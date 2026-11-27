// "Notas": every note, grouped by series and episode. A time (the note's
// own, or one written in its text) opens that episode at that moment.

import { Copy, NotebookPen, Pencil, Play, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { episodeNotes, toMarkdown, useNotes, type Note } from "../notes";
import { Empty } from "./Media";
import { EditBox, NoteText, TimeChip } from "./NotesPanel";
import { t, tn } from "../i18n";

type Group = { mediaId: number; series: string; cover: string | null; episodes: { episode: number; notes: Note[] }[]; last: number };

export function NotesView(props: {
  /** play `episode` of the series, starting at `time` */
  onPlay: (n: Pick<Note, "mediaId" | "series" | "cover" | "episode">, time: number | null) => void;
  onOpen: (mediaId: number) => void;
  notify: (text: string) => void;
}) {
  const { notes, update, remove } = useNotes();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = needle ? notes.filter((n) => n.text.toLowerCase().includes(needle) || n.series.toLowerCase().includes(needle)) : notes;
    const by = new Map<number, Note[]>();
    for (const n of shown) by.set(n.mediaId, [...(by.get(n.mediaId) ?? []), n]);
    const out: Group[] = [];
    for (const [mediaId, list] of by) {
      const eps = [...new Set(list.map((n) => n.episode))].sort((a, b) => a - b);
      out.push({
        mediaId,
        series: list[0].series,
        cover: list[0].cover,
        episodes: eps.map((episode) => ({ episode, notes: episodeNotes(list, mediaId, episode) })),
        last: Math.max(...list.map((n) => n.updatedAt)),
      });
    }
    return out.sort((a, b) => b.last - a.last);
  }, [notes, q]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(notes));
      props.notify(t("Notas copiadas como Markdown"));
    } catch {
      props.notify(t("No se pudieron copiar"));
    }
  };

  if (notes.length === 0) {
    return (
      <Empty
        icon={<NotebookPen size={24} />}
        title={t("Aún no tienes notas")}
        text={t("Mientras ves un episodio, pulsa el botón de notas (o la tecla B) para escribir. Cada nota guarda el minuto del vídeo y luego te lleva directo a ese momento.")}
      />
    );
  }

  return (
    <div className="flex max-w-[900px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[26px] font-medium">{t("Notas")}</h1>
        <label className="flex h-11 items-center gap-2 rounded-full bg-panel px-4 shadow-soft">
          <Search size={16} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar en tus notas")} className="w-48 bg-transparent text-[14.5px] outline-none" />
        </label>
        <button onClick={copy} className="flex h-11 items-center gap-2 rounded-full bg-panel px-4 text-[14.5px] shadow-soft hover:text-accent">
          <Copy size={16} /> {t("Copiar como Markdown")}
        </button>
      </div>

      {groups.length === 0 && <p className="text-muted">{t("Ninguna nota contiene «{q}».", { q })}</p>}

      {groups.map((g, gi) => (
        <section key={g.mediaId} className="reveal-up rounded-[28px] bg-panel p-5 shadow-soft" style={{ animationDelay: `${Math.min(gi, 6) * 60}ms` }}>
          <button onClick={() => props.onOpen(g.mediaId)} className="flex items-center gap-3 text-left">
            {g.cover && <img src={g.cover} alt="" className="h-14 w-10 rounded-lg object-cover" />}
            <span>
              <span className="block text-[18px] font-medium hover:text-accent">{g.series}</span>
              <span className="text-[13px] text-muted">
                {tn(g.episodes.reduce((n, e) => n + e.notes.length, 0), "{n} nota", "{n} notas")} ·{" "}
                {tn(g.episodes.length, "{n} episodio", "{n} episodios")}
              </span>
            </span>
          </button>

          {g.episodes.map((e) => (
            <div key={e.episode} className="mt-4">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[13px] font-semibold tracking-wide text-accent uppercase">{t("Episodio {n}", { n: e.episode })}</p>
                <button
                  onClick={() => props.onPlay({ mediaId: g.mediaId, series: g.series, cover: g.cover, episode: e.episode }, null)}
                  title={t("Ver episodio {n}", { n: e.episode })}
                  className="grid size-7 place-items-center rounded-full text-muted hover:bg-accent hover:text-white"
                >
                  <Play size={12} fill="currentColor" />
                </button>
              </div>
              <div className="flex flex-col">
                {e.notes.map((n) => (
                  <div key={n.id} className="group flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-panel-2">
                    <div className="pt-0.5">
                      <TimeChip time={n.time} onClick={() => props.onPlay(n, n.time)} />
                    </div>
                    <div className="min-w-0 flex-1 text-[14.5px]">
                      {editing === n.id ? (
                        <EditBox
                          dark={false}
                          initial={n.text}
                          onSave={(t) => {
                            if (t.trim()) update(n.id, { text: t.trim() });
                            setEditing(null);
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <NoteText text={n.text} onTime={(t) => props.onPlay(n, t)} />
                      )}
                    </div>
                    <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => setEditing(n.id)} title={t("Editar")} className="grid size-8 place-items-center rounded-full hover:bg-panel">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => remove(n.id)} title={t("Borrar")} className="grid size-8 place-items-center rounded-full hover:bg-panel hover:text-accent">
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
