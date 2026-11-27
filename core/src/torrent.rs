//! Torrent streaming: a librqbit session plus a tiny local HTTP server that
//! serves one file of a torrent while it downloads (pieces are fetched in
//! playback order; a seek in the player becomes an HTTP Range request and
//! the pieces at that point are fetched first).
//!
//! The server listens on 127.0.0.1 only, on a random port, and every URL
//! carries a random token, so other local programs or web pages cannot use it.
//! The session makes outgoing connections only (no listening port, no UPnP).

use std::collections::HashSet;
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use librqbit::api::TorrentIdOrHash;
use librqbit::limits::LimitsConfig;
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent, Session, SessionOptions};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::release;

const VIDEO_EXT: &[&str] = &["mkv", "mp4", "avi", "webm", "m4v", "mov", "ts", "wmv", "flv"];

/// Open trackers added to every torrent. Feeds often give only an info hash
/// (a magnet without trackers), which leaves DHT as the only way to find
/// peers: slow from a cold start, and sometimes never.
const OPEN_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
];

/// How long to look for peers / metadata before giving up on a source.
const OPEN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

/// .torrent files bigger than this are not torrent files.
const MAX_TORRENT_FILE: usize = 8 * 1024 * 1024;

/// What an http(s) link from a feed points at.
#[derive(Debug)]
pub enum Link {
    Torrent(Vec<u8>),
    Video { len: Option<u64> },
    /// an HTML page or anything else that cannot be played
    Other(String),
}

/// Looks at an http(s) link without downloading more than a torrent file:
/// the content type and the first bytes tell a .torrent from a video or a
/// web page.
pub async fn probe(url: &str) -> anyhow::Result<Link> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("AnimeTV/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let mut r = client.get(url).send().await.map_err(|e| anyhow::anyhow!("no se pudo descargar el enlace: {e}"))?;
    if !r.status().is_success() {
        anyhow::bail!("el enlace respondió {}", r.status());
    }
    let ty = r
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let len = r.content_length();
    if ty.starts_with("video/") || ty.contains("matroska") || ty.contains("mpegurl") {
        return Ok(Link::Video { len });
    }
    if ty.starts_with("text/html") || ty.starts_with("application/xhtml") {
        return Ok(Link::Other("el enlace es una página web, no un torrent ni un vídeo".into()));
    }
    if len.is_some_and(|l| l as usize > MAX_TORRENT_FILE) {
        // big and not declared as video: let the player try it
        return Ok(if crate::sources::is_video_url(url) || ty == "application/octet-stream" {
            Link::Video { len }
        } else {
            Link::Other(format!("el enlace no es un torrent ({ty})"))
        });
    }
    let mut body = Vec::new();
    while let Some(chunk) = r.chunk().await? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_TORRENT_FILE {
            return Ok(if crate::sources::is_video_url(url) { Link::Video { len } } else {
                Link::Other("el enlace no es un torrent".into())
            });
        }
    }
    // bencoded dictionary: "d8:announce…" / "d4:info…"
    if body.first() == Some(&b'd') && body.windows(4).take(4096).any(|w| w == b"info" || w == b"anno") {
        return Ok(Link::Torrent(body));
    }
    let head = String::from_utf8_lossy(&body[..body.len().min(512)]).to_ascii_lowercase();
    if head.contains("<html") || head.contains("<!doctype") {
        return Ok(Link::Other("el enlace es una página web, no un torrent ni un vídeo".into()));
    }
    Ok(Link::Other("el enlace no es un torrent ni un vídeo".into()))
}

fn is_video(name: &str) -> bool {
    name.rsplit('.').next().is_some_and(|e| VIDEO_EXT.contains(&e.to_ascii_lowercase().as_str()))
}

/// Which file of a torrent to play: the one the addon named, else a video
/// whose name says it is the wanted episode, else the largest video, else
/// the largest file.
pub fn choose_file(files: &[(String, u64)], file_idx: Option<usize>, episode: Option<u32>) -> Option<usize> {
    if let Some(i) = file_idx.filter(|i| *i < files.len()) {
        return Some(i);
    }
    let videos: Vec<usize> = (0..files.len()).filter(|i| is_video(&files[*i].0)).collect();
    if let Some(ep) = episode {
        let base = |p: &str| p.rsplit(['/', '\\']).next().unwrap_or(p).to_string();
        let matching: Vec<usize> =
            videos.iter().copied().filter(|i| release::parse(&base(&files[*i].0)).has_episode(ep)).collect();
        if let Some(i) = matching.into_iter().max_by_key(|i| files[*i].1) {
            return Some(i);
        }
        // a pack whose names carry no episode numbers: the n-th video by name
        if videos.len() > 1 && videos.iter().all(|i| release::parse(&base(&files[*i].0)).episode.is_none()) {
            let mut sorted = videos.clone();
            sorted.sort_by(|a, b| files[*a].0.cmp(&files[*b].0));
            if let Some(i) = ep.checked_sub(1).and_then(|n| sorted.get(n as usize)) {
                return Some(*i);
            }
        }
    }
    videos
        .into_iter()
        .max_by_key(|i| files[*i].1)
        .or_else(|| (0..files.len()).max_by_key(|i| files[*i].1))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// torrent id in this session
    pub id: usize,
    pub file_idx: usize,
    pub file_name: String,
    pub file_len: u64,
    /// local URL the player opens
    pub url: String,
    /// the link was a video, not a torrent: `url` is that link and there is
    /// nothing to download (id/file_idx mean nothing)
    pub direct: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "initializing" | "live" | "paused" | "error"
    pub state: String,
    /// bytes of the played file already downloaded and checked
    pub file_downloaded: u64,
    pub file_len: u64,
    pub down_bps: f64,
    pub up_bps: f64,
    pub peers: usize,
    pub error: Option<String>,
}

#[derive(Clone)]
struct ServerState {
    session: Arc<Session>,
    token: Arc<String>,
}

pub struct Engine {
    session: Arc<Session>,
    addr: SocketAddr,
    token: Arc<String>,
}

fn random_token() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("system random");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

impl Engine {
    /// Starts the session (downloads go to `dir`) and the local server.
    /// `upload_kib`: upload limit in KiB/s (None = unlimited).
    pub async fn start(dir: PathBuf, upload_kib: Option<u32>) -> anyhow::Result<Engine> {
        std::fs::create_dir_all(&dir)?;
        let opts = SessionOptions {
            ratelimits: LimitsConfig {
                upload_bps: upload_kib.and_then(|k| NonZeroU32::new(k.saturating_mul(1024))),
                download_bps: None,
            },
            trackers: OPEN_TRACKERS.iter().filter_map(|t| url::Url::parse(t).ok()).collect(),
            ..Default::default()
        };
        let session = Session::new_with_opts(dir, opts).await?;
        let token = Arc::new(random_token());
        let state = ServerState { session: session.clone(), token: token.clone() };
        let app = Router::new().route("/s/{token}/{id}/{file}/{name}", get(serve_file)).with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(Engine { session, addr, token })
    }

    /// Tries each source in turn (a .torrent link, a magnet…) and returns
    /// the first that opens. A link that turns out to be a video is
    /// returned as `direct`.
    pub async fn open_any(&self, sources: &[String], file_idx: Option<usize>, episode: Option<u32>) -> anyhow::Result<Opened> {
        let mut errors = Vec::new();
        for src in sources.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            match self.open(src, file_idx, episode).await {
                Ok(o) => return Ok(o),
                Err(e) => errors.push(e.to_string()),
            }
        }
        match errors.len() {
            0 => anyhow::bail!("este resultado no tiene enlace descargable"),
            1 => anyhow::bail!("{}", errors[0]),
            _ => anyhow::bail!("{}", errors.join(" · ")),
        }
    }

    /// Adds a torrent (magnet or http link), keeps only the file to play
    /// and returns its local streaming URL.
    pub async fn open(&self, source: &str, file_idx: Option<usize>, episode: Option<u32>) -> anyhow::Result<Opened> {
        let add = if source.starts_with("http://") || source.starts_with("https://") {
            match probe(source).await? {
                Link::Torrent(bytes) => AddTorrent::from_bytes(bytes),
                Link::Video { len } => {
                    let name = source.split(['?', '#']).next().unwrap_or(source);
                    let name = name.rsplit('/').next().unwrap_or("video").to_string();
                    return Ok(Opened {
                        id: 0,
                        file_idx: 0,
                        file_name: name,
                        file_len: len.unwrap_or(0),
                        url: source.to_string(),
                        direct: true,
                    });
                }
                Link::Other(why) => anyhow::bail!("{why}"),
            }
        } else if source.starts_with("magnet:") {
            AddTorrent::from_url(source)
        } else {
            anyhow::bail!("enlace no soportado");
        };
        let opts = AddTorrentOptions { paused: true, overwrite: true, ..Default::default() };
        // a magnet resolves its metadata inside add_torrent: both steps are
        // bounded so a torrent nobody seeds fails instead of waiting forever
        let added = tokio::time::timeout(OPEN_TIMEOUT, async {
            let resp = self.session.add_torrent(add, Some(opts)).await?;
            let (id, handle) = match resp {
                AddTorrentResponse::Added(id, h) | AddTorrentResponse::AlreadyManaged(id, h) => (id, h),
                AddTorrentResponse::ListOnly(_) => anyhow::bail!("respuesta inesperada del motor torrent"),
            };
            handle.wait_until_initialized().await?;
            Ok((id, handle))
        })
        .await;
        let (id, handle) = match added {
            Ok(r) => r?,
            Err(_) => anyhow::bail!(
                "nadie comparte este torrent ahora mismo (sin peers tras {} s); prueba otro resultado",
                OPEN_TIMEOUT.as_secs()
            ),
        };
        let files: Vec<(String, u64)> = handle.with_metadata(|m| {
            m.file_infos.iter().map(|f| (f.relative_filename.to_string_lossy().into_owned(), f.len)).collect()
        })?;
        let idx = choose_file(&files, file_idx, episode).ok_or_else(|| anyhow::anyhow!("el torrent no tiene archivos"))?;
        self.session.update_only_files(&handle, &HashSet::from([idx])).await?;
        if handle.is_paused() {
            self.session.unpause(&handle).await?;
        }
        let (name, len) = files[idx].clone();
        let leaf = name.rsplit(['/', '\\']).next().unwrap_or(&name).to_string();
        let enc: String = url::form_urlencoded::byte_serialize(leaf.as_bytes()).collect::<String>().replace('+', "%20");
        Ok(Opened {
            id,
            file_idx: idx,
            file_name: leaf,
            file_len: len,
            url: format!("http://{}/s/{}/{id}/{idx}/{enc}", self.addr, self.token),
            direct: false,
        })
    }

    fn handle(&self, id: usize) -> anyhow::Result<Arc<ManagedTorrent>> {
        self.session.get(TorrentIdOrHash::Id(id)).ok_or_else(|| anyhow::anyhow!("torrent {id} no encontrado"))
    }

    pub fn status(&self, id: usize, file_idx: usize) -> anyhow::Result<Status> {
        let h = self.handle(id)?;
        let s = h.stats();
        let file_len = h.with_metadata(|m| m.file_infos.get(file_idx).map(|f| f.len).unwrap_or(0)).unwrap_or(0);
        let state = serde_json::to_value(&s.state)
            .ok()
            .and_then(|v| v.get("state").and_then(|x| x.as_str()).map(str::to_string))
            .unwrap_or_else(|| "live".into());
        Ok(Status {
            state: if s.error.is_some() { "error".into() } else { state },
            file_downloaded: s.file_progress.get(file_idx).copied().unwrap_or(0),
            file_len,
            down_bps: s.live.as_ref().map(|l| l.download_speed.mbps * 1024.0 * 1024.0).unwrap_or(0.0),
            up_bps: s.live.as_ref().map(|l| l.upload_speed.mbps * 1024.0 * 1024.0).unwrap_or(0.0),
            peers: s.live.as_ref().map(|l| l.snapshot.peer_stats.live as usize).unwrap_or(0),
            error: s.error,
        })
    }

    /// Stops a torrent; `delete_files` also removes what was downloaded.
    pub async fn close(&self, id: usize, delete_files: bool) -> anyhow::Result<()> {
        self.session.delete(TorrentIdOrHash::Id(id), delete_files).await
    }
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("mkv") => "video/x-matroska",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("avi") => "video/x-msvideo",
        Some("ts") => "video/mp2t",
        _ => "application/octet-stream",
    }
}

/// "bytes=START-" / "bytes=START-END" (inclusive end) → (start, end exclusive)
pub fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let r = h.trim().strip_prefix("bytes=")?;
    let (a, b) = r.split_once('-')?;
    if r.contains(',') {
        return None; // multiple ranges: not supported, serve the whole file
    }
    let (start, end) = if a.is_empty() {
        // suffix: last N bytes
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len)
    } else {
        let s: u64 = a.parse().ok()?;
        let e = if b.is_empty() { len } else { b.parse::<u64>().ok()?.saturating_add(1).min(len) };
        (s, e)
    };
    (start < end && start < len).then_some((start, end))
}

async fn serve_file(
    State(st): State<ServerState>,
    Path((token, id, file, name)): Path<(String, usize, usize, String)>,
    headers: HeaderMap,
) -> Response {
    if token != *st.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(handle) = st.session.get(TorrentIdOrHash::Id(id)) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut stream = match handle.stream(file).await {
        Ok(s) => s,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let len = stream.len();
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).map(|h| parse_range(h, len));
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    resp_headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type(&name)));
    let (status, start, end) = match range {
        None => (StatusCode::OK, 0, len),
        Some(Some((s, e))) => (StatusCode::PARTIAL_CONTENT, s, e),
        Some(None) => {
            resp_headers.insert(header::CONTENT_RANGE, HeaderValue::from_str(&format!("bytes */{len}")).unwrap());
            return (StatusCode::RANGE_NOT_SATISFIABLE, resp_headers).into_response();
        }
    };
    if start > 0 && stream.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    if status == StatusCode::PARTIAL_CONTENT {
        resp_headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{}/{len}", end - 1)).unwrap(),
        );
    }
    resp_headers.insert(header::CONTENT_LENGTH, HeaderValue::from(end - start));
    let body = Body::from_stream(ReaderStream::with_capacity(stream.take(end - start), 64 * 1024));
    (status, resp_headers, body).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(list: &[(&str, u64)]) -> Vec<(String, u64)> {
        list.iter().map(|(n, l)| (n.to_string(), *l)).collect()
    }

    #[test]
    fn picks_the_right_file() {
        let pack = f(&[
            ("Show/[G] Show - 01 [1080p].mkv", 1_400),
            ("Show/[G] Show - 02 [1080p].mkv", 1_300),
            ("Show/[G] Show - 03 [1080p].mkv", 1_350),
            ("Show/Extras/NCOP.mkv", 200),
            ("Show/cover.jpg", 5),
        ]);
        assert_eq!(choose_file(&pack, Some(3), Some(2)), Some(3), "the addon's choice wins");
        assert_eq!(choose_file(&pack, None, Some(2)), Some(1));
        assert_eq!(choose_file(&pack, None, None), Some(0), "largest video");
        assert_eq!(choose_file(&pack, Some(99), Some(3)), Some(2), "out-of-range index ignored");

        let single = f(&[("[G] Show - 05.mkv", 900), ("readme.txt", 1)]);
        assert_eq!(choose_file(&single, None, Some(7)), Some(0), "a lone video plays even if numbered differently");

        let unnumbered = f(&[("Show/a.mkv", 10), ("Show/b.mkv", 10), ("Show/c.mkv", 10)]);
        assert_eq!(choose_file(&unnumbered, None, Some(2)), Some(1), "n-th video by name");

        assert_eq!(choose_file(&f(&[("x.iso", 5), ("y.bin", 9)]), None, None), Some(1));
        assert_eq!(choose_file(&[], None, None), None);
    }

    async fn serve(ty: &'static str, body: &'static [u8]) -> String {
        use tokio::io::AsyncWriteExt;
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = l.accept().await {
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf).await;
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {ty}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = s.write_all(head.as_bytes()).await;
                let _ = s.write_all(body).await;
            }
        });
        format!("http://{addr}/x")
    }

    #[tokio::test]
    async fn probes_links() {
        let t = serve("application/x-bittorrent", b"d8:announce3:urle4:infod4:name1:aee").await;
        assert!(matches!(probe(&t).await.unwrap(), Link::Torrent(_)));
        // a .torrent served as octet-stream is still a torrent
        let t = serve("application/octet-stream", b"d4:infod4:name1:aee").await;
        assert!(matches!(probe(&t).await.unwrap(), Link::Torrent(_)));
        let v = serve("video/mp4", b"....ftypisom").await;
        assert!(matches!(probe(&v).await.unwrap(), Link::Video { len: Some(12) }));
        let h = serve("text/html; charset=utf-8", b"<!doctype html><html></html>").await;
        assert!(matches!(probe(&h).await.unwrap(), Link::Other(m) if m.contains("página web")));
        let h = serve("text/plain", b"<!DOCTYPE html><html>").await;
        assert!(matches!(probe(&h).await.unwrap(), Link::Other(_)));
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 100)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 20)));
        assert_eq!(parse_range("bytes=90-200", 100), Some((90, 100)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 100)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("bytes=0-1,5-6", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }
}
