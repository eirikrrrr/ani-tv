// The user's library: playlists of episodes and the play queue ("up next").
// Kept in localStorage like the rest of the app's settings.

import { useCallback, useMemo } from "react";
import { useStored, type Saved } from "./store";

export type Item = { id: string; media: Saved; episode: number; addedAt: number };
export type Playlist = {
  id: string;
  name: string;
  description: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  items: Item[];
};
export type QueueItem = { id: string; media: Saved; episode: number };

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function useLibrary() {
  const [playlists, setPlaylists] = useStored<Playlist[]>("playlists", []);
  const [queue, setQueue] = useStored<QueueItem[]>("queue", []);

  const patch = useCallback(
    (id: string, f: (p: Playlist) => Playlist) => setPlaylists((l) => l.map((p) => (p.id === id ? { ...f(p), updatedAt: Date.now() } : p))),
    [setPlaylists],
  );

  const create = useCallback(
    (name: string, items: { media: Saved; episode: number }[] = []) => {
      const now = Date.now();
      const p: Playlist = {
        id: newId(),
        name: name.trim() || "Lista",
        description: "",
        pinned: false,
        createdAt: now,
        updatedAt: now,
        items: items.map((x) => ({ id: newId(), media: x.media, episode: x.episode, addedAt: now })),
      };
      setPlaylists((l) => [p, ...l]);
      return p;
    },
    [setPlaylists],
  );

  /** Adds episodes, skipping the ones already in the list. Returns how many were added. */
  const add = useCallback(
    (id: string, items: { media: Saved; episode: number }[]) => {
      const p = playlists.find((x) => x.id === id);
      if (!p) return 0;
      const have = new Set(p.items.map((x) => `${x.media.id}|${x.episode}`));
      const fresh = items.filter((x) => !have.has(`${x.media.id}|${x.episode}`));
      if (fresh.length)
        patch(id, (q) => ({ ...q, items: [...q.items, ...fresh.map((x) => ({ id: newId(), media: x.media, episode: x.episode, addedAt: Date.now() }))] }));
      return fresh.length;
    },
    [playlists, patch],
  );

  const removeItem = useCallback((id: string, itemId: string) => patch(id, (p) => ({ ...p, items: p.items.filter((x) => x.id !== itemId) })), [patch]);
  const moveItem = useCallback(
    (id: string, from: number, to: number) =>
      patch(id, (p) => {
        const items = [...p.items];
        const [it] = items.splice(from, 1);
        items.splice(to, 0, it);
        return { ...p, items };
      }),
    [patch],
  );
  const rename = useCallback((id: string, name: string, description?: string) => patch(id, (p) => ({ ...p, name: name.trim() || p.name, description: description ?? p.description })), [patch]);
  const togglePin = useCallback((id: string) => patch(id, (p) => ({ ...p, pinned: !p.pinned })), [patch]);
  const remove = useCallback((id: string) => setPlaylists((l) => l.filter((p) => p.id !== id)), [setPlaylists]);

  // ---- queue ----
  const enqueue = useCallback(
    (items: { media: Saved; episode: number }[], front = false) =>
      setQueue((q) => {
        const fresh = items.map((x) => ({ id: newId(), media: x.media, episode: x.episode }));
        return front ? [...fresh, ...q] : [...q, ...fresh];
      }),
    [setQueue],
  );
  const dequeue = useCallback((id: string) => setQueue((q) => q.filter((x) => x.id !== id)), [setQueue]);
  const moveQueued = useCallback(
    (from: number, to: number) =>
      setQueue((q) => {
        const l = [...q];
        const [it] = l.splice(from, 1);
        l.splice(to, 0, it);
        return l;
      }),
    [setQueue],
  );
  const clearQueue = useCallback(() => setQueue([]), [setQueue]);
  /** Takes the first queued episode out of the queue. */
  const shift = useCallback((): QueueItem | null => {
    const first = queue[0] ?? null;
    if (first) setQueue((q) => q.slice(1));
    return first;
  }, [queue, setQueue]);
  /** Replaces the queue (playing a playlist: the rest of it). */
  const setUpNext = useCallback((items: { media: Saved; episode: number }[]) => setQueue(items.map((x) => ({ id: newId(), media: x.media, episode: x.episode }))), [setQueue]);

  const sorted = useMemo(() => [...playlists].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), [playlists]);

  return { playlists: sorted, queue, create, add, removeItem, moveItem, rename, togglePin, remove, enqueue, dequeue, moveQueued, clearQueue, shift, setUpNext };
}

export type Library = ReturnType<typeof useLibrary>;

/** Up to 4 distinct covers for a playlist's mosaic. */
export const mosaic = (p: Playlist) => [...new Map(p.items.map((x) => [x.media.id, x.media.cover])).values()].slice(0, 4);

/** Fisher–Yates on a copy. */
export function shuffled<T>(l: T[]): T[] {
  const a = [...l];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
