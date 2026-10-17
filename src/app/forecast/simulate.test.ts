import { describe, expect, test } from "vitest";
import { mulberry32 } from "./rng";
import { buildArrivals, dayDrawer, drawDay, percentile, simulateHowMany, simulateWhen, type SimOptions } from "./simulate";

/** A backlog no test in this file reaches, for the cases that are not about the cap. */
const UNCAPPED = Number.MAX_SAFE_INTEGER;

function opts(over: Partial<SimOptions> = {}): SimOptions {
  return { trials: 200, rng: mulberry32(42), capacity: 1, horizon: 1300, integer: true, ...over };
}

describe("simulateWhen", () => {
  test("trialDays is the unsorted per-trial result and sorts to days", () => {
    const r = simulateWhen([0, 1, 2, 3], 20, opts({ rng: mulberry32(7) }));
    expect(r.trialDays).toHaveLength(r.days.length);
    expect(Array.from(r.trialDays).sort((a, b) => a - b)).toEqual(Array.from(r.days));
    expect(Array.from(r.trialDays)).not.toEqual(Array.from(r.days)); // trial order, not sorted
  });

  test("constant throughput of 2/day finishes 10 tasks in exactly 5 days", () => {
    const { days, beyondShare } = simulateWhen([2], 10, opts());
    expect(days).toHaveLength(200);
    expect(Array.from(days).every((d) => d === 5)).toBe(true);
    expect(beyondShare).toBe(0);
  });

  test("empty backlog finishes on day 0", () => {
    const { days } = simulateWhen([2], 0, opts());
    expect(Array.from(days).every((d) => d === 0)).toBe(true);
  });

  test("same seed gives identical results", () => {
    const a = simulateWhen([0, 1, 3, 5], 40, opts({ rng: mulberry32(7) }));
    const b = simulateWhen([0, 1, 3, 5], 40, opts({ rng: mulberry32(7) }));
    expect(Array.from(a.days)).toEqual(Array.from(b.days));
  });

  test("results are sorted ascending", () => {
    const { days } = simulateWhen([0, 1, 3, 5], 40, opts());
    expect(Array.from(days)).toEqual(Array.from(days).sort((x, y) => x - y));
  });

  test("all-zero history hits the horizon and reports beyond", () => {
    const o = opts({ horizon: 30 });
    const { days, beyondShare } = simulateWhen([0], 5, o);
    expect(beyondShare).toBe(1);
    expect(percentile(days, 50)).toBe(31);
  });

  test("empty samples are treated as zero per day", () => {
    const { beyondShare } = simulateWhen([], 5, opts({ horizon: 10 }));
    expect(beyondShare).toBe(1);
  });

  test("the certain-beyond early exit gives exactly the days of walking every trial to the horizon", () => {
    // Reference: the plain loop, a short trial drawing every day up to the horizon from the same stream.
    function walked(samples: number[], backlog: number, o: SimOptions): number[] {
      const out: number[] = [];
      for (let t = 0; t < o.trials; t += 1) {
        let done = 0;
        let d = 0;
        while (done < backlog && d < o.horizon) {
          d += 1;
          done += drawDay(samples, o, d);
        }
        out.push(done < backlog ? o.horizon + 1 : d);
      }
      return out.sort((a, b) => a - b);
    }
    const cases: [number[], number, Partial<SimOptions>][] = [
      [[0, 0, 10], 30, { capacity: 0.1, horizon: 120 }],
      // 0.7 and 2.8 round up to 1 and 3: the best day is 3, not the whole part 2.
      [[0, 1, 4], 95, { capacity: 0.7, horizon: 80 }],
      [[0, 2.5, 7.25], 300, { integer: false, horizon: 90 }],
    ];
    for (const [samples, backlog, over] of cases) {
      const fast = simulateWhen(samples, backlog, opts({ ...over, rng: mulberry32(5) }));
      const slow = walked(samples, backlog, opts({ ...over, rng: mulberry32(5) }));
      const beyond = (over.horizon ?? 0) + 1;
      expect(fast.days.includes(beyond) && fast.days.some((d) => d < beyond), "the case has both outcomes").toBe(true);
      expect(Array.from(fast.days), `early exit is exact for ${JSON.stringify(samples)}`).toEqual(slow);
    }
  });

  test("an rng without skip draws and drops instead, with the same result", () => {
    const plain = mulberry32(5);
    const fast = simulateWhen([0, 0, 10], 30, opts({ capacity: 0.1, horizon: 120, rng: mulberry32(5) }));
    const dropped = simulateWhen([0, 0, 10], 30, opts({ capacity: 0.1, horizon: 120, rng: () => plain() }));
    expect(Array.from(dropped.days)).toEqual(Array.from(fast.days));
  });

  test("capacity 0.5 roughly doubles the days", () => {
    const { days } = simulateWhen([2], 10, opts({ capacity: 0.5 }));
    const p50 = percentile(days, 50);
    expect(p50).toBeGreaterThanOrEqual(9);
    expect(p50).toBeLessThanOrEqual(11);
  });
});

describe("capacityByDay", () => {
  /** Plain When under a schedule: sample x m[day], stochastic-rounded, every day to the horizon, trial order. */
  function referenceWhen(samples: number[], backlog: number, m: Float64Array): number[] {
    const o = opts();
    const out: number[] = [];
    for (let t = 0; t < o.trials; t += 1) {
      let done = 0;
      let d = 0;
      while (done < backlog && d < o.horizon) {
        d += 1;
        const x = samples[Math.floor(o.rng() * samples.length)] * m[d];
        const whole = Math.floor(x);
        done += whole + (o.rng() < x - whole ? 1 : 0);
      }
      out.push(done < backlog ? o.horizon + 1 : d);
    }
    return out;
  }

  test("a flat capacityByDay draws exactly what the scalar capacity draws, both units", () => {
    for (const integer of [true, false]) {
      const flat = new Float64Array(1301).fill(1.3);
      const a = simulateWhen([0, 1, 2, 3, 5], 120, opts({ integer, capacity: 1.3 }));
      const b = simulateWhen([0, 1, 2, 3, 5], 120, opts({ integer, capacity: 1, capacityByDay: flat }));
      expect(Array.from(b.trialDays), `When, integer: ${integer}`).toEqual(Array.from(a.trialDays));
      expect(Array.from(simulateHowMany([0, 1, 2, 3, 5], 40, 120, opts({ integer, capacityByDay: flat }))), `How many, integer: ${integer}`)
        .toEqual(Array.from(simulateHowMany([0, 1, 2, 3, 5], 40, 120, opts({ integer, capacity: 1.3 }))));
    }
  });

  test("a day's multiplier scales only its own day", () => {
    const m = new Float64Array(1301).fill(0.5);
    for (let d = 1; d <= 5; d += 1) m[d] = 1;
    expect(Array.from(simulateWhen([2], 15, opts({ capacityByDay: m })).days).every((d) => d === 10)).toBe(true); // 5x2 + 5x1
  });

  test("the certain-beyond exit stays exact under a varying multiplier", () => {
    // ~1.8 tasks a day on average -> ~2,340 by day 1300; a backlog of 2,340 gives both outcomes.
    const m = Float64Array.from({ length: 1301 }, (_, d) => (d % 2 ? 0.2 : 2.5));
    const fast = simulateWhen([0, 1, 3], 2340, opts({ capacityByDay: m }));
    expect(fast.days.includes(1301) && fast.days.some((d) => d < 1301), "the case has both outcomes").toBe(true);
    expect(Array.from(fast.trialDays)).toEqual(referenceWhen([0, 1, 3], 2340, m));
  });

  test("a schedule shorter than horizon + 1 throws rather than finishing trials where it runs out", () => {
    const short = new Float64Array(1300).fill(1); // horizon 1300 needs 1301 entries (index 0 unused)
    expect(() => simulateWhen([2], 10, opts({ capacityByDay: short }))).toThrow("capacityByDay needs horizon + 1 = 1301 entries, got 1300");
    expect(() => dayDrawer([], opts({ capacityByDay: short }))).toThrow(RangeError);
    expect(() => dayDrawer([2], opts({ capacityByDay: new Float64Array(1301).fill(1) }))).not.toThrow();
  });

  test("bestBetween is the sum of each day's best", () => {
    const m = Float64Array.from([0, 1, 2, 0.5]);
    // Tasks: ceil(1.4) + ceil(2.8) + ceil(0.7) = 2 + 3 + 1.
    const tasks = dayDrawer([1.4], opts({ horizon: 3, capacityByDay: m }));
    expect(tasks.bestBetween(0, 3)).toBe(6);
    expect(tasks.bestBetween(1, 3)).toBe(4);
    expect(tasks.bestBetween(2, 2)).toBe(0);
    expect(tasks.max).toBe(3);
    // Effort keeps the fraction: 1.4 + 2.8 + 0.7.
    const effort = dayDrawer([1.4], opts({ horizon: 3, integer: false, capacityByDay: m }));
    expect(effort.bestBetween(0, 3)).toBeCloseTo(4.9, 12);
    expect(effort.max).toBeCloseTo(2.8, 12);
    // Without a schedule: the days times the best day, ceil(1.4 x 2) = 3.
    const flat = dayDrawer([1.4], opts({ capacity: 2 }));
    expect(flat.max).toBe(3);
    expect(flat.bestBetween(2, 7)).toBe(15);
  });
});

describe("dated scope arrivals", () => {
  test("buildArrivals clamps at zero after each step", () => {
    const a = buildArrivals(10, [{ day: 3, amount: 5 }, { day: 5, amount: -20 }, { day: 7, amount: 2 }], 10);
    expect(a.arrivedAt).toHaveLength(11);
    expect([a.arrivedAt[2], a.arrivedAt[3], a.arrivedAt[4], a.arrivedAt[5], a.arrivedAt[6], a.arrivedAt[7], a.arrivedAt[10]]).toEqual([10, 15, 15, 0, 0, 2, 2]);
    expect(a.lastPositiveDay).toBe(7);
    // suffixMin[d] = the smallest arrivedAt from d on.
    expect(Array.from(a.suffixMin)).toEqual([0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2]);
  });

  test("buildArrivals with no positive step has lastPositiveDay 0, and clamps a step past the horizon", () => {
    expect(buildArrivals(4, [{ day: 2, amount: -1 }], 5).lastPositiveDay).toBe(0);
    const late = buildArrivals(4, [{ day: 99, amount: 3 }], 5);
    expect(late.lastPositiveDay).toBe(5);
    expect(late.arrivedAt[5]).toBe(7);
    expect(late.arrivedAt[4]).toBe(4);
  });

  test("work cannot be delivered before it arrives", () => {
    // 5 a day; 2 open, 10 more on day 6: done reads 2,2,2,2,2,7,12 — finished on day 7, not day 6.
    const arrivals = buildArrivals(2, [{ day: 6, amount: 10 }], 1300);
    const r = simulateWhen([5], 12, opts({ integer: false }), arrivals);
    expect(Array.from(r.trialDays).every((d) => d === 7)).toBe(true);
    expect(r.beyondShare).toBe(0);
  });

  test("a removal never goes below zero and does not hold the finish back", () => {
    const arrivals = buildArrivals(10, [{ day: 2, amount: -20 }], 1300);
    const r = simulateWhen([3], 10, opts(), arrivals);
    expect(Array.from(r.trialDays).every((d) => d === 2)).toBe(true);
  });

  test("How many counts only arrived work", () => {
    const arrivals = buildArrivals(5, [{ day: 4, amount: 10 }], 1300);
    expect(Array.from(simulateHowMany([4], 3, 15, opts(), arrivals)).every((v) => v === 5)).toBe(true);
    expect(Array.from(simulateHowMany([4], 6, 15, opts(), arrivals)).every((v) => v === 15)).toBe(true);
  });

  test("the certain-beyond exit stays exact with arrivals", () => {
    // Reference: every trial walks day by day (sample x m[day], stochastic-rounded, capped at arrivedAt[day]) until
    // it is done on or after the last addition, or reaches the horizon.
    const m = Float64Array.from({ length: 1301 }, (_, d) => (d % 2 ? 0.2 : 2.5));
    const samples = [0, 1, 3];
    const arrivals = buildArrivals(2000, [{ day: 400, amount: 340 }], 1300);
    const o = opts();
    const slow: number[] = [];
    for (let t = 0; t < o.trials; t += 1) {
      let done = 0;
      let d = 0;
      while (!(d >= arrivals.lastPositiveDay && done >= arrivals.arrivedAt[d]) && d < o.horizon) {
        d += 1;
        const x = samples[Math.floor(o.rng() * samples.length)] * m[d];
        const whole = Math.floor(x);
        done = Math.min(done + whole + (o.rng() < x - whole ? 1 : 0), arrivals.arrivedAt[d]);
      }
      slow.push(d >= arrivals.lastPositiveDay && done >= arrivals.arrivedAt[d] ? d : o.horizon + 1);
    }
    const fast = simulateWhen(samples, 2340, opts({ capacityByDay: m }), arrivals);
    expect(fast.days.includes(1301) && fast.days.some((d) => d < 1301), "the case has both outcomes").toBe(true);
    expect(Array.from(fast.trialDays)).toEqual(slow);
  });
});

describe("simulateHowMany", () => {
  test("how many after 5 days at 2/day is 10", () => {
    const out = simulateHowMany([2], 5, UNCAPPED, opts());
    expect(Array.from(out).every((v) => v === 10)).toBe(true);
  });

  test("a trial never delivers more than the backlog", () => {
    // 2/day for 5 days would be 10, but only 5 are open; effort fractions are capped the same way.
    const out = simulateHowMany([2], 5, 5, opts());
    expect(Array.from(out).every((v) => v === 5), "How-many is capped at the backlog").toBe(true);
    const frac = simulateHowMany([3], 4, 2.5, opts({ integer: false }));
    expect(Array.from(frac).every((v) => v === 2.5), "How-many is capped at the backlog (effort)").toBe(true);
  });

  test("integer: false keeps fractions", () => {
    const out = simulateHowMany([3], 2, UNCAPPED, opts({ capacity: 0.5, integer: false }));
    expect(Array.from(out).every((v) => v === 3)).toBe(true);
  });

  test("integer: true stochastic-rounds to whole numbers", () => {
    const out = simulateHowMany([3], 2, UNCAPPED, opts({ capacity: 0.5 }));
    expect(Array.from(out).every((v) => Number.isInteger(v) && v >= 2 && v <= 4)).toBe(true);
  });

  test("stochastic rounding averages to the fraction, both ways (T2b)", () => {
    // 1 x 0.5 per day: each day rounds to 0 or 1, and the mean over many draws is 0.5.
    // A floor-only rounding would make every draw 0 (80 % capacity on 1-task days would never finish).
    const out = Array.from(simulateHowMany([1], 1, UNCAPPED, opts({ trials: 4000, capacity: 0.5 })));
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    expect(out).toContain(0);
    expect(out).toContain(1);
    expect(mean).toBeGreaterThan(0.46);
    expect(mean).toBeLessThan(0.54);
  });

  test("results are sorted ascending", () => {
    const out = simulateHowMany([0, 4], 5, UNCAPPED, opts());
    expect(Array.from(out)).toEqual(Array.from(out).sort((x, y) => x - y));
  });
});

describe("drawDay", () => {
  test("empty samples draw 0", () => {
    expect(drawDay([], opts())).toBe(0);
  });

  test("the hoisted drawer draws the plain formula's values from the same stream, both units", () => {
    // Plain: sample x capacity, stochastic-rounded with a second draw (which a whole value cannot pass).
    const samples = [0, 1, 3, 10, 2.5];
    for (const integer of [true, false]) {
      const ref = mulberry32(11);
      const expected = Array.from({ length: 500 }, () => {
        const x = samples[Math.floor(ref() * samples.length)] * 0.7;
        if (!integer) return x;
        const whole = Math.floor(x);
        return whole + (ref() < x - whole ? 1 : 0);
      });
      const { draw } = dayDrawer(samples, opts({ capacity: 0.7, integer, rng: mulberry32(11) }));
      expect(Array.from({ length: 500 }, (_, i) => draw(i + 1)), `integer: ${integer}`).toEqual(expected);
    }
  });
});

describe("percentile", () => {
  test("percentile uses nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80)).toBe(8);
  });
});
