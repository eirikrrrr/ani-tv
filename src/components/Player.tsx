// Playback session: open the torrent, buffer, launch mpv, show live stats,
// and clean up when the player is closed.

import { AlertTriangle, Loader2, MonitorPlay, Play, SkipForward, Square, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as player from "../player";
import type { DownloadSettings, EngineStatus, Opened } from "../player";
import { formatSize, type Prefs, type Ranked } from "../sources";
import type { PickTarget } from "./Picker";

type Phase = "opening" | "buffering" | "playing" | "closed" | "error";

export function PlayerSession(props: {
  target: PickTarget;
  release: Ranked;
  downloads: DownloadSettings;
  prefs: Prefs;
  /** playback actually started (mark watching, Discord) */
  onPlaying: () => void;
  onNext: (() => void) | null;
  onEnd: () => void;
}) {
  const { media, episode } = props.target;
  const [phase, setPhase] = useState<Phase>("opening");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [st, setSt] = useState<EngineStatus | null>(null);
  const launched = useRef(false);
  const title = `${media.title} · Episodio ${episode}`;
  const audio = props.prefs.languages.filter((l) => l.track === "audio").map((l) => l.lang);
  const subs = props.prefs.languages.filter((l) => l.track === "subs").map((l) => l.lang);

  const launch = async (url: string) => {
    try {
      await player.launch(url, title, audio, subs);
      if (!launched.current) props.onPlaying();
      launched.current = true;
      setPhase("playing");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  // open the torrent (or play a direct URL)
  useEffect(() => {
    let cancelled = false;
    const r = props.release;
    if (r.url && !r.magnet && !r.torrentUrl) {
      launch(r.url);
      return;
    }
    const source = r.magnet ?? r.torrentUrl;
    if (!source) {
      setError("Este resultado no tiene enlace descargable");
      setPhase("error");
      return;
    }
    player
      .open(source, r.fileIdx, episode, props.downloads)
      .then((o) => {
        if (cancelled) return;
        setOpened(o);
        setPhase("buffering");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live stats; launch mpv once enough is buffered
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await player.status(opened.id, opened.fileIdx);
        if (!alive) return;
        setSt(s);
        if (s.error) {
          setError(s.error);
          setPhase("error");
        } else if (!launched.current && player.readyToPlay(s)) {
          launch(opened.url);
        }
      } catch {
        /* torrent gone */
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  // mpv window closed
  useEffect(() => {
    const un = player.onExited(() => setPhase((p) => (p === "playing" ? "closed" : p)));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const finish = async () => {
    await player.stop().catch(() => {});
    if (opened) await player.close(opened.id, props.downloads.deleteAfter).catch(() => {});
    props.onEnd();
  };

  const progress = st && st.fileLen ? st.fileDownloaded / st.fileLen : 0;
  const bufferGoal = st ? Math.min(st.fileLen, Math.max(4 * 1048576, Math.min(12 * 1048576, st.fileLen * 0.03))) : 1;
  const buffer = st ? Math.min(1, st.fileDownloaded / bufferGoal) : 0;

  const stats = st && (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
      <span>↓ {player.formatSpeed(st.downBps)}</span>
      <span>↑ {player.formatSpeed(st.upBps)}</span>
      <span className="flex items-center gap-1">
        <Users size={13} /> {st.peers} peers
      </span>
      <span>
        {formatSize(st.fileDownloaded) || "0 B"} / {formatSize(st.fileLen)} ({(progress * 100).toFixed(0)}%)
      </span>
    </div>
  );

  // preparing / error: centered card
  if (phase === "opening" || phase === "buffering" || phase === "error") {
    return createPortal(
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="fade-in relative w-full max-w-[560px] overflow-hidden rounded-[28px] bg-panel shadow-soft">
          <div className="relative h-44 overflow-hidden">
            <img src={media.banner ?? media.cover} alt="" className="kenburns absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent" />
          </div>
          <div className="-mt-10 px-7 pb-7">
            <p className="relative text-[13px] font-medium tracking-wide text-accent uppercase">Episodio {episode}</p>
            <h2 className="relative truncate text-[22px] font-semibold">{media.title}</h2>
            <p className="mt-1 truncate text-[13px] text-muted" title={props.release.title}>
              {props.release.title}
            </p>

            {phase === "error" ? (
              <p className="mt-5 flex items-start gap-2 rounded-2xl bg-amber-500/10 px-4 py-3 text-[14px] text-amber-500">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" /> {error}
              </p>
            ) : (
              <div className="mt-5">
                <p className="flex items-center gap-2 text-[15px]">
                  <Loader2 size={17} className="animate-spin text-accent" />
                  {phase === "opening" ? "Buscando peers y leyendo el torrent…" : "Cargando el principio del episodio…"}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-700"
                    style={{ width: `${phase === "opening" ? 4 : Math.max(6, buffer * 100)}%` }}
                  />
                </div>
                <div className="mt-3">{stats}</div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={finish} className="flex h-11 items-center gap-2 rounded-full bg-panel-2 px-5 text-[15px] hover:text-accent">
                <X size={17} /> {phase === "error" ? "Cerrar" : "Cancelar"}
              </button>
              {phase === "buffering" && (
                <button
                  onClick={() => opened && launch(opened.url)}
                  className="flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-white"
                  title="Abrir ya el reproductor aunque el búfer no esté lleno"
                >
                  <Play size={16} fill="currentColor" /> Ver ya
                </button>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // playing / closed: compact floating card
  return createPortal(
    <div className="fade-in fixed right-5 bottom-5 z-40 w-[380px] max-w-[calc(100vw-2.5rem)] rounded-3xl bg-panel p-4 shadow-soft max-md:bottom-24">
      <div className="flex items-center gap-3">
        <img src={media.cover} alt="" className="h-14 w-10 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-accent uppercase">
            <MonitorPlay size={13} /> {phase === "playing" ? "Reproduciendo en mpv" : "Reproductor cerrado"}
          </p>
          <p className="truncate text-[15px] font-medium">{media.title}</p>
          <p className="text-[13px] text-muted">Episodio {episode}</p>
        </div>
      </div>
      {opened && (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-2">{stats}</div>
        </>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          onClick={() => launch(opened?.url ?? props.release.url ?? "")}
          className="flex h-10 items-center gap-1.5 rounded-full bg-panel-2 px-4 text-[14px] hover:text-accent"
        >
          <Play size={14} fill="currentColor" /> {phase === "playing" ? "Reabrir" : "Seguir viendo"}
        </button>
        {props.onNext && (
          <button
            onClick={async () => {
              await finish();
              props.onNext?.();
            }}
            className="flex h-10 items-center gap-1.5 rounded-full bg-panel-2 px-4 text-[14px] hover:text-accent"
          >
            <SkipForward size={15} /> Siguiente
          </button>
        )}
        <button onClick={finish} className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-medium text-white">
          <Square size={13} fill="currentColor" /> Terminar
        </button>
      </div>
    </div>,
    document.body,
  );
}
