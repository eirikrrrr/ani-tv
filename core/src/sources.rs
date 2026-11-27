//! User-configured sources → normalized releases.
//!
//! Two kinds, both RSS 2.0 underneath:
//! - **Torznab** (`/api?t=search&q=…`): what Prowlarr and Jackett expose for
//!   hundreds of sites. Extra data comes as `<torznab:attr name=… value=…/>`.
//! - **RSS**: any feed. A `{query}` placeholder in the URL is replaced by the
//!   search text; without it the feed is read as is and filtered locally.
//!
//! Feeds are untrusted input: requests time out, bodies are size-capped, and
//! only magnet links / torrent URLs are taken from them.

use std::time::Duration;

use futures::future::join_all;
use serde::{Deserialize, Serialize};

use crate::release::{self, Lang, ParsedName};

/// Torznab category for anime (TV/Anime).
pub const ANIME_CATEGORY: &str = "5070";
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SourceKind {
    #[serde(rename_all = "camelCase")]
    Torznab {
        /// e.g. http://localhost:9696/1/api (Prowlarr) or …/torznab/api (Jackett)
        url: String,
        #[serde(default)]
        api_key: Option<String>,
        /// comma-separated Torznab categories; default: anime (5070)
        #[serde(default)]
        categories: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Rss { url: String },
    /// A Stremio addon: base URL plus what its stream resource accepts
    /// (copied from the manifest when installed).
    #[serde(rename_all = "camelCase")]
    Stremio {
        url: String,
        #[serde(default)]
        types: Vec<String>,
        #[serde(default)]
        id_prefixes: Option<Vec<String>>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(flatten)]
    pub kind: SourceKind,
    /// Subtitle language assumed when a release name does not say (e.g. a
    /// feed of a Spanish fansub site).
    #[serde(default)]
    pub default_subs: Option<Lang>,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    /// `Source::id` it came from
    pub source: String,
    pub title: String,
    pub magnet: Option<String>,
    pub torrent_url: Option<String>,
    pub info_hash: Option<String>,
    pub size: Option<u64>,
    pub seeders: Option<u32>,
    pub leechers: Option<u32>,
    pub published: Option<String>,
    /// the release's page on the site, when the feed gives one
    pub info_url: Option<String>,
    /// file inside the torrent to play (addons pick it for packs)
    pub file_idx: Option<u32>,
    /// direct http(s) stream (some addons)
    pub url: Option<String>,
    /// already known to be the wanted episode (addon results): ranking does
    /// not filter it by title/episode
    pub exact: bool,
    pub parsed: ParsedName,
}

#[derive(Debug)]
pub enum Error {
    Url(String),
    Http(String),
    Feed(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Url(e) => write!(f, "URL no válida: {e}"),
            Error::Http(e) => write!(f, "{e}"),
            Error::Feed(e) => write!(f, "respuesta no válida: {e}"),
        }
    }
}

impl std::error::Error for Error {}

/// The URL to request for `query` (empty query = latest items).
pub fn request_url(kind: &SourceKind, query: &str) -> Result<url::Url, Error> {
    match kind {
        SourceKind::Torznab { url, api_key, categories } => {
            let mut u = url::Url::parse(url.trim()).map_err(|e| Error::Url(e.to_string()))?;
            if !u.path().trim_end_matches('/').ends_with("/api") {
                let p = format!("{}/api", u.path().trim_end_matches('/'));
                u.set_path(&p);
            }
            {
                let keep: Vec<(String, String)> = u
                    .query_pairs()
                    .filter(|(k, _)| !matches!(k.as_ref(), "t" | "q" | "cat" | "apikey"))
                    .map(|(k, v)| (k.into_owned(), v.into_owned()))
                    .collect();
                let mut qp = u.query_pairs_mut();
                qp.clear();
                for (k, v) in keep {
                    qp.append_pair(&k, &v);
                }
                qp.append_pair("t", "search");
                qp.append_pair("q", query);
                qp.append_pair("cat", categories.as_deref().filter(|c| !c.trim().is_empty()).unwrap_or(ANIME_CATEGORY));
                if let Some(k) = api_key.as_deref().filter(|k| !k.is_empty()) {
                    qp.append_pair("apikey", k);
                }
            }
            Ok(u)
        }
        SourceKind::Rss { url } => {
            let enc: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
            let s = url.trim().replace("{query}", &enc);
            url::Url::parse(&s).map_err(|e| Error::Url(e.to_string()))
        }
        SourceKind::Stremio { .. } => Err(Error::Url("un addon no es un feed".into())),
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("AnimeTV/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("http client")
}

async fn fetch(url: url::Url) -> Result<String, Error> {
    let mut r = client().get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            Error::Http("no respondió a tiempo".into())
        } else if e.is_connect() {
            Error::Http("no se pudo conectar".into())
        } else {
            Error::Http(e.to_string())
        }
    })?;
    let status = r.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(Error::Http(format!("HTTP {status}: revisa la API key")));
    }
    if !status.is_success() {
        return Err(Error::Http(format!("HTTP {status}")));
    }
    let mut body = Vec::new();
    while let Some(chunk) = r.chunk().await.map_err(|e| Error::Http(e.to_string()))? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BODY {
            return Err(Error::Feed("respuesta demasiado grande".into()));
        }
    }
    String::from_utf8(body).map_err(|_| Error::Feed("no es texto UTF-8".into()))
}

/// "1.4 GiB", "700 MB", "123456" → bytes
pub fn parse_size(s: &str) -> Option<u64> {
    let s = s.trim();
    if let Ok(n) = s.parse::<u64>() {
        return Some(n);
    }
    let i = s.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))?;
    let n: f64 = s[..i].replace(',', ".").trim().parse().ok()?;
    let unit = s[i..].trim().to_ascii_lowercase();
    let mul: f64 = match unit.as_str() {
        "b" | "bytes" => 1.0,
        // torrent sites and clients write "GB" for 1024³ (and show sizes so)
        "kb" | "kib" => 1024.0,
        "mb" | "mib" => 1024f64.powi(2),
        "gb" | "gib" => 1024f64.powi(3),
        "tb" | "tib" => 1024f64.powi(4),
        _ => return None,
    };
    Some((n * mul) as u64)
}

fn magnet_for(hash: &str, title: &str) -> String {
    let dn: String = url::form_urlencoded::byte_serialize(title.as_bytes()).collect();
    format!("magnet:?xt=urn:btih:{hash}&dn={dn}")
}

fn hash_from_magnet(m: &str) -> Option<String> {
    let i = m.to_ascii_lowercase().find("urn:btih:")? + "urn:btih:".len();
    let h: String = m[i..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    (h.len() == 40 || h.len() == 32).then(|| h.to_ascii_lowercase())
}

fn is_http(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://")
}

/// A link whose path ends in a video extension (query string ignored).
pub fn is_video_url(u: &str) -> bool {
    let path = u.split(['?', '#']).next().unwrap_or(u);
    let ext = path.rsplit('/').next().and_then(|f| f.rsplit_once('.')).map(|(_, e)| e.to_ascii_lowercase());
    matches!(ext.as_deref(), Some("mkv" | "mp4" | "webm" | "m4v" | "mov" | "avi" | "ts" | "m3u8"))
}

/// Parses an RSS/Torznab document into releases. Unknown elements are ignored;
/// items without a title or anything downloadable are skipped.
pub fn parse_feed(xml: &str, source_id: &str) -> Result<Vec<Release>, Error> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| Error::Feed(e.to_string()))?;
    let root = doc.root_element();
    if root.tag_name().name() == "error" {
        let msg = root.attribute("description").unwrap_or("error del indexador");
        return Err(Error::Feed(msg.to_string()));
    }
    let mut out = Vec::new();
    for item in doc.descendants().filter(|n| n.has_tag_name("item")) {
        let text = |name: &str| {
            item.children()
                .find(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case(name))
                .and_then(|c| c.text())
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
        };
        let Some(title) = text("title") else { continue };

        let mut magnet = None;
        let mut torrent_url = None;
        let mut info_hash = text("infoHash").map(|h| h.to_ascii_lowercase());
        let mut size = text("size").and_then(|s| parse_size(&s));
        let mut seeders = text("seeders").and_then(|s| s.parse().ok());
        let mut leechers = text("leechers").and_then(|s| s.parse().ok());
        let mut peers: Option<u32> = None;

        // torznab:attr name=… value=…
        for a in item.children().filter(|c| c.is_element() && c.tag_name().name() == "attr") {
            let (Some(name), Some(value)) = (a.attribute("name"), a.attribute("value")) else { continue };
            match name.to_ascii_lowercase().as_str() {
                "seeders" => seeders = value.parse().ok(),
                "peers" => peers = value.parse().ok(),
                "leechers" => leechers = value.parse().ok(),
                "infohash" => info_hash = Some(value.to_ascii_lowercase()),
                "magneturl" if value.starts_with("magnet:") => magnet = Some(value.to_string()),
                "size" => size = value.parse().ok().or(size),
                _ => {}
            }
        }
        if leechers.is_none() {
            if let (Some(p), Some(s)) = (peers, seeders) {
                leechers = Some(p.saturating_sub(s));
            }
        }

        // a feed may carry the video itself (podcast-style enclosure)
        let mut direct = None;
        let enclosure = item.children().find(|c| c.has_tag_name("enclosure"));
        if let Some(e) = enclosure {
            if let Some(u) = e.attribute("url") {
                let ty = e.attribute("type").unwrap_or("").to_ascii_lowercase();
                if u.starts_with("magnet:") {
                    magnet.get_or_insert_with(|| u.to_string());
                } else if is_http(u) && (ty.starts_with("video/") || is_video_url(u)) {
                    direct = Some(u.to_string());
                } else if is_http(u) {
                    torrent_url = Some(u.to_string());
                }
            }
            if size.is_none() {
                size = e.attribute("length").and_then(|l| l.parse().ok()).filter(|n| *n > 0);
            }
        }
        let link = text("link");
        let guid = text("guid");
        for l in [link.as_deref(), guid.as_deref()].into_iter().flatten() {
            if l.starts_with("magnet:") {
                magnet.get_or_insert_with(|| l.to_string());
            }
        }
        if torrent_url.is_none() {
            torrent_url = link.as_deref().filter(|l| is_http(l) && l.contains(".torrent")).map(str::to_string);
        }
        if direct.is_none() {
            direct = link.as_deref().filter(|l| is_http(l) && is_video_url(l)).map(str::to_string);
        }
        if info_hash.is_none() {
            info_hash = magnet.as_deref().and_then(hash_from_magnet);
        }
        if magnet.is_none() {
            if let Some(h) = info_hash.as_deref() {
                magnet = Some(magnet_for(h, &title));
            }
        }
        if magnet.is_none() && torrent_url.is_none() && direct.is_none() {
            // fall back to an http link only if it is all there is (what it
            // points at is checked when it is played: torrent::probe)
            torrent_url = link.clone().filter(|l| is_http(l));
            if torrent_url.is_none() {
                continue;
            }
        }
        let info_url = text("comments")
            .or_else(|| guid.clone().filter(|g| is_http(g) && !g.contains(".torrent")))
            .filter(|u| is_http(u));

        out.push(Release {
            source: source_id.to_string(),
            parsed: release::parse(&title),
            title,
            magnet,
            torrent_url,
            info_hash,
            size,
            seeders,
            leechers,
            published: text("pubDate"),
            info_url,
            file_idx: None,
            url: direct,
            exact: false,
        });
    }
    Ok(out)
}

/// One source, one query.
pub async fn search_source(src: &Source, query: &str) -> Result<Vec<Release>, Error> {
    let url = request_url(&src.kind, query)?;
    let body = fetch(url).await?;
    let mut releases = parse_feed(&body, &src.id)?;
    if let Some(lang) = src.default_subs {
        for r in &mut releases {
            if r.parsed.subs.is_empty() && !r.parsed.raw {
                r.parsed.subs.push(lang);
            }
        }
    }
    Ok(releases)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceError {
    pub source: String,
    pub name: String,
    pub error: String,
}

#[derive(Debug, Default, Serialize)]
pub struct SearchOutcome {
    pub releases: Vec<Release>,
    pub errors: Vec<SourceError>,
}

/// Every enabled source, concurrently: feeds once per title variant, addons
/// once for the target episode. Duplicates (same info hash, or same name)
/// are dropped, keeping the first (addon results carry the file to play);
/// per-source failures are reported without failing the whole search.
pub async fn search_all(sources: &[Source], titles: &[String], target: Option<crate::addons::Target>) -> SearchOutcome {
    search_all_with(sources, titles, target, crate::addons::MAPPING_URL).await
}

pub async fn search_all_with(
    sources: &[Source],
    titles: &[String],
    target: Option<crate::addons::Target>,
    mapping_url: &str,
) -> SearchOutcome {
    use futures::future::BoxFuture;
    let titles: Vec<&String> = titles.iter().filter(|t| !t.trim().is_empty()).take(3).collect();
    let mut jobs: Vec<BoxFuture<'_, (&Source, Result<Vec<Release>, Error>)>> = Vec::new();
    for s in sources.iter().filter(|s| s.enabled) {
        match &s.kind {
            SourceKind::Stremio { url, types, id_prefixes } => {
                let Some(t) = target else { continue };
                let support = crate::addons::StreamSupport { types: types.clone(), id_prefixes: id_prefixes.clone() };
                jobs.push(Box::pin(async move {
                    (s, crate::addons::streams(&s.id, url, &support, &t, mapping_url).await)
                }));
            }
            _ => {
                for t in &titles {
                    jobs.push(Box::pin(async move { (s, search_source(s, t).await) }));
                }
            }
        }
    }
    let mut out = SearchOutcome::default();
    let mut seen = std::collections::HashSet::new();
    let mut results = join_all(jobs).await;
    // addon results first so their entry (with file index) wins de-duplication
    results.sort_by_key(|(s, _)| !matches!(s.kind, SourceKind::Stremio { .. }));
    for (src, res) in results {
        match res {
            Ok(rs) => {
                for r in rs {
                    let key = r.info_hash.clone().unwrap_or_else(|| release::normalize(&r.title));
                    if seen.insert(key) {
                        out.releases.push(r);
                    }
                }
            }
            Err(e) => {
                if !out.errors.iter().any(|x| x.source == src.id) {
                    out.errors.push(SourceError { source: src.id.clone(), name: src.name.clone(), error: e.to_string() });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const TORZNAB: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
<channel><title>Indexer</title>
<item>
  <title>[GroupA] Frieren - 12 (1080p) [Multi-Subs]</title>
  <guid>https://example.org/view/1</guid>
  <link>https://example.org/download/1.torrent</link>
  <comments>https://example.org/view/1</comments>
  <pubDate>Fri, 22 Nov 2026 10:00:00 +0000</pubDate>
  <size>1468006400</size>
  <enclosure url="https://example.org/download/1.torrent" length="1468006400" type="application/x-bittorrent"/>
  <torznab:attr name="seeders" value="250"/>
  <torznab:attr name="peers" value="270"/>
  <torznab:attr name="infohash" value="0123456789ABCDEF0123456789ABCDEF01234567"/>
</item>
<item>
  <title>[GrupoB] Frieren - 12 [720p][Sub Español]</title>
  <link>magnet:?xt=urn:btih:89abcdef0123456789abcdef0123456789abcdef&amp;dn=x</link>
  <torznab:attr name="seeders" value="12"/>
</item>
<item><title>No download here</title></item>
</channel></rss>"#;

    const RSS: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:site="https://example.org/xmlns" version="2.0"><channel>
<item>
  <title>[GroupC] Frieren - 13 (1080p)</title>
  <link>https://example.org/download/2.torrent</link>
  <guid isPermaLink="true">https://example.org/view/2</guid>
  <site:seeders>40</site:seeders>
  <site:leechers>3</site:leechers>
  <site:infoHash>fedcba9876543210fedcba9876543210fedcba98</site:infoHash>
  <site:size>1.4 GiB</site:size>
</item>
</channel></rss>"#;

    #[test]
    fn torznab_items() {
        let rs = parse_feed(TORZNAB, "t").unwrap();
        assert_eq!(rs.len(), 2, "the item without a download is skipped");
        let a = &rs[0];
        assert_eq!(a.seeders, Some(250));
        assert_eq!(a.leechers, Some(20));
        assert_eq!(a.size, Some(1468006400));
        assert_eq!(a.info_hash.as_deref(), Some("0123456789abcdef0123456789abcdef01234567"));
        assert!(a.magnet.as_deref().unwrap().starts_with("magnet:?xt=urn:btih:0123"));
        assert_eq!(a.torrent_url.as_deref(), Some("https://example.org/download/1.torrent"));
        assert_eq!(a.info_url.as_deref(), Some("https://example.org/view/1"));
        assert_eq!(a.parsed.episode, Some(12));

        let b = &rs[1];
        assert_eq!(b.info_hash.as_deref(), Some("89abcdef0123456789abcdef0123456789abcdef"));
        assert_eq!(b.parsed.subs, vec![Lang::Es]);
    }

    #[test]
    fn plain_rss_with_namespaced_fields() {
        let rs = parse_feed(RSS, "r").unwrap();
        assert_eq!(rs.len(), 1);
        let r = &rs[0];
        assert_eq!(r.seeders, Some(40));
        assert_eq!(r.leechers, Some(3));
        assert_eq!(r.size, Some(1503238553));
        assert!(r.magnet.is_some(), "magnet built from the info hash");
        assert_eq!(r.info_url.as_deref(), Some("https://example.org/view/2"));
    }

    #[test]
    fn video_enclosures_play_directly() {
        let xml = r#"<rss version="2.0"><channel>
<item><title>Show - 03</title><enclosure url="https://cdn.example.org/ep3" type="video/mp4" length="9"/></item>
<item><title>Show - 04</title><link>https://cdn.example.org/show-04.mkv?sig=1</link></item>
<item><title>Show - 05</title><link>https://example.org/watch/5</link></item>
</channel></rss>"#;
        let rs = parse_feed(xml, "r").unwrap();
        assert_eq!(rs[0].url.as_deref(), Some("https://cdn.example.org/ep3"));
        assert_eq!(rs[0].torrent_url, None);
        assert_eq!(rs[1].url.as_deref(), Some("https://cdn.example.org/show-04.mkv?sig=1"));
        assert_eq!(rs[2].url, None, "a web page is not a video");
        assert_eq!(rs[2].torrent_url.as_deref(), Some("https://example.org/watch/5"), "checked when played");
        assert!(is_video_url("https://x/a.MKV"));
        assert!(!is_video_url("https://x/a.torrent"));
    }

    #[test]
    fn torznab_error_document() {
        let e = parse_feed(r#"<error code="100" description="Invalid API Key"/>"#, "t").unwrap_err();
        assert!(e.to_string().contains("Invalid API Key"));
    }

    #[test]
    fn request_urls() {
        let k = SourceKind::Torznab { url: "http://localhost:9696/1/".into(), api_key: Some("KEY".into()), categories: None };
        assert_eq!(
            request_url(&k, "Sousou no Frieren").unwrap().as_str(),
            "http://localhost:9696/1/api?t=search&q=Sousou+no+Frieren&cat=5070&apikey=KEY"
        );
        let k = SourceKind::Torznab { url: "http://h/api/v2.0/indexers/all/results/torznab/api?apikey=OLD&x=1".into(), api_key: Some("NEW".into()), categories: Some("5070,2000".into()) };
        let u = request_url(&k, "x").unwrap();
        assert_eq!(u.path(), "/api/v2.0/indexers/all/results/torznab/api");
        assert_eq!(u.query(), Some("x=1&t=search&q=x&cat=5070%2C2000&apikey=NEW"));

        let k = SourceKind::Rss { url: "https://example.org/?page=rss&q={query}&c=1_0".into() };
        assert_eq!(request_url(&k, "Frieren 12").unwrap().as_str(), "https://example.org/?page=rss&q=Frieren+12&c=1_0");
    }

    #[test]
    fn sizes() {
        assert_eq!(parse_size("1024"), Some(1024));
        assert_eq!(parse_size("1 KiB"), Some(1024));
        assert_eq!(parse_size("700 MB"), Some(734_003_200));
        assert_eq!(parse_size("1,5 GiB"), Some(1610612736));
        assert_eq!(parse_size("lots"), None);
    }

    /// A one-shot HTTP server returning `body`, for end-to-end tests.
    async fn serve(status: &str, body: &'static str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let status = status.to_string();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = l.accept().await {
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf).await;
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(resp.as_bytes()).await;
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn search_all_merges_sources_and_reports_failures() {
        let good = serve("200 OK", TORZNAB).await;
        let rss = serve("200 OK", RSS).await;
        let bad = serve("401 Unauthorized", "").await;
        let sources = vec![
            Source { id: "a".into(), name: "Prowlarr".into(), enabled: true, default_subs: None,
                kind: SourceKind::Torznab { url: format!("{good}/1"), api_key: Some("k".into()), categories: None } },
            Source { id: "b".into(), name: "Feed".into(), enabled: true, default_subs: Some(Lang::Es),
                kind: SourceKind::Rss { url: format!("{rss}/rss?q={{query}}") } },
            Source { id: "c".into(), name: "Broken".into(), enabled: true, default_subs: None,
                kind: SourceKind::Torznab { url: bad.clone(), api_key: None, categories: None } },
            Source { id: "d".into(), name: "Off".into(), enabled: false, default_subs: None,
                kind: SourceKind::Rss { url: bad } },
        ];
        // two titles hit each source twice: duplicates must collapse
        let out = search_all(&sources, &["Frieren".into(), "Sousou no Frieren".into()], None).await;
        assert_eq!(out.releases.len(), 3);
        let from_feed = out.releases.iter().find(|r| r.source == "b").unwrap();
        assert_eq!(from_feed.parsed.subs, vec![Lang::Es], "the source's default subtitle language applies");
        assert_eq!(out.errors.len(), 1);
        assert_eq!(out.errors[0].name, "Broken");
        assert!(out.errors[0].error.contains("API key"));
    }
}
