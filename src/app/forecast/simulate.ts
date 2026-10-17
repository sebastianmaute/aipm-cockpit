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

/**
 * Working days until `backlog` is done, per trial, sorted ascending (`days`) and in trial order
 * (`trialDays`); `horizon + 1` = beyond. A trial
 * that cannot reach the backlog even at the best possible day stops and skips its remaining draws, so
 * the result is the same as walking it to the horizon.
 */
export function simulateWhen(
  samples: readonly number[],
  backlog: number,
  o: SimOptions,
): { days: Int32Array; trialDays: Int32Array; beyondShare: number } {
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
      }
    }
  }
  const trialDays = days.slice();
  days.sort();
  return { days, trialDays, beyondShare: o.trials === 0 ? 0 : beyond / o.trials };
}

/**
 * Amount delivered within `days` working days, per trial, sorted ascending. Capped at `backlog`:
 * a trial cannot deliver more than is open, so it stops drawing once the backlog is done.
 */
export function simulateHowMany(
  samples: readonly number[],
  days: number,
  backlog: number,
  o: SimOptions,
): Float64Array {
  const out = new Float64Array(o.trials);
  const { draw } = dayDrawer(samples, o);
  for (let t = 0; t < o.trials; t += 1) {
    let total = 0;
    for (let d = 1; d <= days && total < backlog; d += 1) total += draw(d);
    out[t] = Math.min(total, backlog);
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
