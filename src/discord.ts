// Bridge to the Rust side (src-tauri) that talks to the local Discord client.
// In a plain browser (UI development without Tauri) every call is a no-op.

import { invoke } from "@tauri-apps/api/core";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type Presence = {
  title: string;
  episode?: number;
  totalEpisodes?: number;
  coverUrl?: string;
  infoUrl?: string;
  startedAt?: number;
  logoUrl?: string;
};

export type DiscordStatus = "off" | "connecting" | "on" | "error";

/** The Anime TV application in the Discord Developer Portal (public, not a
 *  secret). Users can override it with their own in Settings → Discord. */
export const DEFAULT_CLIENT_ID = "1575656237314609202";

/** Public HTTPS images/links Discord shows (it fetches them itself). */
export const LOGO_URL = "https://raw.githubusercontent.com/eirikrrrr/ani-tv/main/src-tauri/icons/icon.png";
export const APP_URL = "https://github.com/eirikrrrr/ani-tv/releases";
/** When the app was opened: the idle status shows the elapsed time. */
export const OPENED_AT = Date.now();

export type Idle = { text: string; logoUrl?: string; startedAt?: number; appUrl?: string };

const err = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

export async function connect(clientId: string): Promise<void> {
  if (!inTauri) throw new Error("Discord solo funciona en la app de escritorio");
  try {
    await invoke("discord_connect", { clientId });
  } catch (e) {
    throw new Error(err(e));
  }
}

export async function setPresence(p: Presence): Promise<void> {
  if (!inTauri) return;
  try {
    await invoke("discord_set", { presence: p });
  } catch (e) {
    throw new Error(err(e));
  }
}

export async function setIdle(i: Idle): Promise<void> {
  if (!inTauri) return;
  try {
    await invoke("discord_idle", { idle: i });
  } catch (e) {
    throw new Error(err(e));
  }
}

export async function clearPresence(): Promise<void> {
  if (!inTauri) return;
  await invoke("discord_clear").catch(() => {});
}

export async function disconnect(): Promise<void> {
  if (!inTauri) return;
  await invoke("discord_disconnect").catch(() => {});
}
