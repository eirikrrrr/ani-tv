// The embedded player's controls. This runs in the transparent player-ui
// window that sits over mpv's video (src-tauri/src/player.rs): mpv's state
// arrives as `mpv` events (its IPC), commands go back through player_cmd,
// torrent stats and keys come from the main window, and "back" / "next"
// are sent to it as `player-action`.

import { emitTo, listen } from "@tauri-apps/api/event";
import {
  ArrowLeft, AudioLines, Captions, Check, CheckCircle2, Download, Loader2, Maximize, Minimize, NotebookPen, Pause, Play,
  RotateCcw, RotateCw, SkipForward, Upload, Users, Volume1, Volume2, VolumeX,
} from "lucide-react";
import { episodeNotes, useNotes } from "../notes";
import { NotesPanel } from "./NotesPanel";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as player from "../player";
import type { MpvEvent, PlayerAction, PlayerInfo, Stats } from "../player";
import { t } from "../i18n";

type Track = { id: number; type: "video" | "audio" | "sub"; lang?: string; title?: string; selected?: boolean; codec?: string; external?: boolean };

type Mpv = {
  pause: boolean;
  timePos: number | null;
  duration: number | null;
  volume: number;
  mute: boolean;
  waiting: boolean;
  cachePct: number | null;
  cacheTime: number | null;
  eof: boolean;
  seeking: boolean;
  tracks: Track[];
};

const INITIAL: Mpv = {
  pause: false,
  timePos: null,
  duration: null,
  volume: 100,
  mute: false,
  waiting: false,
  cachePct: null,
  cacheTime: null,
  eof: false,
  seeking: false,
  tracks: [],
};

function reduce(s: Mpv, e: MpvEvent): Mpv {
  if (e.event !== "property-change") return s;
  const d = e.data;
  switch (e.name) {
    case "pause":
      return { ...s, pause: !!d };
    case "time-pos":
      return { ...s, timePos: typeof d === "number" ? d : s.timePos };
    case "duration":
      return { ...s, duration: typeof d === "number" ? d : null };
    case "volume":
      return { ...s, volume: typeof d === "number" ? d : s.volume };
    case "mute":
      return { ...s, mute: !!d };
    case "paused-for-cache":
      return { ...s, waiting: !!d };
    case "cache-buffering-state":
      return { ...s, cachePct: typeof d === "number" ? d : null };
    case "demuxer-cache-time":
      return { ...s, cacheTime: typeof d === "number" ? d : null };
    case "eof-reached":
      return { ...s, eof: !!d };
    case "seeking":
      return { ...s, seeking: !!d };
    case "track-list":
      return { ...s, tracks: Array.isArray(d) ? (d as Track[]) : [] };
    default:
      return s;
  }
}

export function fmtTime(t: number | null): string {
  if (t == null || !isFinite(t)) return "--:--";
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const LANG_NAMES: Record<string, string> = {
  spa: "Español", es: "Español", "es-419": "Español latino", "es-MX": "Español latino", eng: "Inglés", en: "Inglés",
  jpn: "Japonés", ja: "Japonés", por: "Portugués", pt: "Portugués", "pt-BR": "Portugués (Brasil)", fre: "Francés",
  fra: "Francés", fr: "Francés", ger: "Alemán", deu: "Alemán", de: "Alemán", ita: "Italiano", it: "Italiano",
  rus: "Ruso", ru: "Ruso", ara: "Árabe", ar: "Árabe", chi: "Chino", zho: "Chino", zh: "Chino", kor: "Coreano", ko: "Coreano",
};
const trackLabel = (tr: Track) => {
  const lang = tr.lang ? (LANG_NAMES[tr.lang] ? t(LANG_NAMES[tr.lang]) : tr.lang.toUpperCase()) : null;
  // a title that already names the language ("Español (España)") says it all
  if (tr.title && lang && tr.title.toLowerCase().includes(lang.toLowerCase())) return tr.title;
  const title = tr.title && tr.title !== lang ? tr.title : null;
  return [lang, title].filter(Boolean).join(" · ") || t("Pista {n}", { n: tr.id });
};

const HIDE_AFTER = 2600;

export default function PlayerOverlay() {
  const [s, setS] = useState<Mpv>(INITIAL);
  const [info, setInfo] = useState<PlayerInfo | null>(null);
  const [stats, setStats] = useState<Stats>(null);
  const [shown, setShown] = useState(true);
  const [menu, setMenu] = useState<"sub" | "audio" | null>(null);
  const [full, setFull] = useState(false);
  const [osd, setOsd] = useState<{ text: string; key: number } | null>(null);
  // seek feedback on the side of the jump, like a double tap on a phone
  const [ripple, setRipple] = useState<{ side: "left" | "right"; text: string; key: number } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const notesApi = useNotes();
  const myNotes = info ? episodeNotes(notesApi.notes, info.mediaId, info.episode) : [];
  const hideTimer = useRef<number | undefined>(undefined);
  const clickTimer = useRef<number | undefined>(undefined);
  const state = useRef(s);
  state.current = s;

  useEffect(() => {
    document.documentElement.classList.add("overlay");
    document.documentElement.dataset.theme = "dark";
    // the app's "effects" switch (Settings → look), shared through localStorage
    try {
      const look = JSON.parse(localStorage.getItem("atv.look") ?? "{}");
      document.documentElement.dataset.fx = look.effects === false ? "off" : "on";
    } catch {
      /* default: on */
    }
    player.info().then(setInfo, () => {});
    const subs = [
      player.onMpv((e) => setS((p) => reduce(p, e))),
      listen<Stats>("player-stats", (e) => setStats(e.payload)),
    ];
    return () => subs.forEach((u) => u.then((f) => f()));
  }, []);

  const flash = (text: string) => setOsd({ text, key: Date.now() });
  useEffect(() => {
    if (!ripple) return;
    const t = setTimeout(() => setRipple(null), 650);
    return () => clearTimeout(t);
  }, [ripple]);
  useEffect(() => {
    if (!osd) return;
    const t = setTimeout(() => setOsd(null), 900);
    return () => clearTimeout(t);
  }, [osd]);

  const act = (kind: PlayerAction["kind"]) => emitTo("main", "player-action", { kind }).catch(() => {});

  // show the controls on activity; hide them while playing
  const poke = useCallback(() => {
    setShown(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShown(false), HIDE_AFTER);
  }, []);
  const started = s.timePos != null;
  const loading = !started || s.waiting || (s.seeking && s.waiting);
  const keepShown = s.pause || menu != null || !started || s.eof || notesOpen;
  const visible = shown || keepShown;

  // ---- commands -----------------------------------------------------------
  const togglePause = () => player.cmd("cycle", "pause");
  const seekBy = (sec: number) => {
    player.cmd("seek", sec, "relative");
    setRipple({ side: sec > 0 ? "right" : "left", text: `${Math.abs(sec)} s`, key: Date.now() });
  };
  const seekTo = (t: number) => player.cmd("seek", Math.max(0, t), "absolute");
  const setVolume = (v: number) => {
    const vol = Math.round(Math.min(100, Math.max(0, v)));
    player.cmd("set_property", "volume", vol);
    if (state.current.mute && vol > 0) player.cmd("set_property", "mute", false);
    flash(t("Volumen {n}%", { n: vol }));
  };
  const toggleMute = () => {
    player.cmd("cycle", "mute");
    flash(state.current.mute ? t("Volumen {n}%", { n: Math.round(state.current.volume) }) : t("Silencio"));
  };
  const toggleFull = async () => setFull(await player.fullscreen().catch(() => full));
  const back = async () => {
    if (full) await player.fullscreen(false).catch(() => {});
    act("close");
  };

  // ---- keys (ours, and the main window's forwarded ones) -------------------
  const keyRef = useRef<(key: string, shift: boolean) => void>(() => {});
  keyRef.current = (key, shift) => {
    poke();
    const k = key.length === 1 ? key.toLowerCase() : key;
    switch (k) {
      case " ":
      case "k":
        togglePause();
        break;
      case "ArrowLeft":
        seekBy(shift ? -30 : -5);
        break;
      case "ArrowRight":
        seekBy(shift ? 30 : 5);
        break;
      case "j":
        seekBy(-10);
        break;
      case "l":
        seekBy(10);
        break;
      case "ArrowUp":
        setVolume(state.current.volume + 5);
        break;
      case "ArrowDown":
        setVolume(state.current.volume - 5);
        break;
      case "m":
        toggleMute();
        break;
      case "f":
        toggleFull();
        break;
      case "n":
        if (info?.hasNext) act("next");
        break;
      case "c":
        player.cmd("cycle", "sub-visibility");
        break;
      case "b":
        setNotesOpen((o) => !o);
        break;
      case "Escape":
        if (menu) setMenu(null);
        else if (notesOpen) setNotesOpen(false);
        else if (full) toggleFull();
        else back();
        break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // typing a note: the keys are text, not shortcuts
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      e.preventDefault();
      keyRef.current(e.key, e.shiftKey);
    };
    window.addEventListener("keydown", onKey);
    const un = listen<{ key: string; shift: boolean }>("player-key", (e) => keyRef.current(e.payload.key, e.payload.shift));
    return () => {
      window.removeEventListener("keydown", onKey);
      un.then((f) => f());
    };
  }, []);

  // ---- end of the episode: count down to the next one ----------------------
  useEffect(() => {
    if (!s.eof || !info?.hasNext) {
      setCountdown(null);
      return;
    }
    setCountdown(10);
    const t = setInterval(() => setCountdown((c) => (c == null ? null : c - 1)), 1000);
    return () => clearInterval(t);
  }, [s.eof, info?.hasNext]);
  useEffect(() => {
    if (countdown === 0) act("next");
  }, [countdown]);

  // ---- clicks on the picture: pause / fullscreen ---------------------------
  const onSurfaceClick = () => {
    if (menu) {
      setMenu(null);
      return;
    }
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(togglePause, 220);
  };
  const onSurfaceDouble = () => {
    window.clearTimeout(clickTimer.current);
    toggleFull();
  };

  const remaining = s.duration != null && s.timePos != null ? s.duration - s.timePos : null;
  const nearEnd = !!info?.hasNext && remaining != null && remaining < 90 && !s.eof;
  const subs = s.tracks.filter((t) => t.type === "sub");
  const audios = s.tracks.filter((t) => t.type === "audio");
  const VolIcon = s.mute || s.volume === 0 ? VolumeX : s.volume < 50 ? Volume1 : Volume2;

  return (
    <div
      className={`player-overlay fixed inset-0 overflow-hidden text-white select-none ${visible ? "" : "cursor-none"}`}
      onMouseMove={poke}
      onWheel={(e) => setVolume(s.volume + (e.deltaY < 0 ? 5 : -5))}
    >
      {/* the picture: click = pause, double click = fullscreen */}
      <div className="absolute inset-0" onClick={onSurfaceClick} onDoubleClick={onSurfaceDouble} />

      {/* first frame: the series art until mpv shows something */}
      {!started && (
        <div className="pointer-events-none absolute inset-0 bg-black">
          {info && <img src={info.banner ?? info.cover ?? ""} alt="" className="cinema-backdrop absolute inset-0 size-full object-cover" />}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.3),rgb(0_0_0/0.9))]" />
        </div>
      )}

      {/* center: buffering ring / big play */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="grid size-20 place-items-center rounded-full bg-black/40 backdrop-blur-md">
              <Loader2 size={38} className="animate-spin text-white/90" />
            </div>
            <p className="rounded-full bg-black/40 px-3 py-1 text-[13px] text-white/80 backdrop-blur-md">
              {!started ? t("Abriendo el vídeo…") : s.cachePct != null ? t("Cargando {n}%", { n: s.cachePct }) : t("Cargando…")}
            </p>
          </div>
        ) : s.pause && !s.eof ? (
          <div key="paused" className="player-pop grid size-24 place-items-center rounded-full bg-black/45 backdrop-blur-md">
            <Play size={42} fill="currentColor" className="ml-1.5" />
          </div>
        ) : null}
      </div>

      {/* seek ripple */}
      {ripple && (
        <div
          key={ripple.key}
          className={`seek-ripple pointer-events-none absolute inset-y-0 grid w-[34%] place-items-center ${
            ripple.side === "left" ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]"
          }`}
        >
          <div className="flex flex-col items-center gap-1">
            <span className={`seek-chevrons flex ${ripple.side === "left" ? "flex-row-reverse rotate-180" : ""}`}>
              <Play size={18} fill="currentColor" />
              <Play size={18} fill="currentColor" />
              <Play size={18} fill="currentColor" />
            </span>
            <span className="text-[15px] font-semibold">
              {ripple.side === "left" ? "−" : "+"}
              {ripple.text}
            </span>
          </div>
        </div>
      )}

      {/* OSD feedback */}
      {osd && (
        <div key={osd.key} className="player-osd pointer-events-none absolute top-[18%] left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-5 py-2 text-[16px] font-medium backdrop-blur-md">
          {osd.text}
        </div>
      )}

      {/* top bar */}
      <div className={`player-fade absolute inset-x-0 top-0 ${visible ? "" : "player-hidden"}`}>
        <div className="pointer-events-none flex items-start gap-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-6 pt-5 pb-16 *:pointer-events-auto">
          <button onClick={back} title={t("Volver (Esc)")} className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 backdrop-blur-md transition-colors hover:bg-white/20">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[19px] leading-tight font-semibold drop-shadow">{info?.series ?? ""}</p>
            <p className="mt-0.5 truncate text-[13.5px] text-white/65">
              <span className="font-semibold text-accent">{t("Episodio {n}", { n: info?.episode ?? "" })}</span>
              {info?.release && <span className="ml-2">{info.release}</span>}
            </p>
          </div>
          {stats && (
            <div className="hidden shrink-0 items-center gap-3 rounded-full bg-black/35 px-4 py-2 text-[12.5px] text-white/75 backdrop-blur-md sm:flex">
              {stats.finished ? (
                // all of it is on disk: nothing left to download
                <span className="flex items-center gap-1.5 text-emerald-400" title={t("El episodio está completo en tu equipo")}>
                  <CheckCircle2 size={14} /> {t("Descargado")}
                </span>
              ) : (
                <>
                  <span className="flex items-center gap-1" title={t("Descarga")}>
                    <Download size={13} /> {player.formatSpeed(stats.downBps)}
                  </span>
                  <span className="flex items-center gap-1" title={t("Peers conectados")}>
                    <Users size={13} /> {stats.peers}
                  </span>
                  <span title={t("Descargado")}>{Math.round(stats.progress * 100)}%</span>
                </>
              )}
              {stats.upBps > 1024 && (
                <span className="flex items-center gap-1" title={t("Compartiendo")}>
                  <Upload size={13} /> {player.formatSpeed(stats.upBps)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* next episode */}
      {(nearEnd || (s.eof && info)) && (
        <div className="next-card absolute right-6 bottom-32 max-w-[340px] rounded-2xl bg-black/60 p-4 ring-1 ring-white/10 backdrop-blur-xl">
          {s.eof && !info?.hasNext ? (
            <>
              <p className="text-[15px] font-medium">{t("Episodio terminado")}</p>
              <button onClick={back} className="mt-3 h-10 rounded-full bg-white px-5 text-[14px] font-medium text-black">
                {t("Volver")}
              </button>
            </>
          ) : (
            <>
              <p className="text-[12px] font-semibold tracking-[0.15em] text-white/60 uppercase">{t("A continuación")}</p>
              <p className="mt-0.5 text-[16px] font-medium">{t("Episodio {n}", { n: (info?.episode ?? 0) + 1 })}</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => act("next")} className="flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-black transition-transform hover:scale-[1.03]">
                  {countdown != null ? (
                    <svg viewBox="0 0 20 20" className="size-5 -rotate-90">
                      <circle cx="10" cy="10" r="8" fill="none" stroke="rgb(0 0 0 / 0.15)" strokeWidth="2.5" />
                      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--atv-accent)" strokeWidth="2.5" pathLength="100" className="countdown-ring" />
                    </svg>
                  ) : (
                    <SkipForward size={15} fill="currentColor" />
                  )}
                  {countdown != null ? t("Siguiente en {n}", { n: countdown }) : t("Siguiente episodio")}
                </button>
                {countdown != null && (
                  <button onClick={() => setCountdown(null)} className="h-10 rounded-full bg-white/10 px-4 text-[14px] hover:bg-white/20">
                    {t("Cancelar")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* notes */}
      {notesOpen && info && (
        <NotesPanel
          notes={myNotes}
          now={s.timePos}
          onSeek={(t) => {
            seekTo(t);
            flash(fmtTime(t));
          }}
          onAdd={(text, time) =>
            notesApi.add({ mediaId: info.mediaId, series: info.series, cover: info.cover, episode: info.episode, time, text })
          }
          onUpdate={notesApi.update}
          onRemove={notesApi.remove}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {/* bottom controls */}
      <div className={`player-fade absolute inset-x-0 bottom-0 ${visible ? "" : "player-hidden"}`}>
        <div className="pointer-events-none bg-gradient-to-t from-black/90 via-black/55 to-transparent px-6 pt-20 pb-5 *:pointer-events-auto">
          <Seekbar
            time={s.timePos}
            duration={s.duration}
            cached={s.cacheTime}
            onSeek={seekTo}
            marks={myNotes.filter((n) => n.time != null).map((n) => ({ time: n.time!, text: n.text }))}
          />
          <div className="mt-2 flex items-center gap-1">
            <CtrlButton title={s.pause ? t("Reproducir (espacio)") : t("Pausa (espacio)")} onClick={togglePause} big>
              <span key={String(s.pause)} className="icon-swap grid place-items-center">
                {s.pause ? <Play size={24} fill="currentColor" className="ml-0.5" /> : <Pause size={24} fill="currentColor" />}
              </span>
            </CtrlButton>
            <CtrlButton title="−10 s (J)" onClick={() => seekBy(-10)}>
              <RotateCcw size={20} />
            </CtrlButton>
            <CtrlButton title="+10 s (L)" onClick={() => seekBy(10)}>
              <RotateCw size={20} />
            </CtrlButton>
            {info?.hasNext && (
              <CtrlButton title={t("Siguiente episodio (N)")} onClick={() => act("next")}>
                <SkipForward size={20} />
              </CtrlButton>
            )}
            <div className="group flex items-center">
              <CtrlButton title={t("Silencio (M)")} onClick={toggleMute}>
                <VolIcon size={21} />
              </CtrlButton>
              <div className="w-0 overflow-hidden transition-[width] duration-200 group-hover:w-28 group-focus-within:w-28">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={s.mute ? 0 : Math.round(s.volume)}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="player-range mx-2 w-24"
                  style={{ ["--fill" as string]: `${s.mute ? 0 : s.volume}%` }}
                  aria-label={t("Volumen")}
                />
              </div>
            </div>
            <span className="ml-2 text-[14px] text-white/85 tabular-nums">
              {fmtTime(s.timePos)} <span className="text-white/45">/ {fmtTime(s.duration)}</span>
            </span>

            <div className="ml-auto flex items-center gap-1">
              {subs.length > 0 && (
                <Menu
                  open={menu === "sub"}
                  onToggle={() => setMenu(menu === "sub" ? null : "sub")}
                  icon={<Captions size={21} />}
                  title={t("Subtítulos")}
                  items={[
                    { id: "no", label: t("Desactivados"), selected: !subs.some((t) => t.selected) },
                    ...subs.map((t) => ({ id: String(t.id), label: trackLabel(t), selected: !!t.selected, hint: t.codec })),
                  ]}
                  onPick={(id) => {
                    player.cmd("set_property", "sid", id === "no" ? "no" : Number(id));
                    setMenu(null);
                  }}
                />
              )}
              {audios.length > 1 && (
                <Menu
                  open={menu === "audio"}
                  onToggle={() => setMenu(menu === "audio" ? null : "audio")}
                  icon={<AudioLines size={21} />}
                  title="Audio"
                  items={audios.map((t) => ({ id: String(t.id), label: trackLabel(t), selected: !!t.selected, hint: t.codec }))}
                  onPick={(id) => {
                    player.cmd("set_property", "aid", Number(id));
                    setMenu(null);
                  }}
                />
              )}
              <CtrlButton title={t("Notas (B)")} onClick={() => setNotesOpen((o) => !o)} active={notesOpen}>
                <span className="relative">
                  <NotebookPen size={20} />
                  {myNotes.length > 0 && (
                    <span className="absolute -top-1.5 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold">
                      {myNotes.length}
                    </span>
                  )}
                </span>
              </CtrlButton>
              <CtrlButton title={full ? t("Salir de pantalla completa (F)") : t("Pantalla completa (F)")} onClick={toggleFull}>
                {full ? <Minimize size={20} /> : <Maximize size={20} />}
              </CtrlButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CtrlButton(props: { title: string; onClick: () => void; children: ReactNode; big?: boolean; active?: boolean }) {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      className={`grid shrink-0 place-items-center rounded-full transition-[background-color,transform] hover:bg-white/15 active:scale-90 ${
        props.big ? "size-12" : "size-11"
      } ${props.active ? "bg-white/15" : ""}`}
    >
      {props.children}
    </button>
  );
}

function Menu(props: {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  title: string;
  items: { id: string; label: string; selected: boolean; hint?: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="relative">
      <CtrlButton title={props.title} onClick={props.onToggle} active={props.open}>
        {props.icon}
      </CtrlButton>
      {props.open && (
        <div className="fade-in absolute right-0 bottom-14 w-72 overflow-hidden rounded-2xl bg-neutral-900/90 py-2 shadow-[0_20px_50px_rgb(0_0_0/0.5)] ring-1 ring-white/10 backdrop-blur-xl">
          <p className="px-4 pt-1 pb-2 text-[12px] font-semibold tracking-[0.15em] text-white/50 uppercase">{props.title}</p>
          <div className="max-h-72 overflow-y-auto">
            {props.items.map((it) => (
              <button
                key={it.id}
                onClick={() => props.onPick(it.id)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14.5px] hover:bg-white/10 ${it.selected ? "text-white" : "text-white/75"}`}
              >
                <span className="grid size-4 shrink-0 place-items-center text-accent">{it.selected && <Check size={16} strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && <span className="text-[11px] tracking-wide text-white/35 uppercase">{it.hint}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Played / buffered bar with a hover time and drag-to-seek. */
function Seekbar(props: {
  time: number | null;
  duration: number | null;
  cached: number | null;
  onSeek: (t: number) => void;
  /** the episode's notes, as dots over the bar */
  marks: { time: number; text: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const d = props.duration ?? 0;
  const frac = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const played = drag ?? (d ? (props.time ?? 0) / d : 0);
  const cached = d && props.cached != null ? Math.min(1, props.cached / d) : 0;
  const tip = drag ?? hover;

  return (
    <div
      ref={ref}
      className="group relative flex h-5 cursor-pointer items-center"
      onPointerMove={(e) => {
        const f = frac(e.clientX);
        setHover(f);
        if (drag != null) setDrag(f);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        if (!d) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        setDrag(frac(e.clientX));
      }}
      onPointerUp={(e) => {
        if (drag != null && d) props.onSeek(frac(e.clientX) * d);
        setDrag(null);
      }}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover:h-1.5">
        <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${Math.max(cached, played) * 100}%` }} />
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${played * 100}%` }} />
      </div>
      {d > 0 &&
        props.marks.map((m, i) => (
          <span
            key={i}
            title={m.text}
            className="note-mark absolute -top-1.5 size-2 -translate-x-1/2 rounded-full bg-amber-300 shadow-[0_0_0_2px_rgb(0_0_0/0.5)]"
            style={{ left: `${Math.min(1, m.time / d) * 100}%` }}
          />
        ))}
      <div
        className={`absolute size-3.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_0_4px_rgb(229_22_42/0.25)] transition-transform ${
          drag != null ? "scale-110" : "scale-0 group-hover:scale-100"
        }`}
        style={{ left: `${played * 100}%` }}
      />
      {tip != null && d > 0 && (
        <div
          className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-[12.5px] font-medium tabular-nums"
          style={{ left: `${tip * 100}%` }}
        >
          {fmtTime(tip * d)}
        </div>
      )}
    </div>
  );
}
