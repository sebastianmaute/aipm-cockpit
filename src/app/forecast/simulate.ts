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
};

export type DayDrawer = {
  /** One simulated working day. */
  draw: () => number;
  /** The most one day can deliver, for the early exits. */
  max: number;
  /** Advance the stream past `days` simulated days, landing where drawing them would. */
  skipDays: (days: number) => void;
};

/**
 * The one place a simulated working day is drawn: a bootstrap sample scaled by capacity (empty
 * history = 0), stochastically rounded to whole tasks when `integer`. The per-sample arithmetic is
 * hoisted out of the loop; each day makes the same rng calls (1, or 2 when `integer`) with the same values.
 */
export function dayDrawer(samples: readonly number[], o: SimOptions): DayDrawer {
  const n = samples.length;
  if (n === 0) return { draw: () => 0, max: 0, skipDays: () => {} };
  const { rng } = o;
  const scaled = Float64Array.from(samples, (s) => s * o.capacity);
  const callsPerDay = o.integer ? 2 : 1;
  const skipDays = (days: number) => {
    if (days <= 0) return;
    if (o.rng.skip) o.rng.skip(days * callsPerDay);
    else for (let i = 0; i < days * callsPerDay; i += 1) o.rng();
  };
  // A reduce, not `Math.max(...)`: a spread throws a RangeError past the engine's argument limit.
  if (!o.integer) return { draw: () => scaled[Math.floor(rng() * n)], max: scaled.reduce((a, x) => Math.max(a, x), 0), skipDays };
  const whole = scaled.map((x) => Math.floor(x));
  const frac = scaled.map((x, i) => x - whole[i]);
  // A whole sample cannot round up (`rng() < 0` is never true), so its rounding draw is skipped, not computed.
  const { skip } = o.rng;
  const skipOne = skip ? () => skip(1) : () => void o.rng();
  return {
    draw: () => {
      const i = Math.floor(rng() * n);
      if (frac[i] === 0) {
        skipOne();
        return whole[i];
      }
      return whole[i] + (rng() < frac[i] ? 1 : 0);
    },
    max: whole.reduce((a, w, i) => Math.max(a, w + (frac[i] > 0 ? 1 : 0)), 0),
    skipDays,
  };
}

/** One simulated working day (see `dayDrawer`). */
export function drawDay(samples: readonly number[], o: SimOptions): number {
  return dayDrawer(samples, o).draw();
}

/** Relative slack on the effort unit's float sums, far above the rounding of 1,300 additions. */
const FLOAT_SLACK = 1e-9;

/** True only when `done` plus `days` of the best possible day still falls short of `target`. */
export function cannotReach(done: number, days: number, max: number, target: number): boolean {
  return (done + days * max) * (1 + FLOAT_SLACK) < target;
}

/**
 * Working days until `backlog` is done, per trial, sorted ascending; `horizon + 1` = beyond. A trial
 * that cannot reach the backlog even at the best possible day stops and skips its remaining draws, so
 * the result is the same as walking it to the horizon.
 */
export function simulateWhen(
  samples: readonly number[],
  backlog: number,
  o: SimOptions,
): { days: Int32Array; beyondShare: number } {
  const days = new Int32Array(o.trials);
  let beyond = 0;
  const { draw, max, skipDays } = dayDrawer(samples, o);
  // Before this day even a best day every day could still cover the backlog: no need to ask.
  const checkFrom = max > 0 ? o.horizon - backlog / max : 0;
  if (backlog > 0) {
    for (let t = 0; t < o.trials; t += 1) {
      let done = 0;
      let d = 0;
      while (done < backlog && d < o.horizon) {
        if (d >= checkFrom && cannotReach(done, o.horizon - d, max, backlog)) {
          skipDays(o.horizon - d);
          break;
        }
        d += 1;
        done += draw();
      }
      if (done < backlog) {
        days[t] = o.horizon + 1;
        beyond += 1;
      } else {
        days[t] = d;
      }
    }
  }
  days.sort();
  return { days, beyondShare: o.trials === 0 ? 0 : beyond / o.trials };
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
    for (let d = 0; d < days && total < backlog; d += 1) total += draw();
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
