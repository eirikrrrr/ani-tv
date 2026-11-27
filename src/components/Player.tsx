// Playback session: open the torrent (or the direct video), buffer, start
// mpv and clean up when the player is closed.
//
// While it prepares, a full-window "cinema" screen shows progress. On
// Windows mpv then plays inside this window and the controls live in the
// player-ui window (PlayerOverlay.tsx); here we only forward torrent stats
// and keys to it and react to its actions. Elsewhere mpv has its own window
// and a small card here offers to reopen it.

import { emitTo, listen } from "@tauri-apps/api/event";
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, MonitorPlay, Play, RefreshCw, SkipForward, Square, Upload, Users } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { inTauri } from "../discord";
import * as player from "../player";
import type { DownloadSettings, EngineStatus, Opened, PlayerAction } from "../player";
import { formatSize, type Prefs, type Ranked } from "../sources";
import type { PickTarget } from "./Picker";

type Phase = "opening" | "buffering" | "starting" | "playing" | "closed" | "error";

/** bytes to have before starting: 3% of the file, between 4 and 12 MB */
const bufferGoal = (len: number) => Math.min(len, Math.max(4 * 1048576, Math.min(12 * 1048576, len * 0.03)));

export function PlayerSession(props: {
  target: PickTarget;
  release: Ranked;
  downloads: DownloadSettings;
  prefs: Prefs;
  /** playback actually started (mark watching, Discord) */
  onPlaying: () => void;
  onNext: (() => void) | null;
  /** back to the release list for this episode */
  onRepick: () => void;
  /** the torrent is open (it may be one that was being shared) */
  onOpened: (o: Opened) => void;
  /** the player is done with the torrent: share it or close it */
  onRelease: (o: Opened) => void;
  onEnd: () => void;
}) {
  const { media, episode } = props.target;
  const [phase, setPhase] = useState<Phase>("opening");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [st, setSt] = useState<EngineStatus | null>(null);
  const [embedded, setEmbedded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const launched = useRef(false);
  const ended = useRef(false);
  const title = `${media.title} · Episodio ${episode}`;
  const audio = props.prefs.languages.filter((l) => l.track === "audio").map((l) => l.lang);
  const subs = props.prefs.languages.filter((l) => l.track === "subs").map((l) => l.lang);

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setPhase("error");
  };

  const launch = async (url: string) => {
    setPhase("starting");
    try {
      const r = await player.launch(url, title, audio, subs, {
        series: media.title,
        episode,
        release: props.release.title,
        cover: media.cover ?? null,
        banner: media.banner ?? null,
        hasNext: !!props.onNext,
      });
      setEmbedded(r.embedded);
      if (!launched.current) props.onPlaying();
      launched.current = true;
      setPhase("playing");
    } catch (e) {
      fail(e);
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
    // a .torrent file carries the metadata and trackers: much faster than a
    // magnet built from a feed's info hash, so it goes first
    const sources = [r.torrentUrl, r.magnet].filter((s): s is string => !!s);
    if (sources.length === 0) {
      fail("Este resultado no tiene enlace descargable");
      return;
    }
    player
      .open(sources, r.fileIdx, episode, props.downloads)
      .then((o) => {
        if (cancelled) return;
        if (o.direct) {
          launch(o.url);
          return;
        }
        props.onOpened(o);
        setOpened(o);
        setPhase("buffering");
      })
      .catch((e: Error) => !cancelled && fail(e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // seconds spent preparing (hint when it is slow)
  useEffect(() => {
    if (phase !== "opening" && phase !== "buffering") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // live stats; start once enough is buffered
  useEffect(() => {
    if (!opened || opened.direct) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await player.status(opened.id, opened.fileIdx);
        if (!alive) return;
        setSt(s);
        if (s.error) fail(s.error);
        else if (!launched.current && phase === "buffering" && player.readyToPlay(s)) launch(opened.url);
        if (launched.current && inTauri) {
          emitTo(player.OVERLAY, "player-stats", {
            downBps: s.downBps,
            peers: s.peers,
            progress: s.fileLen ? s.fileDownloaded / s.fileLen : 0,
          }).catch(() => {});
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
  }, [opened, phase]);

  const finish = async () => {
    if (ended.current) return;
    ended.current = true;
    await player.stop().catch(() => {});
    if (opened && !opened.direct) props.onRelease(opened);
    props.onEnd();
  };
  const next = async () => {
    await finish();
    props.onNext?.();
  };
  const repick = async () => {
    await finish();
    props.onRepick();
  };

  // mpv went away (closed its window, or crashed)
  useEffect(() => {
    const un = player.onExited(() => setPhase((p) => (p === "playing" ? "closed" : p)));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // the embedded controls: their actions, and keys pressed while the main
  // window has the focus go to them
  const actions = useRef({ finish, next });
  actions.current = { finish, next };
  useEffect(() => {
    if (!inTauri || !embedded || phase !== "playing") return;
    const un = listen<PlayerAction>("player-action", (e) => {
      if (e.payload.kind === "next") actions.current.next();
      else actions.current.finish();
    });
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      emitTo(player.OVERLAY, "player-key", { key: e.key, shift: e.shiftKey }).catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => {
      un.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, [embedded, phase]);

  // Escape while preparing = cancel
  useEffect(() => {
    if (phase === "playing" || phase === "closed") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const progress = st && st.fileLen ? st.fileDownloaded / st.fileLen : 0;
  const buffer = st && st.fileLen ? Math.min(1, st.fileDownloaded / bufferGoal(st.fileLen)) : 0;

  // embedded and playing: mpv covers this window; keep it black underneath
  if (phase === "playing" && embedded) {
    return createPortal(<div className="fixed inset-0 z-50 bg-black" />, document.body);
  }

  if (phase === "playing" || phase === "closed") {
    return createPortal(
      <MiniCard
        cover={media.cover}
        series={media.title}
        episode={episode}
        playing={phase === "playing"}
        progress={opened && !opened.direct ? progress : null}
        stats={st}
        onReopen={() => launch(opened?.url ?? props.release.url ?? "")}
        onNext={props.onNext ? next : null}
        onEnd={finish}
      />,
      document.body,
    );
  }

  // ---- preparing / error: the cinema screen --------------------------------
  const step = phase === "opening" ? 0 : phase === "buffering" ? 1 : 2;
  const slow = phase === "opening" && elapsed >= 25;
  const pct = phase === "opening" ? 0 : phase === "starting" ? 1 : buffer;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-hidden bg-black text-white">
      <img src={media.banner ?? media.cover} alt="" className="cinema-backdrop absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.35),rgb(0_0_0/0.92))]" />

      <button
        onClick={finish}
        className="absolute top-5 left-5 flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-[15px] backdrop-blur-md transition-colors hover:bg-white/20"
      >
        <ArrowLeft size={18} /> Volver
      </button>

      <div className="relative grid h-full place-items-center p-6">
        <div className="fade-in flex w-full max-w-[760px] items-center gap-8 max-sm:flex-col max-sm:text-center">
          <img
            src={media.cover}
            alt=""
            className="aspect-[2/3] w-[170px] shrink-0 rounded-2xl object-cover shadow-[0_25px_60px_rgb(0_0_0/0.6)] ring-1 ring-white/10 max-sm:w-[130px]"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold tracking-[0.18em] text-accent uppercase">Episodio {episode}</p>
            <h2 className="mt-1 line-clamp-2 text-[34px] leading-tight font-semibold max-sm:text-[26px]">{media.title}</h2>
            <p className="mt-2 truncate text-[13px] text-white/50" title={props.release.title}>
              {props.release.title}
            </p>

            {phase === "error" ? (
              <>
                <div className="mt-6 flex items-start gap-3 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10 backdrop-blur-md">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-400">
                    <AlertTriangle size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">No se pudo reproducir</p>
                    <p className="mt-0.5 text-[14px] break-words text-white/65">{error}</p>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-3 max-sm:justify-center">
                  <PillButton accent onClick={repick} icon={<RefreshCw size={16} />}>
                    Probar otro resultado
                  </PillButton>
                  <PillButton onClick={finish}>Cerrar</PillButton>
                </div>
              </>
            ) : (
              <>
                <Steps step={step} />
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                  {phase === "opening" ? (
                    <div className="cinema-indeterminate h-full w-1/3 rounded-full bg-accent" />
                  ) : (
                    <div
                      className="h-full rounded-full bg-accent shadow-[0_0_14px_var(--atv-accent)] transition-[width] duration-700"
                      style={{ width: `${Math.max(3, pct * 100)}%` }}
                    />
                  )}
                </div>
                <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-white/60 max-sm:justify-center">
                  {st ? (
                    <>
                      <Stat icon={<Download size={13} />}>{player.formatSpeed(st.downBps)}</Stat>
                      <Stat icon={<Upload size={13} />}>{player.formatSpeed(st.upBps)}</Stat>
                      <Stat icon={<Users size={13} />}>{st.peers} peers</Stat>
                      <span>
                        {formatSize(st.fileDownloaded) || "0 B"} de {formatSize(st.fileLen)}
                      </span>
                    </>
                  ) : (
                    <span>{elapsed > 0 ? `${elapsed} s` : " "}</span>
                  )}
                </div>
                {slow && (
                  <p className="mt-4 text-[13.5px] text-white/55">
                    Tarda más de lo normal: puede que pocos compartan este archivo. Puedes esperar o{" "}
                    <button onClick={repick} className="text-accent underline-offset-2 hover:underline">
                      elegir otro resultado
                    </button>
                    .
                  </p>
                )}
                <div className="mt-6 flex flex-wrap gap-3 max-sm:justify-center">
                  {phase === "buffering" && (
                    <PillButton accent onClick={() => opened && launch(opened.url)} icon={<Play size={15} fill="currentColor" />}>
                      Ver ya
                    </PillButton>
                  )}
                  <PillButton onClick={finish}>Cancelar</PillButton>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Steps(props: { step: number }) {
  const labels = ["Conectando", "Cargando", "Abriendo"];
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-2 max-sm:justify-center">
      {labels.map((l, i) => {
        const done = i < props.step;
        const active = i === props.step;
        return (
          <li key={l} className="flex items-center gap-2">
            <span
              className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${
                active ? "bg-white text-black" : done ? "bg-white/15 text-white" : "bg-white/[0.06] text-white/40"
              }`}
            >
              {done ? <Check size={14} /> : active ? <Loader2 size={14} className="animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
              {l}
            </span>
            {i < labels.length - 1 && <span className={`h-px w-5 ${done ? "bg-white/40" : "bg-white/15"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function Stat(props: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {props.icon}
      {props.children}
    </span>
  );
}

function PillButton(props: { onClick: () => void; children: ReactNode; icon?: ReactNode; accent?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-medium transition-[transform,background-color] hover:scale-[1.03] active:scale-[0.98] ${
        props.accent ? "bg-accent text-white shadow-[0_8px_24px_rgb(229_22_42/0.35)]" : "bg-white/10 text-white backdrop-blur-md hover:bg-white/20"
      }`}
    >
      {props.icon}
      {props.children}
    </button>
  );
}

/** mpv in its own window (not Windows): a small card to reopen / stop it. */
function MiniCard(props: {
  cover: string;
  series: string;
  episode: number;
  playing: boolean;
  progress: number | null;
  stats: EngineStatus | null;
  onReopen: () => void;
  onNext: (() => void) | null;
  onEnd: () => void;
}) {
  return (
    <div className="fade-in fixed right-5 bottom-5 z-40 w-[380px] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-3xl bg-panel shadow-soft ring-1 ring-line max-md:bottom-24">
      <div className="flex items-center gap-3 p-4">
        <img src={props.cover} alt="" className="h-16 w-11 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-accent uppercase">
            <MonitorPlay size={13} /> {props.playing ? "Reproduciendo" : "Reproductor cerrado"}
          </p>
          <p className="truncate text-[15px] font-medium">{props.series}</p>
          <p className="flex gap-3 text-[13px] text-muted">
            <span>Episodio {props.episode}</span>
            {props.stats && <span>↓ {player.formatSpeed(props.stats.downBps)}</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 pb-4">
        <button onClick={props.onReopen} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-panel-2 text-[14px] hover:text-accent">
          <Play size={14} fill="currentColor" /> {props.playing ? "Reabrir" : "Seguir viendo"}
        </button>
        {props.onNext && (
          <button onClick={props.onNext} title="Siguiente episodio" className="grid size-10 place-items-center rounded-full bg-panel-2 hover:text-accent">
            <SkipForward size={16} />
          </button>
        )}
        <button onClick={props.onEnd} title="Terminar" className="grid size-10 place-items-center rounded-full bg-accent text-white">
          <Square size={13} fill="currentColor" />
        </button>
      </div>
      {props.progress != null && (
        <div className="h-1 bg-panel-2">
          <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${props.progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}
