//! Playback: the torrent engine (core::torrent) started on first use, and the
//! mpv player launched as a separate window on the engine's local URL.
//!
//! mpv ships next to the app on Windows (bundled from the CI); elsewhere it
//! is taken from PATH.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use anime_tv_core::torrent::{Engine, Opened, Status};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::OnceCell;

#[derive(Default)]
pub struct Player {
    engine: OnceCell<Engine>,
    mpv: Mutex<Option<Child>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSettings {
    /// where episodes are downloaded; empty = the app's cache folder
    #[serde(default)]
    pub download_dir: Option<String>,
    /// upload limit in KiB/s; None = unlimited
    #[serde(default)]
    pub upload_kib: Option<u32>,
}

async fn engine<'a>(app: &AppHandle, p: &'a Player, s: &EngineSettings) -> Result<&'a Engine, String> {
    p.engine
        .get_or_try_init(|| async {
            let dir = match s.download_dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
                Some(d) => PathBuf::from(d),
                None => app.path().app_cache_dir().map_err(|e| e.to_string())?.join("downloads"),
            };
            Engine::start(dir, s.upload_kib).await.map_err(|e| format!("no se pudo iniciar el motor torrent: {e}"))
        })
        .await
}

/// Adds the torrent and returns the local URL of the file to play.
#[tauri::command]
pub async fn play_open(
    app: AppHandle,
    player: State<'_, Player>,
    source: String,
    file_idx: Option<usize>,
    episode: Option<u32>,
    settings: EngineSettings,
) -> Result<Opened, String> {
    let e = engine(&app, &player, &settings).await?;
    e.open(&source, file_idx, episode).await.map_err(|e| format!("no se pudo abrir el torrent: {e}"))
}

#[tauri::command]
pub async fn play_status(player: State<'_, Player>, id: usize, file_idx: usize) -> Result<Status, String> {
    let e = player.engine.get().ok_or("el motor torrent no está iniciado")?;
    e.status(id, file_idx).map_err(|e| e.to_string())
}

/// Stops a torrent (and deletes its files when asked).
#[tauri::command]
pub async fn play_close(player: State<'_, Player>, id: usize, delete_files: bool) -> Result<(), String> {
    match player.engine.get() {
        Some(e) => e.close(id, delete_files).await.map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

fn mpv_path(app: &AppHandle) -> PathBuf {
    if cfg!(windows) {
        if let Ok(dir) = app.path().resource_dir() {
            let p = dir.join("mpv").join("mpv.exe");
            if p.exists() {
                return p;
            }
        }
        // next to the executable (portable build)
        if let Ok(exe) = std::env::current_exe() {
            if let Some(p) = exe.parent().map(|d| d.join("mpv").join("mpv.exe")).filter(|p| p.exists()) {
                return p;
            }
        }
    }
    PathBuf::from("mpv")
}

/// Language codes mpv matches against track tags, for our language ids.
fn mpv_langs(ids: &[String]) -> String {
    let mut out: Vec<&str> = Vec::new();
    for id in ids {
        let codes: &[&str] = match id.as_str() {
            "es" => &["spa", "es", "es-ES", "es-419"],
            "es-419" => &["es-419", "es-MX", "spa", "es"],
            "en" => &["eng", "en"],
            "ja" => &["jpn", "ja"],
            "pt-BR" => &["pt-BR", "por", "pt"],
            "fr" => &["fre", "fra", "fr"],
            "de" => &["ger", "deu", "de"],
            "it" => &["ita", "it"],
            _ => &[],
        };
        for c in codes {
            if !out.contains(c) {
                out.push(c);
            }
        }
    }
    out.join(",")
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    pub url: String,
    /// window / media title, e.g. "Frieren · Episodio 5"
    pub title: String,
    /// preferred audio and subtitle languages, most wanted first (our ids)
    #[serde(default)]
    pub audio: Vec<String>,
    #[serde(default)]
    pub subs: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Exited {
    code: Option<i32>,
}

/// Opens mpv on `url` (replacing a previous mpv window). Emits
/// `player-exited` when the user closes it.
#[tauri::command]
pub fn play_launch(app: AppHandle, player: State<'_, Player>, args: LaunchArgs) -> Result<(), String> {
    if !(args.url.starts_with("http://127.0.0.1:") || args.url.starts_with("https://") || args.url.starts_with("http://")) {
        return Err("URL no válida".into());
    }
    let mut slot = player.mpv.lock().map_err(|e| e.to_string())?;
    if let Some(mut old) = slot.take() {
        let _ = old.kill();
    }
    let mut cmd = Command::new(mpv_path(&app));
    cmd.arg("--force-window=immediate")
        .arg(format!("--title={} — Anime TV", args.title))
        .arg(format!("--force-media-title={}", args.title))
        .arg("--keep-open=no")
        .arg("--cache=yes")
        .arg("--demuxer-readahead-secs=60")
        .arg("--network-timeout=120")
        .arg("--save-position-on-quit=no");
    let alang = mpv_langs(&args.audio);
    if !alang.is_empty() {
        cmd.arg(format!("--alang={alang},jpn,ja"));
    }
    let slang = mpv_langs(&args.subs);
    if !slang.is_empty() {
        cmd.arg(format!("--slang={slang}"));
    }
    cmd.arg("--").arg(&args.url);
    let child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "no se encontró el reproductor mpv".to_string()
        } else {
            format!("no se pudo abrir mpv: {e}")
        }
    })?;
    let pid = child.id();
    *slot = Some(child);
    drop(slot);

    // watch for the window being closed
    let app2 = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let p = app2.state::<Player>();
        let mut slot = match p.mpv.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        match slot.as_mut() {
            Some(c) if c.id() == pid => {
                if let Ok(Some(status)) = c.try_wait() {
                    *slot = None;
                    let _ = app2.emit("player-exited", Exited { code: status.code() });
                    return;
                }
            }
            // replaced by a newer mpv or stopped: nothing to report
            _ => return,
        }
    });
    Ok(())
}

/// Closes the mpv window if open.
#[tauri::command]
pub fn play_stop(player: State<'_, Player>) {
    if let Ok(mut slot) = player.mpv.lock() {
        if let Some(mut c) = slot.take() {
            let _ = c.kill();
        }
    }
}

/// On app exit: close mpv.
pub fn shutdown(player: &Player) {
    if let Ok(mut slot) = player.mpv.lock() {
        if let Some(mut c) = slot.take() {
            let _ = c.kill();
        }
    }
}
