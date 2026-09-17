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
import { orderBudgetChanges, type BudgetHistoryEntry, type BudgetHistorySummary } from "./budget-history";
import type { EvHistory, EvHistoryPoint, EvPartialBucket } from "./budget-ev-history";

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
  /** Earned-value history (cumulative orientation only), split into runs of
   *  partial and complete points. Neighbouring segments SHARE their boundary
   *  point, so the drawn line stays continuous; the span leading out of a
   *  partial run into a complete point is drawn as complete. */
  evSegments: readonly EvSegment[] | null;
  /** Buckets whose earned value starts counting at a point, with the amount
   *  they bring in (current unit). A join that shows as 0 is left out. */
  evJoins: readonly EvJoinLabel[];
  /** One entry per partial segment, in order: its bucket names and whether
   *  every one of them was created after its own start date. */
  evPartialNames: readonly EvPartialNames[];
  /** Names of the budgeted buckets when no earned-value history exists at all. */
  evUnavailable: readonly string[] | null;
  /** The recorded budget at completion as a STEPPED polyline (cumulative
   *  orientation only): it runs at `bacBaseline` from the chart origin to the
   *  first recorded change, then steps to each entry's own project BAC and runs
   *  flat to the end of the domain. Null when nothing has been recorded — the
   *  flat `bacLine` is what the surface draws then. */
  bacSteps: readonly ChartPoint[] | null;
  /** The project BAC before the first recorded change, drawn as a dashed
   *  reference. Null exactly when `bacSteps` is. */
  bacBaseline: number | null;
  /** One tick per PERIOD that holds recorded changes, at the level the last of
   *  them left. Several entries in one period are summed and their bucket names
   *  joined, so the labels cannot pile up on one x. A tick whose summed amount
   *  shows as 0 in the current unit is left out (the Task 9 join rule). */
  bacMarkers: readonly BacMarker[];
  bacLine: number | null; today: string | null; planEnd: string; frameDiffers: boolean;
};
/** `label` is the bucket names joined with ", "; `amount` their summed delta in
 *  the current unit; `removed` is true only when EVERY entry behind the tick
 *  deleted its bucket, which picks the "… removed" sentence. */
export type BacMarker = { date: string; value: number; amount: number; label: string; removed: boolean };
export type EvSegment = { partial: boolean; points: readonly ChartPoint[] };
/** `label` is the bucket names joined with ", "; `count` how many names it holds (it picks the
 *  singular or plural sentence); `amount` their summed contribution. */
export type EvJoinLabel = { date: string; value: number; amount: number; label: string; count: number };
export type EvPartialNames = { names: string; created: boolean };
export type ChartInput = {
  series: BurndownSeries; unit: ChartUnit; orientation: ChartOrientation;
  forecast: BudgetForecast | null; evHistory: EvHistory | null;
  history: BudgetHistorySummary | null; today: string; planEnd: string;
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

/** The chart prints € and hours with no fractional digits, so a join below
 *  half a unit would read "+0" — such a join is not labelled. */
const shownAsZero = (amount: number) => Math.round(amount) === 0;

const createdAfterStart = (b: EvPartialBucket) =>
  b.createdDate !== null && b.startDate !== null && b.createdDate.slice(0, 10) > b.startDate.slice(0, 10);

function partialNames(points: readonly EvHistoryPoint[]): EvPartialNames {
  const buckets = new Map<number, EvPartialBucket>();
  for (const pt of points) for (const b of pt.partial) if (!buckets.has(b.id)) buckets.set(b.id, b);
  const list = [...buckets.values()];
  return { names: list.map((b) => b.name).join(", "), created: list.every(createdAfterStart) };
}

type EvFields = Pick<ChartModel, "evSegments" | "evJoins" | "evPartialNames" | "evUnavailable">;
const NO_EV: EvFields = { evSegments: null, evJoins: [], evPartialNames: [], evUnavailable: null };

function evHistoryFields(evHistory: EvHistory, eurUnit: boolean, origin: ChartPoint): EvFields {
  if (!evHistory.available) return { ...NO_EV, evUnavailable: evHistory.buckets.map((b) => b.name) };
  const { points } = evHistory;
  if (points.length === 0) return NO_EV;
  const valueOf = (pt: { eur: number; hours: number }) => (eurUnit ? pt.eur : pt.hours);
  const segments: { partial: boolean; points: ChartPoint[]; source: EvHistoryPoint[] }[] = [];
  let previous = origin;
  points.forEach((pt) => {
    const partial = pt.partial.length > 0;
    const at: ChartPoint = { date: pt.date, value: valueOf(pt) };
    const current = segments.at(-1);
    if (current && current.partial === partial) {
      current.points.push(at);
      current.source.push(pt);
    } else {
      segments.push({ partial, points: [previous, at], source: [pt] });
    }
    previous = at;
  });
  const evJoins = points.flatMap((pt): EvJoinLabel[] => {
    const shown = pt.joins.filter((j) => !shownAsZero(valueOf(j)));
    if (shown.length === 0) return [];
    const amount = shown.reduce((sum, j) => sum + valueOf(j), 0);
    // A join whose bucket carries a blank name would otherwise join to "", leaving
    // the drawn label (and the sentence built from it, "{0} joins (+{1})") with a
    // dangling leading space and no subject. The em dash mirrors `bacFields`'
    // fallback for the same case, just below.
    const names = [...new Set(shown.map((j) => j.name).filter((name) => name !== ""))];
    return [{ date: pt.date, value: valueOf(pt), amount, label: names.length > 0 ? names.join(", ") : "—", count: shown.length }];
  });
  return {
    evSegments: segments.map(({ partial, points: pts }) => ({ partial, points: pts })),
    evJoins,
    evPartialNames: segments.filter((s) => s.partial).map((s) => partialNames(s.source)),
    evUnavailable: null,
  };
}

type BacFields = Pick<ChartModel, "bacSteps" | "bacBaseline" | "bacMarkers">;
const NO_BAC: BacFields = { bacSteps: null, bacBaseline: null, bacMarkers: [] };

/**
 * Budget-at-completion steps, markers and baseline from the recorded history.
 * Entries are ORDERED first (`orderBudgetChanges`) — the union a second device
 * produces is not chronological, and every figure here is a running one.
 * Dates are clamped into the chart's own x domain so a change recorded before
 * the first period (or after the last) cannot draw outside the plot.
 *
 * The stepped line's final level is the LAST RECORDED entry's own stored BAC —
 * its `after` value, captured LIVE at commit time from the actual bucket state
 * (`commitBuckets`, `use-budget-buckets.ts`; `recordBudgetChange`,
 * `budget-history.ts`), never an increment over the previous entry. So an
 * undo, version restore or template-apply's unrecorded BAC movement (ruling
 * R2) only leaves the line stale UNTIL the next recorded commit — that
 * commit's own `after` reads today's true BAC (whatever the unrecorded move
 * already did to it) and the step jumps straight there, self-healing the gap.
 * The footer's unattributed row (`splitVariance`, `bac - baseline -
 * attributed`) is the RUNNING TOTAL of every such unrecorded movement since
 * the baseline, not the currently visible staleness — it can stay non-zero
 * even once a later commit has healed the line back to today's true BAC.
 * Example: baseline 10,000 → +2,000 recorded (BAC 12,000) → a version restore
 * to an earlier snapshot drops it to 11,000, unrecorded (line still shows
 * 12,000) → +500 recorded stores `after` 11,500 (line jumps to 11,500 =
 * today's true BAC, gap 0) — yet unattributed = 11,500 − 10,000 − (2,000 +
 * 500) = −1,000. (Undo restores a whole before-image, so undoing the +2,000
 * commit itself would land exactly back at the 10,000 baseline, not 11,000 —
 * a version restore or `handleApplyTemplate` can land on any BAC a full undo
 * would not.)
 */
function bacFields(
  history: BudgetHistorySummary, eurUnit: boolean, series: BurndownSeries, start: string, end: string,
): BacFields {
  const changes = orderBudgetChanges(history.changes);
  if (changes.length === 0) return NO_BAC;
  const bacOf = (e: BudgetHistoryEntry) => (eurUnit ? e.projectBacValue : e.projectBacHours);
  const deltaOf = (e: BudgetHistoryEntry) => (eurUnit ? e.deltaValue : e.deltaHours);
  const clamp = (date: string) => (date < start ? start : date > end ? end : date);
  const baseline = eurUnit ? history.baseline.value : history.baseline.hours;

  const steps: ChartPoint[] = [{ date: start, value: baseline }];
  let level = baseline;
  for (const e of changes) {
    const at = clamp(e.date);
    steps.push({ date: at, value: level });
    level = bacOf(e);
    steps.push({ date: at, value: level });
  }
  steps.push({ date: end, value: level });

  // One tick per period, keyed by the period the change falls in; a date past
  // the last period end (or before the first, which `findIndex` already maps to
  // period 0) belongs to the last one. With no periods at all the key falls
  // back to the date itself, so nothing collapses by accident.
  const periodKey = (date: string) => {
    if (series.periodEnds.length === 0) return date;
    const i = series.periodEnds.findIndex((periodEnd) => date <= periodEnd);
    return `p${i < 0 ? series.periodEnds.length - 1 : i}`;
  };
  const groups = new Map<string, BudgetHistoryEntry[]>();
  for (const e of changes) {
    const key = periodKey(clamp(e.date));
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }
  const bacMarkers = [...groups.values()].flatMap((group): BacMarker[] => {
    const amount = group.reduce((sum, e) => sum + deltaOf(e), 0);
    if (shownAsZero(amount)) return [];
    const last = group[group.length - 1];
    const names = [...new Set(group.map((e) => e.bucketName).filter((name) => name !== ""))];
    // A group whose every entry carries a blank bucket name joins to "", which
    // would otherwise leave the drawn label (and the accessible-name sentence
    // built from it) with a dangling or doubled space. The em dash mirrors the
    // change table's own fallback for the same case (`budget-change-table.tsx`).
    return [{
      date: clamp(last.date), value: bacOf(last), amount,
      label: names.length > 0 ? names.join(", ") : "—", removed: group.every((e) => e.kind === "deleted"),
    }];
  });
  return { bacSteps: steps, bacBaseline: baseline, bacMarkers };
}

export function buildChartModel(input: ChartInput): ChartModel {
  const { series, unit, orientation, forecast, evHistory, history, today, planEnd } = input;
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

  const evFields = !down && evHistory ? evHistoryFields(evHistory, eurUnit, origin) : NO_EV;
  const bacF = !down && history ? bacFields(history, eurUnit, series, xDomain[0], xDomain[1]) : NO_BAC;

  const lastCumulative = last === null ? null : (down ? total - last.value : last.value);
  const frameDiffers = forecast !== null && lastCumulative !== null && (
    Math.abs(total - forecast.facts.bac) > CHART_FRAME_TOLERANCE ||
    Math.abs(lastCumulative - forecast.facts.ac) > CHART_FRAME_TOLERANCE
  );

  const values = [
    0, total,
    ...planned.map((pt) => pt.value), ...actual.map((pt) => pt.value),
    ...(evFields.evSegments ?? []).flatMap((s) => s.points.map((pt) => pt.value)),
    // The stepped BAC can rise above `total` (recorded scope added after the
    // baseline), so the domain has to open for it or the steps leave the plot.
    ...(bacF.bacSteps ?? []).map((pt) => pt.value),
    ...[pace?.to.value, efficiency?.to.value, ev?.value].filter((v): v is number => v !== undefined),
  ];
  const yMin = Math.min(...values);
  const yMaxRaw = Math.max(...values);
  const yMax = yMaxRaw > yMin ? yMaxRaw : yMin + 1;

  return {
    empty: !(total > 0), xDomain, yDomain: [yMin, yMax], total,
    planned, actual, over, pace, efficiency, runOut, ev, ...evFields, ...bacF,
    bacLine: down ? null : total,
    today: dates.length > 0 ? dates[dates.length - 1] : null,
    planEnd, frameDiffers,
  };
}
