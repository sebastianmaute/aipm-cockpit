import { describe, expect, test } from "vitest";
import { mulberry32 } from "./rng";
import { dayDrawer, drawDay, percentile, simulateHowMany, simulateWhen, type SimOptions } from "./simulate";

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
          done += drawDay(samples, o);
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
      expect(Array.from({ length: 500 }, draw), `integer: ${integer}`).toEqual(expected);
    }
  });
});

describe("percentile", () => {
  test("percentile uses nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80)).toBe(8);
  });
});
