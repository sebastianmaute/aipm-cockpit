import { expect, test } from "vitest";
import { addToBuckets, weekToDate, nextWeekReset, type UsageBuckets } from "./ai-usage";

const MON = new Date("2026-06-08T10:00:00"); // Monday
const WED = new Date("2026-06-10T10:00:00");
const PREV_SUN = new Date("2026-06-07T10:00:00"); // previous week (Sunday)

test("addToBuckets accumulates per ISO date", () => {
  let b: UsageBuckets = {};
  b = addToBuckets(b, WED, { input: 100, output: 50 });
  b = addToBuckets(b, WED, { input: 10, output: 5 });
  expect(b["2026-06-10"]).toEqual({ input: 110, output: 55 });
});

test("weekToDate sums Monday..now of the current week only", () => {
  let b: UsageBuckets = {};
  b = addToBuckets(b, PREV_SUN, { input: 1000, output: 0 }); // excluded
  b = addToBuckets(b, MON, { input: 100, output: 100 });
  b = addToBuckets(b, WED, { input: 200, output: 0 });
  expect(weekToDate(b, WED)).toBe(400); // 100+100+200, prev week excluded
});

test("nextWeekReset is next Monday 00:00 local", () => {
  const r = nextWeekReset(WED);
  expect(r.getDay()).toBe(1);
  expect(r.getHours()).toBe(0);
  expect(r > WED).toBe(true);
});
