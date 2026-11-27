// Interface language: Spanish (the source text) and English.
//
// `t("Texto en español")` returns the English text when the app is in
// English; the Spanish text is the key, so the code stays readable and a
// missing translation falls back to Spanish. `{name}` placeholders are
// filled from `vars`. `npm run check:i18n` checks every t("…") has an
// English entry in i18n.en.ts.
//
// The language is read once at start-up (main window and player window
// share it through localStorage); changing it reloads the window.

import { EN } from "./i18n.en";

export type UiLang = "es" | "en";
const KEY = "atv.uiLang";

function detect(): UiLang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "es";
  return nav.toLowerCase().startsWith("es") ? "es" : "en";
}

export const lang: UiLang = detect();

/** BCP-47 locale for dates and numbers. */
export const locale = lang === "en" ? "en-US" : "es-ES";

export function setLang(l: UiLang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  location.reload();
}

export function t(es: string, vars?: Record<string, string | number>): string {
  let s = lang === "en" ? (EN[es] ?? es) : es;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Singular / plural by count: tn(n, "{n} nota", "{n} notas"). */
export const tn = (n: number, one: string, many: string) => t(n === 1 ? one : many, { n });

// Messages from the Rust side arrive in Spanish; translate the known ones.
const ERR_PATTERNS: [RegExp, string][] = [
  [/^nadie comparte este torrent ahora mismo \(sin peers tras (\d+) s\); prueba otro resultado$/, "nobody is sharing this torrent right now (no peers after $1 s); try another result"],
  [/^el enlace respondió (.+)$/, "the link answered $1"],
  [/^no se pudo descargar el enlace: (.+)$/, "could not download the link: $1"],
  [/^el enlace no es un torrent \((.+)\)$/, "the link is not a torrent ($1)"],
  [/^no se pudo abrir mpv: (.+)$/, "could not open mpv: $1"],
  [/^no se pudo iniciar el motor torrent: (.+)$/, "could not start the torrent engine: $1"],
  [/^torrent (\d+) no encontrado$/, "torrent $1 not found"],
  [/^URL no válida: (.+)$/, "invalid URL: $1"],
  [/^respuesta no válida: (.+)$/, "invalid answer: $1"],
  [/^HTTP (\d+): revisa la API key$/, "HTTP $1: check the API key"],
  [/^Discord no está abierto o no responde \((.+)\)$/, "Discord is not open or not answering ($1)"],
  [/^Discord rechazó la actualización \((.+)\)$/, "Discord rejected the update ($1)"],
];

export function tErr(msg: string): string {
  if (lang === "es") return msg;
  // several sources' errors joined with " · "
  return msg
    .split(" · ")
    .map((part) => {
      if (EN[part]) return EN[part];
      for (const [re, en] of ERR_PATTERNS) if (re.test(part)) return part.replace(re, en);
      return part;
    })
    .join(" · ");
}
