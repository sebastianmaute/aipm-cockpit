import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { actualHoursIn } from "./actual-hours";
import { periodKeyForDate } from "./resource-capacity";

const DAY_MS = 86_400_000;
const START = Date.UTC(2025, 0, 1);

const dayArb = fc.integer({ min: 0, max: 730 }).map((n) => new Date(START + n * DAY_MS).toISOString().slice(0, 10));
const hoursArb = fc.integer({ min: 0, max: 800 }).map((n) => n / 8);

describe("actualHoursIn conservation", () => {
  it("summing every month of the covered range equals the sum of all day and month keys", () => {
    fc.assert(
      fc.property(fc.dictionary(dayArb, hoursArb), fc.dictionary(dayArb.map((d) => d.slice(0, 7)), hoursArb), (days, months) => {
        const map = { ...days, ...months };
        const keys = new Set([...Object.keys(days).map((d) => periodKeyForDate(d, "month")), ...Object.keys(months)]);
        const total = Object.values(map).reduce((s, v) => s + v, 0);
        const byPeriod = [...keys].reduce((s, k) => s + actualHoursIn(map, k), 0);
        expect(byPeriod).toBeCloseTo(total, 6);
      }),
      { numRuns: 100 },
    );
  });

  it("summing every ISO week of the covered range equals the sum of all day keys", () => {
    fc.assert(
      fc.property(fc.dictionary(dayArb, hoursArb), (days) => {
        const weeks = new Set(Object.keys(days).map((d) => periodKeyForDate(d, "week")));
        const total = Object.values(days).reduce((s, v) => s + v, 0);
        const byWeek = [...weeks].reduce((s, k) => s + actualHoursIn(days, k), 0);
        expect(byWeek).toBeCloseTo(total, 6);
      }),
      { numRuns: 100 },
    );
  });
});
