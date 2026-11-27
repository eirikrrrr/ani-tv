// Local statistics: bytes shared and downloaded and time watched, per day
// and episode. Kept only on this computer (localStorage `atv.stats`).
//
// The torrent engine's counters restart with each torrent, so we record
// increments: every status poll adds what changed since the last one. Rows
// are aggregated per (day, series, episode) and carry a stable id, so a
// future API can upsert them without duplicates.
//
// Only the main window records (the player's controls window never does).

import { useEffect, useState } from "react";

export type StatRow = {
  /** `${day}|${mediaId}|${episode}`: stable, for syncing later */
  id: string;
  /** local date, YYYY-MM-DD */
  day: string;
  mediaId: number;
  series: string;
  cover: string | null;
  episode: number;
  /** bytes sent to other peers */
  up: number;
  /** bytes received from the network */
  down: number;
  /** seconds of video played */
  watched: number;
  updatedAt: number;
};

export type StatCtx = { mediaId: number; series: string; cover: string | null; episode: number };

const KEY = "atv.stats";
const FLUSH_MS = 10_000;

export const dayOf = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function load(): StatRow[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ---- recording ---------------------------------------------------------------

/** increments not yet written, by row id */
const pending = new Map<string, StatRow>();
/** last counters seen per torrent id */
const last = new Map<number, { up: number; down: number }>();

function bump(ctx: StatCtx, d: { up?: number; down?: number; watched?: number }) {
  const day = dayOf();
  const id = `${day}|${ctx.mediaId}|${ctx.episode}`;
  const row = pending.get(id) ?? { id, day, ...ctx, up: 0, down: 0, watched: 0, updatedAt: 0 };
  row.up += d.up ?? 0;
  row.down += d.down ?? 0;
  row.watched += d.watched ?? 0;
  row.updatedAt = Date.now();
  pending.set(id, row);
  scheduleFlush();
}

/** A torrent's cumulative counters (from play_status); adds what changed. */
export function recordTransfer(torrentId: number, ctx: StatCtx, uploaded: number, downloaded: number) {
  const prev = last.get(torrentId);
  last.set(torrentId, { up: uploaded, down: downloaded });
  // first sight, or the counters restarted: count from zero
  const up = prev && uploaded >= prev.up ? uploaded - prev.up : uploaded;
  const down = prev && downloaded >= prev.down ? downloaded - prev.down : downloaded;
  if (up > 0 || down > 0) bump(ctx, { up, down });
}

/** The torrent is gone: its next counters start a new count. */
export const forgetTorrent = (torrentId: number) => last.delete(torrentId);

/** Seconds of video played. */
export function recordWatch(ctx: StatCtx, seconds: number) {
  if (seconds > 0 && seconds < 60) bump(ctx, { watched: seconds });
}

let timer: number | undefined;
function scheduleFlush() {
  if (timer === undefined) timer = window.setTimeout(flush, FLUSH_MS);
}

export function flush() {
  window.clearTimeout(timer);
  timer = undefined;
  if (pending.size === 0) return;
  const rows = load();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const p of pending.values()) {
    const r = byId.get(p.id);
    if (r) {
      r.up += p.up;
      r.down += p.down;
      r.watched += p.watched;
      r.updatedAt = p.updatedAt;
      r.cover = p.cover ?? r.cover;
    } else {
      byId.set(p.id, { ...p });
    }
  }
  pending.clear();
  try {
    localStorage.setItem(KEY, JSON.stringify([...byId.values()]));
  } catch {
    /* storage full: keep going without saving */
  }
  window.dispatchEvent(new Event("atv-stats"));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

export function clearStats() {
  pending.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("atv-stats"));
}

/** Saved rows plus what is still pending, refreshed on every flush. */
export function useStatRows(): StatRow[] {
  const [rows, setRows] = useState<StatRow[]>(() => {
    flush();
    return load();
  });
  useEffect(() => {
    const reload = () => setRows(load());
    window.addEventListener("atv-stats", reload);
    // a live view while something plays
    const t = setInterval(flush, 5000);
    return () => {
      window.removeEventListener("atv-stats", reload);
      clearInterval(t);
    };
  }, []);
  return rows;
}

// ---- aggregation -------------------------------------------------------------

export type Totals = { up: number; down: number; watched: number; episodes: number; series: number };

export function totals(rows: StatRow[]): Totals {
  const eps = new Set<string>();
  const series = new Set<number>();
  let up = 0;
  let down = 0;
  let watched = 0;
  for (const r of rows) {
    up += r.up;
    down += r.down;
    watched += r.watched;
    if (r.watched >= 60) {
      eps.add(`${r.mediaId}|${r.episode}`);
      series.add(r.mediaId);
    }
  }
  return { up, down, watched, episodes: eps.size, series: series.size };
}

export type Bucket = { key: string; label: string; up: number; down: number; watched: number };

/** The last `n` days (oldest first), empty days included. */
export function byDay(rows: StatRow[], n: number, locale: string): Bucket[] {
  const out: Bucket[] = [];
  const idx = new Map<string, Bucket>();
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const b = { key: dayOf(d), label: d.toLocaleDateString(locale, { day: "numeric", month: "short" }), up: 0, down: 0, watched: 0 };
    out.push(b);
    idx.set(b.key, b);
  }
  for (const r of rows) {
    const b = idx.get(r.day);
    if (b) {
      b.up += r.up;
      b.down += r.down;
      b.watched += r.watched;
    }
  }
  return out;
}

/** The last `n` months (oldest first). */
export function byMonth(rows: StatRow[], n: number, locale: string): Bucket[] {
  const out: Bucket[] = [];
  const idx = new Map<string, Bucket>();
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = { key, label: d.toLocaleDateString(locale, { month: "short", year: "2-digit" }), up: 0, down: 0, watched: 0 };
    out.push(b);
    idx.set(key, b);
  }
  for (const r of rows) {
    const b = idx.get(r.day.slice(0, 7));
    if (b) {
      b.up += r.up;
      b.down += r.down;
      b.watched += r.watched;
    }
  }
  return out;
}

export type SeriesTotal = { mediaId: number; series: string; cover: string | null; up: number; down: number; watched: number };

export function bySeries(rows: StatRow[]): SeriesTotal[] {
  const m = new Map<number, SeriesTotal>();
  for (const r of rows) {
    const s = m.get(r.mediaId) ?? { mediaId: r.mediaId, series: r.series, cover: r.cover, up: 0, down: 0, watched: 0 };
    s.up += r.up;
    s.down += r.down;
    s.watched += r.watched;
    s.cover = s.cover ?? r.cover;
    m.set(r.mediaId, s);
  }
  return [...m.values()];
}

/** Days in a row with at least a minute watched, ending today or yesterday. */
export function streak(rows: StatRow[]): { current: number; best: number } {
  const days = new Set<string>();
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.watched);
  for (const [d, w] of perDay) if (w >= 60) days.add(d);
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const d of sorted) {
    const cur = new Date(`${d}T12:00:00`);
    run = prev && Math.round((cur.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = cur;
  }
  let current = 0;
  const day = new Date();
  if (!days.has(dayOf(day))) day.setDate(day.getDate() - 1);
  while (days.has(dayOf(day))) {
    current++;
    day.setDate(day.getDate() - 1);
  }
  return { current, best };
}

/** 1 536 → "1.5 KB" … up to TB. */
export function formatBytes(n: number, locale?: string): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0;
  return `${v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[i]}`;
}

export function exportJson(rows: StatRow[]): string {
  return JSON.stringify({ app: "anime-tv", version: 1, exportedAt: new Date().toISOString(), rows }, null, 2);
}
