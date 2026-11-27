// Playback bridge: torrent engine + mpv (src-tauri/src/player.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inTauri } from "./discord";
import { t, tErr } from "./i18n";

export type Opened = {
  id: number;
  fileIdx: number;
  fileName: string;
  fileLen: number;
  url: string;
  /** the link was a video, not a torrent: nothing to download */
  direct: boolean;
};
export type EngineStatus = {
  state: string;
  fileDownloaded: number;
  fileLen: number;
  downBps: number;
  upBps: number;
  peers: number;
  error: string | null;
  uploaded: number;
  finished: boolean;
};

/** Settings → Downloads & sharing. Speeds in KiB/s; null = no limit. */
export type SeedSettings = {
  /** keep sharing an episode after watching it (needs consent) */
  enabled: boolean;
  /** upload limit while only sharing (nothing playing) */
  uploadKib: number | null;
  /** stop at this upload ratio (uploaded / episode size); null = never */
  ratio: number | null;
  /** stop after this many hours; null = never */
  hours: number | null;
  /** episodes shared at once (the oldest stops first) */
  maxTorrents: number;
};
export type DownloadSettings = {
  /** empty = the app's cache folder */
  dir: string;
  /** delete the episode when it is no longer watched or shared */
  deleteAfter: boolean;
  downloadKib: number | null;
  /** upload limit while watching; 0 = the minimum */
  uploadKib: number | null;
  seed: SeedSettings;
  /** accept incoming connections (applied on the next start) */
  incoming: boolean;
  /** forward the port on the router (UPnP) */
  upnp: boolean;
  /** when the user agreed to share (ISO date); null = not agreed */
  consent: string | null;
};
export const DEFAULT_DOWNLOADS: DownloadSettings = {
  dir: "",
  deleteAfter: true,
  downloadKib: null,
  uploadKib: 500,
  seed: { enabled: false, uploadKib: 500, ratio: 1, hours: 2, maxTorrents: 3 },
  incoming: false,
  upnp: false,
  consent: null,
};
/** Settings saved by older versions lack the new fields. */
export const normalizeDownloads = (s: Partial<DownloadSettings> | null | undefined): DownloadSettings => ({
  ...DEFAULT_DOWNLOADS,
  ...s,
  seed: { ...DEFAULT_DOWNLOADS.seed, ...(s?.seed ?? {}) },
});
/** Sharing (seeding, incoming connections) only counts with consent. */
export const sharingAllowed = (s: DownloadSettings) => !!s.consent;

const msg = (e: unknown) => tErr(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) throw new Error(t("El reproductor solo funciona en la app de escritorio"));
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(msg(e));
  }
}

/** Tries each source in order (.torrent link first, then the magnet). */
const engineSettings = (s: DownloadSettings) => ({
  downloadDir: s.dir || null,
  uploadKib: s.uploadKib,
  downloadKib: s.downloadKib,
  incoming: sharingAllowed(s) && s.incoming,
  upnp: sharingAllowed(s) && s.incoming && s.upnp,
});

export const open = (sources: string[], fileIdx: number | null, episode: number | null, s: DownloadSettings) =>
  call<Opened>("play_open", { sources, fileIdx, episode, settings: engineSettings(s) });

/** New speed limits for the running engine. */
export const limits = (downloadKib: number | null, uploadKib: number | null) =>
  call<void>("engine_limits", { downloadKib, uploadKib }).catch(() => {});
export const engineStarted = () => call<boolean>("engine_started").catch(() => false);

export const status = (id: number, fileIdx: number) => call<EngineStatus>("play_status", { id, fileIdx });

export const close = (id: number, deleteFiles: boolean) => call<void>("play_close", { id, deleteFiles });

/** What the embedded player's controls show. */
export type PlayerInfo = {
  mediaId: number;
  series: string;
  episode: number;
  release: string;
  cover: string | null;
  banner: string | null;
  hasNext: boolean;
};

export const launch = (url: string, title: string, audio: string[], subs: string[], info: PlayerInfo, start: number | null) =>
  call<{ embedded: boolean }>("play_launch", { args: { url, title, audio, subs, info, start } });

export const stop = () => call<void>("play_stop");

export function onExited(cb: () => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen("player-exited", () => cb());
}

// ---- embedded player (controls window ⇄ mpv IPC) ---------------------------

/** Label of the controls window (src-tauri/src/player.rs). */
export const OVERLAY = "player-ui";

export const info = () => call<PlayerInfo | null>("player_info");
export const cmd = (...command: (string | number | boolean)[]) => call<void>("player_cmd", { cmd: command }).catch(() => {});
export const fullscreen = (on?: boolean) => call<boolean>("player_fullscreen", { on: on ?? null });

/** An mpv IPC event: property changes carry name + data. */
export type MpvEvent = { event: string; name?: string; data?: unknown };
export function onMpv(cb: (e: MpvEvent) => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<MpvEvent>("mpv", (e) => cb(e.payload));
}

/** Torrent stats the main window forwards to the controls. */
export type Stats = { downBps: number; upBps: number; peers: number; progress: number; finished: boolean } | null;
/** What the controls ask the main window to do. */
export type PlayerAction = { kind: "close" | "next" };

/** Enough buffered to start: 3% of the file or 12 MB, whichever is smaller. */
export const readyToPlay = (s: EngineStatus) =>
  s.fileLen > 0 && s.fileDownloaded >= Math.min(s.fileLen, Math.max(4 * 1024 * 1024, Math.min(12 * 1024 * 1024, s.fileLen * 0.03)));

/** t("Sin límite"), "500 KB/s", "2 MB/s" for a KiB/s limit. */
export function formatLimit(kib: number | null): string {
  if (kib == null) return t("Sin límite");
  if (kib === 0) return t("Mínimo");
  return kib >= 1024 ? `${+(kib / 1024).toFixed(1)} MB/s` : `${kib} KB/s`;
}

export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}
