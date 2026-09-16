/**
 * Burn-down chart geometry (MR 3 addendum §5.2). Pure, i18n-free, no pixels
 * except the two scale helpers. Values live in the CHART's frame (the series
 * totals); forecast lines start at the last actual point and extend by their
 * own ETC so there is no jump at today, and their end labels carry the
 * forecast's own figures. `frameDiffers` tells the surface to say so when the
 * chart's totals and the forecast's BAC/AC disagree (fixed price, bucket window).
 *
 * Overdue projects (Controller ruling — spec silent): a forecast segment always
 * runs from the last actual point to `planEnd`. Once the project has slipped
 * past its own plan end — `last.date >= planEnd` — that span is zero or
 * negative, so a real (non-zero) ETC would draw backward or straight down/up
 * instead of forward. Rather than draw a stub with no forward meaning, the
 * model omits BOTH forecast segments and the run-out circle entirely once the
 * project is overdue; the actual line itself is untouched, and the surface
 * (Task 12) should read "no forecast" from `pace`/`efficiency`/`runOut` all
 * being null rather than from a special-cased x position.
 */
import { isEfficiencyAvailable, isPaceAvailable, type BudgetForecast } from "./budget-forecast";
import { actualPointDates, type BurndownSeries } from "./budget-burndown";
import type { EvHistory } from "./budget-ev-history";

export type ChartUnit = "eur" | "hours";
export type ChartOrientation = "burndown" | "cumulative";
export const CHART_FRAME_TOLERANCE = 0.5;
export type ChartPoint = { date: string; value: number };
/** `endFigure` is the end label (VAC in burn-down, EAC in cumulative); `vac` is
 *  always the forecast's OWN VAC (the card figure), in both orientations — never
 *  a chart-frame recomputation, which differs whenever `frameDiffers`. */
export type ChartSegment = { from: ChartPoint; to: ChartPoint; endFigure: number; vac: number };
export type ChartModel = {
  empty: boolean; xDomain: readonly [string, string]; yDomain: readonly [number, number]; total: number;
  planned: readonly ChartPoint[]; actual: readonly ChartPoint[]; over: boolean;
  pace: ChartSegment | null; efficiency: ChartSegment | null;
  /** Zero-value marker at the pace forecast's `runOutDate` (working-day math,
   *  from `PaceForecast.runOutDate`). The pace SEGMENT is a straight line in
   *  CALENDAR days between two points (`last` and `planEnd`); the circle sits
   *  at a date derived by counting only WORKING days forward from today. The
   *  two are different measures over the same axis, so the circle is not
   *  guaranteed to land exactly on the segment's line — that is not a bug for
   *  Task 12 to "fix" by snapping one to the other. */
  runOut: ChartPoint | null; ev: ChartPoint | null;
  evLine: readonly ChartPoint[] | null; evHistoryBlockedBy: readonly string[] | null;
  bacLine: number | null; today: string | null; planEnd: string; frameDiffers: boolean;
};
export type ChartInput = {
  series: BurndownSeries; unit: ChartUnit; orientation: ChartOrientation;
  forecast: BudgetForecast | null; evHistory: EvHistory | null; today: string; planEnd: string;
};

const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export function daysBetweenUtc(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export function scaleDate(date: string, domain: readonly [string, string], x0: number, x1: number): number {
  const span = daysBetweenUtc(domain[0], domain[1]);
  return span <= 0 ? x0 : x0 + (daysBetweenUtc(domain[0], date) / span) * (x1 - x0);
}

export function scaleValue(value: number, domain: readonly [number, number], yBottom: number, yTop: number): number {
  const span = domain[1] - domain[0];
  return span <= 0 ? yBottom : yBottom - ((value - domain[0]) / span) * (yBottom - yTop);
}

export function buildChartModel(input: ChartInput): ChartModel {
  const { series, unit, orientation, forecast, evHistory, today, planEnd } = input;
  const eurUnit = unit === "eur";
  const down = orientation === "burndown";
  const total = eurUnit ? series.totalBudgetValue : series.totalBudgetHours;
  const plannedRemaining = eurUnit ? series.plannedRemainingValue : series.plannedRemainingHours;
  const actualRemaining = eurUnit ? series.actualRemainingValue : series.actualRemainingHours;
  const fromCumulative = (cumulative: number) => (down ? total - cumulative : cumulative);
  const n = series.periods.length;
  const start = n > 0 ? series.periodStarts[0] : planEnd;
  const lastEnd = n > 0 ? series.periodEnds[n - 1] : planEnd;
  const xDomain: readonly [string, string] = [start, lastEnd > planEnd ? lastEnd : planEnd];
  const origin: ChartPoint = { date: start, value: fromCumulative(0) };

  const planned: ChartPoint[] = n === 0 ? [] : [
    origin,
    ...plannedRemaining.map((remaining, i) => ({ date: series.periodEnds[i], value: fromCumulative(total - remaining) })),
  ];
  const dates = actualPointDates(series, today);
  const actual: ChartPoint[] = dates.length === 0 ? [] : [origin];
  dates.forEach((date, i) => {
    const remaining = actualRemaining[i];
    if (remaining !== null) actual.push({ date, value: fromCumulative(total - remaining) });
  });
  const last = actual.length > 1 ? actual[actual.length - 1] : null;
  const lastRemaining = series.todayIndex >= 0 ? actualRemaining[series.todayIndex] : null;
  const over = lastRemaining !== null && lastRemaining < 0;

  let pace: ChartSegment | null = null;
  let efficiency: ChartSegment | null = null;
  let runOut: ChartPoint | null = null;
  let ev: ChartPoint | null = null;
  if (forecast && last) {
    // Overdue guard (see module docstring): a segment from `last` to `planEnd`
    // is only forward-meaningful while there is a forward span to draw it on.
    if (last.date < planEnd) {
      const segment = (etc: number, figure: number, vac: number): ChartSegment => ({
        from: last, to: { date: planEnd, value: down ? last.value - etc : last.value + etc }, endFigure: figure, vac,
      });
      const p = forecast.pace;
      if (isPaceAvailable(p)) {
        pace = segment(p.etc, down ? p.vac : p.eac, p.vac);
        if (p.runOutDate !== null && p.runOutDate <= planEnd) runOut = { date: p.runOutDate, value: down ? 0 : total };
      }
      const e = forecast.efficiency;
      if (isEfficiencyAvailable(e)) efficiency = segment(e.etc, down ? e.vac : e.eac, e.vac);
    }
    if (forecast.facts.ev !== null) ev = { date: last.date, value: fromCumulative(forecast.facts.ev) };
  }

  let evLine: ChartPoint[] | null = null;
  let evHistoryBlockedBy: string[] | null = null;
  if (!down && evHistory) {
    if (evHistory.available) {
      evLine = evHistory.points.length === 0 ? null : [origin, ...evHistory.points.map((pt) => ({ date: pt.date, value: eurUnit ? pt.eur : pt.hours }))];
    } else {
      evHistoryBlockedBy = evHistory.buckets.map((b) => b.name);
    }
  }

  const lastCumulative = last === null ? null : (down ? total - last.value : last.value);
  const frameDiffers = forecast !== null && lastCumulative !== null && (
    Math.abs(total - forecast.facts.bac) > CHART_FRAME_TOLERANCE ||
    Math.abs(lastCumulative - forecast.facts.ac) > CHART_FRAME_TOLERANCE
  );

  const values = [
    0, total,
    ...planned.map((pt) => pt.value), ...actual.map((pt) => pt.value),
    ...(evLine ?? []).map((pt) => pt.value),
    ...[pace?.to.value, efficiency?.to.value, ev?.value].filter((v): v is number => v !== undefined),
  ];
  const yMin = Math.min(...values);
  const yMaxRaw = Math.max(...values);
  const yMax = yMaxRaw > yMin ? yMaxRaw : yMin + 1;

  return {
    empty: !(total > 0), xDomain, yDomain: [yMin, yMax], total,
    planned, actual, over, pace, efficiency, runOut, ev, evLine, evHistoryBlockedBy,
    bacLine: down ? null : total,
    today: dates.length > 0 ? dates[dates.length - 1] : null,
    planEnd, frameDiffers,
  };
}
