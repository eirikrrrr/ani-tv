// Release picker: what the sources offer for one episode, best first by the
// user's language/resolution preferences.

import { AlertTriangle, Captions, Copy, Play, Rss, Sprout, Volume2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { inTauri } from "../discord";
import {
  formatSize, langShort, search, type Prefs, type Ranked, type SearchResult, type Source,
} from "../sources";
import type { Saved } from "../store";

export type PickTarget = { media: Saved; episode: number };

function Badge(props: { children: ReactNode; strong?: boolean; title?: string }) {
  return (
    <span
      title={props.title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium tracking-wide ${
        props.strong ? "bg-accent text-white" : "bg-panel-2 text-muted"
      }`}
    >
      {props.children}
    </span>
  );
}

function Row(props: { r: Ranked; sourceName: string; onPlay: () => void; onCopy: () => void }) {
  const { r } = props;
  const p = r.parsed;
  const subs = p.raw ? "RAW" : p.subs.length ? p.subs.map(langShort).join("·") : "?";
  return (
    <div className="flex items-center gap-4 rounded-2xl px-4 py-3 hover:bg-panel-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {r.languageMatch === 0 && <Badge strong>Tu idioma</Badge>}
          {p.resolution && <Badge>{p.resolution === 2160 ? "4K" : `${p.resolution}p`}</Badge>}
          <Badge title="Audio">
            <Volume2 size={12} /> {p.audio.map(langShort).join("·")}
          </Badge>
          <Badge title="Subtítulos">
            <Captions size={12} /> {subs}
          </Badge>
          {p.batch && <Badge title="Pack de varios episodios">Pack {p.episode && p.episodeEnd ? `${p.episode}-${p.episodeEnd}` : ""}</Badge>}
          {p.codec && <Badge>{p.codec}</Badge>}
        </div>
        <p className="mt-1.5 truncate text-[14px]" title={r.title}>
          {r.title}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px] text-muted">
          {r.seeders != null && (
            <span className={r.seeders === 0 ? "text-amber-500" : "text-emerald-500"}>
              <Sprout size={12} className="mr-0.5 inline" />
              {r.seeders} seeders
            </span>
          )}
          {r.size ? <span>{formatSize(r.size)}</span> : null}
          {p.group && <span>{p.group}</span>}
          <span>{props.sourceName}</span>
        </p>
      </div>
      <button
        onClick={props.onCopy}
        title="Copiar enlace magnet"
        className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-panel hover:text-accent"
      >
        <Copy size={17} />
      </button>
      <button
        onClick={props.onPlay}
        title="Ver este"
        className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-white transition-transform hover:scale-105"
      >
        <Play size={17} fill="currentColor" />
      </button>
    </div>
  );
}

export function Picker(props: {
  target: PickTarget;
  sources: Source[];
  prefs: Prefs;
  onClose: () => void;
  onPlay: (r: Ranked | null) => void;
  onSettings: () => void;
  notify: (text: string) => void;
}) {
  const { media, episode } = props.target;
  const enabled = props.sources.filter((s) => s.enabled);
  const [res, setRes] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (enabled.length === 0 || !inTauri) return;
    setRes(null);
    setError(null);
    const titles = [media.romaji, media.title].filter((t, i, a): t is string => !!t && a.indexOf(t) === i);
    const isMovie = media.format === "MOVIE" || media.episodes === 1;
    search(enabled, { titles, episode: isMovie ? null : episode, season: null, anilistId: media.id, movie: isMovie }, props.prefs).then(setRes, (e: Error) =>
      setError(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, episode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const nameOf = (id: string) => props.sources.find((s) => s.id === id)?.name ?? id;
  const copy = async (r: Ranked) => {
    const link = r.magnet ?? r.torrentUrl ?? "";
    try {
      await navigator.clipboard.writeText(link);
      props.notify("Enlace copiado");
    } catch {
      props.notify("No se pudo copiar el enlace");
    }
  };

  let body: ReactNode;
  if (!inTauri) {
    body = <p className="p-6 text-muted">La búsqueda en fuentes solo funciona en la app de escritorio.</p>;
  } else if (enabled.length === 0) {
    body = (
      <div className="grid place-items-center gap-3 px-6 py-12 text-center">
        <div className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
          <Rss size={24} />
        </div>
        <h3 className="text-[18px] font-medium">Aún no tienes fuentes</h3>
        <p className="max-w-[420px] text-[14.5px] text-muted">
          Añade un indexador Torznab (Prowlarr, Jackett) o un feed RSS en Ajustes para buscar este episodio.
        </p>
        <button onClick={props.onSettings} className="mt-1 h-11 rounded-full bg-accent px-6 font-medium text-white">
          Ir a Fuentes
        </button>
      </div>
    );
  } else if (error) {
    body = <p className="p-6 text-amber-500">{error}</p>;
  } else if (!res) {
    body = (
      <div className="flex flex-col gap-2 p-3">
        <p className="px-2 pb-1 text-[14px] text-muted">Buscando en {enabled.length} fuente{enabled.length > 1 ? "s" : ""}…</p>
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="h-[74px] animate-pulse rounded-2xl bg-panel-2" />
        ))}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col p-2">
        {res.errors.map((e) => (
          <p key={e.source} className="mx-2 mb-2 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[13.5px] text-amber-500">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              <b>{e.name}</b>: {e.error}
            </span>
          </p>
        ))}
        {res.results.length === 0 ? (
          <p className="px-4 py-8 text-center text-muted">
            Ninguna fuente tiene este episodio
            {res.total ? ` (${res.total} resultados de la serie, ninguno del episodio ${episode})` : ""}.
          </p>
        ) : (
          res.results.map((r, i) => (
            <Row
              key={(r.infoHash ?? r.title) + i}
              r={r}
              sourceName={nameOf(r.source)}
              onPlay={() => props.onPlay(r)}
              onCopy={() => copy(r)}
            />
          ))
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={props.onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="fade-in flex max-h-[85vh] w-full max-w-[820px] flex-col overflow-hidden rounded-[28px] bg-panel shadow-soft"
      >
        <header className="flex items-center gap-4 border-b border-line p-4 pl-5">
          <img src={media.cover} alt="" className="h-14 w-10 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium tracking-wide text-accent uppercase">Episodio {episode}</p>
            <h2 className="truncate text-[18px] font-medium">{media.title}</h2>
          </div>
          <button onClick={props.onClose} title="Cerrar" className="grid size-10 place-items-center rounded-full hover:bg-panel-2">
            <X size={19} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
          <span>«Ver» descarga el episodio por partes y lo abre en el reproductor en cuanto hay suficiente.</span>
          <button onClick={() => props.onPlay(null)} className="shrink-0 hover:text-accent">
            Marcar sin fuente
          </button>
        </footer>
      </div>
    </div>
  );
}
