// Downloads & sharing: speed limits, sharing after watching (with the
// user's explicit consent), incoming connections, storage, and what is
// being shared right now.

import { Gauge, HardDriveDownload, Router, Share2, ShieldAlert, Square, Upload, Users, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as player from "../player";
import type { DownloadSettings, SeedSettings } from "../player";
import type { useSeeding } from "../seeding";
import { formatSize } from "../sources";

type Seeding = ReturnType<typeof useSeeding>;

const DOWN = [null, 10240, 5120, 2048, 1024];
const UP_WATCHING = [0, 100, 500, 2048, null];
const UP_SEEDING = [100, 500, 2048, 5120, null];
const RATIOS: (number | null)[] = [0.5, 1, 2, null];
const HOURS: (number | null)[] = [0.5, 2, 12, null];
const AT_ONCE = [1, 3, 5, 10];

const hoursLabel = (h: number | null) => (h == null ? "Sin límite" : h < 1 ? `${h * 60} min` : `${h} h`);
const ratioLabel = (r: number | null) => (r == null ? "Sin límite" : `${r}×`);

export function DownloadsView(props: { settings: DownloadSettings; onSettings: (s: DownloadSettings) => void; seeding: Seeding }) {
  const s = props.settings;
  const set = (p: Partial<DownloadSettings>) => props.onSettings({ ...s, ...p });
  const setSeed = (p: Partial<SeedSettings>) => set({ seed: { ...s.seed, ...p } });
  // what to switch on once the user agrees to share
  const [asking, setAsking] = useState<Partial<DownloadSettings> | null>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    player.engineStarted().then(setStarted);
  }, []);
  const allowed = player.sharingAllowed(s);

  /** apply `patch` once the user has agreed to share */
  const withConsent = (patch: Partial<DownloadSettings>) => (allowed ? set(patch) : setAsking(patch));

  return (
    <div className="flex max-w-[820px] flex-col gap-5">
      <h1 className="text-[26px] font-medium">Descargas y compartir</h1>

      {/* ---- speed ---- */}
      <Card icon={<Gauge size={20} />} title="Velocidad">
        <p className="text-[14.5px] text-muted">
          La app no limita la descarga: por defecto usa toda tu conexión. La velocidad real depende de cuántas personas comparten
          el episodio (peers); con muchos, un episodio de 1,4 GB puede bajar en un par de minutos en una conexión de 100 Mb/s. El
          reproductor arranca con los primeros ~12 MB y el resto sigue descargándose mientras ves.
        </p>
        <Field label="Descarga">
          <Choice values={DOWN} value={s.downloadKib} label={player.formatLimit} onPick={(v) => set({ downloadKib: v })} custom />
        </Field>
        <Field
          label="Subida mientras ves"
          hint="Mientras descargas, BitTorrent siempre comparte algo. «Mínimo» lo reduce casi a cero, pero otros peers suelen darte menos velocidad a cambio."
        >
          <Choice values={UP_WATCHING} value={s.uploadKib} label={player.formatLimit} onPick={(v) => set({ uploadKib: v })} custom />
        </Field>
      </Card>

      {/* ---- sharing after watching ---- */}
      <Card icon={<Share2 size={20} />} title="Compartir después de ver">
        <Toggle
          checked={s.seed.enabled && allowed}
          onChange={(on) => (on ? withConsent({ seed: { ...s.seed, enabled: true } }) : setSeed({ enabled: false }))}
          label="Seguir compartiendo los episodios que termines"
          text="Ayudas a que otros los vean más rápido. Solo mientras la app está abierta y dentro de los límites que elijas."
        />
        {s.seed.enabled && allowed && (
          <div className="fade-in">
            <Field label="Subida al compartir">
              <Choice values={UP_SEEDING} value={s.seed.uploadKib} label={player.formatLimit} onPick={(v) => setSeed({ uploadKib: v })} custom />
            </Field>
            <Field label="Dejar de compartir al subir" hint="Proporción respecto al tamaño del episodio: 1× = has subido tanto como pesa.">
              <Choice values={RATIOS} value={s.seed.ratio} label={ratioLabel} onPick={(v) => setSeed({ ratio: v })} />
            </Field>
            <Field label="O después de">
              <Choice values={HOURS} value={s.seed.hours} label={hoursLabel} onPick={(v) => setSeed({ hours: v })} />
            </Field>
            <Field label="Episodios a la vez">
              <Choice values={AT_ONCE} value={s.seed.maxTorrents} label={String} onPick={(v) => setSeed({ maxTorrents: v ?? 3 })} />
            </Field>
          </div>
        )}
        <SharingNow seeding={props.seeding} />
      </Card>

      {/* ---- incoming connections ---- */}
      <Card icon={<Router size={20} />} title="Conexiones entrantes">
        <Toggle
          checked={s.incoming && allowed}
          onChange={(on) => (on ? withConsent({ incoming: true }) : set({ incoming: false, upnp: false }))}
          label="Aceptar conexiones de otros peers"
          text="Por defecto la app solo hace conexiones salientes. Abrir un puerto permite que más gente se conecte contigo: descargas y compartes mejor."
        />
        {s.incoming && allowed && (
          <Toggle
            checked={s.upnp}
            onChange={(on) => set({ upnp: on })}
            label="Abrir el puerto en el router automáticamente (UPnP)"
            text="Solo si tu router lo permite. Puedes dejarlo apagado y abrir el puerto a mano."
          />
        )}
        {started && <p className="mt-4 text-[13.5px] text-amber-500">Los cambios de esta sección se aplican al reiniciar la app.</p>}
      </Card>

      {/* ---- storage ---- */}
      <Card icon={<HardDriveDownload size={20} />} title="Almacenamiento">
        <label className="block text-[14px] text-muted">Carpeta de descargas (se aplica al reiniciar la app)</label>
        <input
          value={s.dir}
          onChange={(e) => set({ dir: e.target.value })}
          placeholder="Por defecto: la carpeta de caché de la app"
          className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-panel-2 px-4 text-[15px] outline-none focus:border-accent"
        />
        <Toggle
          checked={s.deleteAfter}
          onChange={(on) => set({ deleteAfter: on })}
          label="Borrar el episodio cuando ya no se usa"
          text="Al cerrar el reproductor o, si lo compartes, cuando deja de compartirse."
        />
      </Card>

      {/* ---- consent ---- */}
      <section className="flex gap-3 rounded-[28px] bg-panel p-6 text-[14px] text-muted shadow-soft">
        <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-500" />
        <div>
          <p>
            Con torrent, tu IP es visible para las personas que descargan el mismo episodio, y lo que compartes sale de tu conexión.
            Usa solo contenido que tengas derecho a ver y compartir.
          </p>
          {allowed && (
            <p className="mt-2">
              Aceptaste compartir el {new Date(s.consent!).toLocaleDateString()}.{" "}
              <button
                onClick={() => {
                  props.seeding.stopAll();
                  set({ consent: null, incoming: false, upnp: false, seed: { ...s.seed, enabled: false } });
                }}
                className="text-accent hover:underline"
              >
                Retirar el permiso
              </button>
            </p>
          )}
        </div>
      </section>

      {asking && (
        <Consent
          onCancel={() => setAsking(null)}
          onAccept={() => {
            set({ ...asking, consent: new Date().toISOString() });
            setAsking(null);
          }}
        />
      )}
    </div>
  );
}

function SharingNow(props: { seeding: Seeding }) {
  const { seeds } = props.seeding;
  if (seeds.length === 0) return null;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[14px] font-medium">Compartiendo ahora</p>
        <button onClick={props.seeding.stopAll} className="text-[13.5px] text-muted hover:text-accent">
          Dejar de compartir todo
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {seeds.map((x) => {
          const st = x.status;
          const ratio = st && st.fileLen ? st.uploaded / st.fileLen : 0;
          return (
            <div key={x.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-panel-2">
              <img src={x.cover} alt="" className="h-12 w-8 rounded-md object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px]">
                  {x.series} <span className="text-muted">· Ep. {x.episode}</span>
                </p>
                <p className="flex flex-wrap gap-x-3 text-[12.5px] text-muted">
                  {st ? (
                    <>
                      <span className="flex items-center gap-1">
                        <Upload size={12} /> {player.formatSpeed(st.upBps)}
                      </span>
                      <span>{formatSize(st.uploaded) || "0 B"} subidos</span>
                      <span>{ratio.toFixed(2)}×</span>
                      <span className="flex items-center gap-1">
                        <Users size={12} /> {st.peers}
                      </span>
                      {!st.finished && <span>descargando {Math.round((st.fileDownloaded / (st.fileLen || 1)) * 100)}%</span>}
                    </>
                  ) : (
                    "…"
                  )}
                </p>
              </div>
              <button onClick={() => props.seeding.stop(x.id)} title="Dejar de compartir" className="grid size-9 place-items-center rounded-full hover:bg-panel hover:text-accent">
                <Square size={13} fill="currentColor" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Consent(props: { onAccept: () => void; onCancel: () => void }) {
  const [ok, setOk] = useState(false);
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={props.onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="fade-in w-full max-w-[520px] rounded-[28px] bg-panel p-7 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[21px] font-semibold">¿Compartir con otras personas?</h2>
          <button onClick={props.onCancel} className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-panel-2">
            <X size={18} />
          </button>
        </div>
        <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-[14.5px] text-muted">
          <li>Otras personas descargarán partes de episodios desde tu equipo.</li>
          <li>Tu dirección IP será visible para quienes compartan el mismo episodio.</li>
          <li>Usa tu subida de internet; si tu plan tiene límite de datos, también cuenta.</li>
          <li>Eres responsable de lo que compartes: hazlo solo con contenido que tengas derecho a distribuir.</li>
          <li>Tú eliges los límites y puedes retirar el permiso cuando quieras en esta pantalla.</li>
        </ul>
        <label className="mt-5 flex items-center gap-3 text-[15px]">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="size-5 accent-[var(--atv-accent)]" />
          Lo entiendo y quiero compartir
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={props.onCancel} className="h-11 rounded-full bg-panel-2 px-5 text-[15px]">
            Ahora no
          </button>
          <button
            onClick={props.onAccept}
            disabled={!ok}
            className="h-11 rounded-full bg-accent px-5 text-[15px] font-medium text-white disabled:opacity-40"
          >
            Aceptar y activar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Card(props: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] bg-panel p-6 shadow-soft">
      <h2 className="mb-2 flex items-center gap-2 text-[19px] font-medium">
        <span className="text-accent">{props.icon}</span> {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-[14px] text-muted">{props.label}</p>
      {props.children}
      {props.hint && <p className="mt-2 text-[13px] text-muted/80">{props.hint}</p>}
    </div>
  );
}

function Toggle(props: { checked: boolean; onChange: (on: boolean) => void; label: string; text?: string }) {
  return (
    <button onClick={() => props.onChange(!props.checked)} className="mt-4 flex w-full items-start gap-4 text-left">
      <span
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${props.checked ? "bg-accent" : "bg-panel-2 ring-1 ring-line"}`}
      >
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${props.checked ? "left-6" : "left-1"}`} />
      </span>
      <span>
        <span className="block text-[15px]">{props.label}</span>
        {props.text && <span className="mt-0.5 block text-[13.5px] text-muted">{props.text}</span>}
      </span>
    </button>
  );
}

/** Preset chips, plus a custom value in MB/s when `custom`. */
function Choice<T extends number | null>(props: { values: T[]; value: T; label: (v: T) => string; onPick: (v: T) => void; custom?: boolean }) {
  const preset = props.values.includes(props.value);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const showInput = props.custom && (editing || !preset);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex w-fit flex-wrap gap-1 rounded-full bg-panel-2/60 p-1">
        {props.values.map((v) => (
          <button
            key={String(v)}
            onClick={() => {
              setEditing(false);
              props.onPick(v);
            }}
            className={`h-10 rounded-full px-4 text-[14.5px] ${props.value === v && !editing ? "bg-accent text-white" : "hover:bg-panel-2"}`}
          >
            {props.label(v)}
          </button>
        ))}
        {props.custom && (
          <button
            onClick={() => {
              setText(props.value != null && props.value > 0 ? String(+(props.value / 1024).toFixed(2)) : "");
              setEditing(true);
            }}
            className={`h-10 rounded-full px-4 text-[14.5px] ${showInput ? "bg-accent text-white" : "hover:bg-panel-2"}`}
          >
            {!preset && !editing ? props.label(props.value) : "Otro"}
          </button>
        )}
      </div>
      {showInput && editing && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const mb = parseFloat(text.replace(",", "."));
            if (mb > 0) props.onPick(Math.round(mb * 1024) as T);
            setEditing(false);
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="decimal"
            placeholder="MB/s"
            className="h-10 w-24 rounded-full border border-line bg-panel-2 px-4 text-[14.5px] outline-none focus:border-accent"
          />
          <span className="text-[14px] text-muted">MB/s</span>
          <button className="h-10 rounded-full bg-panel-2 px-4 text-[14px] hover:text-accent">Aplicar</button>
        </form>
      )}
    </div>
  );
}
