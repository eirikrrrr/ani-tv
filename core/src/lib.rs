//! Anime TV core: the parts of the app that do not need a window, so they can
//! be built and tested anywhere (CI, headless machines).
//!
//! - `discord`: Rich Presence ("Watching <series>").
//! - `release`: release-name parsing (episode, resolution, languages).
//! - `sources`: user-configured sources (Torznab, RSS, Stremio addons) → normalized releases.
//! - `addons`: the Stremio addon protocol (manifests, streams, id mapping).
//! - `torrent`: torrent streaming (librqbit) served on a local URL for the player.
//! - `rank`: match releases to an episode and order them by preferences.

pub mod addons;
pub mod discord;
pub mod rank;
pub mod release;
pub mod sources;
pub mod torrent;
