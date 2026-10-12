import fc from "fast-check";
import { describe, it } from "vitest";
import { generatePeriods } from "../resource-capacity";
import type { PlanGranularity } from "../types";
import { splitToGranularity } from "./period-split";

const MONTHS = generatePeriods("2024-01-01", "2028-12-31", "month").map((p) => p.key);
const WEEKS = generatePeriods("2024-01-01", "2028-12-31", "week").map((p) => p.key);
const FIRST_DAY_MS = Date.UTC(2023, 11, 1);
const DAY_MS = 86_400_000;
const DAY_SPAN = 365 * 6;

const holidayDate = fc
  .integer({ min: 0, max: DAY_SPAN })
  .map((n) => new Date(FIRST_DAY_MS + n * DAY_MS).toISOString().slice(0, 10));

const sourceArb: fc.Arbitrary<{ period: string; target: PlanGranularity }> = fc.oneof(
  fc.constantFrom(...MONTHS).map((period) => ({ period, target: "week" as const })),
  fc.constantFrom(...WEEKS).map((period) => ({ period, target: "month" as const })),
  fc.constantFrom(...MONTHS).map((period) => ({ period, target: "month" as const })),
  fc.constantFrom(...WEEKS).map((period) => ({ period, target: "week" as const })),
);

describe("splitToGranularity (property)", () => {
  it("preserves the total at 2 decimals and never yields a negative share", () => {
    fc.assert(
      fc.property(
        sourceArb,
        fc.integer({ min: 0, max: 74_400 }).map((cents) => cents / 100),
        fc.array(holidayDate, { maxLength: 60 }),
        ({ period, target }, hours, holidays) => {
          const parts = splitToGranularity(period, hours, target, new Set(holidays));
          const sum = parts.reduce((s, p) => s + p.hours, 0);
          const sorted = [...parts.map((p) => p.key)].sort();
          return (
            parts.length > 0 &&
            Math.round(sum * 100) === Math.round(hours * 100) &&
            parts.every((p) => p.hours >= 0) &&
            parts.every((p, i) => p.key === sorted[i])
          );
        },
      ),
      { seed: 500, numRuns: 200 },
    );
  });
});
