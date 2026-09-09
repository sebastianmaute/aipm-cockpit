import { describe, expect, it, test } from "vitest";
import {
  addToBuckets,
  weekToDate,
  nextWeekReset,
  usageCostEquivalent,
  USAGE_COST_WEIGHTS,
  type UsageBuckets,
} from "./ai-usage";

const MON = new Date("2026-06-08T10:00:00"); // Monday
const WED = new Date("2026-06-10T10:00:00");
const PREV_SUN = new Date("2026-06-07T10:00:00"); // previous week (Sunday)

test("addToBuckets accumulates per ISO date", () => {
  let b: UsageBuckets = {};
  b = addToBuckets(b, WED, { input: 100, output: 50, cacheWrite: 0, cacheRead: 0 });
  b = addToBuckets(b, WED, { input: 10, output: 5, cacheWrite: 0, cacheRead: 0 });
  expect(b["2026-06-10"]).toEqual({ input: 110, output: 55, cacheWrite: 0, cacheRead: 0 });
});

test("weekToDate sums Monday..now of the current week only", () => {
  let b: UsageBuckets = {};
  b = addToBuckets(b, PREV_SUN, { input: 1000, output: 0, cacheWrite: 0, cacheRead: 0 }); // excluded
  b = addToBuckets(b, MON, { input: 100, output: 100, cacheWrite: 0, cacheRead: 0 });
  b = addToBuckets(b, WED, { input: 200, output: 0, cacheWrite: 0, cacheRead: 0 });
  // Cost basis, not a raw sum: MON (100*1 + 100*5=600) + WED (200*1=200) = 800;
  // prev week still excluded.
  expect(weekToDate(b, WED)).toBe(800);
});

it("accumulates all four fields into a bucket", () => {
  const b = addToBuckets({}, new Date(2026, 8, 8), { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 });
  const b2 = addToBuckets(b, new Date(2026, 8, 8), { input: 10, output: 20, cacheWrite: 30, cacheRead: 40 });
  expect(b2["2026-09-08"]).toEqual({ input: 11, output: 22, cacheWrite: 33, cacheRead: 44 });
});

it("counts every billed field in the week total, weighted by cost", () => {
  const now = new Date(2026, 8, 8); // Tuesday
  const b = addToBuckets({}, now, { input: 1, output: 2, cacheWrite: 4, cacheRead: 8 });
  // 1*1 + 4*1.25 + 8*0.1 + 2*5 = 1 + 5 + 0.8 + 10 = 16.8
  expect(weekToDate(b, now)).toBeCloseTo(16.8, 6);
});

// ★ THE UPGRADE CASE. A legacy bucket persisted before the cache fields
// existed has only input/output. Adding to it must not produce NaN — NaN
// defeats every cap comparison silently.
it("treats a legacy bucket's missing cache fields as zero", () => {
  const legacy = { "2026-09-08": { input: 5, output: 5 } } as unknown as UsageBuckets;
  const b = addToBuckets(legacy, new Date(2026, 8, 8), { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 });
  expect(b["2026-09-08"]).toEqual({ input: 6, output: 6, cacheWrite: 1, cacheRead: 1 });
  // 6*1 + 1*1.25 + 1*0.1 + 6*5 = 6 + 1.25 + 0.1 + 30 = 37.35
  expect(weekToDate(b, new Date(2026, 8, 8))).toBeCloseTo(37.35, 6);
});

// ★ THE LOAD-BEARING CALL. A bucket read from storage reaches weekToDate
// without ever passing through addToBuckets, so weekToDate must do its own
// defaulting. Feeding it an addToBuckets OUTPUT cannot prove that — the value
// is already complete by then.
it("defaults a raw legacy bucket's missing fields when totalling the week", () => {
  const legacy = { "2026-09-08": { input: 5, output: 5 } } as unknown as UsageBuckets;
  // 5*1 + 5*5 = 30 (missing cacheWrite/cacheRead default to 0).
  expect(weekToDate(legacy, new Date(2026, 8, 8))).toBe(30);
});

it("weekToDate totals the week on the cost basis, not the raw sum", () => {
  const now = new Date(2026, 8, 9); // Wed 2026-09-09
  const buckets = {
    "2026-09-08": { input: 0, output: 0, cacheWrite: 0, cacheRead: 1000 },
  };
  // Raw sum would be 1000; cached input is billed at a tenth.
  expect(weekToDate(buckets, now)).toBeCloseTo(100, 6);
});

test("nextWeekReset is next Monday 00:00 local", () => {
  const r = nextWeekReset(WED);
  expect(r.getDay()).toBe(1);
  expect(r.getHours()).toBe(0);
  expect(r > WED).toBe(true);
});

describe("usageCostEquivalent", () => {
  // The eight figures below are turns 1 and 4 of the NEW arm of the live
  // 8-request measurement (2026-09-09, claude-sonnet-5). ★ Of the eight
  // numbers, docs/AGENTS/ai-assistant.md corroborates three — 13305, 17796
  // and the 3688.7 cost of turn 4 — and independently states the same weight
  // set; the per-turn breakdown lives only in
  // docs/superpowers/plans/2026-09-09-ai-cost-basis-and-task-list-narrowing.md,
  // because the harness was a scratchpad script that is not part of this repo.
  //
  // ★★ WHAT THIS BLOCK DOES NOT PIN: the weights themselves. Two fixtures are
  // two equations in four unknowns, so this describe() passes under a large
  // family of wrong weightings — including ones that satisfy both toBeCloseTo
  // fixtures, the >5 ratio, the ordering test AND the strict toBe(150) at once.
  // (A count was quoted here and has been removed: the sweep's grid, bounds and
  // step were recorded nowhere, so the figure could not be re-derived.)
  //
  // ★★★ WHAT DOES PIN THEM: the FIVE `weekToDate` assertions above
  // (`grep -n "weekToDate(" src/app/ai-usage.test.ts`), which are
  // OVER-DETERMINED BY EXACTLY ONE. Any four of the five uniquely fix all four
  // weights — solved for each of the five drop-one cases — so deleting ONE is
  // safe and deleting TWO is not, and nothing will tell you which deletion was
  // the fatal one. An earlier revision of this comment said "the four
  // assertions" and "do not delete one of those": wrong on the count, and wrong
  // in both directions on the imperative.
  // What the cold/warm pair buys, and nothing else provides, is the SPREAD
  // demonstration in the third test.
  it("prices a cold first turn, where the cache write dominates", () => {
    const cold = { input: 1279, cacheWrite: 13305, cacheRead: 17796, output: 64 };
    // 1279*1 + 13305*1.25 + 17796*0.1 + 64*5
    expect(usageCostEquivalent(cold)).toBeCloseTo(20009.85, 2);
  });

  it("prices a warm turn, where the cache read dominates", () => {
    const warm = { input: 306, cacheWrite: 41, cacheRead: 31664, output: 33 };
    // 306*1 + 41*1.25 + 31664*0.1 + 33*5
    expect(usageCostEquivalent(warm)).toBeCloseTo(3688.65, 2);
  });

  it("prices the warm turn far below the cold one even though their raw sums match", () => {
    const cold = { input: 1279, cacheWrite: 13305, cacheRead: 17796, output: 64 };
    const warm = { input: 306, cacheWrite: 41, cacheRead: 31664, output: 33 };
    const rawCold = cold.input + cold.cacheWrite + cold.cacheRead + cold.output;
    const rawWarm = warm.input + warm.cacheWrite + warm.cacheRead + warm.output;
    // Within 2% of each other on a raw sum...
    expect(Math.abs(rawCold - rawWarm) / rawCold).toBeLessThan(0.02);
    // ...and more than 5x apart on cost. This is the whole reason the basis
    // changed: a raw sum cannot rank two conversations by what they cost.
    expect(usageCostEquivalent(cold) / usageCostEquivalent(warm)).toBeGreaterThan(5);
  });

  it("defaults a missing field to 0 rather than yielding NaN", () => {
    // A bucket persisted before the cache-token widening carries only
    // input/output. `undefined * weight` is NaN, and every comparison against
    // NaN is false — which makes crossed80/crossed100 permanently false, i.e.
    // silently disables the cap the user configured.
    const legacy = { input: 100, output: 10 } as unknown as Parameters<typeof usageCostEquivalent>[0];
    expect(usageCostEquivalent(legacy)).toBe(150);
    expect(Number.isNaN(usageCostEquivalent(legacy))).toBe(false);
  });

  it("weights output heaviest and cached input lightest", () => {
    expect(USAGE_COST_WEIGHTS.output).toBeGreaterThan(USAGE_COST_WEIGHTS.cacheWrite);
    expect(USAGE_COST_WEIGHTS.cacheWrite).toBeGreaterThan(USAGE_COST_WEIGHTS.input);
    expect(USAGE_COST_WEIGHTS.input).toBeGreaterThan(USAGE_COST_WEIGHTS.cacheRead);
  });
});
