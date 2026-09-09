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
  expect(weekToDate(b, WED)).toBe(400); // 100+100+200, prev week excluded
});

it("accumulates all four fields into a bucket", () => {
  const b = addToBuckets({}, new Date(2026, 8, 8), { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 });
  const b2 = addToBuckets(b, new Date(2026, 8, 8), { input: 10, output: 20, cacheWrite: 30, cacheRead: 40 });
  expect(b2["2026-09-08"]).toEqual({ input: 11, output: 22, cacheWrite: 33, cacheRead: 44 });
});

it("counts every billed field in the week total", () => {
  const now = new Date(2026, 8, 8); // Tuesday
  const b = addToBuckets({}, now, { input: 1, output: 2, cacheWrite: 4, cacheRead: 8 });
  expect(weekToDate(b, now)).toBe(15);
});

// ★ THE UPGRADE CASE. A legacy bucket persisted before the cache fields
// existed has only input/output. Adding to it must not produce NaN — NaN
// defeats every cap comparison silently.
it("treats a legacy bucket's missing cache fields as zero", () => {
  const legacy = { "2026-09-08": { input: 5, output: 5 } } as unknown as UsageBuckets;
  const b = addToBuckets(legacy, new Date(2026, 8, 8), { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 });
  expect(b["2026-09-08"]).toEqual({ input: 6, output: 6, cacheWrite: 1, cacheRead: 1 });
  expect(weekToDate(b, new Date(2026, 8, 8))).toBe(14);
});

// ★ THE LOAD-BEARING CALL. A bucket read from storage reaches weekToDate
// without ever passing through addToBuckets, so weekToDate must do its own
// defaulting. Feeding it an addToBuckets OUTPUT cannot prove that — the value
// is already complete by then.
it("defaults a raw legacy bucket's missing fields when totalling the week", () => {
  const legacy = { "2026-09-08": { input: 5, output: 5 } } as unknown as UsageBuckets;
  expect(weekToDate(legacy, new Date(2026, 8, 8))).toBe(10);
});

test("nextWeekReset is next Monday 00:00 local", () => {
  const r = nextWeekReset(WED);
  expect(r.getDay()).toBe(1);
  expect(r.getHours()).toBe(0);
  expect(r > WED).toBe(true);
});

describe("usageCostEquivalent", () => {
  // The four figures below are turns 1 and 4 of the NEW arm of the live
  // 8-request measurement recorded in docs/AGENTS/ai-assistant.md
  // (2026-09-09, claude-sonnet-5). They are used rather than round numbers
  // because the cold/warm SPREAD is the property under test: a single fixture
  // passes under several wrong weightings.
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
