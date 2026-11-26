//! Tauri shell: the window plus the commands the UI calls. Discord IPC calls
//! block on a socket/pipe, so the commands run off the main thread (`async`).

use std::sync::Mutex;

use anime_tv_core::discord::{Discord, Idle, Presence};
use anime_tv_core::rank::{rank, Prefs, Ranked, Wanted};
use anime_tv_core::addons::{self, CatalogEntry, Manifest, StreamSupport};
use anime_tv_core::sources::{search_all, search_source, Source, SourceError, SourceKind};
use serde::Serialize;
use tauri::{Manager, RunEvent, State};

#[derive(Default)]
struct AppState {
    discord: Mutex<Option<Discord>>,
}

#[tauri::command(async)]
fn discord_connect(state: State<'_, AppState>, client_id: String) -> Result<(), String> {
    let mut slot = state.discord.lock().map_err(|e| e.to_string())?;
    if let Some(d) = slot.as_mut() {
        if d.client_id() == client_id && d.is_connected() {
            return Ok(());
        }
        d.disconnect();
    }
    let mut d = Discord::new(client_id);
    d.connect().map_err(|e| e.to_string())?;
    *slot = Some(d);
    Ok(())
}

#[tauri::command(async)]
fn discord_set(state: State<'_, AppState>, presence: Presence) -> Result<(), String> {
    let mut slot = state.discord.lock().map_err(|e| e.to_string())?;
    match slot.as_mut() {
        Some(d) => d.set(&presence).map_err(|e| e.to_string()),
        None => Err("Discord no está conectado".into()),
    }
}

#[tauri::command(async)]
fn discord_idle(state: State<'_, AppState>, idle: Idle) -> Result<(), String> {
    let mut slot = state.discord.lock().map_err(|e| e.to_string())?;
    match slot.as_mut() {
        Some(d) => d.set_idle(&idle).map_err(|e| e.to_string()),
        None => Err("Discord no está conectado".into()),
    }
}

#[tauri::command(async)]
fn discord_clear(state: State<'_, AppState>) -> Result<(), String> {
    let mut slot = state.discord.lock().map_err(|e| e.to_string())?;
    match slot.as_mut() {
        Some(d) => d.clear().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command(async)]
fn discord_disconnect(state: State<'_, AppState>) {
    if let Ok(mut slot) = state.discord.lock() {
        if let Some(mut d) = slot.take() {
            d.disconnect();
        }
    }
}

#[derive(Serialize)]
struct SearchResult {
    results: Vec<Ranked>,
    errors: Vec<SourceError>,
    /// releases the sources returned before filtering by series/episode
    total: usize,
}

/// Searches every enabled source for an episode and returns the matching
/// releases, best first by the user's preferences.
#[tauri::command]
async fn sources_search(sources: Vec<Source>, wanted: Wanted, prefs: Prefs) -> Result<SearchResult, String> {
    let out = search_all(&sources, &wanted.titles, wanted.addon_target()).await;
    let total = out.releases.len();
    Ok(SearchResult { results: rank(out.releases, &wanted, &prefs), errors: out.errors, total })
}

/// "Probar" in Settings: feeds fetch their latest items, addons their
/// manifest. Returns a short status line.
#[tauri::command]
async fn source_test(source: Source) -> Result<String, String> {
    match &source.kind {
        SourceKind::Stremio { url, .. } => {
            let (_, m) = addons::fetch_manifest(url).await.map_err(|e| e.to_string())?;
            Ok(format!("Funciona: {} {}", m.name, m.version))
        }
        _ => search_source(&source, "")
            .await
            .map(|r| format!("Funciona: {} resultados recientes", r.len()))
            .map_err(|e| e.to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AddonInfo {
    /// base URL to install
    url: String,
    manifest: Manifest,
    /// None = the addon offers no streams
    streams: Option<StreamSupport>,
}

/// Reads an addon's manifest for the install dialog (URL, stremio:// link).
#[tauri::command]
async fn addon_manifest(url: String) -> Result<AddonInfo, String> {
    let (url, manifest) = addons::fetch_manifest(&url).await.map_err(|e| e.to_string())?;
    let streams = manifest.stream_support();
    Ok(AddonInfo { url, manifest, streams })
}

/// The addon store: one catalogue (Stremio's addonscollection.json format).
#[tauri::command]
async fn addon_catalog(url: String) -> Result<Vec<CatalogEntry>, String> {
    addons::fetch_catalog(&url).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            discord_connect,
            discord_set,
            discord_idle,
            discord_clear,
            discord_disconnect,
            sources_search,
            source_test,
            addon_manifest,
            addon_catalog
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| {
            // leave no stale "Watching …" in Discord when the app closes
            if let RunEvent::Exit = event {
                if let Ok(mut slot) = app.state::<AppState>().discord.lock() {
                    if let Some(mut d) = slot.take() {
                        d.disconnect();
                    }
                }
            }
        });
}
