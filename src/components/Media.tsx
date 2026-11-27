// Catalogue views: hero carousel, wide cards row, poster grid, series details
// and the "now watching" bar.

import {
  ArrowLeft, Check, ChevronDown, ChevronUp, Flame, Heart, Info, Pause, Play, SkipBack, SkipForward, Star, ListPlus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { availableEpisodes, byId, formatLabel, genreLabel, type Media } from "../anilist";
import type { DiscordStatus } from "../discord";
import type { Saved } from "../store";
import { t } from "../i18n";

const meta = (m: Pick<Media, "year" | "format" | "episodes">) =>
  [m.year, formatLabel(m.format), m.episodes ? `${m.episodes} eps` : null].filter(Boolean).join(" · ");

/** Sakura petals drifting over the hero (off with Settings → visual effects). */
function Petals() {
  const petals = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        left: (i * 83 + 7) % 100,
        d: 8 + ((i * 37) % 7),
        delay: -((i * 1.7) % 9),
        scale: 0.6 + ((i * 29) % 5) / 10,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {petals.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{ left: `${p.left}%`, scale: p.scale, "--d": `${p.d}s`, "--delay": `${p.delay}s` } as CSSProperties}
        />
      ))}
    </div>
  );
}

const HERO_MS = 8000;

export function Hero(props: {
  items: Media[];
  badge: string;
  isFavorite: (id: number) => boolean;
  onWatch: (m: Media) => void;
  onOpen: (id: number) => void;
  onFavorite: (m: Media) => void;
}) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => setI(0), [props.items]);
  const n = props.items.length;
  // autoplay: next title every 8 s, paused while the pointer is over the hero
  useEffect(() => {
    if (n < 2 || paused) return;
    const t = setTimeout(() => setI((x) => (x + 1) % n), HERO_MS);
    return () => clearTimeout(t);
  }, [i, n, paused]);
  const m = props.items[i % Math.max(n, 1)];
  if (!m) return <div className="h-[380px] animate-pulse rounded-[28px] bg-panel" />;
  const fav = props.isFavorite(m.id);
  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`relative h-[380px] overflow-hidden rounded-[28px] bg-black text-white shadow-soft max-sm:h-[440px] ${paused ? "hero-paused" : ""}`}
    >
      <img
        key={m.id}
        src={m.banner ?? m.cover}
        alt=""
        className="kenburns absolute inset-0 size-full object-cover"
        style={{ objectPosition: m.banner ? "center" : "center 25%" }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/5" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
      <Petals />

      <div key={`t${m.id}`} className="hero-text relative flex h-full max-w-[600px] flex-col justify-end gap-3 p-7 pr-20">
        <span className="mb-auto flex w-fit items-center gap-1.5 rounded-full bg-white/12 px-4 py-2 text-[15px] backdrop-blur-md">
          <Flame size={16} className="text-orange-400" fill="currentColor" /> {props.badge}
        </span>
        <h1 className="line-clamp-2 text-[30px] leading-tight font-bold uppercase">{m.title}</h1>
        <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-white/85">
          {meta(m)}
          {m.score != null && (
            <span className="flex items-center gap-1">
              · <Star size={14} className="text-amber-400" fill="currentColor" /> {(m.score / 10).toFixed(1)}
              <span className="text-white/50">/10</span>
            </span>
          )}
        </p>
        <p className="line-clamp-3 text-[14.5px] leading-relaxed text-white/65">{m.description}</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={() => props.onWatch(m)}
            className="flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[16px] font-medium text-black hover:bg-white/90"
          >
            <Play size={17} fill="currentColor" /> {t("Ver")}
          </button>
          <button
            onClick={() => props.onOpen(m.id)}
            className="flex h-12 items-center gap-2 rounded-full bg-white/12 px-6 text-[16px] backdrop-blur-md hover:bg-white/20"
          >
            <Info size={18} /> {t("Detalles")}
          </button>
          <button
            onClick={() => props.onFavorite(m)}
            title={fav ? t("Quitar de favoritos") : t("Añadir a favoritos")}
            className="grid size-12 place-items-center rounded-full bg-white/12 backdrop-blur-md hover:bg-white/20"
          >
            <Heart key={String(fav)} size={18} className={fav ? "heart-pop text-accent" : ""} fill={fav ? "currentColor" : "none"} />
          </button>
        </div>
      </div>

      {n > 1 && <span key={`p${i}`} className="hero-progress" style={{ "--dur": `${HERO_MS}ms` } as CSSProperties} />}
      {n > 1 && (
        <div className="absolute top-1/2 right-6 flex -translate-y-1/2 flex-col gap-3">
          <button
            onClick={() => setI((i - 1 + n) % n)}
            className="grid size-11 place-items-center rounded-full bg-white/15 backdrop-blur-md hover:bg-white/25"
            title={t("Anterior")}
          >
            <ChevronUp size={20} />
          </button>
          <button
            onClick={() => setI((i + 1) % n)}
            className="grid size-11 place-items-center rounded-full bg-white text-black hover:bg-white/90"
            title={t("Siguiente")}
          >
            <ChevronDown size={20} />
          </button>
        </div>
      )}
    </section>
  );
}

/** Children fade/slide in the first time they scroll into view. */
export function Reveal(props: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return (
    <div ref={ref} className={`reveal ${inView ? "in" : ""} ${props.className ?? ""}`}>
      {props.children}
    </div>
  );
}

export function SectionTitle(props: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mt-7 mb-4 flex items-baseline justify-between">
      <h2 className="text-[22px] font-medium">
        <span className="title-bar" aria-hidden />
        {props.title}
      </h2>
      {props.action && (
        <button onClick={props.onAction} className="text-[15px] text-muted hover:text-accent">
          {props.action}
        </button>
      )}
    </div>
  );
}

export function WideRow(props: { items: Media[]; onOpen: (id: number) => void; onWatch: (m: Media) => void }) {
  if (props.items.length === 0)
    return (
      <div className="grid grid-cols-3 gap-5 max-lg:grid-cols-2">
        {[0, 1, 2].map((k) => (
          <div key={k} className="h-[180px] animate-pulse rounded-3xl bg-panel" />
        ))}
      </div>
    );
  return (
    <div className="no-scrollbar -mx-1 flex snap-x gap-5 overflow-x-auto px-1 pb-2">
      {props.items.map((m, i) => (
        <article
          key={m.id}
          onClick={() => props.onOpen(m.id)}
          style={{ "--i": i } as CSSProperties}
          className="stagger lift shine group relative h-[180px] w-[calc((100%-40px)/3)] min-w-[260px] shrink-0 cursor-pointer snap-start overflow-hidden rounded-3xl bg-black text-white shadow-soft"
        >
          <img
            src={m.banner ?? m.cover}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/35 px-5 py-3.5 backdrop-blur-md">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[17px] font-medium">{m.title}</h3>
              <p className="truncate text-[13px] text-white/70">{meta(m)}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onWatch(m);
              }}
              title={t("Ver")}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-transform hover:scale-110"
            >
              <Play size={16} fill="currentColor" />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function PosterGrid(props: { items: (Media | Saved)[]; onOpen: (id: number) => void; loading?: boolean }) {
  if (props.loading)
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
        {Array.from({ length: 12 }, (_, k) => (
          <div key={k} className="aspect-[2/3] animate-pulse rounded-2xl bg-panel" />
        ))}
      </div>
    );
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6">
      {props.items.map((m, i) => (
        <button
          key={m.id}
          onClick={() => props.onOpen(m.id)}
          style={{ "--i": i } as CSSProperties}
          className="stagger group text-left"
        >
          <div className="lift shine aspect-[2/3] overflow-hidden rounded-2xl bg-panel shadow-soft">
            <img
              src={m.cover}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </div>
          <h3 className="mt-2.5 line-clamp-2 text-[15px] leading-snug group-hover:text-accent">{m.title}</h3>
          <p className="mt-0.5 text-[13px] text-muted">{meta(m)}</p>
        </button>
      ))}
    </div>
  );
}

export function Details(props: {
  /** "add to playlist / queue" for one episode or the whole series */
  onMenu?: (m: Media, episodes: number[], at: { x: number; y: number }) => void;
  id: number;
  watchedUpTo: number;
  current: number | null;
  isFavorite: boolean;
  onBack: () => void;
  onWatch: (m: Media, ep: number) => void;
  onFavorite: (m: Media) => void;
}) {
  const [m, setM] = useState<Media | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setM(null);
    setError(null);
    byId(props.id).then(setM, (e: Error) => setError(e.message));
  }, [props.id]);

  if (error) return <Empty title={t("No se pudo cargar la serie")} text={error} />;
  if (!m) return <div className="h-[320px] animate-pulse rounded-[28px] bg-panel" />;

  const eps = availableEpisodes(m);
  const next = Math.min(Math.max(props.watchedUpTo, 1), Math.max(eps, 1));
  return (
    <div className="fade-in">
      <section className="relative overflow-hidden rounded-[28px] bg-black text-white shadow-soft">
        <img src={m.banner ?? m.cover} alt="" className="absolute inset-0 size-full object-cover opacity-60 blur-[1px]" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-black/30" />
        <div className="relative flex gap-7 p-7 max-sm:flex-col">
          <img src={m.cover} alt="" className="w-[170px] shrink-0 self-start rounded-2xl shadow-2xl" />
          <div className="flex min-w-0 flex-col gap-3">
            <button onClick={props.onBack} className="flex w-fit items-center gap-1.5 text-[15px] text-white/70 hover:text-white">
              <ArrowLeft size={17} /> {t("Volver")}
            </button>
            <h1 className="text-[30px] leading-tight font-bold">{m.title}</h1>
            {m.romaji !== m.title && <p className="-mt-2 text-white/55">{m.romaji}</p>}
            <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-white/85">
              {meta(m)}
              {m.nextEpisode && <span>· {t("En emisión")}</span>}
              {m.score != null && (
                <span className="flex items-center gap-1">
                  · <Star size={14} className="text-amber-400" fill="currentColor" /> {(m.score / 10).toFixed(1)}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {m.genres.map((g) => (
                <span key={g} className="rounded-full bg-white/12 px-3 py-1 text-[13px]">
                  {genreLabel(g)}
                </span>
              ))}
            </div>
            <p className="line-clamp-5 max-w-[760px] text-[14.5px] leading-relaxed whitespace-pre-line text-white/70">
              {m.description}
            </p>
            <div className="mt-1 flex items-center gap-3">
              <button
                disabled={eps === 0}
                onClick={() => props.onWatch(m, next)}
                className="flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[16px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
              >
                <Play size={17} fill="currentColor" /> {props.watchedUpTo > 1 ? t("Continuar · EP {n}", { n: next }) : t("Ver episodio 1")}
              </button>
              <button
                onClick={() => props.onFavorite(m)}
                className="flex h-12 items-center gap-2 rounded-full bg-white/12 px-6 text-[16px] hover:bg-white/20"
              >
                <Heart
                  key={String(props.isFavorite)}
                  size={18}
                  className={props.isFavorite ? "heart-pop text-accent" : ""}
                  fill={props.isFavorite ? "currentColor" : "none"}
                />
                {props.isFavorite ? t("En favoritos") : t("Favorito")}
              </button>
              {props.onMenu && eps > 0 && (
                <button
                  onClick={(e) => props.onMenu!(m, Array.from({ length: eps }, (_, k) => k + 1), { x: e.clientX, y: e.clientY })}
                  title={t("Añadir los episodios a una lista o a la cola")}
                  className="flex h-12 items-center gap-2 rounded-full bg-white/12 px-5 text-[16px] hover:bg-white/20"
                >
                  <ListPlus size={18} /> {t("Añadir a lista")}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <Reveal>
      <SectionTitle title={`${t("Episodios")}${eps ? ` · ${eps}` : ""}`} />
      {eps === 0 ? (
        <p className="text-muted">{t("Todavía no hay episodios emitidos.")}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
          {Array.from({ length: eps }, (_, k) => k + 1).map((ep, i) => {
            const playing = props.current === ep;
            const seen = ep < props.watchedUpTo;
            return (
              <button
                key={ep}
                onClick={() => props.onWatch(m, ep)}
                onContextMenu={(e) => {
                  if (!props.onMenu) return;
                  e.preventDefault();
                  props.onMenu(m, [ep], { x: e.clientX, y: e.clientY });
                }}
                title={props.onMenu ? t("Clic derecho: añadir a lista o cola") : undefined}
                style={{ "--i": i } as CSSProperties}
                className={`stagger flex h-14 items-center justify-between rounded-2xl px-4 text-[15px] transition-colors ${
                  playing ? "bg-accent text-white" : "bg-panel hover:bg-panel-2"
                }`}
              >
                <span className={seen && !playing ? "text-muted" : ""}>EP {ep}</span>
                {playing ? <Play size={14} fill="currentColor" /> : seen ? <Check size={15} className="text-muted" /> : null}
              </button>
            );
          })}
        </div>
      )}
      </Reveal>
    </div>
  );
}

export type Now = { media: Saved; episode: number; startedAt: number };

export function NowWatching(props: {
  now: Now;
  discord: DiscordStatus;
  onOpen: (id: number) => void;
  onEpisode: (ep: number) => void;
  onStop: () => void;
}) {
  const { media: m, episode } = props.now;
  const max = m.episodes ?? Infinity;
  const shared = props.discord === "on";
  return (
    <div className="fade-in sticky bottom-0 z-20 mt-6 flex items-center gap-4 rounded-3xl bg-panel p-3 pr-4 shadow-soft max-md:bottom-20">
      <button onClick={() => props.onOpen(m.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <img src={m.cover} alt="" className="h-16 w-12 shrink-0 rounded-xl object-cover" />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[12px] font-medium tracking-wide text-accent uppercase">
            <span className="eq" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {t("Ahora viendo")}
          </span>
          <span className="block truncate text-[16px] font-medium">{m.title}</span>
          <span className="block truncate text-[13px] text-muted">
            {t("Episodio {n}", { n: episode })}
            {m.episodes ? ` ${t("de {total}", { total: m.episodes })}` : ""} ·{" "}
            {shared ? t("visible para tus amigos en Discord") : t("Discord no conectado")}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-1.5">
        <button
          disabled={episode <= 1}
          onClick={() => props.onEpisode(episode - 1)}
          title={t("Episodio anterior")}
          className="grid size-10 place-items-center rounded-full hover:bg-panel-2 disabled:opacity-40"
        >
          <SkipBack size={18} />
        </button>
        <button onClick={props.onStop} title={t("Dejar de ver")} className="grid size-12 place-items-center rounded-full bg-accent text-white">
          <Pause size={19} fill="currentColor" />
        </button>
        <button
          disabled={episode >= max}
          onClick={() => props.onEpisode(episode + 1)}
          title={t("Episodio siguiente")}
          className="grid size-10 place-items-center rounded-full hover:bg-panel-2 disabled:opacity-40"
        >
          <SkipForward size={18} />
        </button>
      </div>
    </div>
  );
}

export function Empty(props: { title: string; text?: string; icon?: ReactNode }) {
  return (
    <div className="fade-in grid place-items-center rounded-[28px] bg-panel px-6 py-20 text-center shadow-soft">
      {props.icon && <div className="mb-4 grid size-14 place-items-center rounded-full bg-accent-soft text-accent">{props.icon}</div>}
      <h2 className="text-[20px] font-medium">{props.title}</h2>
      {props.text && <p className="mt-2 max-w-[460px] text-muted">{props.text}</p>}
    </div>
  );
}
