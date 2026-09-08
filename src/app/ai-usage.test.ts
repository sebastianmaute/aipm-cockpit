import { expect, it, test } from "vitest";
import { addToBuckets, weekToDate, nextWeekReset, type UsageBuckets } from "./ai-usage";

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

// ★ THE UPGRADE CASE. A bucket persisted before 0.294.0 has only input/output.
// Adding to it must not produce NaN — NaN defeats every cap comparison silently.
it("treats a pre-0.294 bucket's missing cache fields as zero", () => {
  const legacy = { "2026-09-08": { input: 5, output: 5 } } as unknown as UsageBuckets;
  const b = addToBuckets(legacy, new Date(2026, 8, 8), { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 });
  expect(b["2026-09-08"]).toEqual({ input: 6, output: 6, cacheWrite: 1, cacheRead: 1 });
  expect(weekToDate(b, new Date(2026, 8, 8))).toBe(14);
});

// ★ THE LOAD-BEARING CALL. A bucket read from storage reaches weekToDate
// without ever passing through addToBuckets, so weekToDate must do its own
// defaulting. Feeding it an addToBuckets OUTPUT cannot prove that — the value
// is already complete by then.
it("defaults a raw pre-0.294 bucket's missing fields when totalling the week", () => {
  const legacy = { "2026-09-08": { input: 5, output: 5 } } as unknown as UsageBuckets;
  expect(weekToDate(legacy, new Date(2026, 8, 8))).toBe(10);
});

test("nextWeekReset is next Monday 00:00 local", () => {
  const r = nextWeekReset(WED);
  expect(r.getDay()).toBe(1);
  expect(r.getHours()).toBe(0);
  expect(r > WED).toBe(true);
});
