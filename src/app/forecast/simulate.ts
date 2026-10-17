/** Monte Carlo "When" and "How many" simulation over a throughput history (§502). */

export type SimOptions = {
  trials: number;
  /** `skip` (as `mulberry32` has) lets an early exit jump the stream; without it the draws are made and dropped. */
  rng: (() => number) & { skip?: (calls: number) => void };
  /** Team-capacity multiplier, 0.1–3. */
  capacity: number;
  /** Working days simulated before a trial is reported as beyond. */
  horizon: number;
  /** Tasks unit: stochastic-round each day to whole tasks. Effort unit keeps the fraction. */
  integer: boolean;
  /** Multiplier per simulated working day, index 1..horizon (index 0 unused). When set it replaces `capacity`. */
  capacityByDay?: Float64Array;
};

export type DayDrawer = {
  /** One simulated working day; `day` (1-based) picks that day's multiplier under `capacityByDay`. */
  draw: (day: number) => number;
  /** The most one day can deliver (under a schedule, the largest day's best). */
  max: number;
  /** The most the days (afterDay, throughDay] can deliver together, for the early exits. */
  bestBetween: (afterDay: number, throughDay: number) => number;
  /** Advance the stream past `days` simulated days, landing where drawing them would. */
  skipDays: (days: number) => void;
};

type Skips = { skipDays: (days: number) => void; skipOne: () => void };

/**
 * The one place a simulated working day is drawn: a bootstrap sample scaled by capacity, or by the day's
 * own `capacityByDay` multiplier (empty history = 0), stochastically rounded to whole tasks when
 * `integer`. Each day makes the same rng calls (1, or 2 when `integer`) whatever its multiplier, so the
 * stream position after N days never depends on the schedule.
 */
export function dayDrawer(samples: readonly number[], o: SimOptions): DayDrawer {
  // A short schedule would read `undefined` past its end and silently finish trials on that day.
  if (o.capacityByDay && o.capacityByDay.length < o.horizon + 1) {
    throw new RangeError(`capacityByDay needs horizon + 1 = ${o.horizon + 1} entries, got ${o.capacityByDay.length}`);
  }
  if (samples.length === 0) return { draw: () => 0, max: 0, bestBetween: () => 0, skipDays: () => {} };
  const callsPerDay = o.integer ? 2 : 1;
  const skipDays = (days: number) => {
    if (days <= 0) return;
    if (o.rng.skip) o.rng.skip(days * callsPerDay);
    else for (let i = 0; i < days * callsPerDay; i += 1) o.rng();
  };
  // A whole value cannot round up (`rng() < 0` is never true), so its rounding draw is skipped, not computed.
  const { skip } = o.rng;
  const skipOne = skip ? () => skip(1) : () => void o.rng();
  const skips = { skipDays, skipOne };
  return o.capacityByDay ? scheduledDrawer(samples, o, o.capacityByDay, skips) : flatDrawer(samples, o, skips);
}

/** One capacity for every day: the per-sample arithmetic is hoisted out of the loop. */
function flatDrawer(samples: readonly number[], o: SimOptions, { skipDays, skipOne }: Skips): DayDrawer {
  const n = samples.length;
  const { rng } = o;
  const scaled = Float64Array.from(samples, (s) => s * o.capacity);
  if (!o.integer) {
    // A reduce, not `Math.max(...)`: a spread throws a RangeError past the engine's argument limit.
    const max = scaled.reduce((a, x) => Math.max(a, x), 0);
    return { draw: () => scaled[Math.floor(rng() * n)], max, bestBetween: (a, b) => (b - a) * max, skipDays };
  }
  const whole = scaled.map((x) => Math.floor(x));
  const frac = scaled.map((x, i) => x - whole[i]);
  const max = whole.reduce((a, w, i) => Math.max(a, w + (frac[i] > 0 ? 1 : 0)), 0);
  return {
    draw: () => {
      const i = Math.floor(rng() * n);
      if (frac[i] === 0) {
        skipOne();
        return whole[i];
      }
      return whole[i] + (rng() < frac[i] ? 1 : 0);
    },
    max,
    bestBetween: (a, b) => (b - a) * max,
    skipDays,
  };
}

/** A multiplier per day: a day's best is the largest sample at that day's multiplier, summed as a prefix. */
function scheduledDrawer(samples: readonly number[], o: SimOptions, m: Float64Array, { skipDays, skipOne }: Skips): DayDrawer {
  const n = samples.length;
  const { rng } = o;
  const top = samples.reduce((a, s) => Math.max(a, s), 0);
  const prefix = new Float64Array(o.horizon + 1);
  let max = 0;
  for (let d = 1; d <= o.horizon; d += 1) {
    const best = o.integer ? Math.ceil(top * m[d]) : top * m[d];
    prefix[d] = prefix[d - 1] + best;
    max = Math.max(max, best);
  }
  const bestBetween = (afterDay: number, throughDay: number) => prefix[throughDay] - prefix[afterDay];
  if (!o.integer) return { draw: (day) => samples[Math.floor(rng() * n)] * m[day], max, bestBetween, skipDays };
  return {
    draw: (day) => {
      const x = samples[Math.floor(rng() * n)] * m[day];
      const whole = Math.floor(x);
      if (whole === x) {
        skipOne();
        return whole;
      }
      return whole + (rng() < x - whole ? 1 : 0);
    },
    max,
    bestBetween,
    skipDays,
  };
}

/**
 * One simulated working day (see `dayDrawer`); `day` (default 1) picks a schedule's multiplier. A one-shot:
 * it builds a drawer per call (under a schedule an O(horizon) prefix), so a loop takes `dayDrawer` once.
 */
export function drawDay(samples: readonly number[], o: SimOptions, day = 1): number {
  return dayDrawer(samples, o).draw(day);
}

/**
 * Relative slack on the effort unit's float sums, far above the rounding of 1,300 additions (and of a
 * schedule's `bestBetween`, a difference of two such prefix sums).
 */
const FLOAT_SLACK = 1e-9;

/** True only when `done` plus `days` of the best possible day still falls short of `target`. */
export function cannotReach(done: number, days: number, max: number, target: number): boolean {
  return (done + days * max) * (1 + FLOAT_SLACK) < target;
}

/** The work that has arrived by each simulated day, for dated scope changes. */
export type Arrivals = {
  /** Index 0..horizon: the open work that has arrived by that day. */
  arrivedAt: Float64Array;
  /** The latest day of a positive step (0 if none): no trial finishes before it. */
  lastPositiveDay: number;
  /** `suffixMin[d]` = the smallest `arrivedAt[d']` for d' ≥ d. */
  suffixMin: Float64Array;
};

/**
 * `arrivedAt[d]` (0..horizon) = base plus the steps with day ≤ d, applied in day order (input order within a
 * day) and clamped at 0 after each step; a step past the horizon lands on it. `lastPositiveDay` = the latest
 * day of a positive step (0 if none); `suffixMin[d]` = min over d' ≥ d.
 */
export function buildArrivals(base: number, steps: readonly { day: number; amount: number }[], horizon: number): Arrivals {
  const sorted = steps
    .map((s) => ({ day: Math.min(horizon, Math.max(0, s.day)), amount: s.amount }))
    .sort((a, b) => a.day - b.day);
  const arrivedAt = new Float64Array(horizon + 1);
  let level = Math.max(0, base);
  let lastPositiveDay = 0;
  let k = 0;
  for (let d = 0; d <= horizon; d += 1) {
    for (; k < sorted.length && sorted[k].day <= d; k += 1) {
      level = Math.max(0, level + sorted[k].amount);
      if (sorted[k].amount > 0) lastPositiveDay = sorted[k].day;
    }
    arrivedAt[d] = level;
  }
  const suffixMin = new Float64Array(horizon + 1);
  for (let d = horizon; d >= 0; d -= 1) suffixMin[d] = d === horizon ? arrivedAt[d] : Math.min(arrivedAt[d], suffixMin[d + 1]);
  return { arrivedAt, lastPositiveDay, suffixMin };
}

/**
 * Working days until `backlog` is done, per trial, sorted ascending (`days`) and in trial order
 * (`trialDays`); `horizon + 1` = beyond. Every trial consumes exactly `horizon` days of draws (an empty backlog
 * draws nothing at all): one that
 * finishes, or that cannot reach the backlog even at the best possible day, skips its remaining draws, so
 * trial t starts at the same stream position whatever the backlog or capacity (common random numbers),
 * and the result is the same as walking it to the horizon. With `arrivals` the backlog is `arrivals`
 * instead (see `whenWithArrivals`).
 */
export function simulateWhen(
  samples: readonly number[],
  backlog: number,
  o: SimOptions,
  arrivals?: Arrivals,
): { days: Int32Array; trialDays: Int32Array; beyondShare: number } {
  if (arrivals) return whenWithArrivals(samples, o, arrivals);
  const days = new Int32Array(o.trials);
  let beyond = 0;
  const { draw, max, bestBetween, skipDays } = dayDrawer(samples, o);
  // Before this day even a best day every day could still cover the backlog: no need to ask. A schedule asks every day.
  const checkFrom = !o.capacityByDay && max > 0 ? o.horizon - backlog / max : 0;
  if (backlog > 0) {
    for (let t = 0; t < o.trials; t += 1) {
      let done = 0;
      let d = 0;
      while (done < backlog && d < o.horizon) {
        if (d >= checkFrom && cannotReach(done, 1, bestBetween(d, o.horizon), backlog)) {
          skipDays(o.horizon - d);
          break;
        }
        d += 1;
        done += draw(d);
      }
      if (done < backlog) {
        days[t] = o.horizon + 1;
        beyond += 1;
      } else {
        days[t] = d;
        skipDays(o.horizon - d);
      }
    }
  }
  return sortedWhen(days, beyond, o.trials);
}

function sortedWhen(days: Int32Array, beyond: number, trials: number): { days: Int32Array; trialDays: Int32Array; beyondShare: number } {
  const trialDays = days.slice();
  days.sort();
  return { days, trialDays, beyondShare: trials === 0 ? 0 : beyond / trials };
}

/**
 * When under dated scope: day 0 has no draw, and `done(d) = min(done(d − 1) + draw(d), arrivedAt[d])` — work
 * cannot be delivered before it arrives. A trial finishes on the smallest `d ≥ lastPositiveDay` with
 * `done(d) ≥ arrivedAt[d]`: added scope must be finished, so a trial done before an addition resumes when it
 * arrives. It is certainly beyond once even the best possible days cannot reach the least work that can be
 * open on any day it could still finish. A finished or certainly-beyond trial skips its remaining draws to the
 * horizon, as the plain path does.
 */
function whenWithArrivals(
  samples: readonly number[],
  o: SimOptions,
  { arrivedAt, lastPositiveDay, suffixMin }: Arrivals,
): { days: Int32Array; trialDays: Int32Array; beyondShare: number } {
  const days = new Int32Array(o.trials);
  let beyond = 0;
  const { draw, bestBetween, skipDays } = dayDrawer(samples, o);
  for (let t = 0; t < o.trials; t += 1) {
    let done = 0;
    let d = 0;
    let finished = false;
    for (;;) {
      if (d >= lastPositiveDay && done >= arrivedAt[d]) {
        finished = true;
        break;
      }
      if (d >= o.horizon) break;
      if (cannotReach(done, 1, bestBetween(d, o.horizon), suffixMin[Math.max(d + 1, lastPositiveDay)])) {
        skipDays(o.horizon - d);
        break;
      }
      d += 1;
      done = Math.min(done + draw(d), arrivedAt[d]);
    }
    if (finished) {
      days[t] = d;
      skipDays(o.horizon - d);
    } else {
      days[t] = o.horizon + 1;
      beyond += 1;
    }
  }
  return sortedWhen(days, beyond, o.trials);
}

/**
 * Amount delivered within `days` working days, per trial, sorted ascending. Capped at `backlog`:
 * a trial cannot deliver more than is open, so it stops drawing once the backlog is done. With `arrivals`
 * `backlog` is unused: a day delivers at most what has arrived by it, and a trial done on or after the last
 * addition stops drawing and reports `arrivedAt[days]` (later removals still lower it). A trial that stops
 * early skips the rest of its `days` draws, so every trial consumes exactly `days` days of the stream.
 */
export function simulateHowMany(
  samples: readonly number[],
  days: number,
  backlog: number,
  o: SimOptions,
  arrivals?: Arrivals,
): Float64Array {
  if (arrivals) return howManyWithArrivals(samples, days, o, arrivals);
  const out = new Float64Array(o.trials);
  const { draw, skipDays } = dayDrawer(samples, o);
  for (let t = 0; t < o.trials; t += 1) {
    let total = 0;
    let d = 0;
    while (d < days && total < backlog) {
      d += 1;
      total += draw(d);
    }
    skipDays(days - d);
    out[t] = Math.min(total, backlog);
  }
  out.sort();
  return out;
}

function howManyWithArrivals(samples: readonly number[], days: number, o: SimOptions, { arrivedAt, lastPositiveDay }: Arrivals): Float64Array {
  const out = new Float64Array(o.trials);
  const { draw, skipDays } = dayDrawer(samples, o);
  for (let t = 0; t < o.trials; t += 1) {
    let done = 0;
    let d = 0;
    while (d < days && !(d >= lastPositiveDay && done >= arrivedAt[d])) {
      d += 1;
      done = Math.min(done + draw(d), arrivedAt[d]);
    }
    skipDays(days - d);
    out[t] = d < days ? arrivedAt[days] : done;
  }
  out.sort();
  return out;
}

/** Nearest-rank percentile of an ascending-sorted array. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sorted[idx];
}
