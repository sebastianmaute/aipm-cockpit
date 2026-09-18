// The hover/keyboard readout's pure half (spec A): which dates the readout can
// land on, and what every drawn series is worth there. i18n-free and
// formatter-free by design — `chart-readout.tsx` owns the words, the chart owns
// the number formatting, and this file owns only the arithmetic.
import { daysBetweenUtc, scaleDate, type ChartModel, type ChartPoint, type ChartSegment } from "./burndown-geometry";

export type ReadoutKind =
  | "plan" | "budget" | "baseline" | "actual" | "ev" | "evPoint"
  | "pace" | "efficiency" | "change" | "runOut";

export type ReadoutRow = {
  kind: ReadoutKind;
  value: number;
  /** EV only: the point sits in a partial span. */
  partial?: boolean;
  /** pace/efficiency: the value is a forecast, not a record. */
  forecast?: boolean;
  /** change only: the bucket names behind the marker. */
  label?: string;
  /** change only: every entry behind the marker deleted its bucket. */
  removed?: boolean;
};

export type Readout = { date: string; today: boolean; rows: readonly ReadoutRow[] };

/**
 * Every date the readout may land on: the union of all drawn series' own
 * points, today, the plan end, each budget-change marker and the run-out.
 *
 * ★ Deliberately NOT every calendar day. `actual` and the earned-value spans
 * carry ONE point per plan period, so a value between two points would be
 * invented; the two forecasts are straight segments, so reading along them at
 * a stop is exactly what the chart draws.
 */
export function readoutStops(model: ChartModel): readonly string[] {
  if (model.empty) return [];
  const dates = new Set<string>();
  const add = (list: readonly ChartPoint[]) => { for (const p of list) dates.add(p.date); };
  add(model.planned);
  add(model.actual);
  if (model.bacSteps) add(model.bacSteps);
  for (const seg of model.evSegments ?? []) add(seg.points);
  for (const marker of model.bacMarkers) dates.add(marker.date);
  for (const seg of [model.pace, model.efficiency]) {
    if (seg) { dates.add(seg.from.date); dates.add(seg.to.date); }
  }
  if (model.ev) dates.add(model.ev.date);
  if (model.runOut) dates.add(model.runOut.date);
  if (model.today) dates.add(model.today);
  dates.add(model.planEnd);
  return [...dates].sort();
}

/** The stop whose x is closest to `x`, in the SVG's own coordinate space. */
export function nearestStop(
  stops: readonly string[], xDomain: readonly [string, string],
  x0: number, x1: number, x: number,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const stop of stops) {
    const dist = Math.abs(scaleDate(stop, xDomain, x0, x1) - x);
    if (dist < bestDist) { best = stop; bestDist = dist; }
  }
  return best;
}

function pointAt(list: readonly ChartPoint[], date: string): number | null {
  const hit = list.find((p) => p.date === date);
  return hit ? hit.value : null;
}

/** The stepped budget's level at `date`: the last step at or before it. */
function steppedAt(steps: readonly ChartPoint[], date: string): number | null {
  let value: number | null = null;
  for (const p of steps) {
    if (p.date <= date) value = p.value;
  }
  return value;
}

/** A forecast's value along its straight segment, or null outside it. */
function segmentAt(seg: ChartSegment | null, date: string): number | null {
  if (!seg) return null;
  if (date < seg.from.date || date > seg.to.date) return null;
  const span = daysBetweenUtc(seg.from.date, seg.to.date);
  if (span <= 0) return seg.from.value;
  const gone = daysBetweenUtc(seg.from.date, date);
  return seg.from.value + ((seg.to.value - seg.from.value) * gone) / span;
}

/**
 * Earned value at `date`, with the partial flag of the span it belongs to.
 * ★ Neighbouring spans SHARE their boundary point and the span leading out of a
 * partial run is drawn as complete, so a boundary point that any complete span
 * holds is reported complete.
 */
function evAt(model: ChartModel, date: string): { value: number; partial: boolean } | null {
  let found: { value: number; partial: boolean } | null = null;
  for (const seg of model.evSegments ?? []) {
    const value = pointAt(seg.points, date);
    if (value === null) continue;
    if (!seg.partial) return { value, partial: false };
    found = { value, partial: true };
  }
  return found;
}

/** Every drawn series' value at one stop, in the legend's order. */
export function readoutAt(model: ChartModel, date: string): Readout | null {
  if (model.empty) return null;
  const rows: ReadoutRow[] = [];
  const push = (kind: ReadoutKind, value: number | null, extra: Omit<ReadoutRow, "kind" | "value"> = {}) => {
    if (value !== null) rows.push({ kind, value, ...extra });
  };
  push("plan", pointAt(model.planned, date));
  push("budget", model.bacSteps ? steppedAt(model.bacSteps, date) : model.bacLine);
  push("baseline", model.bacSteps ? model.bacBaseline : null);
  push("actual", pointAt(model.actual, date));
  const ev = evAt(model, date);
  if (ev) rows.push({ kind: "ev", value: ev.value, partial: ev.partial });
  if (model.ev && model.ev.date === date) rows.push({ kind: "evPoint", value: model.ev.value });
  push("pace", segmentAt(model.pace, date), { forecast: true });
  push("efficiency", segmentAt(model.efficiency, date), { forecast: true });
  const marker = model.bacMarkers.find((m) => m.date === date);
  if (marker) rows.push({ kind: "change", value: marker.amount, label: marker.label, removed: marker.removed });
  if (model.runOut && model.runOut.date === date) rows.push({ kind: "runOut", value: model.runOut.value });
  if (rows.length === 0) return null;
  return { date, today: model.today === date, rows };
}
