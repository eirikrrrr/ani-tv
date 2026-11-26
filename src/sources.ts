// Sources (Torznab / RSS) and release search, backed by the Rust core
// (core/src/sources.rs + rank.rs) through Tauri commands.

import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./discord";

export type Lang = "ja" | "en" | "es" | "es-419" | "pt-BR" | "fr" | "de" | "it" | "multi";
export type Track = "audio" | "subs";

export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: "es", label: "Español", short: "ES" },
  { id: "es-419", label: "Español latino", short: "LAT" },
  { id: "en", label: "Inglés", short: "EN" },
  { id: "ja", label: "Japonés", short: "JA" },
  { id: "pt-BR", label: "Portugués (Brasil)", short: "PT" },
  { id: "fr", label: "Francés", short: "FR" },
  { id: "de", label: "Alemán", short: "DE" },
  { id: "it", label: "Italiano", short: "IT" },
  { id: "multi", label: "Varios (multi-sub)", short: "MULTI" },
];
export const langLabel = (l: Lang) => LANGS.find((x) => x.id === l)?.label ?? l;
export const langShort = (l: Lang) => LANGS.find((x) => x.id === l)?.short ?? l.toUpperCase();

export type LangPref = { lang: Lang; track: Track };
export type Prefs = { languages: LangPref[]; resolution: number | null; batches: boolean };

export const DEFAULT_PREFS: Prefs = {
  languages: [
    { lang: "es", track: "subs" },
    { lang: "en", track: "subs" },
  ],
  resolution: 1080,
  batches: true,
};

export type Source = {
  id: string;
  name: string;
  enabled: boolean;
  kind: "torznab" | "rss" | "stremio";
  url: string;
  apiKey?: string;
  categories?: string;
  defaultSubs?: Lang | null;
  /** stremio addons: what the stream resource accepts, and its logo */
  types?: string[];
  idPrefixes?: string[] | null;
  logo?: string | null;
  version?: string;
};

export type Parsed = {
  group: string | null;
  title: string;
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  batch: boolean;
  version: number | null;
  resolution: number | null;
  codec: string | null;
  audio: Lang[];
  subs: Lang[];
  raw: boolean;
};

export type Ranked = {
  source: string;
  title: string;
  magnet: string | null;
  torrentUrl: string | null;
  infoHash: string | null;
  size: number | null;
  seeders: number | null;
  leechers: number | null;
  published: string | null;
  infoUrl: string | null;
  fileIdx: number | null;
  url: string | null;
  exact: boolean;
  parsed: Parsed;
  score: number;
  languageMatch: number | null;
};

export type SearchResult = {
  results: Ranked[];
  errors: { source: string; name: string; error: string }[];
  total: number;
};

export type Wanted = {
  titles: string[];
  episode: number | null;
  season: number | null;
  /** for addons, which look series up by id */
  anilistId: number;
  movie: boolean;
};

const msg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

export async function search(sources: Source[], wanted: Wanted, prefs: Prefs): Promise<SearchResult> {
  if (!inTauri) throw new Error("La búsqueda en fuentes solo funciona en la app de escritorio");
  try {
    return await invoke<SearchResult>("sources_search", { sources, wanted, prefs });
  } catch (e) {
    throw new Error(msg(e));
  }
}

export async function testSource(source: Source): Promise<string> {
  if (!inTauri) throw new Error("Solo en la app de escritorio");
  try {
    return await invoke<string>("source_test", { source });
  } catch (e) {
    throw new Error(msg(e));
  }
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 1 ? 1 : 0)} ${u[i]}`;
}

export const newId = () => Math.random().toString(36).slice(2, 10);

// ---- Stremio addons ---------------------------------------------------

export type AddonResource = string | { name: string; types?: string[]; idPrefixes?: string[] };

export type Manifest = {
  id: string;
  version: string;
  name: string;
  description?: string | null;
  logo?: string | null;
  background?: string | null;
  types: string[];
  resources: AddonResource[];
  idPrefixes?: string[] | null;
  behaviorHints: { adult: boolean; p2p: boolean; configurable: boolean; configurationRequired: boolean };
};

export type StreamSupport = { types: string[]; idPrefixes: string[] | null };

/** An addon as shown in the store / install dialog. */
export type AddonInfo = { url: string; manifest: Manifest; streams: StreamSupport | null };

export type Catalog = { id: string; name: string; url: string };

export const DEFAULT_CATALOGS: Catalog[] = [
  { id: "stremio", name: "Stremio (oficial)", url: "https://api.strem.io/addonscollection.json" },
];

export async function addonManifest(url: string): Promise<AddonInfo> {
  if (!inTauri) throw new Error("Solo en la app de escritorio");
  try {
    return await invoke<AddonInfo>("addon_manifest", { url });
  } catch (e) {
    throw new Error(msg(e));
  }
}

export async function addonCatalog(url: string): Promise<AddonInfo[]> {
  if (!inTauri) throw new Error("Solo en la app de escritorio");
  try {
    return await invoke<AddonInfo[]>("addon_catalog", { url });
  } catch (e) {
    throw new Error(msg(e));
  }
}

export const resourceName = (r: AddonResource) => (typeof r === "string" ? r : r.name);

/** Stremio addon → a source for the picker. */
export function addonSource(a: AddonInfo): Source {
  return {
    id: `addon:${a.manifest.id}`,
    name: a.manifest.name,
    enabled: true,
    kind: "stremio",
    url: a.url,
    types: a.streams?.types ?? [],
    idPrefixes: a.streams?.idPrefixes ?? null,
    logo: a.manifest.logo ?? null,
    version: a.manifest.version,
  };
}
