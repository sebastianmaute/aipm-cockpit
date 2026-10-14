import { describe, expect, test } from "vitest";
import { mulberry32 } from "./rng";
import { drawDay, percentile, simulateHowMany, simulateWhen, type SimOptions } from "./simulate";

function opts(over: Partial<SimOptions> = {}): SimOptions {
  return { trials: 200, rng: mulberry32(42), capacity: 1, horizon: 1300, integer: true, ...over };
}

describe("simulateWhen", () => {
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

  test("capacity 0.5 roughly doubles the days", () => {
    const { days } = simulateWhen([2], 10, opts({ capacity: 0.5 }));
    const p50 = percentile(days, 50);
    expect(p50).toBeGreaterThanOrEqual(9);
    expect(p50).toBeLessThanOrEqual(11);
  });
});

describe("simulateHowMany", () => {
  test("how many after 5 days at 2/day is 10", () => {
    const out = simulateHowMany([2], 5, opts());
    expect(Array.from(out).every((v) => v === 10)).toBe(true);
  });

  test("integer: false keeps fractions", () => {
    const out = simulateHowMany([3], 2, opts({ capacity: 0.5, integer: false }));
    expect(Array.from(out).every((v) => v === 3)).toBe(true);
  });

  test("integer: true stochastic-rounds to whole numbers", () => {
    const out = simulateHowMany([3], 2, opts({ capacity: 0.5 }));
    expect(Array.from(out).every((v) => Number.isInteger(v) && v >= 2 && v <= 4)).toBe(true);
  });

  test("results are sorted ascending", () => {
    const out = simulateHowMany([0, 4], 5, opts());
    expect(Array.from(out)).toEqual(Array.from(out).sort((x, y) => x - y));
  });
});

describe("drawDay", () => {
  test("empty samples draw 0", () => {
    expect(drawDay([], opts())).toBe(0);
  });
});

describe("percentile", () => {
  test("percentile uses nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80)).toBe(8);
  });
});
