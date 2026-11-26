//! Stremio addon protocol: an addon is an HTTP service described by a
//! `manifest.json`; for streams the app requests
//! `{base}/stream/{type}/{id}.json` and gets `{ streams: [...] }`.
//!
//! Series are identified by the addon's own id scheme (`kitsu:<id>:<ep>`,
//! `tt<imdb>:<season>:<ep>`, `mal:…`, `anilist:…`), so the AniList id is mapped
//! to the others first (api.ani.zip, cached).
//!
//! The app ships no addons; users install the ones they choose. Responses are
//! untrusted input: timeouts, size caps, only magnets / http(s) URLs kept.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::release::{self, Lang};
use crate::sources::{parse_size, Error, Release};

const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY: usize = 4 * 1024 * 1024;
pub const MAPPING_URL: &str = "https://api.ani.zip/mappings";

// ---------------------------------------------------------------------------
// manifest

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Resource {
    Name(String),
    #[serde(rename_all = "camelCase")]
    Full {
        name: String,
        #[serde(default)]
        types: Option<Vec<String>>,
        #[serde(default)]
        id_prefixes: Option<Vec<String>>,
    },
}

impl Resource {
    fn name(&self) -> &str {
        match self {
            Resource::Name(n) => n,
            Resource::Full { name, .. } => name,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorHints {
    #[serde(default)]
    pub adult: bool,
    #[serde(default)]
    pub p2p: bool,
    #[serde(default)]
    pub configurable: bool,
    #[serde(default)]
    pub configuration_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    #[serde(default)]
    pub version: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub resources: Vec<Resource>,
    #[serde(default)]
    pub id_prefixes: Option<Vec<String>>,
    #[serde(default)]
    pub behavior_hints: BehaviorHints,
}

/// What the app needs to ask an addon for streams.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSupport {
    /// content types the stream resource serves ("series", "movie", "anime"…)
    pub types: Vec<String>,
    /// id prefixes it understands; None = any
    pub id_prefixes: Option<Vec<String>>,
}

impl Manifest {
    /// None when the addon offers no streams (catalog/subtitle-only addons).
    pub fn stream_support(&self) -> Option<StreamSupport> {
        let r = self.resources.iter().find(|r| r.name() == "stream")?;
        let (types, prefixes) = match r {
            Resource::Name(_) => (None, None),
            Resource::Full { types, id_prefixes, .. } => (types.clone(), id_prefixes.clone()),
        };
        Some(StreamSupport {
            types: types.unwrap_or_else(|| self.types.clone()),
            id_prefixes: prefixes.or_else(|| self.id_prefixes.clone()),
        })
    }
}

/// `stremio://host/manifest.json`, `https://host/x/manifest.json` or the bare
/// base URL → the base URL (no trailing `/manifest.json`, no trailing slash).
pub fn base_url(input: &str) -> Result<String, Error> {
    let mut s = input.trim().to_string();
    if let Some(rest) = s.strip_prefix("stremio://") {
        s = format!("https://{rest}");
    }
    if !(s.starts_with("https://") || s.starts_with("http://")) {
        return Err(Error::Url("debe empezar por https://, http:// o stremio://".into()));
    }
    let u = url::Url::parse(&s).map_err(|e| Error::Url(e.to_string()))?;
    let mut base = u.as_str().to_string();
    if let Some(i) = base.find('?') {
        base.truncate(i);
    }
    let base = base.trim_end_matches('/').trim_end_matches("/manifest.json").trim_end_matches('/');
    Ok(base.to_string())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("AnimeTV/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("http client")
}

async fn get_json<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T, Error> {
    let mut r = client().get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            Error::Http("no respondió a tiempo".into())
        } else if e.is_connect() {
            Error::Http("no se pudo conectar".into())
        } else {
            Error::Http(e.to_string())
        }
    })?;
    if !r.status().is_success() {
        return Err(Error::Http(format!("HTTP {}", r.status())));
    }
    let mut body = Vec::new();
    while let Some(chunk) = r.chunk().await.map_err(|e| Error::Http(e.to_string()))? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BODY {
            return Err(Error::Feed("respuesta demasiado grande".into()));
        }
    }
    serde_json::from_slice(&body).map_err(|e| Error::Feed(e.to_string()))
}

/// Reads an addon's manifest. Returns its base URL (what to store) too.
pub async fn fetch_manifest(input: &str) -> Result<(String, Manifest), Error> {
    let base = base_url(input)?;
    let m: Manifest = get_json(&format!("{base}/manifest.json")).await?;
    Ok((base, m))
}

// ---------------------------------------------------------------------------
// ids

#[derive(Debug, Clone, Default)]
pub struct Ids {
    pub anilist: u32,
    pub kitsu: Option<u64>,
    pub imdb: Option<String>,
    pub mal: Option<u64>,
    /// AniList episode → (season, episode) as IMDb/TVDB number them
    pub tv_episode: HashMap<u32, (u32, u32)>,
}

#[derive(Deserialize)]
struct AniZip {
    #[serde(default)]
    mappings: AniZipMappings,
    #[serde(default)]
    episodes: HashMap<String, AniZipEpisode>,
}
#[derive(Deserialize, Default)]
struct AniZipMappings {
    kitsu_id: Option<serde_json::Value>,
    imdb_id: Option<String>,
    mal_id: Option<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AniZipEpisode {
    episode_number: Option<u32>,
    season_number: Option<u32>,
}

fn as_u64(v: &Option<serde_json::Value>) -> Option<u64> {
    match v.as_ref()? {
        serde_json::Value::Number(n) => n.as_u64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

static ID_CACHE: LazyLock<Mutex<HashMap<u32, Ids>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// AniList id → Kitsu/IMDb/MAL ids, from `mapping_url` (api.ani.zip).
pub async fn ids_from(mapping_url: &str, anilist: u32) -> Result<Ids, Error> {
    if let Some(hit) = ID_CACHE.lock().unwrap().get(&anilist) {
        return Ok(hit.clone());
    }
    let z: AniZip = get_json(&format!("{mapping_url}?anilist_id={anilist}")).await?;
    let mut tv_episode = HashMap::new();
    for (k, e) in z.episodes {
        if let (Ok(n), Some(s), Some(ep)) = (k.parse::<u32>(), e.season_number, e.episode_number) {
            if s > 0 {
                tv_episode.insert(n, (s, ep));
            }
        }
    }
    let ids = Ids {
        anilist,
        kitsu: as_u64(&z.mappings.kitsu_id),
        imdb: z.mappings.imdb_id.filter(|s| s.starts_with("tt")),
        mal: as_u64(&z.mappings.mal_id),
        tv_episode,
    };
    ID_CACHE.lock().unwrap().insert(anilist, ids.clone());
    Ok(ids)
}

/// What is being looked for, in AniList terms.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub anilist_id: u32,
    pub episode: Option<u32>,
    pub movie: bool,
}

/// (type, id) pairs to try, in order of preference.
pub fn candidates(ids: &Ids, t: &Target) -> Vec<(String, String)> {
    let mut v = Vec::new();
    let ep = t.episode.unwrap_or(1);
    if t.movie {
        if let Some(i) = &ids.imdb {
            v.push(("movie".into(), i.clone()));
        }
        if let Some(k) = ids.kitsu {
            v.push(("movie".into(), format!("kitsu:{k}")));
            v.push(("anime".into(), format!("kitsu:{k}")));
        }
        return v;
    }
    if let Some(k) = ids.kitsu {
        v.push(("series".into(), format!("kitsu:{k}:{ep}")));
        v.push(("anime".into(), format!("kitsu:{k}:{ep}")));
    }
    if let (Some(i), Some((s, e))) = (&ids.imdb, ids.tv_episode.get(&ep)) {
        v.push(("series".into(), format!("{i}:{s}:{e}")));
    }
    if let Some(m) = ids.mal {
        v.push(("series".into(), format!("mal:{m}:{ep}")));
        v.push(("anime".into(), format!("mal:{m}:{ep}")));
    }
    v.push(("series".into(), format!("anilist:{}:{ep}", ids.anilist)));
    v.push(("anime".into(), format!("anilist:{}:{ep}", ids.anilist)));
    v
}

/// The first candidate this addon understands.
pub fn pick(support: &StreamSupport, cands: &[(String, String)]) -> Option<(String, String)> {
    cands
        .iter()
        .find(|(ty, id)| {
            let type_ok = support.types.is_empty() || support.types.iter().any(|t| t == ty);
            let prefix_ok = match &support.id_prefixes {
                None => true,
                Some(ps) => ps.iter().any(|p| id.starts_with(p.as_str())),
            };
            type_ok && prefix_ok
        })
        .cloned()
}

// ---------------------------------------------------------------------------
// streams

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub info_hash: Option<String>,
    #[serde(default)]
    pub file_idx: Option<u32>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub behavior_hints: StreamHints,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamHints {
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub video_size: Option<u64>,
}

#[derive(Deserialize)]
struct Streams {
    #[serde(default)]
    streams: Vec<Stream>,
}

static SEEDERS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:👤|👥|seeders?:?)\s*(\d+)").unwrap());
static SIZE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(?:💾|size:?)\s*([\d.,]+\s*[KMGT]i?B)").unwrap());

/// Flag emojis addons put in stream titles. Treated as subtitle languages
/// (for anime the release language is usually the subtitles); Japanese is audio.
const FLAGS: &[(&str, Lang)] = &[
    ("🇪🇸", Lang::Es),
    ("🇲🇽", Lang::EsLatam),
    ("🇦🇷", Lang::EsLatam),
    ("🇨🇴", Lang::EsLatam),
    ("🇬🇧", Lang::En),
    ("🇺🇸", Lang::En),
    ("🇧🇷", Lang::PtBr),
    ("🇵🇹", Lang::PtBr),
    ("🇫🇷", Lang::Fr),
    ("🇩🇪", Lang::De),
    ("🇮🇹", Lang::It),
];

fn magnet(hash: &str, name: &str, sources: &[String]) -> String {
    let dn: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
    let mut m = format!("magnet:?xt=urn:btih:{hash}&dn={dn}");
    for s in sources.iter().filter_map(|s| s.strip_prefix("tracker:")).take(20) {
        let tr: String = url::form_urlencoded::byte_serialize(s.as_bytes()).collect();
        m.push_str("&tr=");
        m.push_str(&tr);
    }
    m
}

/// A stream from an addon → a release for the picker. `None` when it has
/// nothing playable (neither a torrent nor an http(s) URL).
pub fn to_release(source_id: &str, s: Stream) -> Option<Release> {
    let hash = s.info_hash.as_deref().map(str::to_ascii_lowercase).filter(|h| h.len() == 40 || h.len() == 32);
    let url = s.url.clone().filter(|u| u.starts_with("https://") || u.starts_with("http://"));
    if hash.is_none() && url.is_none() {
        return None;
    }
    let body = [s.title.as_deref(), s.description.as_deref()].into_iter().flatten().collect::<Vec<_>>().join("\n");
    let first_line = body.lines().next().unwrap_or("").trim().to_string();
    let display = s.behavior_hints.filename.clone().filter(|f| !f.is_empty()).unwrap_or_else(|| {
        if first_line.is_empty() { s.name.clone().unwrap_or_default() } else { first_line.clone() }
    });
    let all_text = format!("{}\n{}", s.name.as_deref().unwrap_or(""), body);

    let mut parsed = release::parse(&display);
    let (audio, subs, raw) = release::detect_languages(&all_text);
    parsed.audio = audio;
    parsed.subs = subs;
    parsed.raw = raw;
    for (flag, lang) in FLAGS {
        if all_text.contains(flag) && !parsed.subs.contains(lang) {
            parsed.subs.push(*lang);
            parsed.raw = false;
        }
    }
    if parsed.resolution.is_none() {
        parsed.resolution = release::parse(&all_text.replace('\n', " ")).resolution;
    }
    // a file picked out of a pack is a single episode
    if s.file_idx.is_some() {
        parsed.batch = false;
        parsed.episode_end = None;
    }

    let seeders = SEEDERS.captures(&all_text).and_then(|c| c[1].parse().ok());
    let size = s.behavior_hints.video_size.or_else(|| SIZE.captures(&all_text).and_then(|c| parse_size(&c[1])));
    let title = if display.is_empty() { s.name.clone().unwrap_or_else(|| "Stream".into()) } else { display };
    Some(Release {
        source: source_id.to_string(),
        magnet: hash.as_deref().map(|h| magnet(h, &title, &s.sources)),
        torrent_url: None,
        info_hash: hash,
        size,
        seeders,
        leechers: None,
        published: None,
        info_url: None,
        file_idx: s.file_idx,
        url,
        exact: true,
        parsed,
        title,
    })
}

/// Streams of one addon for the target episode.
pub async fn streams(
    source_id: &str,
    base: &str,
    support: &StreamSupport,
    target: &Target,
    mapping_url: &str,
) -> Result<Vec<Release>, Error> {
    let ids = ids_from(mapping_url, target.anilist_id).await?;
    let cands = candidates(&ids, target);
    let Some((ty, id)) = pick(support, &cands) else {
        return Err(Error::Feed("este addon no reconoce la serie (no hay un id compatible)".into()));
    };
    let id_enc: String = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>().replace("%3A", ":");
    let s: Streams = get_json(&format!("{}/stream/{ty}/{id_enc}.json", base.trim_end_matches('/'))).await?;
    Ok(s.streams.into_iter().filter_map(|st| to_release(source_id, st)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{
        "id": "org.example.anime", "version": "1.2.0", "name": "Example Anime",
        "description": "Test addon", "logo": "https://example.org/logo.png",
        "types": ["series", "movie", "anime"],
        "catalogs": [],
        "resources": ["catalog", {"name": "stream", "types": ["series", "anime", "movie"], "idPrefixes": ["kitsu", "tt"]}],
        "behaviorHints": {"p2p": true, "configurable": true}
    }"#;

    #[test]
    fn manifest_and_stream_support() {
        let m: Manifest = serde_json::from_str(MANIFEST).unwrap();
        assert_eq!(m.name, "Example Anime");
        assert!(m.behavior_hints.p2p && m.behavior_hints.configurable);
        let s = m.stream_support().unwrap();
        assert_eq!(s.types, vec!["series", "anime", "movie"]);
        assert_eq!(s.id_prefixes, Some(vec!["kitsu".into(), "tt".into()]));

        let subs: Manifest = serde_json::from_str(r#"{"id":"x","name":"Subs","resources":["subtitles"],"types":["movie"]}"#).unwrap();
        assert!(subs.stream_support().is_none());
        // plain string resource: types/prefixes come from the manifest
        let plain: Manifest = serde_json::from_str(r#"{"id":"y","name":"P","resources":["stream"],"types":["series"],"idPrefixes":["tt"]}"#).unwrap();
        assert_eq!(plain.stream_support().unwrap(), StreamSupport { types: vec!["series".into()], id_prefixes: Some(vec!["tt".into()]) });
    }

    #[test]
    fn base_urls() {
        assert_eq!(base_url("stremio://addon.example.org/abc/manifest.json").unwrap(), "https://addon.example.org/abc");
        assert_eq!(base_url("https://addon.example.org/manifest.json").unwrap(), "https://addon.example.org");
        assert_eq!(base_url(" https://addon.example.org/cfg=1/ ").unwrap(), "https://addon.example.org/cfg=1");
        assert!(base_url("ftp://x").is_err());
    }

    fn ids() -> Ids {
        Ids {
            anilist: 154587,
            kitsu: Some(46474),
            imdb: Some("tt22248376".into()),
            mal: Some(52991),
            tv_episode: HashMap::from([(5, (1, 5))]),
        }
    }

    #[test]
    fn candidate_ids_follow_addon_support() {
        let t = Target { anilist_id: 154587, episode: Some(5), movie: false };
        let c = candidates(&ids(), &t);
        let kitsu_only = StreamSupport { types: vec!["series".into()], id_prefixes: Some(vec!["kitsu".into()]) };
        assert_eq!(pick(&kitsu_only, &c), Some(("series".into(), "kitsu:46474:5".into())));
        let imdb_only = StreamSupport { types: vec!["series".into(), "movie".into()], id_prefixes: Some(vec!["tt".into()]) };
        assert_eq!(pick(&imdb_only, &c), Some(("series".into(), "tt22248376:1:5".into())));
        let anime_type = StreamSupport { types: vec!["anime".into()], id_prefixes: Some(vec!["mal".into()]) };
        assert_eq!(pick(&anime_type, &c), Some(("anime".into(), "mal:52991:5".into())));
        let movies = StreamSupport { types: vec!["movie".into()], id_prefixes: None };
        assert_eq!(pick(&movies, &c), None);

        let m = Target { anilist_id: 1, episode: None, movie: true };
        assert_eq!(pick(&imdb_only, &candidates(&ids(), &m)), Some(("movie".into(), "tt22248376".into())));
    }

    #[test]
    fn streams_become_releases() {
        let s: Stream = serde_json::from_str(r#"{
            "name": "Example\n1080p",
            "title": "[GroupA] Sousou no Frieren - 05 (1080p) [HEVC]\n👤 152 💾 1.3 GB ⚙️ Site\n🇪🇸 / 🇬🇧",
            "infoHash": "0123456789ABCDEF0123456789ABCDEF01234567",
            "fileIdx": 4,
            "sources": ["tracker:udp://tracker.example.org:1337/announce", "dht:0123"]
        }"#).unwrap();
        let r = to_release("addon", s).unwrap();
        assert_eq!(r.title, "[GroupA] Sousou no Frieren - 05 (1080p) [HEVC]");
        assert_eq!(r.seeders, Some(152));
        assert_eq!(r.size, Some(1395864371));
        assert_eq!(r.file_idx, Some(4));
        assert_eq!(r.parsed.episode, Some(5));
        assert_eq!(r.parsed.resolution, Some(1080));
        assert!(r.parsed.subs.contains(&Lang::Es) && r.parsed.subs.contains(&Lang::En));
        assert!(r.exact);
        let m = r.magnet.unwrap();
        assert!(m.starts_with("magnet:?xt=urn:btih:0123456789abcdef"));
        assert!(m.contains("&tr=udp%3A%2F%2Ftracker.example.org%3A1337%2Fannounce"));

        let http: Stream = serde_json::from_str(r#"{"name":"Direct","title":"Frieren 05 720p","url":"https://cdn.example.org/v.mp4"}"#).unwrap();
        let r = to_release("addon", http).unwrap();
        assert_eq!(r.url.as_deref(), Some("https://cdn.example.org/v.mp4"));
        assert!(r.magnet.is_none());

        let nothing: Stream = serde_json::from_str(r#"{"name":"YouTube","ytId":"abc"}"#).unwrap();
        assert!(to_release("addon", nothing).is_none());
    }

    async fn serve(routes: Vec<(&'static str, &'static str)>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = l.accept().await {
                let mut buf = vec![0u8; 8192];
                let n = s.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("").to_string();
                let (status, body) = routes
                    .iter()
                    .find(|(p, _)| path.starts_with(p))
                    .map(|(_, b)| ("200 OK", *b))
                    .unwrap_or(("404 Not Found", "{}"));
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(resp.as_bytes()).await;
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn end_to_end_streams_from_an_addon() {
        let mapping = serve(vec![(
            "/mappings?anilist_id=9001",
            r#"{"mappings":{"kitsu_id":777,"imdb_id":"tt0000001","mal_id":"55"},"episodes":{"3":{"episodeNumber":3,"seasonNumber":1}}}"#,
        )])
        .await;
        let addon = serve(vec![
            ("/manifest.json", MANIFEST),
            (
                "/stream/series/kitsu:777:3.json",
                r#"{"streams":[{"name":"A","title":"[G] Show - 03 [1080p] [Sub Español]\n👤 9","infoHash":"89abcdef0123456789abcdef0123456789abcdef"}]}"#,
            ),
        ])
        .await;
        let (base, m) = fetch_manifest(&format!("{addon}/manifest.json")).await.unwrap();
        assert_eq!(base, addon);
        let support = m.stream_support().unwrap();
        let t = Target { anilist_id: 9001, episode: Some(3), movie: false };
        let rs = streams("ex", &base, &support, &t, &format!("{mapping}/mappings")).await.unwrap();
        assert_eq!(rs.len(), 1);
        assert_eq!(rs[0].seeders, Some(9));
        assert_eq!(rs[0].parsed.subs, vec![Lang::Es]);
    }
}
