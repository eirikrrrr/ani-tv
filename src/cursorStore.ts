// Custom cursor images live in IndexedDB (room for large animated GIFs);
// only their id and name are kept in localStorage. Older saves that still
// carry a data URL keep working.

import { useEffect, useState } from "react";
import type { CustomCursor } from "./components/Cursor";

const DB = "atv";
const STORE = "cursor-images";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = f(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const putImage = (id: string, blob: Blob) => run<void>("readwrite", (s) => s.put(blob, id));
export const getImage = (id: string) => run<Blob | undefined>("readonly", (s) => s.get(id));
export const deleteImage = (id: string) => run<void>("readwrite", (s) => s.delete(id)).catch(() => {});

/** id → displayable URL for every custom cursor (object URLs, revoked on change). */
export function useCursorImages(list: CustomCursor[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = list.map((c) => c.id).join(",");
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    Promise.all(
      list.map(async (c) => {
        if (c.src) return [c.id, c.src] as const;
        const blob = await getImage(c.id).catch(() => undefined);
        if (!blob) return [c.id, ""] as const;
        const u = URL.createObjectURL(blob);
        made.push(u);
        return [c.id, u] as const;
      }),
    ).then((pairs) => {
      if (alive) setUrls(Object.fromEntries(pairs.filter(([, u]) => u)));
    });
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}
