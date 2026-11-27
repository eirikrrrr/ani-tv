// Addons: a store fed by addon catalogues (Stremio's format), install by URL
// or stremio:// link, and an info dialog with one-click install.

import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ExternalLink, Link2, Plus, Puzzle, Search, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { inTauri } from "../discord";
import {
  addonCatalog, addonManifest, addonSource, newId, resourceName, type AddonInfo, type Catalog, type Source,
} from "../sources";
import { t, tErr } from "../i18n";

const RESOURCE_LABEL: Record<string, string> = {
  stream: "Streams",
  catalog: t("Catálogos"),
  meta: t("Metadatos"),
  subtitles: t("Subtítulos"),
  addon_catalog: t("Catálogo de addons"),
};
const TYPE_LABEL: Record<string, string> = { series: t("Series"), movie: t("Películas"), anime: "Anime", channel: t("Canales"), tv: "TV", other: t("Otros") };

function Logo(props: { src?: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  if (!props.src || broken)
    return (
      <span className="grid shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent" style={{ width: props.size, height: props.size }}>
        <Puzzle size={props.size * 0.45} />
      </span>
    );
  return (
    <img
      src={props.src}
      alt=""
      onError={() => setBroken(true)}
      className="shrink-0 rounded-2xl bg-panel-2 object-contain p-1"
      style={{ width: props.size, height: props.size }}
    />
  );
}

function Chip(props: { children: ReactNode; strong?: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[12.5px] ${props.strong ? "bg-accent text-white" : "bg-panel-2 text-muted"}`}>
      {props.children}
    </span>
  );
}

/** The install dialog: what the addon is and does, and one click to add it. */
export function AddonModal(props: {
  addon: AddonInfo;
  installed: boolean;
  onInstall: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { manifest: m, streams } = props.addon;
  const hints = m.behaviorHints ?? { p2p: false, configurable: false, configurationRequired: false, adult: false };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  const configure = () => openUrl(`${props.addon.url}/configure`).catch(() => {});
  const resources = [...new Set(m.resources.map(resourceName))];

  // portal: the view's entry animation makes its container the reference box
  // for fixed elements, which would trap the dialog inside the content area
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={props.onClose}>
      <div onClick={(e) => e.stopPropagation()} className="fade-in w-full max-w-[620px] overflow-hidden rounded-[28px] bg-panel shadow-soft">
        <div className="relative h-36 bg-gradient-to-br from-accent/60 to-black">
          {m.background && <img src={m.background} alt="" className="absolute inset-0 size-full object-cover opacity-60" />}
          <div className="absolute inset-0 bg-gradient-to-t from-panel to-transparent" />
          <button onClick={props.onClose} title={t("Cerrar")} className="absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60">
            <X size={19} />
          </button>
        </div>
        <div className="-mt-14 px-7 pb-7">
          <div className="relative flex items-end gap-4">
            <span className="rounded-3xl bg-panel p-1.5 shadow-soft">
              <Logo src={m.logo} size={84} />
            </span>
            <div className="min-w-0 pb-1">
              <h2 className="truncate text-[24px] leading-tight font-semibold">{m.name}</h2>
              <p className="text-[13.5px] text-muted">
                v{m.version} · {m.id}
              </p>
            </div>
          </div>

          {m.description && <p className="mt-5 max-h-36 overflow-y-auto text-[14.5px] leading-relaxed whitespace-pre-line text-muted">{m.description}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            {resources.map((r) => (
              <Chip key={r} strong={r === "stream"}>
                {RESOURCE_LABEL[r] ?? r}
              </Chip>
            ))}
            {m.types.map((t) => (
              <Chip key={t}>{TYPE_LABEL[t] ?? t}</Chip>
            ))}
            {hints.p2p && <Chip>P2P (torrent)</Chip>}
          </div>

          {!streams && (
            <p className="mt-5 rounded-2xl bg-panel-2 px-4 py-3 text-[14px] text-muted">
              {t("Este addon no ofrece streams. Por ahora Anime TV usa los addons para encontrar episodios, así que no aportaría nada.")}
            </p>
          )}
          {hints.configurationRequired && (
            <p className="mt-5 rounded-2xl bg-amber-500/10 px-4 py-3 text-[14px] text-amber-500">
              {t("Necesita configurarse antes de instalarlo: pulsa «Configurar», elige las opciones en la página del addon y pega aquí la URL de instalación que te dé.")}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            {hints.configurable && (
              <button onClick={configure} className="flex h-12 items-center gap-2 rounded-full bg-panel-2 px-5 text-[15px] hover:text-accent">
                <Settings2 size={17} /> {t("Configurar")} <ExternalLink size={14} />
              </button>
            )}
            {props.installed ? (
              <button onClick={props.onRemove} className="flex h-12 items-center gap-2 rounded-full bg-panel-2 px-6 text-[15px] hover:text-accent">
                <Trash2 size={17} /> {t("Desinstalar")}
              </button>
            ) : (
              <button
                onClick={props.onInstall}
                disabled={!streams || hints.configurationRequired}
                className="flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-[15px] font-medium text-white disabled:opacity-40"
              >
                <Plus size={18} /> {t("Instalar")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AddonCard(props: { a: AddonInfo; installed: boolean; i: number; onOpen: () => void }) {
  const m = props.a.manifest;
  return (
    <button
      onClick={props.onOpen}
      style={{ "--i": props.i } as CSSProperties}
      className="stagger lift flex items-start gap-4 rounded-3xl bg-panel p-4 text-left shadow-soft"
    >
      <Logo src={m.logo} size={56} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[16px] font-medium">{m.name}</span>
          {props.installed && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11.5px] text-emerald-500">
              <Check size={12} /> Instalado
            </span>
          )}
        </span>
        <span className="mt-1 line-clamp-2 text-[13.5px] leading-snug text-muted">{m.description || t("Sin descripción")}</span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          {props.a.streams && <Chip strong>Streams</Chip>}
          {m.types.slice(0, 3).map((t) => (
            <Chip key={t}>{TYPE_LABEL[t] ?? t}</Chip>
          ))}
        </span>
      </span>
    </button>
  );
}

export function AddonsView(props: {
  sources: Source[];
  onSources: (s: Source[]) => void;
  catalogs: Catalog[];
  onCatalogs: (c: Catalog[]) => void;
  /** an addon to show right away (e.g. opened from a stremio:// link) */
  initial?: string | null;
  notify: (t: string) => void;
}) {
  const [tab, setTab] = useState<"store" | "installed">("store");
  const [catalogId, setCatalogId] = useState(props.catalogs[0]?.id ?? "");
  const [items, setItems] = useState<AddonInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyStreams, setOnlyStreams] = useState(true);
  const [link, setLink] = useState(props.initial ?? "");
  const [linkBusy, setLinkBusy] = useState(false);
  const [open, setOpen] = useState<AddonInfo | null>(null);
  const [addingCatalog, setAddingCatalog] = useState(false);
  const [newCatalog, setNewCatalog] = useState({ name: "", url: "" });

  const catalog = props.catalogs.find((c) => c.id === catalogId) ?? props.catalogs[0];
  useEffect(() => {
    if (!catalog || !inTauri) return;
    setItems(null);
    setError(null);
    addonCatalog(catalog.url).then(setItems, (e: Error) => setError(tErr(e.message)));
  }, [catalog?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const installedUrls = new Set(props.sources.filter((s) => s.kind === "stremio").map((s) => s.url));
  const install = (a: AddonInfo) => {
    const src = addonSource(a);
    props.onSources([...props.sources.filter((s) => s.id !== src.id && s.url !== a.url), src]);
    props.notify(t("{name} instalado", { name: a.manifest.name }));
    setOpen(null);
  };
  const remove = (url: string) => {
    props.onSources(props.sources.filter((s) => !(s.kind === "stremio" && s.url === url)));
    setOpen(null);
  };
  const fromLink = async () => {
    if (!link.trim()) return;
    setLinkBusy(true);
    try {
      setOpen(await addonManifest(link));
      setLink("");
    } catch (e) {
      props.notify(tErr((e as Error).message));
    } finally {
      setLinkBusy(false);
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter(
      (a) =>
        (!onlyStreams || a.streams) &&
        (!needle || a.manifest.name.toLowerCase().includes(needle) || (a.manifest.description ?? "").toLowerCase().includes(needle)),
    );
  }, [items, q, onlyStreams]);

  const installed: AddonInfo[] = props.sources
    .filter((s) => s.kind === "stremio")
    .map((s) => ({
      url: s.url,
      streams: { types: s.types ?? [], idPrefixes: s.idPrefixes ?? null },
      manifest: {
        id: s.id.replace(/^addon:/, ""),
        version: s.version ?? "",
        name: s.name,
        description: items?.find((a) => a.url === s.url)?.manifest.description ?? null,
        logo: s.logo ?? null,
        types: s.types ?? [],
        resources: ["stream"],
        behaviorHints: { adult: false, p2p: false, configurable: false, configurationRequired: false },
      },
    }));

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`h-10 rounded-full px-5 text-[15px] ${tab === id ? "bg-accent text-white" : "hover:bg-panel"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-medium">Addons</h1>
          <p className="mt-1 max-w-[620px] text-[14.5px] text-muted">
            {t("Compatibles con los addons de Stremio. Los addons con streams aparecen al elegir un episodio, junto a tus otras fuentes.")}
          </p>
        </div>
        <div className="flex gap-1 rounded-full bg-panel-2/60 p-1">
          {tabBtn("store", t("Tienda"))}
          {tabBtn("installed", `${t("Instalados")}${installed.length ? ` · ${installed.length}` : ""}`)}
        </div>
      </div>

      <div className="flex gap-2 rounded-3xl bg-panel p-2 pl-4 shadow-soft max-sm:flex-col">
        <label className="flex flex-1 items-center gap-2.5">
          <Link2 size={18} className="shrink-0 text-muted" />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fromLink()}
            placeholder={t("Instalar desde URL: https://…/manifest.json o stremio://…")}
            className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
        </label>
        <button
          onClick={fromLink}
          disabled={!link.trim() || linkBusy || !inTauri}
          className="h-11 shrink-0 rounded-full bg-accent px-6 text-[15px] font-medium text-white disabled:opacity-40"
        >
          {linkBusy ? t("Leyendo…") : t("Ver addon")}
        </button>
      </div>

      {!inTauri && <p className="text-[14.5px] text-muted">{t("Los addons solo funcionan en la app de escritorio.")}</p>}

      {tab === "store" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-11 min-w-[220px] flex-1 items-center gap-2.5 rounded-full bg-panel px-4 shadow-soft">
              <Search size={17} className="text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar addons")} className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted" />
            </label>
            <button
              onClick={() => setOnlyStreams(!onlyStreams)}
              className={`h-11 rounded-full px-5 text-[14.5px] ${onlyStreams ? "bg-accent text-white" : "bg-panel shadow-soft"}`}
            >
              {t("Solo con streams")}
            </button>
            <select
              value={catalog?.id}
              onChange={(e) => setCatalogId(e.target.value)}
              className="h-11 rounded-full border-none bg-panel px-4 text-[14.5px] shadow-soft outline-none"
              title={t("Catálogo de addons")}
            >
              {props.catalogs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button onClick={() => setAddingCatalog(!addingCatalog)} className="h-11 rounded-full bg-panel px-4 text-[14.5px] shadow-soft hover:text-accent" title={t("Añadir catálogo")}>
              <Plus size={17} />
            </button>
          </div>

          {addingCatalog && (
            <div className="flex flex-col gap-2 rounded-3xl bg-panel p-4 shadow-soft">
              <p className="text-[13.5px] text-muted">
                {t("Un catálogo es una lista JSON de addons en el formato de Stremio")} (<code>[{"{ transportUrl, manifest }"}]</code>).{" "}
                {t("La app solo trae el oficial; añade otros bajo tu responsabilidad.")}
              </p>
              <div className="flex gap-2 max-sm:flex-col">
                <input value={newCatalog.name} onChange={(e) => setNewCatalog({ ...newCatalog, name: e.target.value })} placeholder={t("Nombre")} className="h-11 rounded-2xl border border-line bg-panel-2 px-4 text-[15px] outline-none focus:border-accent sm:w-48" />
                <input value={newCatalog.url} onChange={(e) => setNewCatalog({ ...newCatalog, url: e.target.value })} placeholder="https://…/addons.json" className="h-11 flex-1 rounded-2xl border border-line bg-panel-2 px-4 text-[15px] outline-none focus:border-accent" />
                <button
                  disabled={!newCatalog.name.trim() || !/^https?:\/\//.test(newCatalog.url.trim())}
                  onClick={() => {
                    const c = { id: newId(), name: newCatalog.name.trim(), url: newCatalog.url.trim() };
                    props.onCatalogs([...props.catalogs, c]);
                    setCatalogId(c.id);
                    setNewCatalog({ name: "", url: "" });
                    setAddingCatalog(false);
                  }}
                  className="h-11 rounded-full bg-accent px-5 text-[15px] font-medium text-white disabled:opacity-40"
                >
                  {t("Añadir")}
                </button>
              </div>
              {props.catalogs.length > 1 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {props.catalogs.slice(1).map((c) => (
                    <span key={c.id} className="flex items-center gap-1 rounded-full bg-panel-2 py-1 pr-1 pl-3 text-[13.5px]">
                      {c.name}
                      <button onClick={() => props.onCatalogs(props.catalogs.filter((x) => x.id !== c.id))} title={t("Quitar catálogo")} className="grid size-6 place-items-center rounded-full hover:text-accent">
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {error ? (
            <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-[14.5px] text-amber-500">{t("No se pudo cargar el catálogo: {error}", { error })}</p>
          ) : items === null && inTauri ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {Array.from({ length: 6 }, (_, k) => (
                <div key={k} className="h-[124px] animate-pulse rounded-3xl bg-panel" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <p className="py-10 text-center text-muted">{items?.length ? t("Ningún addon coincide.") : ""}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {shown.map((a, i) => (
                <AddonCard key={a.url} a={a} i={i} installed={installedUrls.has(a.url)} onOpen={() => setOpen(a)} />
              ))}
            </div>
          )}
        </>
      ) : installed.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-[28px] bg-panel px-6 py-16 text-center shadow-soft">
          <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
            <Puzzle size={24} />
          </span>
          <h2 className="text-[19px] font-medium">{t("Aún no tienes addons")}</h2>
          <p className="max-w-[420px] text-[14.5px] text-muted">{t("Instala uno desde la tienda o pega la URL de un addon arriba.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {installed.map((a, i) => (
            <AddonCard key={a.url} a={a} i={i} installed onOpen={() => setOpen(items?.find((x) => x.url === a.url) ?? a)} />
          ))}
        </div>
      )}

      {open && (
        <AddonModal
          addon={open}
          installed={installedUrls.has(open.url)}
          onInstall={() => install(open)}
          onRemove={() => remove(open.url)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
