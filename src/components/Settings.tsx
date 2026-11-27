import { ImagePlus, Languages, Moon, Sun, X } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_CLIENT_ID, inTauri, type DiscordStatus } from "../discord";
import type { Prefs, Source } from "../sources";
import type { DiscordSettings, Look, Theme } from "../store";
import { CURSORS, CursorPreview, MAX_CUSTOM_BYTES, type CustomCursor } from "./Cursor";
import { deleteImage, putImage } from "../cursorStore";
import { newId } from "../sources";
import { LanguagePrefs, SourcesList } from "./SourcesSettings";
import { lang, setLang, t } from "../i18n";

function Card(props: { title: string; text?: string; children: ReactNode; id?: string }) {
  return (
    <section id={props.id} className="rounded-[28px] bg-panel p-6 shadow-soft">
      <h2 className="text-[19px] font-medium">{props.title}</h2>
      {props.text && <p className="mt-1 text-[14.5px] text-muted">{props.text}</p>}
      <div className="mt-5">{props.children}</div>
    </section>
  );
}

const STATUS: Record<DiscordStatus, string> = {
  off: t("Desconectado"),
  connecting: t("Conectando…"),
  on: t("Conectado: tus amigos ven lo que estás viendo"),
  error: t("Sin conexión"),
};

export function SettingsView(props: {
  theme: Theme;
  onTheme: (t: Theme) => void;
  discord: DiscordSettings;
  onDiscord: (d: DiscordSettings) => void;
  status: DiscordStatus;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  sources: Source[];
  onSources: (s: Source[]) => void;
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  look: Look;
  onLook: (l: Look) => void;
  customCursors: CustomCursor[];
  onCustomCursors: (c: CustomCursor[]) => void;
  /** id → image URL of each custom cursor */
  cursorImages: Record<string, string>;
}) {
  const look = props.look;
  const file = useRef<HTMLInputElement>(null);
  const [cursorError, setCursorError] = useState<string | null>(null);
  const addCursor = (f: File | undefined) => {
    setCursorError(null);
    if (!f) return;
    if (!/^image\/(gif|png|apng|webp)$/.test(f.type)) {
      setCursorError(t("Usa una imagen GIF, PNG, APNG o WebP."));
      return;
    }
    if (f.size > MAX_CUSTOM_BYTES) {
      setCursorError(t("La imagen pesa {size} MB; el máximo es {max} MB.", { size: (f.size / 1048576).toFixed(1), max: MAX_CUSTOM_BYTES / 1048576 }));
      return;
    }
    const c: CustomCursor = { id: newId(), name: f.name.replace(/\.[^.]+$/, "").slice(0, 24) };
    putImage(c.id, f).then(
      () => {
        props.onCustomCursors([...props.customCursors, c]);
        props.onLook({ ...look, cursor: `custom:${c.id}` });
      },
      () => setCursorError(t("No se pudo guardar la imagen (¿disco lleno?).")),
    );
  };
  const removeCursor = (id: string) => {
    props.onCustomCursors(props.customCursors.filter((c) => c.id !== id));
    deleteImage(id);
    if (look.cursor === `custom:${id}`) props.onLook({ ...look, cursor: "system" });
  };
  const d = props.discord;
  const seg = (th: Theme, label: string, icon: ReactNode) => (
    <button
      onClick={() => props.onTheme(th)}
      className={`flex h-11 items-center gap-2 rounded-full px-5 text-[15px] ${
        props.theme === th ? "bg-accent text-white" : "hover:bg-panel-2"
      }`}
    >
      {icon} {label}
    </button>
  );
  return (
    <div className="fade-in flex max-w-[820px] flex-col gap-5">
      <h1 className="text-[26px] font-medium">{t("Ajustes")}</h1>

      <Card id="app-language" title="Idioma de la app · App language">
        <div className="flex w-fit gap-1 rounded-full bg-panel-2/60 p-1">
          {(
            [
              ["es", "Español"],
              ["en", "English"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => id !== lang && setLang(id)}
              className={`flex h-11 items-center gap-2 rounded-full px-5 text-[15px] ${lang === id ? "bg-accent text-white" : "hover:bg-panel-2"}`}
            >
              <Languages size={16} /> {label}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t("Apariencia")}>
        <div className="flex w-fit gap-1 rounded-full bg-panel-2/60 p-1">
          {seg("dark", t("Oscuro"), <Moon size={16} />)}
          {seg("light", t("Claro"), <Sun size={16} />)}
        </div>
        <label className="mt-5 flex items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={look.effects}
            onChange={(e) => props.onLook({ ...look, effects: e.target.checked })}
            className="size-5 accent-[var(--atv-accent)]"
          />
          {t("Efectos visuales (pétalos de sakura, zoom en la portada)")}
        </label>
      </Card>

      <Card
        id="cursor"
        title="Cursor"
        text={t("Cambia el puntero del ratón por un personaje animado: salta al moverse, se emociona sobre los botones y se duerme si no lo mueves.")}
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
          {CURSORS.map((c) => {
            const on = look.cursor === c.id;
            return (
              <button
                key={c.id}
                onClick={() => props.onLook({ ...look, cursor: c.id })}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 text-[14.5px] transition-colors ${
                  on ? "border-accent bg-accent-soft" : "border-transparent bg-panel-2 hover:border-line"
                }`}
              >
                <span className="grid h-[60px] place-items-center">
                  {c.id === "system" ? (
                    <svg width="22" height="28" viewBox="0 0 16 20" aria-hidden>
                      <path d="M1 1 L1 15.5 L5 11.8 L7.8 18 L10.6 16.7 L7.9 10.7 L13 10.5 Z" fill="var(--atv-text)" stroke="var(--atv-panel)" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <CursorPreview kind={c.id} size={56} />
                  )}
                </span>
                {c.label}
              </button>
            );
          })}
          {props.customCursors.map((c) => {
            const on = look.cursor === `custom:${c.id}`;
            return (
              <div key={c.id} className="group relative">
                <button
                  onClick={() => props.onLook({ ...look, cursor: `custom:${c.id}` })}
                  className={`flex w-full flex-col items-center gap-2 rounded-2xl border-2 p-4 text-[14.5px] transition-colors ${
                    on ? "border-accent bg-accent-soft" : "border-transparent bg-panel-2 hover:border-line"
                  }`}
                >
                  <span className="grid h-[60px] place-items-center">
                    <CursorPreview image={props.cursorImages[c.id]} size={56} />
                  </span>
                  <span className="w-full truncate">{c.name}</span>
                </button>
                <button
                  onClick={() => removeCursor(c.id)}
                  title={t("Quitar este personaje")}
                  className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-panel opacity-0 shadow-soft group-hover:opacity-100 hover:text-accent"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => file.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line p-4 text-[14.5px] text-muted hover:border-accent hover:text-accent"
          >
            <span className="grid h-[60px] place-items-center">
              <ImagePlus size={26} />
            </span>
            {t("Añadir personaje")}
          </button>
          <input
            ref={file}
            type="file"
            accept="image/gif,image/png,image/apng,image/webp"
            className="hidden"
            onChange={(e) => {
              addCursor(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <p className="mt-3 text-[13.5px] text-muted">
          {t("Añade el personaje que quieras con un GIF, APNG o WebP animado (fondo transparente, máx. 10 MB). Se guarda solo en este equipo.")}
        </p>
        {cursorError && <p className="mt-1 text-[13.5px] text-amber-500">{cursorError}</p>}
        <div className={`mt-5 flex items-center gap-3 ${look.cursor === "system" ? "pointer-events-none opacity-40" : ""}`}>
          <span className="text-[14px] text-muted">{t("Tamaño")}</span>
          <div className="flex w-fit gap-1 rounded-full bg-panel-2/60 p-1">
            {(["s", "m", "l", "xl"] as const).map((z) => (
              <button
                key={z}
                onClick={() => props.onLook({ ...look, cursorSize: z })}
                className={`h-9 rounded-full px-4 text-[14.5px] ${look.cursorSize === z ? "bg-accent text-white" : "hover:bg-panel-2"}`}
              >
                {z === "s" ? t("Pequeño") : z === "m" ? t("Mediano") : z === "l" ? t("Grande") : "×2"}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card
        id="discord"
        title="Discord"
        text={t("Mientras navegas, tu perfil muestra el logo de Anime TV; al ver un episodio cambia a la portada de la serie y «Viendo …». Necesita Discord abierto en este equipo; no hace falta añadir la app a Juegos registrados.")}
      >
        <label className="flex items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={d.enabled}
            onChange={(e) => props.onDiscord({ ...d, enabled: e.target.checked })}
            className="size-5 accent-[var(--atv-accent)]"
          />
          {t("Compartir lo que veo en Discord")}
        </label>

        <div className="mt-5 flex items-center gap-4">
          <p className="flex-1 text-[14.5px]">
            {t("Estado:")}{" "}
            <span className={props.status === "on" ? "text-emerald-500" : props.status === "error" ? "text-amber-500" : "text-muted"}>
              {STATUS[props.status]}
            </span>
            {props.error && <span className="block text-[13px] text-muted">{t("{error}. Se reintenta solo cada 30 s.", { error: props.error })}</span>}
            {!inTauri && <span className="block text-[13px] text-muted">{t("Solo disponible en la app de escritorio.")}</span>}
          </p>
          {props.status === "on" ? (
            <button onClick={props.onDisconnect} className="h-11 shrink-0 rounded-full bg-panel-2 px-6 text-[15px] hover:text-accent">
              {t("Desconectar")}
            </button>
          ) : (
            <button
              onClick={props.onConnect}
              disabled={props.status === "connecting" || !inTauri}
              className="h-11 shrink-0 rounded-full bg-accent px-6 text-[15px] font-medium text-white disabled:opacity-50"
            >
              {t("Conectar")}
            </button>
          )}
        </div>
        <details className="mt-5 text-[14px] text-muted">
          <summary className="cursor-pointer hover:text-text">{t("Avanzado: usar mi propia aplicación de Discord")}</summary>
          <p className="mt-2">
            {t("Por defecto se usa la aplicación «Anime TV». Si creas la tuya en")}{" "}
            <span className="text-text select-all">discord.com/developers/applications</span>{" "}
            {t("(su nombre e icono son los que se ven en tu perfil), pega aquí su Application ID y pulsa Conectar.")}
          </p>
          <input
            value={d.clientId}
            onChange={(e) => props.onDiscord({ ...d, clientId: e.target.value.replace(/\D/g, "") })}
            placeholder={`${DEFAULT_CLIENT_ID} (Anime TV)`}
            inputMode="numeric"
            className="mt-3 h-11 w-full rounded-2xl border border-line bg-panel-2 px-4 text-[15px] text-text outline-none focus:border-accent"
          />
        </details>
      </Card>

      <Card
        id="languages"
        title={t("Idiomas preferidos")}
        text={t("Al elegir un episodio, primero se muestran los releases en estos idiomas, en este orden.")}
      >
        <LanguagePrefs prefs={props.prefs} onChange={props.onPrefs} />
      </Card>

      <Card
        id="sources"
        title={t("Fuentes")}
        text={t("Indexadores Torznab (Prowlarr, Jackett) o feeds RSS donde la app busca los episodios. Se guardan solo en este equipo.")}
      >
        <SourcesList sources={props.sources} onChange={props.onSources} />
      </Card>

      <Card title={t("Acerca de")}>
        <p className="text-[14.5px] text-muted">
          Anime TV {__APP_VERSION__} · {t("catálogo e imágenes de AniList. La app no aloja ni distribuye contenido.")}
        </p>
      </Card>
    </div>
  );
}
