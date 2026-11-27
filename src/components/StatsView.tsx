// Statistics: what you shared, downloaded and watched, from the local
// records in stats.ts. Totals as stat tiles, one metric over time as a
// bar chart (with a table view), and the top series.

import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Clock, Download, Flame, Table2, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { locale, t, tn } from "../i18n";
import { byDay, byMonth, bySeries, clearStats, exportJson, formatBytes, streak, totals, useStatRows, type Bucket, type StatRow } from "../stats";
import { Empty } from "./Media";

type Range = "7d" | "30d" | "12m" | "all";
type Metric = "up" | "down" | "watched";

/** "3 h 20 min", "45 min", "30 s" */
export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

const fmt = (m: Metric, v: number) => (m === "watched" ? formatDuration(v) : formatBytes(v, locale));

/** Up to 4 round gridline values covering `max`, in the metric's unit. */
function ticks(max: number, m: Metric): number[] {
  if (max <= 0) return [0];
  let unit = 1;
  if (m === "watched") unit = max >= 7200 ? 3600 : 60;
  else for (let u = 1024 ** 4; u >= 1; u /= 1024) if (max >= u) { unit = u; break; }
  const raw = max / unit / 3;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const step = ([1, 2, 2.5, 5, 10].find((k) => k * p >= raw) ?? 10) * p * unit;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999 && out.length < 6; v += step) out.push(v);
  return out;
}

export function StatsView(props: { onOpen: (mediaId: number) => void; notify: (text: string) => void }) {
  const rows = useStatRows();
  const [range, setRange] = useState<Range>("30d");
  const [metric, setMetric] = useState<Metric>("up");
  const [table, setTable] = useState(false);
  const [topBy, setTopBy] = useState<"watched" | "up">("watched");
  const [confirmClear, setConfirmClear] = useState(false);

  const inRange = useMemo(() => {
    if (range === "all") return rows;
    const d = new Date();
    if (range === "7d") d.setDate(d.getDate() - 6);
    else if (range === "30d") d.setDate(d.getDate() - 29);
    else d.setMonth(d.getMonth() - 11, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return rows.filter((r) => r.day >= from);
  }, [rows, range]);

  const tot = totals(inRange);
  const st = streak(rows);
  const buckets = useMemo(() => {
    if (range === "7d") return byDay(rows, 7, locale);
    if (range === "30d") return byDay(rows, 30, locale);
    if (range === "12m") return byMonth(rows, 12, locale);
    const first = rows.reduce((a, r) => (r.day < a ? r.day : a), rows[0]?.day ?? "");
    const [y, mo] = first.split("-").map(Number);
    const now = new Date();
    const months = first ? (now.getFullYear() - y) * 12 + now.getMonth() + 1 - mo + 1 : 1;
    return byMonth(rows, Math.min(Math.max(months, 3), 36), locale);
  }, [rows, range]);
  const top = bySeries(inRange)
    .filter((s) => s[topBy] > 0)
    .sort((a, b) => b[topBy] - a[topBy])
    .slice(0, 6);

  const download = () => {
    const blob = new Blob([exportJson(rows)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `anime-tv-stats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (rows.length === 0) {
    return (
      <Empty
        icon={<BarChart3 size={24} />}
        title={t("Aún no hay estadísticas")}
        text={t("Cuando veas o compartas episodios, aquí verás cuánto has subido y descargado y cuánto tiempo has visto. Se guarda solo en este equipo.")}
      />
    );
  }

  const ranges: [Range, string][] = [
    ["7d", t("7 días")],
    ["30d", t("30 días")],
    ["12m", t("12 meses")],
    ["all", t("Todo")],
  ];
  const metrics: [Metric, string][] = [
    ["up", t("Compartido")],
    ["down", t("Descargado")],
    ["watched", t("Tiempo visto")],
  ];

  return (
    <div className="flex max-w-[1000px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[26px] font-medium">{t("Estadísticas")}</h1>
        <Segmented items={ranges} value={range} onChange={setRange} />
      </div>

      {/* ---- totals ---- */}
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <Tile
          icon={<ArrowUpFromLine size={18} />}
          label={t("Compartido")}
          value={formatBytes(tot.up, locale)}
          sub={tot.down > 0 ? t("proporción {r}×", { r: (tot.up / tot.down).toLocaleString(locale, { maximumFractionDigits: 2 }) }) : t("sin descargas en este periodo")}
          i={0}
        />
        <Tile icon={<ArrowDownToLine size={18} />} label={t("Descargado")} value={formatBytes(tot.down, locale)} sub={t("desde la red, sin contar lo ya guardado")} i={1} />
        <Tile
          icon={<Clock size={18} />}
          label={t("Tiempo visto")}
          value={formatDuration(tot.watched)}
          sub={`${tn(tot.episodes, "{n} episodio", "{n} episodios")} · ${tn(tot.series, "{n} serie", "{n} series")}`}
          i={2}
        />
        <Tile
          icon={<Flame size={18} />}
          label={t("Racha")}
          value={tn(st.current, "{n} día", "{n} días")}
          sub={t("récord: {n}", { n: tn(st.best, "{n} día", "{n} días") })}
          i={3}
        />
      </div>

      {/* ---- over time ---- */}
      <section className="rounded-[28px] bg-panel p-6 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-[19px] font-medium">
            {metrics.find((m) => m[0] === metric)![1]} {range === "7d" || range === "30d" ? t("por día") : t("por mes")}
          </h2>
          <Segmented small items={metrics} value={metric} onChange={setMetric} />
          <button
            onClick={() => setTable(!table)}
            title={table ? t("Ver como gráfico") : t("Ver como tabla")}
            className={`grid size-9 place-items-center rounded-full ${table ? "bg-accent text-white" : "hover:bg-panel-2"}`}
          >
            {table ? <BarChart3 size={16} /> : <Table2 size={16} />}
          </button>
        </div>
        {table ? <BucketTable buckets={buckets} /> : <Bars buckets={buckets} metric={metric} />}
      </section>

      {/* ---- top series ---- */}
      <section className="rounded-[28px] bg-panel p-6 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-[19px] font-medium">{t("Series destacadas")}</h2>
          <Segmented
            small
            items={[
              ["watched", t("Por tiempo visto")],
              ["up", t("Por compartido")],
            ]}
            value={topBy}
            onChange={setTopBy}
          />
        </div>
        {top.length === 0 ? (
          <p className="mt-4 text-[14.5px] text-muted">{t("Nada en este periodo.")}</p>
        ) : (
          <ol className="mt-4 flex flex-col gap-1">
            {top.map((s, i) => (
              <li key={s.mediaId}>
                <button onClick={() => props.onOpen(s.mediaId)} className="stagger group flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-panel-2" style={{ ["--i" as string]: i }}>
                  <span className="w-5 text-right text-[13px] text-muted tabular-nums">{i + 1}</span>
                  {s.cover ? <img src={s.cover} alt="" className="h-12 w-8 shrink-0 rounded-md object-cover" /> : <span className="h-12 w-8 shrink-0 rounded-md bg-panel-2" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] group-hover:text-accent">{s.series}</span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-panel-2">
                      <span className="grow-x block h-full rounded-full bg-accent" style={{ width: `${(s[topBy] / top[0][topBy]) * 100}%` }} />
                    </span>
                  </span>
                  <span className="w-24 shrink-0 text-right text-[14px] tabular-nums">{topBy === "watched" ? formatDuration(s.watched) : formatBytes(s.up, locale)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---- data ---- */}
      <section className="flex flex-wrap items-center gap-3 rounded-[28px] bg-panel p-5 text-[14px] text-muted shadow-soft">
        <p className="flex-1">{t("Estas estadísticas se guardan solo en este equipo. Más adelante podrás sincronizarlas con tu cuenta.")}</p>
        <button onClick={download} className="flex h-10 items-center gap-2 rounded-full bg-panel-2 px-4 text-text hover:text-accent">
          <Download size={15} /> {t("Exportar JSON")}
        </button>
        {confirmClear ? (
          <span className="flex items-center gap-2">
            <button
              onClick={() => {
                clearStats();
                setConfirmClear(false);
                props.notify(t("Estadísticas borradas"));
              }}
              className="h-10 rounded-full bg-accent px-4 font-medium text-white"
            >
              {t("Sí, borrar todo")}
            </button>
            <button onClick={() => setConfirmClear(false)} className="h-10 rounded-full px-3 hover:text-text">
              {t("Cancelar")}
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmClear(true)} className="flex h-10 items-center gap-2 rounded-full px-4 hover:text-accent">
            <Trash2 size={15} /> {t("Borrar")}
          </button>
        )}
      </section>
    </div>
  );
}

function Tile(props: { icon: ReactNode; label: string; value: string; sub: string; i: number }) {
  return (
    <div className="stagger rounded-[24px] bg-panel p-5 shadow-soft" style={{ ["--i" as string]: props.i }}>
      <p className="flex items-center gap-2 text-[14px] text-muted">
        <span className="text-accent">{props.icon}</span>
        {props.label}
      </p>
      <p className="mt-2 text-[30px] leading-tight font-semibold tabular-nums">{props.value}</p>
      <p className="mt-1 text-[13px] text-muted">{props.sub}</p>
    </div>
  );
}

function Segmented<T extends string>(props: { items: [T, string][]; value: T; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className="flex w-fit flex-wrap gap-1 rounded-full bg-panel p-1 shadow-soft">
      {props.items.map(([id, label]) => (
        <button
          key={id}
          onClick={() => props.onChange(id)}
          className={`rounded-full px-4 ${props.small ? "h-8 text-[13.5px]" : "h-10 text-[14.5px]"} ${props.value === id ? "bg-accent text-white" : "hover:bg-panel-2"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** One metric over time: thin rounded bars, recessive grid, a tooltip per bar. */
function Bars(props: { buckets: Bucket[]; metric: Metric }) {
  const { buckets, metric } = props;
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...buckets.map((b) => b[metric]), 0);
  const tk = ticks(max, metric);
  const top = tk[tk.length - 1] || 1;
  const dense = buckets.length > 14;
  return (
    <div className="mt-5 flex gap-3">
      {/* y axis */}
      <div className="relative h-56 w-16 shrink-0 text-right text-[11.5px] text-muted tabular-nums">
        {tk.map((v) => (
          <span key={v} className="absolute right-0" style={{ bottom: `${(v / top) * 100}%`, transform: "translateY(50%)" }}>
            {v === 0 ? "0" : fmt(metric, v)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-56">
          {tk.map((v) => (
            <span key={v} className={`absolute inset-x-0 h-px ${v === 0 ? "bg-line" : "bg-line/50"}`} style={{ bottom: `${(v / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {buckets.map((b, i) => {
              const v = b[metric];
              const on = hover === i;
              return (
                <button
                  key={b.key}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${b.label}: ${fmt(metric, v)}`}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center outline-none"
                >
                  <span
                    className={`bar-grow block w-full max-w-9 rounded-t-[4px] transition-colors ${v > 0 ? (on ? "bg-accent" : "bg-accent/80") : ""}`}
                    style={{ height: v > 0 ? `max(2px, ${(v / top) * 100}%)` : 0, animationDelay: `${i * 12}ms` }}
                  />
                  {on && (
                    <span
                      className={`pointer-events-none absolute bottom-[calc(100%+6px)] z-10 rounded-xl ${
                        // keep the tooltip inside the card at both ends
                        i < 2 ? "left-0" : i > buckets.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                      } bg-invert px-3 py-2 text-left whitespace-nowrap shadow-soft`}
                    >
                      <span className="block text-[15px] font-semibold text-invert-ink tabular-nums">{fmt(metric, v)}</span>
                      <span className="block text-[12px] text-invert-ink/60">{b.label}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        {/* x labels: every one, or a few when dense */}
        <div className="mt-2 flex gap-[2px] text-[11.5px] text-muted">
          {buckets.map((b, i) => (
            <span key={b.key} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
              {!dense || i % 5 === 0 || i === buckets.length - 1 ? b.label : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BucketTable(props: { buckets: Bucket[] }) {
  return (
    <div className="mt-4 max-h-72 overflow-y-auto">
      <table className="w-full text-[14px] tabular-nums">
        <thead className="sticky top-0 bg-panel text-left text-[12.5px] text-muted">
          <tr>
            <th className="py-2 font-medium">{t("Periodo")}</th>
            <th className="py-2 text-right font-medium">{t("Compartido")}</th>
            <th className="py-2 text-right font-medium">{t("Descargado")}</th>
            <th className="py-2 text-right font-medium">{t("Tiempo visto")}</th>
          </tr>
        </thead>
        <tbody>
          {[...props.buckets].reverse().map((b) => (
            <tr key={b.key} className="border-t border-line">
              <td className="py-2">{b.label}</td>
              <td className="py-2 text-right">{formatBytes(b.up, locale)}</td>
              <td className="py-2 text-right">{formatBytes(b.down, locale)}</td>
              <td className="py-2 text-right">{formatDuration(b.watched)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { StatRow };
