//! Tauri shell: the window plus the commands the UI calls. Discord IPC calls
//! block on a socket/pipe, so the commands run off the main thread (`async`).

use std::sync::Mutex;

use anime_tv_core::discord::{Discord, Presence};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            discord_connect,
            discord_set,
            discord_clear,
            discord_disconnect
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
