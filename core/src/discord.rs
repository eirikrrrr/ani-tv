//! Discord Rich Presence over the local IPC socket of the Discord client.
//!
//! No OAuth: the app talks to the Discord client running on the same machine
//! and shows "Watching <series>" with the series cover, so friends can see it.
//! It needs the Client ID of an application created in the Discord Developer
//! Portal (the application's name is what appears if the status falls back to
//! the app name).

use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::Deserialize;

/// What the user is watching, as sent by the UI.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    /// Series title, e.g. "Sousou no Frieren".
    pub title: String,
    /// Episode being watched (1-based).
    pub episode: Option<u32>,
    /// Episodes in the season, when known.
    pub total_episodes: Option<u32>,
    /// Public URL of the cover (AniList CDN). Discord accepts external URLs.
    pub cover_url: Option<String>,
    /// Page about the series, shown as a button friends can click.
    pub info_url: Option<String>,
    /// When playback started, Unix milliseconds (shows the elapsed time).
    pub started_at: Option<i64>,
    /// The app logo (public HTTPS URL), shown small over the cover.
    #[serde(default)]
    pub logo_url: Option<String>,
    /// The episode line and the button text in the user's language (the UI
    /// translates them); None = Spanish defaults.
    #[serde(default)]
    pub episode_text: Option<String>,
    #[serde(default)]
    pub button_text: Option<String>,
}

/// Nothing playing: the profile shows the app logo and what the user is doing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Idle {
    /// e.g. "Explorando el catálogo"
    pub text: String,
    /// The app logo (public HTTPS URL).
    pub logo_url: Option<String>,
    /// When the app was opened, Unix milliseconds.
    pub started_at: Option<i64>,
    /// Where friends can get the app, shown as a button.
    pub app_url: Option<String>,
    /// That button's text in the user's language; None = Spanish.
    #[serde(default)]
    pub button_text: Option<String>,
}

/// Name shown next to the logo and on the small image.
pub const APP_NAME: &str = "Anime TV";

#[derive(Debug)]
pub enum Error {
    /// Discord is not running, or its IPC socket is not reachable.
    NotRunning(String),
    /// Connected, but Discord rejected or dropped the update.
    Ipc(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::NotRunning(e) => write!(f, "Discord no está abierto o no responde ({e})"),
            Error::Ipc(e) => write!(f, "Discord rechazó la actualización ({e})"),
        }
    }
}

impl std::error::Error for Error {}

/// Discord limits text fields to 2..=128 characters.
fn field(s: &str) -> String {
    let s = s.trim();
    let mut out: String = s.chars().take(128).collect();
    while out.chars().count() < 2 {
        out.push(' ');
    }
    out
}

/// The "Episodio 3 de 12" line.
pub fn episode_line(p: &Presence) -> Option<String> {
    if let Some(t) = p.episode_text.as_deref().filter(|t| !t.trim().is_empty()) {
        return Some(t.to_string());
    }
    match (p.episode, p.total_episodes) {
        (Some(e), Some(t)) => Some(format!("Episodio {e} de {t}")),
        (Some(e), None) => Some(format!("Episodio {e}")),
        _ => None,
    }
}

/// A connection to the local Discord client. Reconnects once when an update
/// fails (Discord was restarted, the socket went away).
pub struct Discord {
    client_id: String,
    client: Option<DiscordIpcClient>,
}

impl Discord {
    pub fn new(client_id: impl Into<String>) -> Self {
        Discord { client_id: client_id.into(), client: None }
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    pub fn is_connected(&self) -> bool {
        self.client.is_some()
    }

    pub fn connect(&mut self) -> Result<(), Error> {
        if self.client_id.trim().is_empty() {
            return Err(Error::NotRunning("falta el Client ID de Discord".into()));
        }
        let mut c = DiscordIpcClient::new(&self.client_id);
        c.connect().map_err(|e| Error::NotRunning(e.to_string()))?;
        self.client = Some(c);
        Ok(())
    }

    pub fn disconnect(&mut self) {
        if let Some(mut c) = self.client.take() {
            let _ = c.clear_activity();
            let _ = c.close();
        }
    }

    pub fn set(&mut self, p: &Presence) -> Result<(), Error> {
        self.with_retry(|c| {
            let title = field(&p.title);
            let episode = episode_line(p).map(|s| field(&s));
            let cover_text = field(&p.title);

            let mut assets = Assets::new().large_text(cover_text.as_str());
            if let Some(url) = p.cover_url.as_deref() {
                assets = assets.large_image(url);
            }
            if let Some(logo) = p.logo_url.as_deref() {
                assets = assets.small_image(logo).small_text(APP_NAME);
            }
            let mut a = Activity::new()
                .activity_type(ActivityType::Watching)
                // the member list shows "Watching <series>" instead of the app name
                .status_display_type(StatusDisplayType::Details)
                .details(title.as_str())
                .assets(assets);
            if let Some(ep) = episode.as_deref() {
                a = a.state(ep);
            }
            if let Some(ms) = p.started_at {
                a = a.timestamps(Timestamps::new().start(ms));
            }
            if let Some(url) = p.info_url.as_deref() {
                a = a.buttons(vec![Button::new(p.button_text.as_deref().unwrap_or("Ver la serie"), url)]);
            }
            c.set_activity(a)
        })
    }

    /// The resting state: app logo, "Watching Anime TV" and a status line.
    pub fn set_idle(&mut self, idle: &Idle) -> Result<(), Error> {
        self.with_retry(|c| {
            let text = field(&idle.text);
            let mut assets = Assets::new().large_text(APP_NAME);
            if let Some(logo) = idle.logo_url.as_deref() {
                assets = assets.large_image(logo);
            }
            let mut a = Activity::new()
                .activity_type(ActivityType::Watching)
                // the member list shows "Watching Anime TV"
                .status_display_type(StatusDisplayType::Name)
                .details(text.as_str())
                .assets(assets);
            if let Some(ms) = idle.started_at {
                a = a.timestamps(Timestamps::new().start(ms));
            }
            if let Some(url) = idle.app_url.as_deref() {
                a = a.buttons(vec![Button::new(idle.button_text.as_deref().unwrap_or("Descargar Anime TV"), url)]);
            }
            c.set_activity(a)
        })
    }

    pub fn clear(&mut self) -> Result<(), Error> {
        if self.client.is_none() {
            return Ok(());
        }
        self.with_retry(|c| c.clear_activity())
    }

    fn with_retry(
        &mut self,
        f: impl Fn(&mut DiscordIpcClient) -> Result<(), discord_rich_presence::error::Error>,
    ) -> Result<(), Error> {
        if self.client.is_none() {
            self.connect()?;
        }
        let c = self.client.as_mut().expect("connected above");
        if f(c).is_ok() {
            return Ok(());
        }
        // the socket may be stale (Discord restarted): reconnect once
        self.client = None;
        self.connect()?;
        let c = self.client.as_mut().expect("connected above");
        f(c).map_err(|e| Error::Ipc(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(ep: Option<u32>, total: Option<u32>) -> Presence {
        Presence {
            title: "Frieren".into(),
            episode: ep,
            total_episodes: total,
            cover_url: None,
            info_url: None,
            started_at: None,
            logo_url: None,
            episode_text: None,
            button_text: None,
        }
    }

    #[test]
    fn episode_lines() {
        assert_eq!(episode_line(&p(Some(3), Some(12))).as_deref(), Some("Episodio 3 de 12"));
        assert_eq!(episode_line(&p(Some(3), None)).as_deref(), Some("Episodio 3"));
        assert_eq!(episode_line(&p(None, Some(12))), None);
    }

    #[test]
    fn fields_respect_discord_limits() {
        assert_eq!(field("A").chars().count(), 2);
        assert_eq!(field(&"x".repeat(300)).chars().count(), 128);
        assert_eq!(field("  Frieren "), "Frieren");
    }

    #[test]
    fn missing_client_id_is_a_clean_error() {
        let mut d = Discord::new("");
        assert!(matches!(d.connect(), Err(Error::NotRunning(_))));
    }

    #[test]
    fn no_discord_running_is_a_clean_error() {
        // no Discord client on CI / this machine: must not panic
        let mut d = Discord::new("123456789012345678");
        assert!(d.set(&p(Some(1), Some(12))).is_err());
        assert!(!d.is_connected());
    }
}
