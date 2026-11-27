// Downloads: where episodes go, upload limit and clean-up.

import { HardDriveDownload, ShieldAlert } from "lucide-react";
import type { DownloadSettings } from "../player";

const UPLOAD: { v: number | null; label: string }[] = [
  { v: 100, label: "100 KB/s" },
  { v: 500, label: "500 KB/s" },
  { v: 2000, label: "2 MB/s" },
  { v: null, label: "Sin límite" },
];

export function DownloadsView(props: { settings: DownloadSettings; onSettings: (s: DownloadSettings) => void }) {
  const s = props.settings;
  return (
    <div className="flex max-w-[820px] flex-col gap-5">
      <h1 className="text-[26px] font-medium">Descargas</h1>

      <section className="rounded-[28px] bg-panel p-6 shadow-soft">
        <h2 className="flex items-center gap-2 text-[19px] font-medium">
          <HardDriveDownload size={20} className="text-accent" /> Cómo se descargan los episodios
        </h2>
        <p className="mt-1 text-[14.5px] text-muted">
          Al pulsar «Ver», el episodio se descarga por partes en orden y el reproductor empieza en cuanto hay suficiente. Los cambios
          de carpeta y de límite se aplican al reiniciar la app.
        </p>

        <label className="mt-5 block text-[14px] text-muted">Carpeta de descargas</label>
        <input
          value={s.dir}
          onChange={(e) => props.onSettings({ ...s, dir: e.target.value })}
          placeholder="Por defecto: la carpeta de caché de la app"
          className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-panel-2 px-4 text-[15px] outline-none focus:border-accent"
        />

        <p className="mt-5 mb-2 text-[14px] text-muted">Límite de subida</p>
        <div className="flex w-fit flex-wrap gap-1 rounded-full bg-panel-2/60 p-1">
          {UPLOAD.map((u) => (
            <button
              key={u.label}
              onClick={() => props.onSettings({ ...s, uploadKib: u.v })}
              className={`h-10 rounded-full px-4 text-[14.5px] ${s.uploadKib === u.v ? "bg-accent text-white" : "hover:bg-panel-2"}`}
            >
              {u.label}
            </button>
          ))}
        </div>

        <label className="mt-5 flex items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={s.deleteAfter}
            onChange={(e) => props.onSettings({ ...s, deleteAfter: e.target.checked })}
            className="size-5 accent-[var(--atv-accent)]"
          />
          Borrar el episodio al terminar de verlo
        </label>
      </section>

      <section className="flex gap-3 rounded-[28px] bg-panel p-6 text-[14px] text-muted shadow-soft">
        <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-500" />
        <p>
          Con torrent, mientras ves también compartes partes del episodio con otras personas, y tu IP es visible para ellas. El
          límite de subida reduce cuánto compartes. Usa solo contenido que tengas derecho a ver.
        </p>
      </section>
    </div>
  );
}
