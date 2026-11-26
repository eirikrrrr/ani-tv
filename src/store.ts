// Per-user state kept in this machine: theme, favourites, what is being
// watched, Discord settings. localStorage can be missing or throw (private
// mode), so every access is guarded and the app works without it.

import { useEffect, useState } from "react";
import type { Media } from "./anilist";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep it in memory only */
  }
}

/** useState persisted under `atv.<key>`. */
export function useStored<T>(key: string, initial: T) {
  const k = `atv.${key}`;
  const [v, setV] = useState<T>(() => read(k, initial));
  useEffect(() => write(k, v), [k, v]);
  return [v, setV] as const;
}

/** The bits of a series kept offline (list views, "continue watching"). */
export type Saved = Pick<Media, "id" | "title" | "cover" | "banner" | "episodes" | "siteUrl" | "year" | "format"> & {
  /** romaji title, the one most release names use (missing in old saves) */
  romaji?: string;
};

export const toSaved = (m: Media): Saved => ({
  id: m.id, title: m.title, romaji: m.romaji, cover: m.cover, banner: m.banner,
  episodes: m.episodes, siteUrl: m.siteUrl, year: m.year, format: m.format,
});

export type Progress = Saved & { episode: number; updatedAt: number };

export type Theme = "dark" | "light";

export type DiscordSettings = { enabled: boolean; clientId: string };

/** Look & feel: animated cursor and decorative effects. */
export type Look = {
  cursor: "system" | "neko" | "kitsune" | "mochi";
  cursorSize: "s" | "m" | "l";
  /** petals, Ken Burns zoom */
  effects: boolean;
};
export const DEFAULT_LOOK: Look = { cursor: "system", cursorSize: "m", effects: true };
