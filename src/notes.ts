// The user's notes: free text attached to a series episode, optionally at
// a moment of it. Kept in localStorage, which the main window and the
// player's controls window share (same origin): each one listens to the
// `storage` event so a note written in the player shows up in the app.
//
// Times written inside a note ("en 12:34 aparece…", "1:02:03") are
// recognised too and become links that jump to that moment.

import { useCallback, useEffect, useState } from "react";
import { t } from "./i18n";

export type Note = {
  id: string;
  mediaId: number;
  series: string;
  cover: string | null;
  episode: number;
  /** seconds into the episode; null = a note about the whole episode */
  time: number | null;
  text: string;
  createdAt: number;
  updatedAt: number;
};

const KEY = "atv.notes";

function load(): Note[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(list: Note[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* full or blocked: the notes stay in memory for this session */
  }
  // same-window listeners (the storage event only reaches other windows)
  window.dispatchEvent(new Event("atv-notes"));
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(load);
  useEffect(() => {
    const reload = () => setNotes(load());
    const onStorage = (e: StorageEvent) => e.key === KEY && reload();
    window.addEventListener("storage", onStorage);
    window.addEventListener("atv-notes", reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("atv-notes", reload);
    };
  }, []);

  const add = useCallback((n: Omit<Note, "id" | "createdAt" | "updatedAt">) => {
    const now = Date.now();
    const note: Note = { ...n, text: n.text.trim(), id: newId(), createdAt: now, updatedAt: now };
    save([...load(), note]);
    return note;
  }, []);
  const update = useCallback((id: string, p: Partial<Pick<Note, "text" | "time">>) => {
    save(load().map((n) => (n.id === id ? { ...n, ...p, updatedAt: Date.now() } : n)));
  }, []);
  const remove = useCallback((id: string) => save(load().filter((n) => n.id !== id)), []);

  return { notes, add, update, remove };
}

/** Notes of one episode, in playback order (whole-episode notes first). */
export const episodeNotes = (notes: Note[], mediaId: number, episode: number) =>
  notes
    .filter((n) => n.mediaId === mediaId && n.episode === episode)
    .sort((a, b) => (a.time ?? -1) - (b.time ?? -1) || a.createdAt - b.createdAt);

/** "12:34" / "1:02:03" → seconds; null if it is not a time. */
export function parseTime(s: string): number | null {
  const m = s.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (sec >= 60 || (m[1] != null && min >= 60)) return null;
  return h * 3600 + min * 60 + sec;
}

export function formatTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export type Segment = { text: string } | { time: number; label: string };

/** Splits a note's text into plain text and the times written in it. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const t = parseTime(m[0]);
    if (t == null) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ time: t, label: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** All notes as Markdown, grouped by series and episode. */
export function toMarkdown(notes: Note[]): string {
  const bySeries = new Map<number, Note[]>();
  for (const n of notes) bySeries.set(n.mediaId, [...(bySeries.get(n.mediaId) ?? []), n]);
  const lines: string[] = [];
  for (const [mediaId, list] of bySeries) {
    lines.push(`## ${list[0].series}`, "");
    const eps = [...new Set(list.map((n) => n.episode))].sort((a, b) => a - b);
    for (const ep of eps) {
      lines.push(`### ${t("Episodio {n}", { n: ep })}`);
      for (const n of episodeNotes(list, mediaId, ep)) {
        lines.push(`- ${n.time != null ? `**${formatTime(n.time)}** ` : ""}${n.text.replace(/\n/g, " ")}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
