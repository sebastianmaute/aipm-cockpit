/** Simulated cost at finish (§502 part 3) — i18n-free, React-free. */

import type { DatedValue } from "../budget-forecast";
import { MIN_SPEND_WORKING_DAYS } from "./constants";
import { mulberry32, seedFrom } from "./rng";
import { percentile } from "./simulate";

export type CostAtFinish =
  | { kind: "sim"; p50: number | "beyond"; p80: number | "beyond"; p95: number | "beyond";
      /** Share of trials whose cost exceeds BAC (a beyond trial counts as over); null when BAC <= 0. */
      chanceOverBudget: number | null; spendDays: number }
  | { kind: "unavailable"; reason: "schedule-floor" | "spend-history" | "no-spend"; spendDays: number; neededSpendDays: number };

/** Per-working-day spend in the window, from the first booking on (days before it are not samples). */
export function spendSamples(dated: readonly DatedValue[], windowDates: readonly string[]): number[] {
  let firstBooking: string | null = null;
  const perDay = new Map<string, number>();
  for (const d of dated) {
    if (d.value === 0) continue;
    if (firstBooking === null || d.date < firstBooking) firstBooking = d.date;
    perDay.set(d.date, (perDay.get(d.date) ?? 0) + d.value);
  }
  if (firstBooking === null) return [];
  const from = firstBooking;
  return windowDates.filter((date) => date >= from).map((date) => perDay.get(date) ?? 0);
}

function toPercentile(sorted: Float64Array, p: number): number | "beyond" {
  const v = percentile(sorted, p);
  return v === Infinity ? "beyond" : v;
}

/** `spendScale` multiplies every drawn spend sample (the Forecast view's What-if capacity: burn scales
 *  with team availability); the seed ignores it, so every
 *  pinned value stays and a scaled run draws the same days as the unscaled one. */
export function simulateCostAtFinish(a: {
  trialDays: Int32Array; samples: readonly number[]; ac: number; bac: number; seedTag: string; horizon: number;
  spendScale?: number;
}): CostAtFinish {
  const { trialDays, samples, ac, bac, seedTag, horizon } = a;
  const scale = a.spendScale ?? 1;
  // Nothing left open: every trial finishes today, so the cost is exactly AC — no history needed.
  if (trialDays.length > 0 && trialDays.every((d) => d === 0)) {
    return {
      kind: "sim", p50: ac, p80: ac, p95: ac,
      chanceOverBudget: bac > 0 ? (ac > bac ? 1 : 0) : null, spendDays: samples.length,
    };
  }
  if (samples.length < MIN_SPEND_WORKING_DAYS) {
    return { kind: "unavailable", reason: "spend-history", spendDays: samples.length, neededSpendDays: MIN_SPEND_WORKING_DAYS };
  }
  // Bookings exist before the window, none inside it: enough days, but nothing to draw.
  if (samples.every((s) => s === 0)) {
    return { kind: "unavailable", reason: "no-spend", spendDays: samples.length, neededSpendDays: MIN_SPEND_WORKING_DAYS };
  }
  const rng = mulberry32(seedFrom([...samples, ac, bac, seedTag, "cost"]));
  const costs = new Float64Array(trialDays.length);
  let over = 0;
  for (let t = 0; t < trialDays.length; t += 1) {
    const days = trialDays[t];
    let cost = ac;
    if (days > horizon) cost = Infinity;
    else for (let i = 0; i < days; i += 1) cost += samples[Math.floor(rng() * samples.length)] * scale;
    costs[t] = cost;
    if (cost > bac) over += 1;
  }
  costs.sort();
  return {
    kind: "sim",
    p50: toPercentile(costs, 50),
    p80: toPercentile(costs, 80),
    p95: toPercentile(costs, 95),
    chanceOverBudget: bac > 0 ? over / trialDays.length : null,
    spendDays: samples.length,
  };
}
