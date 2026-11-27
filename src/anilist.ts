// AniList public GraphQL API: catalogue, covers and banners. No key needed
// (rate limit ~90 requests/min), so results are cached per query.

import { lang, t } from "./i18n";

export type Media = {
  id: number;
  title: string;
  romaji: string;
  cover: string;
  color: string | null;
  banner: string | null;
  description: string;
  year: number | null;
  episodes: number | null;
  /** next episode to air (ongoing series) */
  nextEpisode: number | null;
  score: number | null;
  genres: string[];
  format: string | null;
  status: string | null;
  siteUrl: string;
};

export type ListQuery = {
  sort?: string[];
  season?: string;
  seasonYear?: number;
  genre?: string;
  format?: string;
  search?: string;
  perPage?: number;
  /** include announced series with nothing aired yet (default: only when searching) */
  includeUnreleased?: boolean;
};

const FIELDS = `id siteUrl title { romaji english userPreferred }
  coverImage { extraLarge large color } bannerImage description(asHtml: false)
  seasonYear episodes averageScore genres format status
  nextAiringEpisode { episode }`;

const LIST = `query ($perPage: Int, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int,
  $genre: String, $format: MediaFormat, $search: String, $statusNot: MediaStatus) {
  Page(page: 1, perPage: $perPage) {
    media(type: ANIME, isAdult: false, sort: $sort, season: $season, seasonYear: $seasonYear,
      genre: $genre, format: $format, search: $search, status_not: $statusNot, format_not: MUSIC) { ${FIELDS} }
  }
}`;

const ONE = `query ($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`;

type Raw = {
  id: number;
  siteUrl: string;
  title: { romaji: string; english: string | null; userPreferred: string };
  coverImage: { extraLarge: string; large: string; color: string | null };
  bannerImage: string | null;
  description: string | null;
  seasonYear: number | null;
  episodes: number | null;
  averageScore: number | null;
  genres: string[];
  format: string | null;
  status: string | null;
  nextAiringEpisode: { episode: number } | null;
};

function cleanDescription(s: string | null): string {
  if (!s) return "";
  const txt = new DOMParser().parseFromString(s.replace(/<br\s*\/?>/gi, "\n"), "text/html")
    .documentElement.textContent ?? "";
  return txt.replace(/\(Source:[^)]*\)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

function toMedia(r: Raw): Media {
  return {
    id: r.id,
    title: r.title.english || r.title.userPreferred || r.title.romaji,
    romaji: r.title.romaji,
    cover: r.coverImage.extraLarge || r.coverImage.large,
    color: r.coverImage.color,
    banner: r.bannerImage,
    description: cleanDescription(r.description),
    year: r.seasonYear,
    episodes: r.episodes,
    nextEpisode: r.nextAiringEpisode?.episode ?? null,
    score: r.averageScore,
    genres: r.genres ?? [],
    format: r.format,
    status: r.status,
    siteUrl: r.siteUrl,
  };
}

// AniList may run in a degraded mode of 30 requests/min, so answers are kept in
// memory and in localStorage for an hour (the catalogue barely changes), and a
// 429 is retried once after the wait the server asks for.
const TTL_MS = 60 * 60 * 1000;
const memory = new Map<string, Promise<unknown>>();

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `atv.al.${(h >>> 0).toString(36)}`;
}

function fromDisk<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const { at, data } = JSON.parse(raw) as { at: number; data: T };
    return Date.now() - at < TTL_MS ? data : undefined;
  } catch {
    return undefined;
  }
}

function toDisk(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* full or unavailable: memory cache still works */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(query: string, variables: Record<string, unknown>, retry = true): Promise<T> {
  let r: Response;
  try {
    r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new Error("AniList no responde");
  }
  if (r.status === 429 && retry) {
    const wait = Number(r.headers.get("Retry-After")) || 30;
    await sleep(Math.min(wait, 60) * 1000);
    return post<T>(query, variables, false);
  }
  const body = await r.json().catch(() => null);
  if (!r.ok || !body || body.errors) {
    const msg = r.status === 429 ? t("demasiadas peticiones, prueba en un minuto") : body?.errors?.[0]?.message ?? `HTTP ${r.status}`;
    throw new Error(`AniList: ${msg}`);
  }
  return body.data as T;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = hashKey(query + JSON.stringify(variables));
  const hit = memory.get(key);
  if (hit) return hit as Promise<T>;
  const disk = fromDisk<T>(key);
  if (disk !== undefined) {
    const p = Promise.resolve(disk);
    memory.set(key, p);
    return p;
  }
  const p = post<T>(query, variables).then((data) => {
    toDisk(key, data);
    return data;
  });
  memory.set(key, p);
  p.catch(() => memory.delete(key)); // don't cache failures
  return p;
}

export async function list(q: ListQuery): Promise<Media[]> {
  // unset filters are left out, not sent as null: AniList returns nothing for
  // `format: null` combined with `format_not`
  const vars: Record<string, unknown> = {
    perPage: q.perPage ?? 20,
    sort: q.sort ?? ["TRENDING_DESC"],
    season: q.season,
    seasonYear: q.seasonYear,
    genre: q.genre,
    format: q.format,
    search: q.search || undefined,
    statusNot: (q.includeUnreleased ?? !!q.search) ? undefined : "NOT_YET_RELEASED",
  };
  for (const k of Object.keys(vars)) if (vars[k] === undefined) delete vars[k];
  const data = await gql<{ Page: { media: Raw[] } }>(LIST, vars);
  return data.Page.media.map(toMedia);
}

export async function byId(id: number): Promise<Media> {
  const data = await gql<{ Media: Raw }>(ONE, { id });
  return toMedia(data.Media);
}

export function currentSeason(d = new Date()): { season: string; seasonYear: number } {
  const m = d.getMonth();
  const season = m < 3 ? "WINTER" : m < 6 ? "SPRING" : m < 9 ? "SUMMER" : "FALL";
  return { season, seasonYear: d.getFullYear() };
}

/** Episodes that can be watched: the aired ones for an ongoing series. */
export function availableEpisodes(m: Media): number {
  if (m.nextEpisode) return Math.max(m.nextEpisode - 1, 0);
  return m.episodes ?? 0;
}

const FORMAT: Record<string, string> = {
  TV: "Serie", TV_SHORT: "Serie corta", MOVIE: "Película", OVA: "OVA", ONA: "ONA",
  SPECIAL: "Especial", MUSIC: "Música",
};
export const formatLabel = (f: string | null) => (f ? (FORMAT[f] ? t(FORMAT[f]) : f) : "");

const GENRE_ES: Record<string, string> = {
  Action: "Acción", Adventure: "Aventura", Comedy: "Comedia", Drama: "Drama",
  Fantasy: "Fantasía", Horror: "Terror", Mecha: "Mecha", Music: "Música",
  Mystery: "Misterio", Psychological: "Psicológico", Romance: "Romance",
  "Sci-Fi": "Ciencia ficción", "Slice of Life": "Recuentos de la vida", Sports: "Deportes",
  Supernatural: "Sobrenatural", Thriller: "Suspenso", Ecchi: "Ecchi", "Mahou Shoujo": "Mahou Shoujo",
};
/** AniList genres are English: the Spanish name only in Spanish. */
export const genreLabel = (g: string) => (lang === "es" ? GENRE_ES[g] ?? g : g);
export const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Romance", "Sci-Fi",
  "Slice of Life", "Mystery", "Psychological", "Sports", "Supernatural", "Horror", "Mecha",
];
