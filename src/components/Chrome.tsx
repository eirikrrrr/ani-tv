// App chrome: top bar (search, categories, theme, Discord), sidebar with
// "continue watching", and the floating dock used on narrow windows.

import {
  Compass, Download, Heart, Home, Moon, Play, Search, Settings, Sun, Tv,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DiscordStatus } from "../discord";
import type { Progress, Theme } from "../store";

export type ViewKind = "home" | "explore" | "favorites" | "downloads" | "settings" | "detail";

export function Logo() {
  return (
    <div className="flex items-center gap-2 select-none">
      <span className="grid size-8 place-items-center rounded-xl bg-accent text-white">
        <Tv size={17} strokeWidth={2.4} />
      </span>
      <span className="text-[17px] font-bold tracking-tight">
        ANIME<span className="text-accent">TV</span>
      </span>
    </div>
  );
}

function DiscordGlyph({ size = 16 }: { size?: number }) {
  // simplified controller-shaped mark, not Discord's logo
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7.5 5.5c1.4-.6 2.9-1 4.5-1s3.1.4 4.5 1c1.9 2.6 2.9 5.6 3 9-1.4 1.3-3 2.2-4.8 2.8l-.9-1.6c-1.1.3-1.8.4-1.8.4s-.7-.1-1.8-.4l-.9 1.6C7.5 16.7 5.9 15.8 4.5 14.5c.1-3.4 1.1-6.4 3-9Zm1.9 7.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Zm5.2 0a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" />
    </svg>
  );
}

const STATUS_TEXT: Record<DiscordStatus, string> = {
  off: "Conectar Discord",
  connecting: "Conectando…",
  on: "Discord",
  error: "Discord sin conexión",
};

export function TopBar(props: {
  query: string;
  onQuery: (q: string) => void;
  categories: { id: string; label: string }[];
  active: string | null;
  onCategory: (id: string) => void;
  onMore: () => void;
  theme: Theme;
  onTheme: () => void;
  discord: DiscordStatus;
  onDiscord: () => void;
}) {
  const dot =
    props.discord === "on" ? "bg-emerald-500" : props.discord === "error" ? "bg-amber-500" : "bg-muted";
  return (
    <header className="flex items-center gap-3">
      <label className="flex h-12 w-full max-w-[270px] shrink-0 items-center gap-2.5 rounded-full bg-panel px-4 shadow-soft max-md:max-w-none max-md:flex-1">
        <Search size={18} className="text-muted" />
        <input
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder="Buscar anime"
          className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted"
        />
      </label>

      <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto max-md:hidden">
        {props.categories.map((c) => (
          <button
            key={c.id}
            onClick={() => props.onCategory(c.id)}
            className={`h-11 shrink-0 rounded-full px-5 text-[15px] font-medium transition-colors ${
              props.active === c.id ? "bg-accent text-white" : "hover:bg-panel"
            }`}
          >
            {c.label}
          </button>
        ))}
        <button onClick={props.onMore} className="h-11 shrink-0 rounded-full px-5 text-[15px] font-medium hover:bg-panel">
          Más
        </button>
      </nav>

      <button
        onClick={props.onTheme}
        title={props.theme === "dark" ? "Tema claro" : "Tema oscuro"}
        className="grid size-12 shrink-0 place-items-center rounded-full bg-panel shadow-soft hover:text-accent"
      >
        {props.theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
      </button>
      <button
        onClick={props.onDiscord}
        className="flex h-12 shrink-0 items-center gap-2.5 rounded-full bg-panel pr-5 pl-2 shadow-soft hover:text-accent max-sm:pr-2"
      >
        <span className="grid size-8 place-items-center rounded-full bg-[#5865f2] text-white">
          <DiscordGlyph />
        </span>
        <span className="text-[15px] font-medium max-sm:hidden">{STATUS_TEXT[props.discord]}</span>
        <span className={`size-2 rounded-full ${dot} max-sm:hidden`} />
      </button>
    </header>
  );
}

const NAV: { kind: ViewKind; label: string; icon: ReactNode }[] = [
  { kind: "home", label: "Inicio", icon: <Home size={19} /> },
  { kind: "explore", label: "Explorar", icon: <Compass size={19} /> },
  { kind: "favorites", label: "Favoritos", icon: <Heart size={19} /> },
];
const NAV2: { kind: ViewKind; label: string; icon: ReactNode }[] = [
  { kind: "downloads", label: "Descargas", icon: <Download size={19} /> },
  { kind: "settings", label: "Ajustes", icon: <Settings size={19} /> },
];

export function Sidebar(props: {
  view: ViewKind;
  onView: (v: ViewKind) => void;
  progress: Progress[];
  onResume: (p: Progress) => void;
  onOpen: (id: number) => void;
}) {
  const item = (n: (typeof NAV)[number]) => {
    const on = props.view === n.kind;
    return (
      <button
        key={n.kind}
        onClick={() => props.onView(n.kind)}
        className={`flex h-12 items-center gap-3.5 rounded-2xl px-4 text-[16px] transition-colors ${
          on ? "font-medium text-accent" : "hover:bg-panel-2"
        }`}
      >
        {n.icon}
        {n.label}
        {on && <span className="size-1.5 rounded-full bg-accent" />}
      </button>
    );
  };
  return (
    <aside className="flex w-[270px] shrink-0 flex-col rounded-[28px] bg-panel p-5 shadow-soft max-md:hidden">
      <div className="px-3 pt-2 pb-6">
        <Logo />
      </div>
      <nav className="flex flex-col gap-1">{NAV.map(item)}</nav>
      <div className="mx-4 my-4 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <nav className="flex flex-col gap-1">{NAV2.map(item)}</nav>

      <h3 className="mt-7 mb-3 px-3 text-[15px] font-medium">Continuar viendo</h3>
      <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-2">
        {props.progress.length === 0 && (
          <p className="px-3 text-sm text-muted">Lo que empieces a ver aparecerá aquí.</p>
        )}
        {props.progress.map((p) => (
          <div key={p.id} className="group flex items-center gap-3 rounded-2xl p-2 hover:bg-panel-2">
            <button onClick={() => props.onOpen(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <img src={p.cover} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
              <span className="min-w-0">
                <span className="block truncate text-[15px]">{p.title}</span>
                <span className="text-sm text-muted">EP {p.episode}</span>
              </span>
            </button>
            <button
              onClick={() => props.onResume(p)}
              title={`Ver episodio ${p.episode}`}
              className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-accent hover:text-white"
            >
              <Play size={15} fill="currentColor" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function Dock(props: { view: ViewKind; onView: (v: ViewKind) => void }) {
  return (
    <nav className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 gap-1.5 rounded-full bg-[#1b1b20] p-2 shadow-soft md:hidden">
      {[...NAV, ...NAV2].map((n) => (
        <button
          key={n.kind}
          onClick={() => props.onView(n.kind)}
          title={n.label}
          className={`grid size-12 place-items-center rounded-full transition-colors ${
            props.view === n.kind ? "bg-accent text-white" : "bg-white/8 text-white/85 hover:bg-white/15"
          }`}
        >
          {n.icon}
        </button>
      ))}
    </nav>
  );
}
