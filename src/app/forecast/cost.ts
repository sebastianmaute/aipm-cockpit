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

/** A per-day array is read at days 1..horizon; a shorter one would read `undefined` and turn every cost
 *  into NaN, which sorts and reports silently. Refuse it instead. */
function assertCoversHorizon(perDay: number | Float64Array | undefined, horizon: number, name: string): void {
  if (perDay instanceof Float64Array && perDay.length <= horizon) {
    throw new RangeError(`${name} must cover days 1..${horizon} (length ${horizon + 1}), got length ${perDay.length}`);
  }
}

/** One trial's cost at finish, from today's actual cost on: day `i` (1-based, up to the trial's finish
 *  day) adds one drawn sample times that day's scale, plus that day's added cost. */
function trialCost(
  rng: () => number, ac: number, days: number, samples: readonly number[], scale: number | Float64Array, addedCost: Float64Array | undefined,
): number {
  let cost = ac;
  for (let i = 1; i <= days; i += 1) {
    const s = typeof scale === "number" ? scale : scale[i];
    cost += samples[Math.floor(rng() * samples.length)] * s + (addedCost ? addedCost[i] : 0);
  }
  return cost;
}

function toPercentile(sorted: Float64Array, p: number): number | "beyond" {
  const v = percentile(sorted, p);
  return v === Infinity ? "beyond" : v;
}

/** `spendScale` multiplies every drawn spend sample (the Forecast view's What-if capacity: burn scales
 *  with team availability); the seed ignores it, so a scaled run draws the same days as the unscaled one.
 *  Trial `t` draws from its own sub-stream `seedFrom([base, t])`, so one trial's finish day never moves
 *  another trial's draws: two columns that differ only in some trials' days share every other draw. */
export function simulateCostAtFinish(a: {
  trialDays: Int32Array; samples: readonly number[]; ac: number; bac: number; seedTag: string; horizon: number;
  /** A number (What-if) or a per-day schedule, index 1..horizon (Scenarios: the clamped availability product). */
  spendScale?: number | Float64Array;
  /** Baseline-currency cost per simulated working day, index 1..horizon (Scenarios: added people). */
  addedCost?: Float64Array;
}): CostAtFinish {
  const { trialDays, samples, ac, bac, seedTag, horizon, addedCost } = a;
  const scale = a.spendScale ?? 1;
  assertCoversHorizon(scale, horizon, "spendScale");
  assertCoversHorizon(addedCost, horizon, "addedCost");
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
  const base = seedFrom([...samples, ac, bac, seedTag, "cost"]);
  const costs = new Float64Array(trialDays.length);
  let over = 0;
  for (let t = 0; t < trialDays.length; t += 1) {
    const days = trialDays[t];
    const cost = days > horizon
      ? Infinity
      : trialCost(mulberry32(seedFrom([base, t])), ac, days, samples, scale, addedCost);
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
