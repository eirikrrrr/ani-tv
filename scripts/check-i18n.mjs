// Checks that every t("…") / tn(…, "…", "…") key in src/ has an English
// entry in src/i18n.en.ts, and lists entries no code uses any more.
//   npm run check:i18n
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "src");
const files = fs.readdirSync(root, { recursive: true }).filter((f) => /\.tsx?$/.test(f) && !/i18n(\.en)?\.ts$/.test(f));
const used = new Set();
const str = String.raw`"((?:[^"\\]|\\.)*)"`;
const reT = new RegExp(String.raw`\bt\(\s*` + str, "g");
// tn(count, "one", "many"): the count expression may contain commas
const reTn = new RegExp(String.raw`\btn\([\s\S]{0,200}?` + str + String.raw`\s*,\s*` + str + String.raw`\s*\)`, "g");
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  for (const m of src.matchAll(reT)) used.add(JSON.parse(`"${m[1]}"`));
  for (const m of src.matchAll(reTn)) {
    used.add(JSON.parse(`"${m[1]}"`));
    used.add(JSON.parse(`"${m[2]}"`));
  }
}
const enSrc = fs.readFileSync(path.join(root, "i18n.en.ts"), "utf8");
const keys = new Set([...enSrc.matchAll(/^\s+("(?:[^"\\]|\\.)*"):/gm)].map((m) => JSON.parse(m[1])));
// keys used only through variables (labels in tables, Rust error texts)
const dynamic = /^(Serie|Serie corta|Película|Especial|Música|Ruso|Árabe|Chino|Coreano|Portugués|Discord no está conectado|URL no válida)$|^[a-zé]/;
const missing = [...used].filter((k) => !keys.has(k));
const unused = [...keys].filter((k) => !used.has(k) && !dynamic.test(k));
if (missing.length) console.log(`Missing English (${missing.length}):\n  ` + missing.join("\n  "));
if (unused.length) console.log(`Unused entries (${unused.length}):\n  ` + unused.join("\n  "));
console.log(`${used.size} keys used, ${keys.size} English entries.`);
process.exit(missing.length ? 1 : 0);
