import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import type { BurndownSeries } from "./budget-burndown";

const W = 320, H = 160, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD_L;
  return PAD_L + (i * PLOT_W) / (n - 1);
}
function yAt(v: number, max: number): number {
  if (max <= 0) return PAD_T + PLOT_H;
  const clamped = Math.max(0, v);
  return PAD_T + (1 - clamped / max) * PLOT_H;
}
function points(vals: readonly (number | null)[], max: number, n: number): string {
  return vals
    .map((v, i) => (v === null ? null : `${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(" ");
}

/** Distinct X-tick indices: first, today (if valid), last. */
function xTickIndices(n: number, todayIndex: number): number[] {
  if (n <= 0) return [];
  const set = new Set<number>([0, n - 1]);
  if (todayIndex >= 0 && todayIndex < n) set.add(todayIndex);
  return [...set].sort((a, b) => a - b);
}

function Chart({
  caption, planned, actual, max, todayIndex, n, over, periods, unit, currency, locale,
}: {
  caption: string;
  planned: readonly number[];
  actual: readonly (number | null)[];
  max: number;
  todayIndex: number;
  n: number;
  over: boolean;
  periods: readonly string[];
  unit: "hours" | "currency";
  currency: string;
  locale: string;
}) {
  const baseY = PAD_T + PLOT_H;
  const todayX = todayIndex >= 0 ? xAt(todayIndex, n) : null;
  const fmt = (v: number) =>
    unit === "currency" ? formatCurrency(v, currency, locale) : `${Math.round(v)}h`;
  const yTicks = [0, max / 2, max];
  const xTicks = xTickIndices(n, todayIndex);
  return (
    <div className="min-w-[240px] flex-1">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{caption}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={baseY} className="stroke-line" strokeWidth={1} />
        <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY} className="stroke-line" strokeWidth={1} />
        {yTicks.map((v, i) => (
          <text key={i} x={PAD_L - 4} y={yAt(v, max) + 3} textAnchor="end" className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">
            {fmt(v)}
          </text>
        ))}
        {xTicks.map((idx) => (
          <text key={idx} x={xAt(idx, n)} y={baseY + 12} textAnchor={idx === 0 ? "start" : idx === n - 1 ? "end" : "middle"} className="fill-muted-foreground text-[8px] tabular-nums" aria-hidden="true">
            {periods[idx]}
          </text>
        ))}
        <polyline points={points(planned, max, n)} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="5 4" />
        <polyline points={points(actual, max, n)} fill="none" className={over ? "stroke-AIPM-pink" : "stroke-AIPM-green"} strokeWidth={2.5} />
        {todayX !== null && (
          <line x1={todayX} y1={PAD_T} x2={todayX} y2={baseY} className="stroke-AIPM-dark-blue" strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>
    </div>
  );
}

/** Twin burn-down (remaining) charts: hours + currency. Dashed = planned
 *  glide-path, solid = actual remaining (pink when over budget). Axis ticks:
 *  hours/currency on Y, period dates on X. Dependency-free SVG. */
export function BurndownCharts({ series, lang, currency }: { series: BurndownSeries; lang: Lang; currency: string }) {
  if (series.totalBudgetHours <= 0 && series.totalBudgetValue <= 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>;
  }
  const n = series.periods.length;
  const locale = localeFor(lang);
  const lastActualH = [...series.actualRemainingHours].reverse().find((v) => v !== null) ?? null;
  const lastActualV = [...series.actualRemainingValue].reverse().find((v) => v !== null) ?? null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4">
        <Chart caption={t(lang, "burndownHoursRemaining")} planned={series.plannedRemainingHours} actual={series.actualRemainingHours} max={series.totalBudgetHours} todayIndex={series.todayIndex} n={n} over={lastActualH !== null && lastActualH < 0} periods={series.periods} unit="hours" currency={currency} locale={locale} />
        <Chart caption={t(lang, "burndownBudgetRemaining")} planned={series.plannedRemainingValue} actual={series.actualRemainingValue} max={series.totalBudgetValue} todayIndex={series.todayIndex} n={n} over={lastActualV !== null && lastActualV < 0} periods={series.periods} unit="currency" currency={currency} locale={locale} />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="5 4" /></svg>
          {t(lang, "burndownPlanned")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" className="stroke-AIPM-green" strokeWidth={2.5} /></svg>
          {t(lang, "burndownActual")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="6" height="14" aria-hidden="true"><line x1="3" y1="0" x2="3" y2="14" className="stroke-AIPM-dark-blue" strokeWidth={1} strokeDasharray="3 3" /></svg>
          {t(lang, "burndownToday")}
        </span>
      </div>
    </div>
  );
}
