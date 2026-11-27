// Library: playlists and the play queue, laid out like a music app (cover
// mosaic, big gradient header, numbered episode rows, an "up next" panel)
// in Anime TV's own colours and type.

import {
  Check, GripVertical, ListPlus, ListVideo, MoreHorizontal, Pencil, Pin, PinOff, Play, Plus, Shuffle, SkipForward, Trash2, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { locale, t, tn } from "../i18n";
import { mosaic, shuffled, type Item, type Library, type Playlist, type QueueItem } from "../library";
import type { Saved } from "../store";

export type EpisodeRef = { media: Saved; episode: number };

/** 1–4 covers: one fills the square, otherwise a 2×2 grid. */
export function Mosaic(props: { playlist: Playlist; size: number; className?: string }) {
  const covers = mosaic(props.playlist);
  const style = { width: props.size, height: props.size };
  if (covers.length === 0)
    return (
      <span style={style} className={`grid shrink-0 place-items-center bg-gradient-to-br from-accent/70 to-black text-white ${props.className ?? ""}`}>
        <ListVideo size={props.size * 0.38} />
      </span>
    );
  if (covers.length < 4)
    return <img src={covers[0]} alt="" style={style} className={`shrink-0 object-cover ${props.className ?? ""}`} />;
  return (
    <span style={style} className={`grid shrink-0 grid-cols-2 overflow-hidden ${props.className ?? ""}`}>
      {covers.map((c) => (
        <img key={c} src={c} alt="" className="size-full object-cover" />
      ))}
    </span>
  );
}

/** Sidebar section: "Your library" with the playlists. */
export function LibraryNav(props: { library: Library; active: string | null; onOpen: (id: string) => void; onCreate: () => void }) {
  const { playlists } = props.library;
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between px-3">
        <h3 className="flex items-center gap-2 text-[15px] font-medium">
          <ListVideo size={17} /> {t("Tu biblioteca")}
        </h3>
        <button onClick={props.onCreate} title={t("Crear lista")} className="grid size-8 place-items-center rounded-full text-muted hover:bg-panel-2 hover:text-accent">
          <Plus size={17} />
        </button>
      </div>
      <div className="-mr-2 flex max-h-[min(30vh,180px)] flex-col gap-0.5 overflow-y-auto pr-2">
        {playlists.length === 0 && <p className="px-3 text-sm text-muted">{t("Crea listas para organizar lo que quieres ver.")}</p>}
        {playlists.map((p) => (
          <button
            key={p.id}
            onClick={() => props.onOpen(p.id)}
            className={`flex items-center gap-3 rounded-2xl p-2 text-left transition-colors ${props.active === p.id ? "bg-panel-2" : "hover:bg-panel-2"}`}
          >
            <Mosaic playlist={p} size={44} className="rounded-lg" />
            <span className="min-w-0">
              <span className={`block truncate text-[14.5px] ${props.active === p.id ? "text-accent" : ""}`}>{p.name}</span>
              <span className="flex items-center gap-1 text-[12.5px] text-muted">
                {p.pinned && <Pin size={11} className="text-accent" />}
                {t("Lista")} · {tn(p.items.length, "{n} episodio", "{n} episodios")}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const ago = (ms: number) => {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d < 1) return t("hoy");
  if (d < 2) return t("ayer");
  if (d < 30) return t("hace {n} días", { n: d });
  return new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
};

export function PlaylistView(props: {
  playlist: Playlist;
  library: Library;
  watchedUpTo: (mediaId: number) => number;
  onPlay: (items: Item[], index: number) => void;
  onOpenSeries: (id: number) => void;
  onMenu: (target: EpisodeRef[], at: { x: number; y: number }, itemId?: string) => void;
  onDeleted: () => void;
}) {
  const p = props.playlist;
  const lib = props.library;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description);
  const [menu, setMenu] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  useEffect(() => {
    setName(p.name);
    setDesc(p.description);
    // a brand-new, empty list opens ready to be named
    setEditing(p.items.length === 0 && Date.now() - p.createdAt < 3000);
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const color = p.items.find((x) => x.media.color)?.media.color ?? "var(--atv-accent)";
  const series = new Set(p.items.map((x) => x.media.id)).size;
  const save = () => {
    lib.rename(p.id, name, desc);
    setEditing(false);
  };

  return (
    <div className="fade-in -mx-1 overflow-hidden rounded-[28px] bg-panel shadow-soft">
      {/* header: colour of the first cover fading into the panel */}
      <header className="playlist-head relative flex items-end gap-6 p-7 pb-6 max-sm:flex-col max-sm:items-start" style={{ ["--pl" as string]: color }}>
        <Mosaic playlist={p} size={196} className="rounded-2xl shadow-[0_18px_50px_rgb(0_0_0/0.45)] max-sm:!size-36" />
        <div className="min-w-0 flex-1 text-white">
          <p className="text-[12.5px] font-semibold tracking-[0.18em] uppercase opacity-80">{t("Lista")}</p>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
              className="mt-1 flex flex-col gap-2"
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Nombre de la lista")}
                className="w-full rounded-xl bg-black/30 px-3 py-1.5 text-[34px] font-bold outline-none ring-1 ring-white/20 focus:ring-white/60"
              />
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={t("Añade una descripción (opcional)")}
                className="w-full rounded-xl bg-black/30 px-3 py-2 text-[14.5px] outline-none ring-1 ring-white/20 focus:ring-white/60"
              />
              <div className="flex gap-2">
                <button className="h-9 rounded-full bg-white px-4 text-[14px] font-medium text-black">{t("Guardar")}</button>
                <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-full bg-black/30 px-4 text-[14px]">
                  {t("Cancelar")}
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1 onClick={() => setEditing(true)} title={t("Editar")} className="mt-1 line-clamp-2 cursor-text text-[44px] leading-[1.05] font-bold tracking-tight max-sm:text-[30px]">
                {p.name}
              </h1>
              {p.description && <p className="mt-2 line-clamp-2 text-[14.5px] opacity-80">{p.description}</p>}
              <p className="mt-3 text-[14px] opacity-80">
                {tn(p.items.length, "{n} episodio", "{n} episodios")} · {tn(series, "{n} serie", "{n} series")}
              </p>
            </>
          )}
        </div>
      </header>

      {/* actions */}
      <div className="flex items-center gap-4 px-7 py-5">
        <button
          onClick={() => props.onPlay(p.items, 0)}
          disabled={p.items.length === 0}
          title={t("Reproducir")}
          className="grid size-14 place-items-center rounded-full bg-accent text-white shadow-[0_10px_28px_rgb(229_22_42/0.4)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          <Play size={24} fill="currentColor" className="ml-0.5" />
        </button>
        <button
          onClick={() => props.onPlay(shuffled(p.items), 0)}
          disabled={p.items.length < 2}
          title={t("Aleatorio")}
          className="grid size-11 place-items-center rounded-full text-muted hover:text-accent disabled:opacity-40"
        >
          <Shuffle size={22} />
        </button>
        <div className="relative">
          <button onClick={() => setMenu(!menu)} title={t("Más opciones")} className="grid size-11 place-items-center rounded-full text-muted hover:text-text">
            <MoreHorizontal size={24} />
          </button>
          {menu && (
            <Popover onClose={() => setMenu(false)} className="left-0 top-12">
              <MenuItem icon={<ListPlus size={16} />} onClick={() => (lib.enqueue(p.items), setMenu(false))}>
                {t("Añadir a la cola")}
              </MenuItem>
              <MenuItem icon={<Pencil size={16} />} onClick={() => (setEditing(true), setMenu(false))}>
                {t("Editar nombre y descripción")}
              </MenuItem>
              <MenuItem icon={p.pinned ? <PinOff size={16} /> : <Pin size={16} />} onClick={() => (lib.togglePin(p.id), setMenu(false))}>
                {p.pinned ? t("Desfijar") : t("Fijar arriba")}
              </MenuItem>
              <MenuItem
                danger
                icon={<Trash2 size={16} />}
                onClick={() => {
                  lib.remove(p.id);
                  props.onDeleted();
                }}
              >
                {t("Eliminar lista")}
              </MenuItem>
            </Popover>
          )}
        </div>
      </div>

      {/* episodes */}
      {p.items.length === 0 ? (
        <div className="px-7 pb-10 text-[14.5px] text-muted">
          <p className="text-[17px] font-medium text-text">{t("Añadamos algo a tu lista")}</p>
          <p className="mt-1 max-w-[520px]">{t("En la ficha de una serie, usa «Añadir a lista» o haz clic derecho en un episodio.")}</p>
        </div>
      ) : (
        <div className="px-4 pb-6">
          <div className="grid grid-cols-[36px_1fr_140px_44px] items-center gap-3 border-b border-line px-3 pb-2 text-[12.5px] tracking-wide text-muted uppercase max-md:grid-cols-[36px_1fr_44px]">
            <span className="text-right">#</span>
            <span>{t("Título")}</span>
            <span className="max-md:hidden">{t("Añadido")}</span>
            <span />
          </div>
          <ol className="mt-2">
            {p.items.map((it, i) => {
              const seen = it.episode <= props.watchedUpTo(it.media.id) - 1;
              return (
                <li
                  key={it.id}
                  draggable
                  onDragStart={() => setDragFrom(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(i);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  onDrop={() => {
                    if (dragFrom != null && dragFrom !== i) lib.moveItem(p.id, dragFrom, i);
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  onDoubleClick={() => props.onPlay(p.items, i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    props.onMenu([it], { x: e.clientX, y: e.clientY }, it.id);
                  }}
                  className={`group grid grid-cols-[36px_1fr_140px_44px] items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-panel-2 max-md:grid-cols-[36px_1fr_44px] ${
                    dragOver === i && dragFrom !== i ? "ring-1 ring-accent" : ""
                  } ${dragFrom === i ? "opacity-40" : ""}`}
                >
                  <span className="relative grid h-9 place-items-center justify-end text-[15px] text-muted tabular-nums">
                    <span className="group-hover:invisible">{i + 1}</span>
                    <button onClick={() => props.onPlay(p.items, i)} title={t("Reproducir")} className="absolute inset-0 hidden place-items-center justify-end text-text group-hover:grid">
                      <Play size={15} fill="currentColor" />
                    </button>
                  </span>
                  <span className="flex min-w-0 items-center gap-3">
                    <GripVertical size={14} className="-ml-2 shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100" />
                    <img src={it.media.cover} alt="" className="h-12 w-9 shrink-0 rounded-md object-cover" />
                    <span className="min-w-0">
                      <span className={`block truncate text-[15px] ${seen ? "text-muted" : ""}`}>{t("Episodio {n}", { n: it.episode })}</span>
                      <button onClick={() => props.onOpenSeries(it.media.id)} className="block truncate text-[13px] text-muted hover:text-text hover:underline">
                        {it.media.title}
                      </button>
                    </span>
                    {seen && <Check size={15} className="shrink-0 text-emerald-500" />}
                  </span>
                  <span className="text-[13.5px] text-muted max-md:hidden">{ago(it.addedAt)}</span>
                  <button
                    onClick={(e) => props.onMenu([it], { x: e.clientX, y: e.clientY }, it.id)}
                    title={t("Más opciones")}
                    className="grid size-9 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:bg-panel hover:text-text"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** "Up next": the queue, as a panel on the right. */
export function QueuePanel(props: { library: Library; now: EpisodeRef | null; onPlayQueued: (q: QueueItem) => void; onClose: () => void }) {
  const lib = props.library;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [props]);
  return createPortal(
    <div className="fixed inset-0 z-40" onClick={props.onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="queue-panel absolute top-4 right-4 bottom-4 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[28px] bg-panel shadow-[0_24px_70px_rgb(0_0_0/0.45)] ring-1 ring-line"
      >
        <header className="flex items-center gap-2 px-5 pt-5 pb-3">
          <h2 className="flex-1 text-[19px] font-semibold">{t("Cola")}</h2>
          <button onClick={props.onClose} title={t("Cerrar")} className="grid size-9 place-items-center rounded-full hover:bg-panel-2">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className="px-2 pt-1 pb-2 text-[13px] font-semibold text-muted">{t("Reproduciendo ahora")}</p>
          {props.now ? <QueueRow media={props.now.media} episode={props.now.episode} active /> : <p className="px-2 pb-2 text-[14px] text-muted">{t("Nada por ahora.")}</p>}

          <div className="flex items-center px-2 pt-5 pb-2">
            <p className="flex-1 text-[13px] font-semibold text-muted">{t("A continuación")}</p>
            {lib.queue.length > 0 && (
              <button onClick={lib.clearQueue} className="text-[13px] text-muted hover:text-accent">
                {t("Vaciar cola")}
              </button>
            )}
          </div>
          {lib.queue.length === 0 ? (
            <p className="px-2 text-[14px] text-muted">{t("Añade episodios con «Añadir a la cola» o reproduce una lista.")}</p>
          ) : (
            lib.queue.map((q, i) => (
              <div
                key={q.id}
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom != null && dragFrom !== i) lib.moveQueued(dragFrom, i);
                  setDragFrom(null);
                }}
              >
                <QueueRow media={q.media} episode={q.episode} onPlay={() => props.onPlayQueued(q)} onRemove={() => lib.dequeue(q.id)} />
              </div>
            ))
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function QueueRow(props: { media: Saved; episode: number; active?: boolean; onPlay?: () => void; onRemove?: () => void }) {
  return (
    <div className="group flex items-center gap-3 rounded-2xl p-2 hover:bg-panel-2">
      <span className="relative shrink-0">
        <img src={props.media.cover} alt="" className="h-14 w-10 rounded-lg object-cover" />
        {props.onPlay && (
          <button onClick={props.onPlay} title={t("Reproducir")} className="absolute inset-0 hidden place-items-center rounded-lg bg-black/50 text-white group-hover:grid">
            <Play size={16} fill="currentColor" />
          </button>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14.5px] ${props.active ? "font-medium text-accent" : ""}`}>{props.media.title}</span>
        <span className="text-[13px] text-muted">{t("Episodio {n}", { n: props.episode })}</span>
      </span>
      {props.active && (
        <span className="eq mr-1" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      )}
      {props.onRemove && (
        <button onClick={props.onRemove} title={t("Quitar de la cola")} className="grid size-8 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:text-accent">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/** Context menu for episodes: play next, queue, add to a playlist. */
export function AddMenu(props: {
  at: { x: number; y: number };
  target: EpisodeRef[];
  library: Library;
  /** set when the menu is for a row of this playlist */
  fromPlaylist?: { id: string; itemId: string } | null;
  onPlay?: () => void;
  onCreated: (p: Playlist) => void;
  notify: (text: string) => void;
  onClose: () => void;
}) {
  const lib = props.library;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(props.at);
  const [sub, setSub] = useState(false);
  useEffect(() => {
    // keep the menu inside the window
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(props.at.x, window.innerWidth - r.width - 8), y: Math.min(props.at.y, window.innerHeight - r.height - 8) });
  }, [props.at, sub]);
  const n = props.target.length;
  const done = (text: string) => {
    props.notify(text);
    props.onClose();
  };
  return createPortal(
    <div className="fixed inset-0 z-[55]" onClick={props.onClose} onContextMenu={(e) => (e.preventDefault(), props.onClose())}>
      <div
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        style={{ left: pos.x, top: pos.y }}
        className="menu-pop absolute w-64 overflow-hidden rounded-2xl bg-panel py-1.5 shadow-[0_18px_50px_rgb(0_0_0/0.4)] ring-1 ring-line"
      >
        {!sub ? (
          <>
            {props.onPlay && (
              <MenuItem icon={<Play size={16} />} onClick={() => (props.onPlay!(), props.onClose())}>
                {t("Reproducir")}
              </MenuItem>
            )}
            <MenuItem icon={<SkipForward size={16} />} onClick={() => (lib.enqueue(props.target, true), done(tn(n, "Se reproducirá a continuación", "{n} episodios se reproducirán a continuación")))}>
              {t("Reproducir a continuación")}
            </MenuItem>
            <MenuItem icon={<ListPlus size={16} />} onClick={() => (lib.enqueue(props.target), done(tn(n, "Añadido a la cola", "{n} episodios añadidos a la cola")))}>
              {t("Añadir a la cola")}
            </MenuItem>
            <div className="my-1 h-px bg-line" />
            <MenuItem icon={<Plus size={16} />} onClick={() => setSub(true)} trailing="›">
              {t("Añadir a lista")}
            </MenuItem>
            {props.fromPlaylist && (
              <MenuItem danger icon={<Trash2 size={16} />} onClick={() => (lib.removeItem(props.fromPlaylist!.id, props.fromPlaylist!.itemId), props.onClose())}>
                {t("Quitar de esta lista")}
              </MenuItem>
            )}
          </>
        ) : (
          <>
            <MenuItem icon={<span className="text-muted">‹</span>} onClick={() => setSub(false)}>
              <span className="text-muted">{t("Añadir a lista")}</span>
            </MenuItem>
            <div className="my-1 h-px bg-line" />
            <MenuItem
              icon={<Plus size={16} />}
              onClick={() => {
                const p = lib.create(t("Mi lista nº {n}", { n: lib.playlists.length + 1 }), props.target);
                props.onCreated(p);
                done(t("Añadido a «{name}»", { name: p.name }));
              }}
            >
              {t("Nueva lista")}
            </MenuItem>
            <div className="max-h-64 overflow-y-auto">
              {lib.playlists.map((p) => (
                <MenuItem
                  key={p.id}
                  icon={<Mosaic playlist={p} size={22} className="rounded" />}
                  onClick={() => {
                    const added = lib.add(p.id, props.target);
                    done(added ? t("Añadido a «{name}»", { name: p.name }) : t("Ya estaba en «{name}»", { name: p.name }));
                  }}
                >
                  {p.name}
                </MenuItem>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function MenuItem(props: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; trailing?: string }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14.5px] hover:bg-panel-2 ${props.danger ? "text-accent" : ""}`}
    >
      <span className="grid size-5 shrink-0 place-items-center">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.children}</span>
      {props.trailing && <span className="text-muted">{props.trailing}</span>}
    </button>
  );
}

function Popover(props: { children: ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    const close = () => props.onClose();
    const tm = setTimeout(() => window.addEventListener("click", close), 0);
    return () => {
      clearTimeout(tm);
      window.removeEventListener("click", close);
    };
  }, [props]);
  return (
    <div onClick={(e) => e.stopPropagation()} className={`menu-pop absolute z-20 w-64 overflow-hidden rounded-2xl bg-panel py-1.5 shadow-[0_18px_50px_rgb(0_0_0/0.4)] ring-1 ring-line ${props.className ?? ""}`}>
      {props.children}
    </div>
  );
}
