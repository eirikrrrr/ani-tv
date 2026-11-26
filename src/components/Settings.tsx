import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { inTauri, type DiscordStatus } from "../discord";
import type { Prefs, Source } from "../sources";
import type { DiscordSettings, Theme } from "../store";
import { LanguagePrefs, SourcesList } from "./SourcesSettings";

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
  off: "Desconectado",
  connecting: "Conectando…",
  on: "Conectado: tus amigos ven lo que estás viendo",
  error: "Sin conexión",
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
}) {
  const d = props.discord;
  const seg = (t: Theme, label: string, icon: ReactNode) => (
    <button
      onClick={() => props.onTheme(t)}
      className={`flex h-11 items-center gap-2 rounded-full px-5 text-[15px] ${
        props.theme === t ? "bg-accent text-white" : "hover:bg-panel-2"
      }`}
    >
      {icon} {label}
    </button>
  );
  return (
    <div className="fade-in flex max-w-[820px] flex-col gap-5">
      <h1 className="text-[26px] font-medium">Ajustes</h1>

      <Card title="Apariencia">
        <div className="flex w-fit gap-1 rounded-full bg-panel-2/60 p-1">
          {seg("dark", "Oscuro", <Moon size={16} />)}
          {seg("light", "Claro", <Sun size={16} />)}
        </div>
      </Card>

      <Card
        id="discord"
        title="Discord"
        text="Mientras navegas, tu perfil muestra el logo de Anime TV; al ver un episodio cambia a la portada de la serie y «Viendo …». Necesita Discord abierto en este equipo; no hace falta añadir la app a Juegos registrados."
      >
        <label className="flex items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={d.enabled}
            onChange={(e) => props.onDiscord({ ...d, enabled: e.target.checked })}
            className="size-5 accent-[var(--atv-accent)]"
          />
          Compartir lo que veo en Discord
        </label>

        <label className="mt-5 block text-[14px] text-muted">Application ID de Discord</label>
        <div className="mt-1.5 flex gap-3 max-sm:flex-col">
          <input
            value={d.clientId}
            onChange={(e) => props.onDiscord({ ...d, clientId: e.target.value.replace(/\D/g, "") })}
            placeholder="p. ej. 1234567890123456789"
            inputMode="numeric"
            className="h-12 flex-1 rounded-2xl border border-line bg-panel-2 px-4 text-[15px] outline-none focus:border-accent"
          />
          {props.status === "on" ? (
            <button onClick={props.onDisconnect} className="h-12 rounded-full bg-panel-2 px-6 text-[15px] hover:text-accent">
              Desconectar
            </button>
          ) : (
            <button
              onClick={props.onConnect}
              disabled={!d.clientId || props.status === "connecting" || !inTauri}
              className="h-12 rounded-full bg-accent px-6 text-[15px] font-medium text-white disabled:opacity-50"
            >
              Conectar
            </button>
          )}
        </div>
        <p className="mt-3 text-[14px]">
          Estado:{" "}
          <span className={props.status === "on" ? "text-emerald-500" : props.status === "error" ? "text-amber-500" : "text-muted"}>
            {STATUS[props.status]}
          </span>
          {props.error && <span className="block text-[13px] text-muted">{props.error}</span>}
          {!inTauri && <span className="block text-[13px] text-muted">Solo disponible en la app de escritorio.</span>}
        </p>
        <details className="mt-4 text-[14px] text-muted">
          <summary className="cursor-pointer hover:text-text">¿De dónde saco el Application ID?</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Entra en <span className="text-text select-all">discord.com/developers/applications</span> y pulsa{" "}
              <em>New Application</em>.
            </li>
            <li>Ponle de nombre «Anime TV» (es lo que se ve si Discord no puede mostrar la serie).</li>
            <li>Copia el <em>Application ID</em> de la pestaña General Information y pégalo aquí.</li>
          </ol>
        </details>
      </Card>

      <Card
        id="languages"
        title="Idiomas preferidos"
        text="Al elegir un episodio, primero se muestran los releases en estos idiomas, en este orden."
      >
        <LanguagePrefs prefs={props.prefs} onChange={props.onPrefs} />
      </Card>

      <Card
        id="sources"
        title="Fuentes"
        text="Indexadores Torznab (Prowlarr, Jackett) o feeds RSS donde la app busca los episodios. Se guardan solo en este equipo."
      >
        <SourcesList sources={props.sources} onChange={props.onSources} />
      </Card>

      <Card title="Acerca de">
        <p className="text-[14.5px] text-muted">
          Anime TV {__APP_VERSION__} · catálogo e imágenes de AniList. La app no aloja ni distribuye contenido.
        </p>
      </Card>
    </div>
  );
}
