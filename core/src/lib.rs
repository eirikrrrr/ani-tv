//! Anime TV core: the parts of the app that do not need a window, so they can
//! be built and tested anywhere (CI, headless machines).
//!
//! - `discord`: Rich Presence ("Watching <series>").
//! - `release`: release-name parsing (episode, resolution, languages).
//! - next: `sources` (Torznab, RSS) and `rank` (match + order by preferences).

pub mod discord;
pub mod release;
