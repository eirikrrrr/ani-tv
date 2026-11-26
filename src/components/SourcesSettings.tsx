// Settings → language preferences and sources (Torznab / RSS).

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { inTauri } from "../discord";
import {
  LANGS, langLabel, newId, testSource, type Lang, type LangPref, type Prefs, type Source, type Track,
} from "../sources";

const input =
  "h-11 w-full rounded-2xl border border-line bg-panel-2 px-4 text-[15px] outline-none focus:border-accent";
const select = `${input} appearance-none pr-8`;
const TRACK: Record<Track, string> = { subs: "Subtítulos", audio: "Audio" };
const RESOLUTIONS: { v: number | null; label: string }[] = [
  { v: 2160, label: "4K" },
  { v: 1080, label: "1080p" },
  { v: 720, label: "720p" },
  { v: 480, label: "480p" },
  { v: null, label: "Cualquiera" },
];

export function LanguagePrefs(props: { prefs: Prefs; onChange: (p: Prefs) => void }) {
  const { prefs } = props;
  const [track, setTrack] = useState<Track>("subs");
  const [lang, setLang] = useState<Lang>("es");
  const set = (languages: LangPref[]) => props.onChange({ ...prefs, languages });
  const move = (i: number, d: -1 | 1) => {
    const l = [...prefs.languages];
    [l[i], l[i + d]] = [l[i + d], l[i]];
    set(l);
  };
  const exists = prefs.languages.some((p) => p.lang === lang && p.track === track);
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-2">
        {prefs.languages.length === 0 && <li className="text-[14.5px] text-muted">Sin preferencia: se ordena por calidad y seeders.</li>}
        {prefs.languages.map((p, i) => (
          <li key={`${p.track}-${p.lang}`} className="flex items-center gap-3 rounded-2xl bg-panel-2 py-2 pr-2 pl-4">
            <span className="w-5 text-[14px] text-muted">{i + 1}.</span>
            <span className="flex-1 text-[15px]">
              {TRACK[p.track]} · <b className="font-medium">{langLabel(p.lang)}</b>
            </span>
            <button disabled={i === 0} onClick={() => move(i, -1)} title="Subir" className="grid size-9 place-items-center rounded-full hover:bg-panel disabled:opacity-30">
              <ArrowUp size={16} />
            </button>
            <button disabled={i === prefs.languages.length - 1} onClick={() => move(i, 1)} title="Bajar" className="grid size-9 place-items-center rounded-full hover:bg-panel disabled:opacity-30">
              <ArrowDown size={16} />
            </button>
            <button onClick={() => set(prefs.languages.filter((_, k) => k !== i))} title="Quitar" className="grid size-9 place-items-center rounded-full hover:bg-panel hover:text-accent">
              <X size={16} />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 max-sm:flex-col">
        <select value={track} onChange={(e) => setTrack(e.target.value as Track)} className={`${select} sm:w-44`}>
          <option value="subs">Subtítulos</option>
          <option value="audio">Audio</option>
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className={select}>
          {LANGS.filter((l) => !(track === "audio" && l.id === "multi")).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          disabled={exists}
          onClick={() => set([...prefs.languages, { lang, track }])}
          className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-accent px-5 text-[15px] font-medium text-white disabled:opacity-40"
        >
          <Plus size={17} /> Añadir
        </button>
      </div>

      <div>
        <p className="mb-2 text-[14px] text-muted">Resolución preferida</p>
        <div className="flex w-fit flex-wrap gap-1 rounded-full bg-panel-2/60 p-1">
          {RESOLUTIONS.map((r) => (
            <button
              key={r.label}
              onClick={() => props.onChange({ ...prefs, resolution: r.v })}
              className={`h-10 rounded-full px-4 text-[14.5px] ${prefs.resolution === r.v ? "bg-accent text-white" : "hover:bg-panel-2"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-3 text-[15px]">
        <input
          type="checkbox"
          checked={prefs.batches}
          onChange={(e) => props.onChange({ ...prefs, batches: e.target.checked })}
          className="size-5 accent-[var(--atv-accent)]"
        />
        Incluir packs de temporada que contengan el episodio
      </label>
    </div>
  );
}

type TestState = { state: "running" } | { state: "ok"; n: number } | { state: "error"; error: string };

const EMPTY: Omit<Source, "id"> = { name: "", enabled: true, kind: "torznab", url: "", apiKey: "", categories: "", defaultSubs: null };

export function SourcesList(props: { sources: Source[]; onChange: (s: Source[]) => void }) {
  const [draft, setDraft] = useState<Omit<Source, "id"> | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const update = (id: string, patch: Partial<Source>) =>
    props.onChange(props.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const run = async (s: Source) => {
    setTests((t) => ({ ...t, [s.id]: { state: "running" } }));
    try {
      const n = await testSource(s);
      setTests((t) => ({ ...t, [s.id]: { state: "ok", n } }));
    } catch (e) {
      setTests((t) => ({ ...t, [s.id]: { state: "error", error: (e as Error).message } }));
    }
  };
  const save = () => {
    if (!draft) return;
    const s: Source = { ...draft, id: newId(), name: draft.name.trim(), url: draft.url.trim() };
    props.onChange([...props.sources, s]);
    setDraft(null);
    if (inTauri) run(s);
  };

  return (
    <div className="flex flex-col gap-3">
      {props.sources.length === 0 && !draft && (
        <p className="text-[14.5px] text-muted">No hay fuentes. La app no trae ninguna: añade las que tú uses.</p>
      )}
      {props.sources.map((s) => {
        const t = tests[s.id];
        return (
          <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-panel-2 p-3 pl-4 max-sm:flex-wrap">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => update(s.id, { enabled: e.target.checked })}
              title={s.enabled ? "Activa" : "Desactivada"}
              className="size-5 shrink-0 accent-[var(--atv-accent)]"
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[15px]">
                <span className="truncate font-medium">{s.name}</span>
                <span className="rounded-md bg-panel px-1.5 py-0.5 text-[11px] tracking-wide text-muted uppercase">{s.kind}</span>
                {s.defaultSubs && <span className="text-[12px] text-muted">subs por defecto: {langLabel(s.defaultSubs)}</span>}
              </p>
              <p className="truncate text-[13px] text-muted">{s.url}</p>
              {t && (
                <p className={`text-[13px] ${t.state === "error" ? "text-amber-500" : t.state === "ok" ? "text-emerald-500" : "text-muted"}`}>
                  {t.state === "running" ? "Probando…" : t.state === "ok" ? `Funciona: ${t.n} resultados recientes` : t.error}
                </p>
              )}
            </div>
            <button
              onClick={() => run(s)}
              disabled={!inTauri || t?.state === "running"}
              className="h-9 shrink-0 rounded-full bg-panel px-4 text-[14px] hover:text-accent disabled:opacity-40"
            >
              Probar
            </button>
            <button
              onClick={() => props.onChange(props.sources.filter((x) => x.id !== s.id))}
              title="Eliminar fuente"
              className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-panel hover:text-accent"
            >
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}

      {draft ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <div className="flex w-fit gap-1 rounded-full bg-panel-2/60 p-1">
            {(["torznab", "rss"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setDraft({ ...draft, kind: k })}
                className={`h-9 rounded-full px-4 text-[14.5px] ${draft.kind === k ? "bg-accent text-white" : "hover:bg-panel-2"}`}
              >
                {k === "torznab" ? "Torznab" : "RSS"}
              </button>
            ))}
          </div>
          <p className="text-[13.5px] text-muted">
            {draft.kind === "torznab"
              ? "Prowlarr: en Indexers, abre el indexador y copia su «Torznab Feed»; la API key está en Settings → General. Jackett: «Copy Torznab Feed»."
              : "URL de un feed RSS. Pon {query} donde va el texto de búsqueda; sin {query} se lee el feed tal cual."}
          </p>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nombre (p. ej. Prowlarr)" className={input} />
          <input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder={draft.kind === "torznab" ? "http://localhost:9696/1/api" : "https://…/rss?q={query}"}
            className={input}
          />
          {draft.kind === "torznab" && (
            <div className="flex gap-2 max-sm:flex-col">
              <input value={draft.apiKey ?? ""} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder="API key" className={input} />
              <input
                value={draft.categories ?? ""}
                onChange={(e) => setDraft({ ...draft, categories: e.target.value })}
                placeholder="Categorías (por defecto 5070, anime)"
                className={input}
              />
            </div>
          )}
          <select
            value={draft.defaultSubs ?? ""}
            onChange={(e) => setDraft({ ...draft, defaultSubs: (e.target.value || null) as Lang | null })}
            className={select}
          >
            <option value="">Subtítulos si el nombre no lo dice: desconocido</option>
            {LANGS.filter((l) => l.id !== "ja").map((l) => (
              <option key={l.id} value={l.id}>
                Subtítulos si el nombre no lo dice: {l.label}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className="h-10 rounded-full px-5 text-[15px] hover:bg-panel-2">
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={!draft.name.trim() || !/^https?:\/\//.test(draft.url.trim())}
              className="h-10 rounded-full bg-accent px-5 text-[15px] font-medium text-white disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setDraft({ ...EMPTY })}
          className="flex h-11 w-fit items-center gap-1.5 rounded-full bg-accent px-5 text-[15px] font-medium text-white"
        >
          <Plus size={17} /> Añadir fuente
        </button>
      )}
    </div>
  );
}
