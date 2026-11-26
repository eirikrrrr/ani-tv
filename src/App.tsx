import { Download, Heart, SearchX } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { currentSeason, genreLabel, GENRES, list, type ListQuery, type Media } from "./anilist";
import { Dock, Sidebar, TopBar, type ViewKind } from "./components/Chrome";
import { Details, Empty, Hero, NowWatching, PosterGrid, SectionTitle, WideRow, type Now } from "./components/Media";
import { SettingsView } from "./components/Settings";
import * as discord from "./discord";
import { toSaved, useStored, type DiscordSettings, type Progress, type Saved, type Theme } from "./store";

const CATEGORIES: { id: string; label: string; badge: string; q: ListQuery }[] = [
  { id: "trending", label: "Tendencias", badge: "Tendencia ahora", q: { sort: ["TRENDING_DESC", "POPULARITY_DESC"] } },
  { id: "season", label: "Temporada", badge: "Esta temporada", q: { ...currentSeason(), sort: ["POPULARITY_DESC"] } },
  { id: "popular", label: "Populares", badge: "Lo más popular", q: { sort: ["POPULARITY_DESC"] } },
  { id: "top", label: "Mejor valoradas", badge: "Mejor valorada", q: { sort: ["SCORE_DESC"] } },
  { id: "movies", label: "Películas", badge: "Película destacada", q: { format: "MOVIE", sort: ["TRENDING_DESC", "POPULARITY_DESC"] } },
];

type View = { kind: ViewKind; id?: number };

export default function App() {
  const [theme, setTheme] = useStored<Theme>("theme", "dark");
  const [category, setCategory] = useStored("category", "trending");
  const [favorites, setFavorites] = useStored<Saved[]>("favorites", []);
  const [progress, setProgress] = useStored<Progress[]>("progress", []);
  const [dsettings, setDsettings] = useStored<DiscordSettings>("discord", { enabled: true, clientId: "" });

  const [view, setView] = useState<View>({ kind: "home" });
  const [back, setBack] = useState<View>({ kind: "home" });
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [now, setNow] = useState<Now | null>(null);
  const [dstatus, setDstatus] = useState<discord.DiscordStatus>("off");
  const [derror, setDerror] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // ---- catalogue --------------------------------------------------------
  const cat = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
  const [items, setItems] = useState<Media[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    setItems([]);
    setLoadError(null);
    list({ ...cat.q, perPage: 30 }).then(setItems, (e: Error) => setLoadError(e.message));
  }, [cat]);
  const heroItems = useMemo(() => items.filter((m) => m.banner).slice(0, 6), [items]);
  const rest = useMemo(() => items.filter((m) => !heroItems.includes(m)), [items, heroItems]);

  const [results, setResults] = useState<Media[] | null>(null);
  useEffect(() => {
    if (view.kind !== "explore") return;
    setResults(null);
    const t = setTimeout(() => {
      list({ search: query.trim() || undefined, genre: genre ?? undefined, sort: query.trim() ? ["SEARCH_MATCH"] : ["POPULARITY_DESC"], perPage: 36 })
        .then(setResults, () => setResults([]));
    }, query ? 350 : 0);
    return () => clearTimeout(t);
  }, [view.kind, query, genre]);

  // ---- navigation -------------------------------------------------------
  const go = useCallback((v: View) => {
    setView((cur) => {
      if (v.kind === "detail" && cur.kind !== "detail") setBack(cur);
      return v;
    });
    document.getElementById("main")?.scrollTo({ top: 0 });
  }, []);
  const openDetail = useCallback((id: number) => go({ kind: "detail", id }), [go]);

  const onQuery = (q: string) => {
    setQuery(q);
    if (view.kind !== "explore") go({ kind: "explore" });
  };

  // ---- favourites & progress -------------------------------------------
  const isFavorite = (id: number) => favorites.some((f) => f.id === id);
  const toggleFavorite = (m: Media) =>
    setFavorites((fs) => (fs.some((f) => f.id === m.id) ? fs.filter((f) => f.id !== m.id) : [toSaved(m), ...fs]));
  const progressOf = (id: number) => progress.find((p) => p.id === id);

  // ---- Discord ----------------------------------------------------------
  const connectDiscord = useCallback(async () => {
    if (!dsettings.clientId) return;
    setDstatus("connecting");
    setDerror(null);
    try {
      await discord.connect(dsettings.clientId);
      setDstatus("on");
    } catch (e) {
      setDstatus("error");
      setDerror((e as Error).message);
    }
  }, [dsettings.clientId]);

  // connect on start when the user already set it up
  useEffect(() => {
    if (discord.inTauri && dsettings.enabled && dsettings.clientId) connectDiscord();
  }, []);

  // keep the Discord status in sync with what is being watched
  useEffect(() => {
    if (!discord.inTauri || dstatus !== "on") return;
    if (!now || !dsettings.enabled) {
      discord.clearPresence();
      return;
    }
    discord
      .setPresence({
        title: now.media.title,
        episode: now.episode,
        totalEpisodes: now.media.episodes ?? undefined,
        coverUrl: now.media.cover,
        infoUrl: now.media.siteUrl,
        startedAt: now.startedAt,
      })
      .catch((e: Error) => {
        setDstatus("error");
        setDerror(e.message);
      });
  }, [now, dstatus, dsettings.enabled]);

  // ---- watching ---------------------------------------------------------
  const watch = (m: Media | Saved, episode?: number) => {
    const s: Saved = "description" in m ? toSaved(m) : m;
    const ep = episode ?? progressOf(m.id)?.episode ?? 1;
    setNow({ media: s, episode: ep, startedAt: Date.now() });
    setProgress((ps) => [{ ...s, episode: ep, updatedAt: Date.now() }, ...ps.filter((p) => p.id !== s.id)].slice(0, 30));
  };

  // ---- render -----------------------------------------------------------
  let content: ReactNode;
  switch (view.kind) {
    case "home":
      content = loadError ? (
        <Empty title="No se pudo cargar el catálogo" text={`${loadError}. Revisa tu conexión a internet.`} />
      ) : (
        <>
          <Hero
            items={heroItems}
            badge={cat.badge}
            isFavorite={isFavorite}
            onWatch={(m) => watch(m)}
            onOpen={openDetail}
            onFavorite={toggleFavorite}
          />
          <SectionTitle title="Te puede gustar" action="Ver todo" onAction={() => go({ kind: "explore" })} />
          <WideRow items={rest.slice(0, 9)} onOpen={openDetail} onWatch={(m) => watch(m)} />
          <SectionTitle title={`Más en ${cat.label.toLowerCase()}`} />
          <PosterGrid items={rest.slice(9)} onOpen={openDetail} loading={items.length === 0} />
        </>
      );
      break;
    case "explore":
      content = (
        <div className="fade-in">
          <h1 className="text-[26px] font-medium">{query.trim() ? `Resultados para «${query.trim()}»` : "Explorar"}</h1>
          <div className="no-scrollbar mt-4 mb-6 flex gap-2 overflow-x-auto">
            {[null, ...GENRES].map((g) => (
              <button
                key={g ?? "all"}
                onClick={() => setGenre(g)}
                className={`h-10 shrink-0 rounded-full px-4 text-[14.5px] ${
                  genre === g ? "bg-accent text-white" : "bg-panel hover:bg-panel-2"
                }`}
              >
                {g ? genreLabel(g) : "Todos"}
              </button>
            ))}
          </div>
          {results && results.length === 0 ? (
            <Empty icon={<SearchX size={24} />} title="Sin resultados" text="Prueba con otro nombre (en inglés o en romaji) o quita el filtro de género." />
          ) : (
            <PosterGrid items={results ?? []} onOpen={openDetail} loading={results === null} />
          )}
        </div>
      );
      break;
    case "favorites":
      content = (
        <div className="fade-in">
          <h1 className="mb-6 text-[26px] font-medium">Favoritos</h1>
          {favorites.length === 0 ? (
            <Empty icon={<Heart size={24} />} title="Aún no tienes favoritos" text="Pulsa el corazón en una serie para guardarla aquí." />
          ) : (
            <PosterGrid items={favorites} onOpen={openDetail} />
          )}
        </div>
      );
      break;
    case "downloads":
      content = (
        <div className="fade-in">
          <h1 className="mb-6 text-[26px] font-medium">Descargas</h1>
          <Empty
            icon={<Download size={24} />}
            title="Streaming y descargas: fase 2"
            text="Aquí verás los episodios que se están descargando o que ya tienes en el equipo. Primero hay que añadir fuentes en Ajustes."
          />
        </div>
      );
      break;
    case "settings":
      content = (
        <SettingsView
          theme={theme}
          onTheme={setTheme}
          discord={dsettings}
          onDiscord={setDsettings}
          status={dstatus}
          error={derror}
          onConnect={connectDiscord}
          onDisconnect={() => {
            discord.disconnect();
            setDstatus("off");
          }}
        />
      );
      break;
    case "detail": {
      const p = progressOf(view.id!);
      content = (
        <Details
          id={view.id!}
          watchedUpTo={p?.episode ?? 0}
          current={now && now.media.id === view.id ? now.episode : null}
          isFavorite={isFavorite(view.id!)}
          onBack={() => go(back)}
          onWatch={(m, ep) => watch(m, ep)}
          onFavorite={toggleFavorite}
        />
      );
      break;
    }
  }

  const playing = now;
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <TopBar
        query={query}
        onQuery={onQuery}
        categories={CATEGORIES}
        active={view.kind === "home" ? category : null}
        onCategory={(id) => {
          setCategory(id);
          go({ kind: "home" });
        }}
        onMore={() => go({ kind: "explore" })}
        theme={theme}
        onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        discord={dstatus}
        onDiscord={() => go({ kind: "settings" })}
      />
      <div className="flex min-h-0 flex-1 gap-5">
        <Sidebar
          view={view.kind}
          onView={(k) => go({ kind: k })}
          progress={progress.slice(0, 8)}
          onResume={(p) => watch(p, p.episode)}
          onOpen={openDetail}
        />
        <main id="main" className="min-w-0 flex-1 overflow-y-auto pr-1 max-md:pb-24">
          {content}
          {playing && (
            <NowWatching
              now={playing}
              discord={dsettings.enabled ? dstatus : "off"}
              onOpen={openDetail}
              onEpisode={(ep) => watch(playing.media, ep)}
              onStop={() => setNow(null)}
            />
          )}
        </main>
      </div>
      <Dock view={view.kind} onView={(k) => go({ kind: k })} />
    </div>
  );
}
