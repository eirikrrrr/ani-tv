// Playback bridge: torrent engine + mpv (src-tauri/src/player.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inTauri } from "./discord";

export type Opened = { id: number; fileIdx: number; fileName: string; fileLen: number; url: string };
export type EngineStatus = {
  state: string;
  fileDownloaded: number;
  fileLen: number;
  downBps: number;
  upBps: number;
  peers: number;
  error: string | null;
};

/** Settings → Downloads. */
export type DownloadSettings = {
  /** empty = the app's cache folder */
  dir: string;
  /** KiB/s, null = unlimited */
  uploadKib: number | null;
  /** delete the episode when the player is closed */
  deleteAfter: boolean;
};
export const DEFAULT_DOWNLOADS: DownloadSettings = { dir: "", uploadKib: 500, deleteAfter: true };

const msg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) throw new Error("El reproductor solo funciona en la app de escritorio");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(msg(e));
  }
}

export const open = (source: string, fileIdx: number | null, episode: number | null, s: DownloadSettings) =>
  call<Opened>("play_open", { source, fileIdx, episode, settings: { downloadDir: s.dir || null, uploadKib: s.uploadKib } });

export const status = (id: number, fileIdx: number) => call<EngineStatus>("play_status", { id, fileIdx });

export const close = (id: number, deleteFiles: boolean) => call<void>("play_close", { id, deleteFiles });

export const launch = (url: string, title: string, audio: string[], subs: string[]) =>
  call<void>("play_launch", { args: { url, title, audio, subs } });

export const stop = () => call<void>("play_stop");

export function onExited(cb: () => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen("player-exited", () => cb());
}

/** Enough buffered to start: 3% of the file or 12 MB, whichever is smaller. */
export const readyToPlay = (s: EngineStatus) =>
  s.fileLen > 0 && s.fileDownloaded >= Math.min(s.fileLen, Math.max(4 * 1024 * 1024, Math.min(12 * 1024 * 1024, s.fileLen * 0.03)));

export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}
