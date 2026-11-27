//! Playback: the torrent engine (core::torrent) started on first use, and the
//! mpv player on the engine's local URL.
//!
//! On Windows mpv is embedded in the app window: it draws into a child
//! window that covers the main window's client area (`--wid`), and the
//! controls live in a transparent, borderless window owned by the main one
//! (label `player-ui`) that follows it. The controls talk to mpv through its
//! JSON IPC (a named pipe); mpv's own keys, mouse and on-screen controller
//! are off. Elsewhere mpv opens in its own window (same IPC, no overlay).
//!
//! mpv ships next to the app on Windows (bundled from the CI); elsewhere it
//! is taken from PATH.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use anime_tv_core::torrent::{Engine, EngineOptions, Opened, Status};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, OnceCell};

/// Label of the controls window.
pub const OVERLAY: &str = "player-ui";

#[derive(Default)]
pub struct Player {
    engine: OnceCell<Engine>,
    mpv: Mutex<Option<Child>>,
    live: Mutex<Option<Live>>,
}

/// The current mpv session.
struct Live {
    pid: u32,
    /// what the controls show (title, episode, cover…), from the UI
    info: Value,
    /// commands to mpv's IPC
    tx: mpsc::UnboundedSender<String>,
    /// child window mpv draws into (Windows), 0 = own window
    host: isize,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSettings {
    /// where episodes are downloaded; empty = the app's cache folder
    #[serde(default)]
    pub download_dir: Option<String>,
    /// upload limit in KiB/s; None = unlimited, 0 = minimum
    #[serde(default)]
    pub upload_kib: Option<u32>,
    /// download limit in KiB/s; None = unlimited
    #[serde(default)]
    pub download_kib: Option<u32>,
    /// accept incoming peer connections (+ UPnP); applied when the engine
    /// starts (first playback after launching the app)
    #[serde(default)]
    pub incoming: bool,
    #[serde(default)]
    pub upnp: bool,
}

async fn engine<'a>(app: &AppHandle, p: &'a Player, s: &EngineSettings) -> Result<&'a Engine, String> {
    p.engine
        .get_or_try_init(|| async {
            let dir = match s.download_dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
                Some(d) => PathBuf::from(d),
                None => app.path().app_cache_dir().map_err(|e| e.to_string())?.join("downloads"),
            };
            let o = EngineOptions {
                down_kib: s.download_kib,
                up_kib: s.upload_kib,
                incoming: s.incoming,
                upnp: s.incoming && s.upnp,
                peer_limit: None,
            };
            Engine::start(dir, o).await.map_err(|e| format!("no se pudo iniciar el motor torrent: {e}"))
        })
        .await
}

/// Opens the first source that works (a .torrent link, then the magnet…)
/// and returns the local URL of the file to play. A link that is a video is
/// returned as `direct`.
#[tauri::command]
pub async fn play_open(
    app: AppHandle,
    player: State<'_, Player>,
    sources: Vec<String>,
    file_idx: Option<usize>,
    episode: Option<u32>,
    settings: EngineSettings,
) -> Result<Opened, String> {
    let e = engine(&app, &player, &settings).await?;
    e.open_any(&sources, file_idx, episode).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn play_status(player: State<'_, Player>, id: usize, file_idx: usize) -> Result<Status, String> {
    let e = player.engine.get().ok_or("el motor torrent no está iniciado")?;
    e.status(id, file_idx).map_err(|e| e.to_string())
}

/// Applies new speed limits to the running engine (no-op before it starts:
/// play_open passes them then).
#[tauri::command]
pub fn engine_limits(player: State<'_, Player>, download_kib: Option<u32>, upload_kib: Option<u32>) {
    if let Some(e) = player.engine.get() {
        e.set_limits(download_kib, upload_kib);
    }
}

/// Whether the engine is running and with which network mode, for Settings
/// ("se aplica al reiniciar").
#[tauri::command]
pub fn engine_started(player: State<'_, Player>) -> bool {
    player.engine.get().is_some()
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
    /// shown by the controls window (series, episode, cover, has next…)
    #[serde(default)]
    pub info: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Exited {
    code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Launched {
    /// mpv is inside the app window, with the app's controls
    embedded: bool,
}

fn ipc_path() -> String {
    // unique enough to keep two app instances apart
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let tag = format!("{}-{:x}", std::process::id(), t & 0xffff_ffff);
    if cfg!(windows) {
        format!(r"\\.\pipe\animetv-mpv-{tag}")
    } else {
        std::env::temp_dir().join(format!("animetv-mpv-{tag}.sock")).display().to_string()
    }
}

/// Opens mpv on `url` (replacing a previous one): inside the app window on
/// Windows, in its own window elsewhere. Emits `player-exited` when mpv
/// goes away, and every mpv event / property change as `mpv`.
#[tauri::command]
pub async fn play_launch(app: AppHandle, player: State<'_, Player>, args: LaunchArgs) -> Result<Launched, String> {
    if !(args.url.starts_with("http://") || args.url.starts_with("https://")) {
        return Err("URL no válida".into());
    }
    stop_mpv(&app, &player);

    // the child window mpv draws into
    let host = if cfg!(windows) { create_host(&app).await.unwrap_or(0) } else { 0 };
    let embedded = host != 0;

    let ipc = ipc_path();
    let mut cmd = Command::new(mpv_path(&app));
    cmd.arg(format!("--input-ipc-server={ipc}"))
        .arg(format!("--title={} — Anime TV", args.title))
        .arg(format!("--force-media-title={}", args.title))
        .arg("--cache=yes")
        .arg("--demuxer-readahead-secs=60")
        .arg("--network-timeout=120")
        .arg("--save-position-on-quit=no")
        .arg("--hwdec=auto-safe")
        .arg("--sub-auto=fuzzy")
        .arg("--volume-max=100");
    if embedded {
        // the app draws the controls: no mpv keys, mouse, OSC or OSD
        cmd.arg(format!("--wid={host}"))
            .arg("--keep-open=yes")
            .arg("--osc=no")
            .arg("--osd-level=0")
            .arg("--input-default-bindings=no")
            .arg("--input-vo-keyboard=no")
            .arg("--input-cursor=no")
            .arg("--cursor-autohide=always")
            .arg("--background-color=#000000");
    } else {
        cmd.arg("--force-window=immediate").arg("--keep-open=no");
    }
    let alang = mpv_langs(&args.audio);
    if !alang.is_empty() {
        cmd.arg(format!("--alang={alang},jpn,ja"));
    }
    let slang = mpv_langs(&args.subs);
    if !slang.is_empty() {
        cmd.arg(format!("--slang={slang}"));
    }
    cmd.arg("--").arg(&args.url);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            destroy_host(&app, host);
            return Err(if e.kind() == std::io::ErrorKind::NotFound {
                "no se encontró el reproductor mpv".to_string()
            } else {
                format!("no se pudo abrir mpv: {e}")
            });
        }
    };
    let pid = child.id();
    let (tx, rx) = mpsc::unbounded_channel();
    *player.mpv.lock().map_err(|e| e.to_string())? = Some(child);
    *player.live.lock().map_err(|e| e.to_string())? = Some(Live { pid, info: args.info.clone(), tx, host });
    tauri::async_runtime::spawn(run_ipc(app.clone(), ipc, rx));

    if embedded {
        if let Err(e) = open_overlay(&app) {
            eprintln!("player overlay: {e}");
        }
    }
    watch_exit(app.clone(), pid);
    Ok(Launched { embedded })
}

/// Polls mpv; when it exits, tears the embedding down and tells the UI.
fn watch_exit(app: AppHandle, pid: u32) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let p = app.state::<Player>();
        let mut slot = match p.mpv.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        match slot.as_mut() {
            Some(c) if c.id() == pid => {
                if let Ok(Some(status)) = c.try_wait() {
                    *slot = None;
                    drop(slot);
                    teardown(&app, &p, pid);
                    let _ = app.emit("player-exited", Exited { code: status.code() });
                    return;
                }
            }
            // replaced by a newer mpv or stopped: nothing to report
            _ => return,
        }
    });
}

/// Removes the session `pid` (or any, with 0): the controls window, the
/// child window and fullscreen.
fn teardown(app: &AppHandle, p: &Player, pid: u32) {
    let live = match p.live.lock() {
        Ok(mut l) if pid == 0 || l.as_ref().is_some_and(|x| x.pid == pid) => l.take(),
        _ => None,
    };
    let Some(live) = live else { return };
    if live.host != 0 {
        if let Some(w) = app.get_webview_window(OVERLAY) {
            let _ = w.destroy();
        }
        destroy_host(app, live.host);
        if let Some(main) = app.get_webview_window("main") {
            if main.is_fullscreen().unwrap_or(false) {
                let _ = main.set_fullscreen(false);
            }
            let _ = main.set_focus();
        }
    }
}

fn stop_mpv(app: &AppHandle, p: &Player) {
    if let Ok(mut slot) = p.mpv.lock() {
        if let Some(mut c) = slot.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
    teardown(app, p, 0);
}

/// Closes mpv (and the embedded player) if open.
#[tauri::command]
pub fn play_stop(app: AppHandle, player: State<'_, Player>) {
    stop_mpv(&app, &player);
}

/// What the controls window shows: the `info` the UI passed to play_launch.
#[tauri::command]
pub fn player_info(player: State<'_, Player>) -> Value {
    player.live.lock().ok().and_then(|l| l.as_ref().map(|x| x.info.clone())).unwrap_or(Value::Null)
}

/// Properties the controls may set or cycle. Anything else (notably `run`,
/// `load-script`, `loadfile`…) is refused.
const SETTABLE: &[&str] = &["pause", "volume", "mute", "sid", "aid", "sub-delay", "speed", "sub-visibility", "time-pos"];

fn allowed(cmd: &[Value]) -> bool {
    let name = |i: usize| cmd.get(i).and_then(Value::as_str).unwrap_or("");
    match name(0) {
        "set_property" | "cycle" | "add" => SETTABLE.contains(&name(1)),
        "seek" => cmd.get(1).is_some_and(Value::is_number),
        "frame-step" | "frame-back-step" => cmd.len() == 1,
        _ => false,
    }
}

/// A command from the controls to mpv, e.g. ["seek", 10, "relative"].
#[tauri::command]
pub fn player_cmd(player: State<'_, Player>, cmd: Vec<Value>) -> Result<(), String> {
    if !allowed(&cmd) {
        return Err("comando no permitido".into());
    }
    let live = player.live.lock().map_err(|e| e.to_string())?;
    let live = live.as_ref().ok_or("no hay nada reproduciéndose")?;
    live.tx.send(json!({ "command": cmd }).to_string()).map_err(|_| "el reproductor se cerró".to_string())
}

/// Toggles fullscreen of the app window (the player follows it). Returns
/// the new state.
#[tauri::command]
pub fn player_fullscreen(app: AppHandle, on: Option<bool>) -> Result<bool, String> {
    let main = app.get_webview_window("main").ok_or("sin ventana")?;
    let now = main.is_fullscreen().map_err(|e| e.to_string())?;
    let want = on.unwrap_or(!now);
    if want != now {
        main.set_fullscreen(want).map_err(|e| e.to_string())?;
    }
    Ok(want)
}

/// Properties forwarded to the UI as they change.
const OBSERVED: &[&str] = &[
    "pause",
    "time-pos",
    "duration",
    "volume",
    "mute",
    "paused-for-cache",
    "cache-buffering-state",
    "demuxer-cache-time",
    "eof-reached",
    "track-list",
    "seeking",
    "sid",
    "aid",
];

#[cfg(windows)]
async fn connect_ipc(path: &str) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    tokio::net::windows::named_pipe::ClientOptions::new().open(path)
}

#[cfg(unix)]
async fn connect_ipc(path: &str) -> std::io::Result<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(path).await
}

/// Connects to mpv's IPC (it appears a moment after mpv starts), observes
/// the properties the controls need and forwards events as `mpv`.
async fn run_ipc(app: AppHandle, path: String, mut rx: mpsc::UnboundedReceiver<String>) {
    let mut conn = None;
    for _ in 0..150 {
        match connect_ipc(&path).await {
            Ok(c) => {
                conn = Some(c);
                break;
            }
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
        }
        if rx.is_closed() {
            return;
        }
    }
    let Some(conn) = conn else {
        eprintln!("mpv ipc: no connection on {path}");
        return;
    };
    pump(app, conn, &mut rx).await;
    #[cfg(unix)]
    let _ = std::fs::remove_file(&path);
}

async fn pump<S: AsyncRead + AsyncWrite>(app: AppHandle, conn: S, rx: &mut mpsc::UnboundedReceiver<String>) {
    let (r, mut w) = tokio::io::split(conn);
    for (i, p) in OBSERVED.iter().enumerate() {
        let line = json!({ "command": ["observe_property", i + 1, p] }).to_string() + "\n";
        if w.write_all(line.as_bytes()).await.is_err() {
            return;
        }
    }
    let mut lines = BufReader::new(r).lines();
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(l)) => {
                    if let Ok(v) = serde_json::from_str::<Value>(&l) {
                        if v.get("event").is_some() {
                            let _ = app.emit("mpv", v);
                        }
                    }
                }
                _ => return,
            },
            cmd = rx.recv() => match cmd {
                Some(c) => {
                    if w.write_all((c + "\n").as_bytes()).await.is_err() {
                        return;
                    }
                }
                None => return,
            },
        }
    }
}

// ---- embedding (Windows) ----------------------------------------------------

/// The controls window: transparent, borderless, owned by the main window
/// (so it stays above it, hides when it is minimised), over its client area.
fn open_overlay(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(OVERLAY) {
        let _ = w.destroy();
    }
    let main = app.get_webview_window("main").ok_or("sin ventana")?;
    let w = tauri::WebviewWindowBuilder::new(app, OVERLAY, tauri::WebviewUrl::App("index.html".into()))
        .title("Anime TV")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(true)
        .parent(&main)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    // Alt+F4 on the controls closes the player, not just the controls
    let app2 = app.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = app2.emit_to("main", "player-action", json!({ "kind": "close" }));
        }
    });
    sync_geometry(app);
    w.show().map_err(|e| e.to_string())?;
    let _ = w.set_focus();
    Ok(())
}

/// Keeps the child window and the controls on the main window's client
/// area; called on every move / resize of the main window.
pub fn sync_geometry(app: &AppHandle) {
    let host = match app.state::<Player>().live.lock() {
        Ok(l) => l.as_ref().map(|x| x.host).unwrap_or(0),
        Err(_) => 0,
    };
    if host == 0 {
        return;
    }
    let Some(main) = app.get_webview_window("main") else { return };
    let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) else { return };
    if let Some(w) = app.get_webview_window(OVERLAY) {
        let _ = w.set_position(pos);
        let _ = w.set_size(size);
    }
    place_host(host, size.width as i32, size.height as i32);
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW, WS_CHILD,
        WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_DISABLED, WS_VISIBLE,
    };

    const SS_BLACKRECT: u32 = 0x4;

    /// A black child window covering the parent's client area, on top of
    /// the webview. Disabled: it never takes input (the controls do).
    pub fn create(parent: isize, w: i32, h: i32) -> isize {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        unsafe {
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN | WS_DISABLED | SS_BLACKRECT,
                0,
                0,
                w,
                h,
                parent as HWND,
                std::ptr::null_mut(),
                GetModuleHandleW(std::ptr::null()),
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return 0;
            }
            SetWindowPos(hwnd, HWND_TOP, 0, 0, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            hwnd as isize
        }
    }

    pub fn place(hwnd: isize, w: i32, h: i32) {
        unsafe {
            SetWindowPos(hwnd as HWND, HWND_TOP, 0, 0, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }

    pub fn destroy(hwnd: isize) {
        unsafe {
            DestroyWindow(hwnd as HWND);
        }
    }
}

/// Creates the child window on the UI thread (it must own it).
async fn create_host(app: &AppHandle) -> Result<isize, String> {
    #[cfg(windows)]
    {
        let main = app.get_webview_window("main").ok_or("sin ventana")?;
        let parent = main.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let size = main.inner_size().map_err(|e| e.to_string())?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(win::create(parent, size.width as i32, size.height as i32));
        })
        .map_err(|e| e.to_string())?;
        let h = rx.await.map_err(|e| e.to_string())?;
        if h == 0 {
            return Err("no se pudo crear la ventana del vídeo".into());
        }
        Ok(h)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("solo en Windows".into())
    }
}

fn place_host(host: isize, w: i32, h: i32) {
    #[cfg(windows)]
    win::place(host, w, h);
    #[cfg(not(windows))]
    let _ = (host, w, h);
}

fn destroy_host(app: &AppHandle, host: isize) {
    if host == 0 {
        return;
    }
    #[cfg(windows)]
    {
        let _ = app.run_on_main_thread(move || win::destroy(host));
    }
    #[cfg(not(windows))]
    let _ = app;
}

/// On app exit: close mpv.
pub fn shutdown(player: &Player) {
    if let Ok(mut slot) = player.mpv.lock() {
        if let Some(mut c) = slot.take() {
            let _ = c.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_harmless_commands() {
        let c = |v: Value| allowed(v.as_array().unwrap());
        assert!(c(json!(["set_property", "pause", true])));
        assert!(c(json!(["cycle", "mute"])));
        assert!(c(json!(["seek", 10, "relative"])));
        assert!(c(json!(["add", "volume", -5])));
        assert!(!c(json!(["run", "cmd.exe"])));
        assert!(!c(json!(["set_property", "input-ipc-server", "x"])));
        assert!(!c(json!(["loadfile", "C:/x"])));
        assert!(!c(json!(["seek", "x"])));
    }
}
