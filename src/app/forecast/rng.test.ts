import { describe, expect, test } from "vitest";
import { mulberry32, seedFrom } from "./rng";

describe("mulberry32", () => {
  test("same seed gives identical first values", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
  });

  test("different seeds differ", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(Array.from({ length: 5 }, () => b()));
  });

  test("skip(n) leaves the stream exactly where n draws would", () => {
    for (const n of [0, 1, 2, 7, 2600, 123457]) {
      const drawn = mulberry32(99);
      for (let i = 0; i < n; i += 1) drawn();
      const skipped = mulberry32(99);
      skipped.skip(n);
      expect(Array.from({ length: 3 }, () => skipped()), `skip(${n})`).toEqual(Array.from({ length: 3 }, () => drawn()));
    }
  });

  test("draws stay in [0, 1) with a mean near one half", () => {
    const r = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 10000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeGreaterThan(0.49);
    expect(sum / 10000).toBeLessThan(0.51);
  });
});

describe("seedFrom", () => {
  test("is stable across calls and sensitive to the parts", () => {
    expect(seedFrom(["a", 1])).toBe(seedFrom(["a", 1]));
    expect(seedFrom(["a", 1])).not.toBe(seedFrom(["a", 2]));
  });

  test("returns an unsigned 32-bit integer", () => {
    const s = seedFrom(["project", 3, "2026-10-14"]);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});
