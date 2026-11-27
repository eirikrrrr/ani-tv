import { Heart, SearchX } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { currentSeason, genreLabel, GENRES, list, type ListQuery, type Media } from "./anilist";
import { Dock, Sidebar, TopBar, type ViewKind } from "./components/Chrome";
import { Details, Empty, Hero, NowWatching, PosterGrid, Reveal, SectionTitle, WideRow, type Now } from "./components/Media";
import { AddonsView } from "./components/Addons";
import { AnimeCursor, type CursorKind, type CustomCursor } from "./components/Cursor";
import { useCursorImages } from "./cursorStore";
import { Picker, type PickTarget } from "./components/Picker";
import { PlayerSession } from "./components/Player";
import { DownloadsView } from "./components/Downloads";
import { NotesView } from "./components/NotesView";
import * as player from "./player";
import { DEFAULT_DOWNLOADS, normalizeDownloads, type DownloadSettings } from "./player";
import { useSeeding } from "./seeding";
import { SettingsView } from "./components/Settings";
import * as discord from "./discord";
import { DEFAULT_CATALOGS, DEFAULT_PREFS, type Catalog, type Prefs, type Ranked, type Source } from "./sources";
import { DEFAULT_LOOK, toSaved, useStored, type DiscordSettings, type Look, type Progress, type Saved, type Theme } from "./store";
import { t } from "./i18n";

const CATEGORIES: { id: string; label: string; badge: string; q: ListQuery }[] = [
  { id: "trending", label: t("Tendencias"), badge: t("Tendencia ahora"), q: { sort: ["TRENDING_DESC", "POPULARITY_DESC"] } },
  { id: "season", label: t("Temporada"), badge: t("Esta temporada"), q: { ...currentSeason(), sort: ["POPULARITY_DESC"] } },
  { id: "popular", label: t("Populares"), badge: t("Lo más popular"), q: { sort: ["POPULARITY_DESC"] } },
  { id: "top", label: t("Mejor valoradas"), badge: t("Mejor valorada"), q: { sort: ["SCORE_DESC"] } },
  { id: "movies", label: t("Películas"), badge: t("Película destacada"), q: { format: "MOVIE", sort: ["TRENDING_DESC", "POPULARITY_DESC"] } },
];

type View = { kind: ViewKind; id?: number };

export default function App() {
  const [theme, setTheme] = useStored<Theme>("theme", "dark");
  const [category, setCategory] = useStored("category", "trending");
  const [favorites, setFavorites] = useStored<Saved[]>("favorites", []);
  const [progress, setProgress] = useStored<Progress[]>("progress", []);
  const [dsettings, setDsettings] = useStored<DiscordSettings>("discord", { enabled: true, clientId: "" });
  const [sources, setSources] = useStored<Source[]>("sources", []);
  const [prefs, setPrefs] = useStored<Prefs>("prefs", DEFAULT_PREFS);
  const [catalogs, setCatalogs] = useStored<Catalog[]>("catalogs", DEFAULT_CATALOGS);
  const [look, setLook] = useStored<Look>("look", DEFAULT_LOOK);
  const [customCursors, setCustomCursors] = useStored<CustomCursor[]>("cursors", []);
  const cursorImages = useCursorImages(customCursors);
  const cursorImage = look.cursor.startsWith("custom:") ? cursorImages[look.cursor.slice(7)] ?? null : null;
  const [pick, setPick] = useState<PickTarget | null>(null);
  const [storedDownloads, setDownloads] = useStored<DownloadSettings>("downloads", DEFAULT_DOWNLOADS);
  const downloads = useMemo(() => normalizeDownloads(storedDownloads), [storedDownloads]);
  const seeding = useSeeding(downloads);
  const [session, setSession] = useState<{ target: PickTarget; release: Ranked; key: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
  useEffect(() => {
    document.documentElement.dataset.fx = look.effects ? "on" : "off";
  }, [look.effects]);

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
    const clientId = dsettings.clientId || discord.DEFAULT_CLIENT_ID;
    setDstatus("connecting");
    setDerror(null);
    try {
      await discord.connect(clientId);
      setDstatus("on");
    } catch (e) {
      setDstatus("error");
      setDerror((e as Error).message);
    }
  }, [dsettings.clientId]);

  // connect on start when the user already set it up
  useEffect(() => {
    if (discord.inTauri && dsettings.enabled) connectDiscord();
  }, []);

  // Discord may be opened after the app: retry every 30 s while it is enabled
  useEffect(() => {
    if (!discord.inTauri || !dsettings.enabled || dstatus !== "error") return;
    const t = setInterval(connectDiscord, 30_000);
    return () => clearInterval(t);
  }, [dstatus, dsettings.enabled, connectDiscord]);

  // keep the Discord status in sync: the app logo while browsing, the
  // series cover and "Watching <series>" while watching
  useEffect(() => {
    if (!discord.inTauri || dstatus !== "on") return;
    if (!dsettings.enabled) {
      discord.clearPresence();
      return;
    }
    const fail = (e: Error) => {
      setDstatus("error");
      setDerror(e.message);
    };
    if (!now) {
      discord
        .setIdle({ text: t("Explorando el catálogo"), logoUrl: discord.LOGO_URL, startedAt: discord.OPENED_AT, appUrl: discord.APP_URL, buttonText: t("Descargar Anime TV") })
        .catch(fail);
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
        logoUrl: discord.LOGO_URL,
        episodeText: now.media.episodes
          ? t("Episodio {n} de {total}", { n: now.episode, total: now.media.episodes })
          : t("Episodio {n}", { n: now.episode }),
        buttonText: t("Ver la serie"),
      })
      .catch(fail);
  }, [now, dstatus, dsettings.enabled]);

  // ---- watching ---------------------------------------------------------
  const watch = (m: Media | Saved, episode?: number) => {
    const s: Saved = "description" in m ? toSaved(m) : m;
    const ep = episode ?? progressOf(m.id)?.episode ?? 1;
    setNow({ media: s, episode: ep, startedAt: Date.now() });
    setProgress((ps) => [{ ...s, episode: ep, updatedAt: Date.now() }, ...ps.filter((p) => p.id !== s.id)].slice(0, 30));
  };

  // every "watch" goes through the release picker for that episode
  const choose = (m: Media | Saved, episode?: number, start?: number | null) => {
    const s: Saved = "description" in m ? toSaved(m) : m;
    setPick({ media: s, episode: episode ?? progressOf(m.id)?.episode ?? 1, start: start ?? null });
  };
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  // a release chosen → play it (torrent + mpv); no release → just mark it
  const onPicked = (r: Ranked | null) => {
    if (!pick) return;
    if (r) {
      setSession({ target: pick, release: r, key: Date.now() });
    } else {
      watch(pick.media, pick.episode);
      notify(t("Episodio marcado como «viendo»"));
    }
    setPick(null);
  };

  // speed limits follow what is happening: watching or only sharing
  const watching = !!session;
  useEffect(() => {
    player.limits(downloads.downloadKib, watching ? downloads.uploadKib : downloads.seed.uploadKib);
  }, [watching, downloads.downloadKib, downloads.uploadKib, downloads.seed.uploadKib]);

  // ---- render -----------------------------------------------------------
  let content: ReactNode;
  switch (view.kind) {
    case "home":
      content = loadError ? (
        <Empty title={t("No se pudo cargar el catálogo")} text={t("{error}. Revisa tu conexión a internet.", { error: loadError })} />
      ) : (
        <>
          <Hero
            items={heroItems}
            badge={cat.badge}
            isFavorite={isFavorite}
            onWatch={(m) => choose(m)}
            onOpen={openDetail}
            onFavorite={toggleFavorite}
          />
          <Reveal>
            <SectionTitle title={t("Te puede gustar")} action={t("Ver todo")} onAction={() => go({ kind: "explore" })} />
            <WideRow items={rest.slice(0, 9)} onOpen={openDetail} onWatch={(m) => choose(m)} />
          </Reveal>
          <Reveal>
            <SectionTitle title={t("Más en {category}", { category: cat.label.toLowerCase() })} />
            <PosterGrid items={rest.slice(9)} onOpen={openDetail} loading={items.length === 0} />
          </Reveal>
        </>
      );
      break;
    case "explore":
      content = (
        <div className="fade-in">
          <h1 className="text-[26px] font-medium">{query.trim() ? t("Resultados para «{q}»", { q: query.trim() }) : t("Explorar")}</h1>
          <div className="no-scrollbar mt-4 mb-6 flex gap-2 overflow-x-auto">
            {[null, ...GENRES].map((g) => (
              <button
                key={g ?? "all"}
                onClick={() => setGenre(g)}
                className={`h-10 shrink-0 rounded-full px-4 text-[14.5px] ${
                  genre === g ? "bg-accent text-white" : "bg-panel hover:bg-panel-2"
                }`}
              >
                {g ? genreLabel(g) : t("Todos")}
              </button>
            ))}
          </div>
          {results && results.length === 0 ? (
            <Empty icon={<SearchX size={24} />} title={t("Sin resultados")} text={t("Prueba con otro nombre (en inglés o en romaji) o quita el filtro de género.")} />
          ) : (
            <PosterGrid items={results ?? []} onOpen={openDetail} loading={results === null} />
          )}
        </div>
      );
      break;
    case "favorites":
      content = (
        <div className="fade-in">
          <h1 className="mb-6 text-[26px] font-medium">{t("Favoritos")}</h1>
          {favorites.length === 0 ? (
            <Empty icon={<Heart size={24} />} title={t("Aún no tienes favoritos")} text={t("Pulsa el corazón en una serie para guardarla aquí.")} />
          ) : (
            <PosterGrid items={favorites} onOpen={openDetail} />
          )}
        </div>
      );
      break;
    case "notes":
      content = (
        <NotesView
          notify={notify}
          onOpen={openDetail}
          onPlay={(n, time) => {
            const known = [...progress, ...favorites].find((x) => x.id === n.mediaId);
            const media: Saved = known ?? {
              id: n.mediaId, title: n.series, cover: n.cover ?? "", banner: null, episodes: null,
              siteUrl: "", year: null, format: null,
            };
            choose(media, n.episode, time);
          }}
        />
      );
      break;
    case "downloads":
      content = <DownloadsView settings={downloads} onSettings={setDownloads} seeding={seeding} />;
      break;
    case "addons":
      content = <AddonsView sources={sources} onSources={setSources} catalogs={catalogs} onCatalogs={setCatalogs} notify={notify} />;
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
          sources={sources}
          onSources={setSources}
          prefs={prefs}
          onPrefs={setPrefs}
          look={look}
          onLook={setLook}
          customCursors={customCursors}
          onCustomCursors={setCustomCursors}
          cursorImages={cursorImages}
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
          onWatch={(m, ep) => choose(m, ep)}
          onFavorite={toggleFavorite}
        />
      );
      break;
    }
  }

  const playing = now;
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="ambient" aria-hidden>
        <i />
        <i />
      </div>
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
          onResume={(p) => choose(p, p.episode)}
          onOpen={openDetail}
        />
        <main id="main" className="min-w-0 flex-1 overflow-y-auto pr-1 max-md:pb-24">
          <div key={`${view.kind}-${view.id ?? ""}`} className="view-enter">
            {content}
          </div>
          {playing && !session && (
            <NowWatching
              now={playing}
              discord={dsettings.enabled ? dstatus : "off"}
              onOpen={openDetail}
              onEpisode={(ep) => choose(playing.media, ep)}
              onStop={() => setNow(null)}
            />
          )}
        </main>
      </div>
      <Dock view={view.kind} onView={(k) => go({ kind: k })} />
      <AnimeCursor kind={look.cursor as CursorKind} size={look.cursorSize} image={cursorImage} />
      {pick && (
        <Picker
          target={pick}
          sources={sources}
          prefs={prefs}
          onClose={() => setPick(null)}
          onPlay={onPicked}
          onSettings={() => {
            setPick(null);
            go({ kind: "settings" });
            setTimeout(() => document.getElementById("sources")?.scrollIntoView({ behavior: "smooth" }), 50);
          }}
          notify={notify}
        />
      )}
      {session && (
        <PlayerSession
          key={session.key}
          target={session.target}
          release={session.release}
          downloads={downloads}
          prefs={prefs}
          onPlaying={() => watch(session.target.media, session.target.episode)}
          onNext={
            !session.target.media.episodes || session.target.episode < session.target.media.episodes
              ? () => choose(session.target.media, session.target.episode + 1)
              : null
          }
          onRepick={() => choose(session.target.media, session.target.episode)}
          onOpened={(o) => seeding.claim(o.id)}
          onRelease={(o) =>
            seeding.release({
              id: o.id,
              fileIdx: o.fileIdx,
              series: session.target.media.title,
              episode: session.target.episode,
              cover: session.target.media.cover,
            })
          }
          onEnd={() => {
            setSession(null);
            setNow(null);
          }}
        />
      )}
      {toast && (
        <div className="fade-in fixed top-20 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-invert px-5 py-3 text-[14.5px] text-invert-ink shadow-soft">
          {toast}
        </div>
      )}
    </div>
  );
}
