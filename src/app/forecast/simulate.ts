/** Monte Carlo "When" and "How many" simulation over a throughput history (§502). */

export type SimOptions = {
  trials: number;
  rng: () => number;
  /** Team-capacity multiplier, 0.1–3. */
  capacity: number;
  /** Working days simulated before a trial is reported as beyond. */
  horizon: number;
  /** Tasks unit: stochastic-round each day to whole tasks. Effort unit keeps the fraction. */
  integer: boolean;
};

/** One simulated working day: a bootstrap draw scaled by capacity (empty history = 0). */
export function drawDay(samples: readonly number[], o: SimOptions): number {
  if (samples.length === 0) return 0;
  const x = samples[Math.floor(o.rng() * samples.length)] * o.capacity;
  if (!o.integer) return x;
  const whole = Math.floor(x);
  return whole + (o.rng() < x - whole ? 1 : 0);
}

/** Working days until `backlog` is done, per trial, sorted ascending; `horizon + 1` = beyond. */
export function simulateWhen(
  samples: readonly number[],
  backlog: number,
  o: SimOptions,
): { days: Int32Array; beyondShare: number } {
  const days = new Int32Array(o.trials);
  let beyond = 0;
  if (backlog > 0) {
    for (let t = 0; t < o.trials; t += 1) {
      let done = 0;
      let d = 0;
      while (done < backlog && d < o.horizon) {
        d += 1;
        done += drawDay(samples, o);
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

/** Amount delivered within `days` working days, per trial, sorted ascending. */
export function simulateHowMany(
  samples: readonly number[],
  days: number,
  o: SimOptions,
): Float64Array {
  const out = new Float64Array(o.trials);
  for (let t = 0; t < o.trials; t += 1) {
    let total = 0;
    for (let d = 0; d < days; d += 1) total += drawDay(samples, o);
    out[t] = total;
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
