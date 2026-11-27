// Notes inside the player: the episode's notes in playback order, each
// time a link that seeks there, and a composer that stamps the note with
// the moment you started writing it.

import { Clock, NotebookPen, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatTime, segments, type Note } from "../notes";
import { t } from "../i18n";

/** A note's text with the times written in it as links. */
export function NoteText(props: { text: string; onTime: (t: number) => void; linkClass?: string }) {
  return (
    <span className="break-words whitespace-pre-wrap">
      {segments(props.text).map((s, i) =>
        "time" in s ? (
          <button
            key={i}
            onClick={() => props.onTime(s.time)}
            className={props.linkClass ?? "font-medium text-accent underline-offset-2 hover:underline"}
          >
            {s.label}
          </button>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

/** Time stamp chip (click = go there). */
export function TimeChip(props: { time: number | null; onClick?: () => void; dark?: boolean }) {
  const cls = props.dark ? "bg-white/12 text-white hover:bg-accent" : "bg-accent-soft text-accent hover:bg-accent hover:text-white";
  if (props.time == null)
    return (
      <span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${props.dark ? "bg-white/8 text-white/60" : "bg-panel-2 text-muted"}`}>
        {t("Episodio")}
      </span>
    );
  return (
    <button onClick={props.onClick} className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold tabular-nums transition-colors ${cls}`}>
      <Clock size={11} /> {formatTime(props.time)}
    </button>
  );
}

export function NotesPanel(props: {
  notes: Note[];
  /** current playback position */
  now: number | null;
  onSeek: (t: number) => void;
  onAdd: (text: string, time: number | null) => void;
  onUpdate: (id: string, p: { text: string }) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  // the moment the user started writing; null = about the whole episode
  const [stamp, setStamp] = useState<number | null>(null);
  const [stamped, setStamped] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const take = () => {
    if (stamp == null && props.now != null) setStamp(props.now);
  };
  const submit = () => {
    if (!text.trim()) return;
    props.onAdd(text, stamped ? (stamp ?? props.now) : null);
    setText("");
    setStamp(null);
    setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 30);
  };
  const shownStamp = stamp ?? props.now;

  return (
    <aside
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="notes-panel absolute top-24 right-4 bottom-32 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl bg-neutral-950/80 shadow-[0_24px_60px_rgb(0_0_0/0.55)] ring-1 ring-white/10 backdrop-blur-xl"
    >
      <header className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5">
        <NotebookPen size={17} className="text-accent" />
        <h3 className="flex-1 text-[15.5px] font-semibold">{t("Notas del episodio")}</h3>
        <button onClick={props.onClose} title={t("Cerrar (B)")} className="grid size-8 place-items-center rounded-full hover:bg-white/10">
          <X size={16} />
        </button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {props.notes.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center text-[14px] text-white/50">
            <p>
              {t("Escribe lo que quieras recordar. La nota guarda el minuto en que empezaste a escribir, y si pones un tiempo como")}{" "}
              <b className="text-white/75">12:34</b> {t("en el texto, se convierte en un enlace.")}
            </p>
          </div>
        ) : (
          props.notes.map((n) => (
            <Item key={n.id} anim>
              <div className="flex items-center gap-2">
                <TimeChip dark time={n.time} onClick={() => n.time != null && props.onSeek(n.time)} />
                <span className="flex-1" />
                <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => setEditing(n.id)} title={t("Editar")} className="grid size-7 place-items-center rounded-full hover:bg-white/10">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => props.onRemove(n.id)} title={t("Borrar")} className="grid size-7 place-items-center rounded-full hover:bg-white/10 hover:text-accent">
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              {editing === n.id ? (
                <EditBox
                  initial={n.text}
                  onSave={(t) => {
                    if (t.trim()) props.onUpdate(n.id, { text: t.trim() });
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <p className="mt-1.5 text-[14px] leading-relaxed text-white/90">
                  <NoteText text={n.text} onTime={props.onSeek} />
                </p>
              )}
            </Item>
          ))
        )}
      </div>

      <form
        className="border-t border-white/10 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="rounded-2xl bg-white/[0.06] p-2 ring-1 ring-white/10 focus-within:ring-accent/70">
          <textarea
            ref={inputRef}
            value={text}
            onFocus={take}
            onChange={(e) => {
              take();
              setText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            rows={2}
            placeholder={t("Escribe una nota…")}
            className="block max-h-40 w-full resize-none bg-transparent px-2 py-1 text-[14px] text-white outline-none placeholder:text-white/35"
          />
          <div className="mt-1 flex items-center gap-2 px-1">
            <button
              type="button"
              onClick={() => setStamped((v) => !v)}
              title={stamped ? t("La nota se guarda en este momento del vídeo (clic: del episodio entero)") : t("Nota del episodio entero (clic: en este momento)")}
              className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold tabular-nums ${
                stamped ? "bg-accent text-white" : "bg-white/10 text-white/60"
              }`}
            >
              <Clock size={11} /> {stamped && shownStamp != null ? formatTime(shownStamp) : t("Sin minuto")}
            </button>
            <span className="flex-1 text-right text-[11.5px] text-white/35">{t("Enter guarda")}</span>
            <button disabled={!text.trim()} className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium disabled:opacity-35">
              {t("Guardar")}
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function Item(props: { children: ReactNode; anim?: boolean }) {
  return <div className={`group rounded-2xl px-3 py-2.5 hover:bg-white/[0.05] ${props.anim ? "note-in" : ""}`}>{props.children}</div>;
}

export function EditBox(props: { initial: string; onSave: (t: string) => void; onCancel: () => void; dark?: boolean }) {
  const [t, setT] = useState(props.initial);
  return (
    <textarea
      autoFocus
      value={t}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => props.onSave(t)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          props.onSave(t);
        } else if (e.key === "Escape") props.onCancel();
      }}
      rows={3}
      className={`mt-1.5 block w-full resize-none rounded-xl px-3 py-2 text-[14px] outline-none ring-1 ring-accent/60 ${
        props.dark === false ? "bg-panel-2" : "bg-white/[0.07] text-white"
      }`}
    />
  );
}
