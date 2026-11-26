//! Matching releases to the episode being looked for, and ordering them by the
//! user's preferences: language first, then resolution, then health (seeders).

use serde::{Deserialize, Serialize};

use crate::release::{normalize, strip_season, Lang};
use crate::sources::Release;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Track {
    Audio,
    Subs,
}

/// "Spanish subtitles", "Latin American audio"…
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LangPref {
    pub lang: Lang,
    pub track: Track,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    /// most wanted first
    pub languages: Vec<LangPref>,
    /// preferred vertical resolution (1080, 720…)
    pub resolution: Option<u32>,
    /// also offer season packs that contain the episode
    #[serde(default = "yes")]
    pub batches: bool,
}

fn yes() -> bool {
    true
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            languages: vec![
                LangPref { lang: Lang::Es, track: Track::Subs },
                LangPref { lang: Lang::En, track: Track::Subs },
            ],
            resolution: Some(1080),
            batches: true,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wanted {
    /// title variants (romaji, English, synonyms)
    pub titles: Vec<String>,
    /// None for movies / single-file entries
    pub episode: Option<u32>,
    pub season: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ranked {
    #[serde(flatten)]
    pub release: Release,
    pub score: i64,
    /// index in `Prefs::languages` this release satisfies, best one
    pub language_match: Option<usize>,
}

/// Same series? Loose: one normalized title contains the other, so
/// "Sousou no Frieren" matches "Frieren" and vice versa, but short noise like
/// "TV" never matches anything.
pub fn title_matches(release_title: &str, wanted: &[String]) -> bool {
    let r = normalize(&strip_season(release_title).0);
    if r.len() < 3 {
        return false;
    }
    wanted.iter().map(|w| normalize(&strip_season(w).0)).filter(|w| w.len() >= 3).any(|w| r.contains(&w) || w.contains(&r))
}

/// Subtitle languages a release effectively has: Multi counts for any.
fn has(langs: &[Lang], want: Lang) -> bool {
    langs.contains(&want)
        || (langs.contains(&Lang::Multi) && want != Lang::Ja)
        // asking for Spanish accepts both variants, at a small cost (see score)
        || (want == Lang::Es && langs.contains(&Lang::EsLatam))
        || (want == Lang::EsLatam && langs.contains(&Lang::Es))
}

fn language_match(r: &Release, prefs: &Prefs) -> Option<usize> {
    prefs.languages.iter().position(|p| match p.track {
        Track::Subs => !r.parsed.raw && has(&r.parsed.subs, p.lang),
        Track::Audio => r.parsed.audio.contains(&p.lang),
    })
}

fn score(r: &Release, lm: Option<usize>, prefs: &Prefs, wanted: &Wanted) -> i64 {
    let n = prefs.languages.len() as i64;
    let mut s = 0i64;
    if let Some(i) = lm {
        s += (n - i as i64) * 1000;
        let p = prefs.languages[i];
        // exact variant beats the accepted neighbour (es vs es-419), and an
        // explicit language beats "Multi"
        let list = if p.track == Track::Subs { &r.parsed.subs } else { &r.parsed.audio };
        if list.contains(&p.lang) {
            s += 200;
        }
    }
    if let (Some(want), Some(got)) = (prefs.resolution, r.parsed.resolution) {
        s += if got == want { 300 } else if got > want { 150 } else { -((want - got) as i64) / 4 };
    }
    match r.seeders {
        Some(0) => s -= 600,
        Some(n) => s += ((n as f64 + 1.0).ln() * 40.0) as i64,
        None => {}
    }
    if wanted.episode.is_some() && r.parsed.batch {
        s -= 150;
    }
    s += r.parsed.version.unwrap_or(1).saturating_sub(1) as i64 * 10;
    s
}

impl Wanted {
    /// The season asked for, or the one the titles imply ("2nd Season").
    pub fn season(&self) -> Option<u32> {
        self.season.or_else(|| self.titles.iter().find_map(|t| strip_season(t).1))
    }
}

/// Keeps the releases of the wanted series/episode, best first.
pub fn rank(releases: Vec<Release>, wanted: &Wanted, prefs: &Prefs) -> Vec<Ranked> {
    let season = wanted.season();
    let mut out: Vec<Ranked> = releases
        .into_iter()
        // addon results are already for this episode
        .filter(|r| r.exact || title_matches(&r.parsed.title, &wanted.titles))
        .filter(|r| {
            if r.exact {
                return true;
            }
            let got = r.parsed.season.or_else(|| strip_season(&r.parsed.title).1);
            match (season, got) {
                (Some(a), Some(b)) => a == b,
                // untagged releases are season 1 (sequels are tagged S2, 2nd Season…)
                (Some(a), None) => a == 1,
                _ => true,
            }
        })
        .filter(|r| match wanted.episode {
            _ if r.exact => true,
            Some(ep) => r.parsed.has_episode(ep) || (prefs.batches && r.parsed.batch && r.parsed.episode.is_none()),
            None => true,
        })
        .filter(|r| prefs.batches || !r.parsed.batch)
        .map(|r| {
            let lm = language_match(&r, prefs);
            let score = score(&r, lm, prefs, wanted);
            Ranked { release: r, score, language_match: lm }
        })
        .collect();
    out.sort_by(|a, b| b.score.cmp(&a.score));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::release::parse;

    fn rel(title: &str, seeders: u32) -> Release {
        Release {
            source: "s".into(),
            title: title.into(),
            magnet: Some("magnet:?xt=urn:btih:x".into()),
            torrent_url: None,
            info_hash: None,
            size: None,
            seeders: Some(seeders),
            leechers: None,
            published: None,
            info_url: None,
            file_idx: None,
            url: None,
            exact: false,
            parsed: parse(title),
        }
    }

    fn wanted(ep: Option<u32>) -> Wanted {
        Wanted { titles: vec!["Sousou no Frieren".into(), "Frieren: Beyond Journey's End".into()], episode: ep, season: None }
    }

    fn titles(r: &[Ranked]) -> Vec<&str> {
        r.iter().map(|x| x.release.title.as_str()).collect()
    }

    #[test]
    fn titles_match_loosely() {
        let w = wanted(None).titles;
        assert!(title_matches("Sousou no Frieren", &w));
        assert!(title_matches("Frieren", &w), "short form inside the long one");
        assert!(!title_matches("Dungeon Meshi", &w));
        assert!(!title_matches("TV", &w));
    }

    #[test]
    fn spanish_subs_first_then_english_then_rest() {
        let rs = vec![
            rel("[A] Sousou no Frieren - 05 (1080p)", 900),
            rel("[B] Sousou no Frieren - 05 [1080p][Sub Español]", 15),
            rel("[C] Sousou no Frieren - 05 (1080p) [ENG]", 300),
            rel("[D] Sousou no Frieren - 06 [Sub Español]", 50),
            rel("[E] Dungeon Meshi - 05 [Sub Español]", 50),
        ];
        let out = rank(rs, &wanted(Some(5)), &Prefs::default());
        assert_eq!(
            titles(&out),
            vec![
                "[B] Sousou no Frieren - 05 [1080p][Sub Español]",
                "[C] Sousou no Frieren - 05 (1080p) [ENG]",
                "[A] Sousou no Frieren - 05 (1080p)",
            ]
        );
        assert_eq!(out[0].language_match, Some(0));
        assert_eq!(out[1].language_match, Some(1));
        assert_eq!(out[2].language_match, None);
    }

    #[test]
    fn latin_audio_preference() {
        let prefs = Prefs {
            languages: vec![LangPref { lang: Lang::EsLatam, track: Track::Audio }],
            resolution: Some(1080),
            batches: true,
        };
        let rs = vec![
            rel("[A] Frieren - 03 [Sub Español] [1080p]", 100),
            rel("[B] Frieren - 03 [Audio Latino] [720p]", 5),
        ];
        let out = rank(rs, &wanted(Some(3)), &prefs);
        assert!(out[0].release.title.contains("Latino"));
    }

    #[test]
    fn batches_contain_the_episode_and_rank_below_singles() {
        let rs = vec![
            rel("[A] Sousou no Frieren [01-28] [1080p] [Multi-Subs]", 500),
            rel("[B] Sousou no Frieren - 12 [1080p] [Multi-Subs]", 500),
            rel("[C] Sousou no Frieren [01-10] [1080p] [Multi-Subs]", 500),
        ];
        let out = rank(rs.clone(), &wanted(Some(12)), &Prefs::default());
        assert_eq!(titles(&out), vec!["[B] Sousou no Frieren - 12 [1080p] [Multi-Subs]", "[A] Sousou no Frieren [01-28] [1080p] [Multi-Subs]"]);

        let no_batches = Prefs { batches: false, ..Prefs::default() };
        assert_eq!(rank(rs, &wanted(Some(12)), &no_batches).len(), 1);
    }

    #[test]
    fn dead_torrents_sink_and_resolution_counts() {
        let rs = vec![
            rel("[A] Frieren - 01 [1080p] [ENG]", 0),
            rel("[B] Frieren - 01 [720p] [ENG]", 40),
            rel("[C] Frieren - 01 [1080p] [ENG]", 40),
        ];
        let out = rank(rs, &wanted(Some(1)), &Prefs::default());
        assert_eq!(titles(&out)[0], "[C] Frieren - 01 [1080p] [ENG]");
        assert_eq!(titles(&out)[2], "[A] Frieren - 01 [1080p] [ENG]");
    }

    #[test]
    fn sequels_match_by_season() {
        let w = Wanted { titles: vec!["Sousou no Frieren 2nd Season".into()], episode: Some(5), season: None };
        let rs = vec![
            rel("[A] Sousou no Frieren S2 - 05 [1080p] [ENG]", 100),
            rel("[B] Sousou no Frieren Season 1 - 05 [1080p] [ENG]", 100),
            rel("[C] Sousou no Frieren 2nd Season - 05 [1080p] [ENG]", 100),
            rel("[D] Sousou no Frieren - 05 [1080p] [ENG]", 100),
        ];
        let out = rank(rs, &w, &Prefs::default());
        let mut t = titles(&out);
        t.sort();
        assert_eq!(t, vec!["[A] Sousou no Frieren S2 - 05 [1080p] [ENG]", "[C] Sousou no Frieren 2nd Season - 05 [1080p] [ENG]"]);
    }

    #[test]
    fn addon_results_skip_title_and_episode_filters() {
        // addons answer for a specific episode; their names may not match
        let mut r = rel("Episode 5 · 1080p · Sub Español", 20);
        r.exact = true;
        let out = rank(vec![r, rel("[A] Dungeon Meshi - 05 [ENG]", 900)], &wanted(Some(5)), &Prefs::default());
        assert_eq!(titles(&out), vec!["Episode 5 · 1080p · Sub Español"]);
    }

    #[test]
    fn raws_never_satisfy_a_subtitle_preference() {
        let rs = vec![rel("[X-Raws] Frieren - 02 (1080p)", 300)];
        let out = rank(rs, &wanted(Some(2)), &Prefs::default());
        assert_eq!(out[0].language_match, None);
    }
}
