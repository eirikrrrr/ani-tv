//! Release-name parsing: "[Group] Title - 12 (1080p) [Sub Español].mkv" →
//! group, title, episode, resolution, audio and subtitle languages.
//!
//! Anime releases follow loose conventions (anitomy-style). This is a
//! heuristic parser tuned for those conventions; anything it cannot tell is
//! left as `None` rather than guessed.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// A language for audio or subtitles. `Multi` = several subtitle tracks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Lang {
    #[serde(rename = "ja")]
    Ja,
    #[serde(rename = "en")]
    En,
    /// Spanish (Spain, or unspecified)
    #[serde(rename = "es")]
    Es,
    /// Latin American Spanish
    #[serde(rename = "es-419")]
    EsLatam,
    #[serde(rename = "pt-BR")]
    PtBr,
    #[serde(rename = "fr")]
    Fr,
    #[serde(rename = "de")]
    De,
    #[serde(rename = "it")]
    It,
    #[serde(rename = "multi")]
    Multi,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedName {
    pub group: Option<String>,
    pub title: String,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    /// Last episode of a range ("01-12"): the release is a batch.
    pub episode_end: Option<u32>,
    pub batch: bool,
    pub version: Option<u32>,
    /// Vertical resolution: 480, 720, 1080, 2160…
    pub resolution: Option<u32>,
    pub codec: Option<String>,
    /// Audio languages. Japanese is assumed when nothing says otherwise.
    pub audio: Vec<Lang>,
    /// Subtitle languages; empty = unknown (or none, when `raw`).
    pub subs: Vec<Lang>,
    /// Japanese audio without subtitles.
    pub raw: bool,
}

impl ParsedName {
    /// True when this release contains `ep` (single episode or batch range).
    pub fn has_episode(&self, ep: u32) -> bool {
        match (self.episode, self.episode_end) {
            (Some(a), Some(b)) => a <= ep && ep <= b,
            (Some(a), None) => a == ep,
            _ => false,
        }
    }
}

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($pat).unwrap());
    };
}

re!(EXT, r"(?i)\.(mkv|mp4|avi|webm|m4v|ts)$");
re!(BRACKETS, r"\[([^\]]*)\]|\(([^)]*)\)|【([^】]*)】|\{([^}]*)\}");
re!(RES_P, r"(?i)\b(240|360|480|540|576|720|1080|1440|2160)[pi]\b");
re!(RES_WXH, r"(?i)\b\d{3,4}\s*x\s*(\d{3,4})\b");
re!(RES_4K, r"(?i)\b(4k|uhd)\b");
re!(CODEC, r"(?i)\b(hevc|x\.?265|h\.?265|x\.?264|h\.?264|avc|av1|vp9|xvid)\b");
re!(CRC, r"^[0-9A-Fa-f]{8}$");
re!(SXXEYY, r"(?i)\bS(\d{1,2})\s*E(\d{1,4})(?:v(\d))?\b");
re!(DASH_RANGE, r"(?:^|\s)-\s+(\d{1,4})\s*(?:-|~|to)\s*(\d{1,4})(?:\s|$)");
re!(DASH_EP, r"(?:^|\s)-\s+(\d{1,4})(?:v(\d))?(?:\s|$)");
re!(WORD_EP, r"(?i)\b(?:ep|eps|episode|episodio|cap|capitulo|capítulo|e)\.?\s*(\d{1,4})(?:v(\d))?\b");
re!(RANGE, r"(?:^|\s)(\d{1,4})\s*(?:-|~)\s*(\d{1,4})(?:\s|$)");
re!(TRAILING_NUM, r"\s(\d{1,4})(?:v(\d))?\s*$");
re!(SEASON, r"(?i)\b(?:s|season|temporada|saison)\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b");
re!(BATCH, r"(?i)\b(batch|complete|completa|completo|integral|todos los cap[ií]tulos)\b");
re!(SPACES, r"\s+");

/// Language markers. Phrases are checked before bare words so "sub latino"
/// counts as subtitles, not as a Latin-American dub.
struct LangRule {
    re: Regex,
    audio: &'static [Lang],
    subs: &'static [Lang],
    raw: bool,
}

static LANG_RULES: LazyLock<Vec<LangRule>> = LazyLock::new(|| {
    use Lang::*;
    let r = |p: &str, audio: &'static [Lang], subs: &'static [Lang]| LangRule {
        re: Regex::new(&format!(r"(?i)(?:^|[^\p{{L}}])(?:{p})(?:[^\p{{L}}]|$)")).unwrap(),
        audio,
        subs,
        raw: false,
    };
    let mut v = vec![
        // subtitles stated explicitly
        r(r"(?:sub|subs|subtitulado|subt[ií]tulos|subtitles)\s*(?:en\s+|in\s+)?(?:espa[ñn]ol|castellano|esp|spa|spanish)\s*(?:latino|lat)", &[], &[EsLatam]),
        r(r"(?:sub|subs|subtitulado|subt[ií]tulos|subtitles)\s*(?:en\s+|in\s+)?(?:espa[ñn]ol|castellano|esp|spa|spanish)", &[], &[Es]),
        r(r"(?:sub|subs|subtitulado)\s*(?:en\s+)?latino", &[], &[EsLatam]),
        r(r"(?:eng?\s*sub(?:s|bed)?|english\s*sub(?:s|bed|titles)?|sub(?:s)?\s*(?:eng|english))", &[], &[En]),
        r(r"multi[\s\-_]?subs?|multiple\s+subtitles?|multisub", &[], &[Multi]),
        r(r"vose|vosub", &[Ja], &[Es]),
        r(r"vostfr|vost\s*fr|fr\s*sub", &[Ja], &[Fr]),
        r(r"legendado|pt[\s\-_]?br|ptbr", &[], &[PtBr]),
        // audio stated explicitly
        r(r"dual[\s\-_]?audio", &[Ja, En], &[]),
        r(r"(?:audio\s+)?(?:espa[ñn]ol\s+)?latino|audio\s+lat|lat(?:am)?\s+dub", &[EsLatam], &[]),
        r(r"audio\s+(?:castellano|espa[ñn]ol)|castellano|espa[ñn]ol\s+espa[ñn]a|\bcast\b", &[Es], &[]),
        r(r"(?:english|eng)\s*dub(?:bed)?|dubbed", &[En], &[]),
        r(r"(?:jap|jpn|japanese|japon[eé]s)\s*audio|audio\s*(?:jap|jpn|japanese|japon[eé]s)", &[Ja], &[]),
        // bare language tags (in fansub naming these mean subtitles)
        r(r"espa[ñn]ol|esp|spa|spanish", &[], &[Es]),
        r(r"eng|english", &[], &[En]),
        r(r"multi", &[], &[Multi]),
        r(r"fre|french|fran[çc]ais", &[], &[Fr]),
        r(r"ger|deu|german|deutsch", &[], &[De]),
        r(r"ita|italian|italiano", &[], &[It]),
        r(r"por|portugu[eê]s", &[], &[PtBr]),
    ];
    v.push(LangRule {
        re: Regex::new(r"(?i)(?:^|[^\p{L}])raws?(?:[^\p{L}]|$)").unwrap(),
        audio: &[Ja],
        subs: &[],
        raw: true,
    });
    v
});

fn push_unique(v: &mut Vec<Lang>, l: &[Lang]) {
    for x in l {
        if !v.contains(x) {
            v.push(*x);
        }
    }
}

/// Audio/subtitle languages mentioned anywhere in the name.
pub fn detect_languages(text: &str) -> (Vec<Lang>, Vec<Lang>, bool) {
    let mut audio = Vec::new();
    let mut subs = Vec::new();
    let mut raw = false;
    // consume matches so a phrase is not counted again by a bare-word rule
    let mut rest = text.to_string();
    for rule in LANG_RULES.iter() {
        if rule.re.is_match(&rest) {
            push_unique(&mut audio, rule.audio);
            push_unique(&mut subs, rule.subs);
            raw |= rule.raw;
            rest = rule.re.replace_all(&rest, " ").into_owned();
        }
    }
    // specific Spanish (Latin American) wins over generic Spanish
    if subs.contains(&Lang::EsLatam) {
        subs.retain(|l| *l != Lang::Es || text.to_lowercase().contains("castellano"));
    }
    // a raw has no subtitles: any subtitle tag means it is not a raw
    raw = raw && subs.is_empty();
    if audio.is_empty() {
        audio.push(Lang::Ja);
    }
    (audio, subs, raw)
}

fn is_tag(s: &str) -> bool {
    let t = s.trim();
    RES_P.is_match(t)
        || RES_WXH.is_match(t)
        || CODEC.is_match(t)
        || CRC.is_match(t)
        || t.chars().all(|c| c.is_ascii_digit())
}

pub fn parse(name: &str) -> ParsedName {
    let mut p = ParsedName::default();
    let name = EXT.replace(name.trim(), "").into_owned();

    // [Group] at the very start
    if let Some(c) = BRACKETS.captures(&name) {
        let m = c.get(0).unwrap();
        let inner = c.iter().skip(1).flatten().next().map(|x| x.as_str()).unwrap_or("");
        if m.start() == 0 && !inner.is_empty() && !is_tag(inner) {
            p.group = Some(inner.trim().to_string());
        }
    }

    // bracket contents are tags; the rest is "title - episode …"
    let tags: Vec<String> = BRACKETS
        .captures_iter(&name)
        .filter_map(|c| c.iter().skip(1).flatten().next().map(|x| x.as_str().to_string()))
        .collect();
    let mut main = BRACKETS.replace_all(&name, " ").into_owned();
    if !main.contains(' ') || main.matches('.').count() > main.matches(' ').count() {
        main = main.replace(['.', '_'], " ");
    }
    main = main.replace('_', " ");
    main = SPACES.replace_all(main.trim(), " ").into_owned();
    let all = format!("{main} {}", tags.join(" "));

    // resolution / codec
    p.resolution = RES_P
        .captures(&all)
        .and_then(|c| c[1].parse().ok())
        .or_else(|| RES_WXH.captures(&all).and_then(|c| c[1].parse().ok()))
        .or_else(|| RES_4K.is_match(&all).then_some(2160));
    p.codec = CODEC.captures(&all).map(|c| {
        let k = c[1].to_lowercase().replace('.', "");
        match k.as_str() {
            "hevc" | "x265" | "h265" => "HEVC".to_string(),
            "x264" | "h264" | "avc" => "H.264".to_string(),
            other => other.to_uppercase(),
        }
    });

    // strip resolution/codec words from the title part before episode matching
    let mut work = RES_P.replace_all(&main, " ").into_owned();
    work = CODEC.replace_all(&work, " ").into_owned();
    work = SPACES.replace_all(work.trim(), " ").into_owned();

    let mut cut: Option<usize> = None;
    let set_ver = |p: &mut ParsedName, v: Option<regex::Match>| {
        p.version = v.and_then(|m| m.as_str().parse().ok());
    };
    if let Some(c) = SXXEYY.captures(&work) {
        p.season = c[1].parse().ok();
        p.episode = c[2].parse().ok();
        set_ver(&mut p, c.get(3));
        cut = Some(c.get(0).unwrap().start());
    } else if let Some(c) = DASH_RANGE.captures(&work) {
        p.episode = c[1].parse().ok();
        p.episode_end = c[2].parse().ok();
        cut = Some(c.get(0).unwrap().start());
    } else if let Some(c) = DASH_EP.captures(&work) {
        p.episode = c[1].parse().ok();
        set_ver(&mut p, c.get(2));
        cut = Some(c.get(0).unwrap().start());
    } else if let Some(c) = WORD_EP.captures(&work) {
        p.episode = c[1].parse().ok();
        set_ver(&mut p, c.get(2));
        cut = Some(c.get(0).unwrap().start());
    } else if let Some(c) = RANGE.captures(&work) {
        p.episode = c[1].parse().ok();
        p.episode_end = c[2].parse().ok();
        cut = Some(c.get(0).unwrap().start());
    } else if let Some(c) = TRAILING_NUM.captures(&work) {
        let n: u32 = c[1].parse().unwrap_or(0);
        if !(1900..=2100).contains(&n) {
            p.episode = Some(n);
            set_ver(&mut p, c.get(2));
            cut = Some(c.get(0).unwrap().start());
        }
    }
    // a range inside a tag: "[01-12]"
    if p.episode.is_none() {
        for t in &tags {
            if let Some(c) = RANGE.captures(&format!(" {} ", t.trim())) {
                p.episode = c[1].parse().ok();
                p.episode_end = c[2].parse().ok();
                break;
            }
        }
    }
    if let (Some(a), Some(b)) = (p.episode, p.episode_end) {
        if b <= a {
            p.episode_end = None;
        }
    }

    let mut title = match cut {
        Some(i) => work[..i].to_string(),
        None => work.clone(),
    };
    if p.season.is_none() {
        // "Title S2 - 05" or a "(Season 1)" tag
        let tag_text = tags.join(" ");
        p.season = SEASON
            .captures(&title)
            .or_else(|| SEASON.captures(&tag_text))
            .and_then(|c| c.get(1).or(c.get(2)).and_then(|m| m.as_str().parse().ok()));
    }
    title = BATCH.replace_all(&title, " ").into_owned();
    title = title.trim().trim_end_matches(['-', '–', '|', ':']).trim().to_string();
    p.title = SPACES.replace_all(&title, " ").into_owned();

    p.batch = p.episode_end.is_some() || BATCH.is_match(&all) || (p.episode.is_none() && p.season.is_some());

    let (audio, subs, raw) = detect_languages(&all);
    p.audio = audio;
    p.subs = subs;
    p.raw = raw;
    p
}

/// Lowercase alphanumerics only, for loose title comparison.
pub fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use Lang::*;

    #[test]
    fn typical_english_release() {
        let p = parse("[SomeGroup] Sousou no Frieren - 12 (1080p) [ABCD1234].mkv");
        assert_eq!(p.group.as_deref(), Some("SomeGroup"));
        assert_eq!(p.title, "Sousou no Frieren");
        assert_eq!(p.episode, Some(12));
        assert_eq!(p.resolution, Some(1080));
        assert!(!p.batch);
        assert_eq!(p.audio, vec![Ja]);
    }

    #[test]
    fn spanish_fansub() {
        let p = parse("[Fansub-X] Frieren - 05 [720p][Sub Español]");
        assert_eq!(p.episode, Some(5));
        assert_eq!(p.resolution, Some(720));
        assert_eq!(p.subs, vec![Es]);
        assert_eq!(p.audio, vec![Ja]);

        let p = parse("Frieren Cap 07 VOSE 1080p");
        assert_eq!(p.episode, Some(7));
        assert_eq!(p.title, "Frieren");
        assert_eq!(p.subs, vec![Es]);
    }

    #[test]
    fn latin_american() {
        let p = parse("[Grupo] Frieren - 03 [Audio Latino] [1080p]");
        assert_eq!(p.audio, vec![EsLatam]);
        let p = parse("[Grupo] Frieren - 03 [Sub Español Latino]");
        assert_eq!(p.subs, vec![EsLatam]);
        assert_eq!(p.audio, vec![Ja]);
    }

    #[test]
    fn dual_audio_multisub_batch() {
        let p = parse("[Group] Frieren (Season 1) [01-28] [Dual Audio] [Multi-Subs] [BD 1080p HEVC]");
        assert_eq!(p.episode, Some(1));
        assert_eq!(p.episode_end, Some(28));
        assert!(p.batch);
        assert!(p.has_episode(12));
        assert!(!p.has_episode(29));
        assert_eq!(p.audio, vec![Ja, En]);
        assert_eq!(p.subs, vec![Multi]);
        assert_eq!(p.codec.as_deref(), Some("HEVC"));
        assert_eq!(p.season, Some(1));
    }

    #[test]
    fn raw_and_french_and_portuguese() {
        let p = parse("[Ohys-Raws] Frieren - 10 (BS11 1280x720 x264 AAC).mp4");
        assert!(p.raw);
        assert!(p.subs.is_empty());
        assert_eq!(p.resolution, Some(720));
        assert_eq!(p.episode, Some(10));

        assert_eq!(parse("Frieren 04 VOSTFR 1080p").subs, vec![Fr]);
        assert_eq!(parse("[Grupo] Frieren - 04 [PT-BR] 1080p").subs, vec![PtBr]);
    }

    #[test]
    fn sxxeyy_and_dotted() {
        let p = parse("Frieren.S02E03.1080p.WEB.x264-GRP.mkv");
        assert_eq!(p.season, Some(2));
        assert_eq!(p.episode, Some(3));
        assert_eq!(p.title, "Frieren");
        assert_eq!(p.resolution, Some(1080));
    }

    #[test]
    fn versions_and_years_are_not_episodes() {
        let p = parse("[Group] Frieren - 12v2 [1080p]");
        assert_eq!(p.episode, Some(12));
        assert_eq!(p.version, Some(2));

        let p = parse("Some Movie 2023 [1080p]");
        assert_eq!(p.episode, None);
    }

    #[test]
    fn english_dub() {
        let p = parse("[Group] Frieren - 02 [English Dub] [1080p]");
        assert_eq!(p.audio, vec![En]);
    }

    #[test]
    fn spanish_words_inside_titles_dont_trigger() {
        // "Espada" must not read as "esp"
        let p = parse("[Group] La Espada Rota - 01 [1080p]");
        assert!(p.subs.is_empty());
    }
}
