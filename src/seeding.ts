// Sharing after watching (seeding): episodes kept in the torrent engine
// once their player closes, until the user's ratio / time limit, the
// "at once" limit, or the user stops them. Only while the app is open and
// only with the user's consent (DownloadSettings.consent).

import { useCallback, useEffect, useRef, useState } from "react";
import * as player from "./player";
import type { DownloadSettings, EngineStatus } from "./player";
import * as stats from "./stats";

export type Seed = {
  id: number;
  fileIdx: number;
  mediaId: number;
  series: string;
  episode: number;
  cover: string;
  since: number;
  status: EngineStatus | null;
};

export function useSeeding(settings: DownloadSettings) {
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const ref = useRef(seeds);
  ref.current = seeds;
  const cfg = useRef(settings);
  cfg.current = settings;

  const stop = useCallback(async (id: number) => {
    setSeeds((l) => l.filter((s) => s.id !== id));
    stats.forgetTorrent(id);
    await player.close(id, cfg.current.deleteAfter).catch(() => {});
  }, []);
  const stopAll = useCallback(async () => {
    const ids = ref.current.map((s) => s.id);
    setSeeds([]);
    await Promise.all(ids.map((id) => player.close(id, cfg.current.deleteAfter).catch(() => {})));
  }, []);

  /** An episode's player closed: share it, or release it. */
  const release = useCallback(
    async (s: Omit<Seed, "since" | "status">) => {
      const c = cfg.current;
      if (!(c.seed.enabled && player.sharingAllowed(c))) {
        await player.close(s.id, c.deleteAfter).catch(() => {});
        return;
      }
      const list = [{ ...s, since: Date.now(), status: null }, ...ref.current.filter((x) => x.id !== s.id)];
      const over = list.slice(Math.max(1, c.seed.maxTorrents));
      setSeeds(list.slice(0, Math.max(1, c.seed.maxTorrents)));
      await Promise.all(over.map((x) => player.close(x.id, c.deleteAfter).catch(() => {})));
    },
    [],
  );

  /** The same torrent is being watched again: not a seed meanwhile. */
  const claim = useCallback((id: number) => setSeeds((l) => l.filter((s) => s.id !== id)), []);

  // sharing switched off or consent withdrawn: stop everything
  useEffect(() => {
    if ((!settings.seed.enabled || !settings.consent) && ref.current.length) stopAll();
  }, [settings.seed.enabled, settings.consent, stopAll]);

  // stats, and the ratio / time limits
  useEffect(() => {
    if (seeds.length === 0) return;
    const tick = async () => {
      const c = cfg.current.seed;
      for (const s of ref.current) {
        const st = await player.status(s.id, s.fileIdx).catch(() => null);
        if (st) stats.recordTransfer(s.id, { mediaId: s.mediaId, series: s.series, cover: s.cover, episode: s.episode }, st.uploaded, st.downloaded);
        if (!st) {
          setSeeds((l) => l.filter((x) => x.id !== s.id));
          continue;
        }
        const ratio = st.fileLen ? st.uploaded / st.fileLen : 0;
        const hours = (Date.now() - s.since) / 3_600_000;
        if ((c.ratio != null && ratio >= c.ratio) || (c.hours != null && hours >= c.hours)) {
          await stop(s.id);
          continue;
        }
        setSeeds((l) => l.map((x) => (x.id === s.id ? { ...x, status: st } : x)));
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeds.length]);

  return { seeds, release, claim, stop, stopAll };
}
