import fc from "fast-check";
import { describe, it } from "vitest";
import { generatePeriods, periodKeyForDate } from "../resource-capacity";
import type { Period } from "../resource-capacity";
import type { PlanGranularity } from "../types";
import { splitToGranularity } from "./period-split";

const MONTHS = generatePeriods("2024-01-01", "2028-12-31", "month");
const WEEKS = generatePeriods("2024-01-01", "2028-12-31", "week");
const FIRST_DAY_MS = Date.UTC(2023, 11, 1);
const DAY_MS = 86_400_000;
const DAY_SPAN = 365 * 6;

const holidayDate = fc
  .integer({ min: 0, max: DAY_SPAN })
  .map((n) => new Date(FIRST_DAY_MS + n * DAY_MS).toISOString().slice(0, 10));

// Mostly the full range; one in three draws is tiny so the rounding-remainder branch is reached.
const hoursArb = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 74_400 }).map((cents) => cents / 100), weight: 2 },
  { arbitrary: fc.integer({ min: 0, max: 10 }).map((cents) => cents / 100), weight: 1 },
);

type Source = { period: Period; target: PlanGranularity };

const sourceArb: fc.Arbitrary<Source> = fc.oneof(
  fc.constantFrom(...MONTHS).map((period) => ({ period, target: "week" as const })),
  fc.constantFrom(...WEEKS).map((period) => ({ period, target: "month" as const })),
  fc.constantFrom(...MONTHS).map((period) => ({ period, target: "month" as const })),
  fc.constantFrom(...WEEKS).map((period) => ({ period, target: "week" as const })),
);

function daysOf(period: Period): string[] {
  const out: string[] = [];
  const last = Date.parse(`${period.end}T00:00:00Z`);
  for (let t = Date.parse(`${period.start}T00:00:00Z`); t <= last; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function isWeekday(dateISO: string): boolean {
  const day = new Date(`${dateISO}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

describe("splitToGranularity (property)", () => {
  it("preserves the total at 2 decimals, never goes negative, and only uses covered keys", () => {
    fc.assert(
      fc.property(
        sourceArb,
        hoursArb,
        fc.array(holidayDate, { maxLength: 60 }),
        fc.boolean(),
        ({ period, target }, hours, holidays, holidayAllWeekdays) => {
          const days = daysOf(period);
          // Every weekday of the source a holiday: forces the calendar-day fallback.
          const holidaySet = new Set(holidayAllWeekdays ? days.filter(isWeekday) : holidays);
          const parts = splitToGranularity(period.key, hours, target, holidaySet);
          const sum = parts.reduce((s, p) => s + p.hours, 0);
          const sorted = [...parts.map((p) => p.key)].sort();
          // A key with weight 0 would carry no day of the source period.
          const covered = new Set(days.map((d) => periodKeyForDate(d, target)));
          return (
            parts.length > 0 &&
            Math.round(sum * 100) === Math.round(hours * 100) &&
            parts.every((p) => p.hours >= 0) &&
            parts.every((p, i) => p.key === sorted[i]) &&
            parts.every((p) => covered.has(p.key))
          );
        },
      ),
      { seed: 500, numRuns: 200 },
    );
  });
});
