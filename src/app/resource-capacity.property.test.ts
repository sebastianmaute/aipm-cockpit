import { describe, expect, test } from "vitest";
import fc from "fast-check";
import {
  generatePeriods,
  workdaysInRange,
  periodCapacityHours,
  convertUtilization,
  type Period,
} from "./resource-capacity";
import type { Resource } from "./types";

// Bounded to a ~10-year window: wide enough to exercise month/week boundaries,
// leap years, and ordering, but small enough that week-granularity period
// generation stays fast (a century span would build thousands of periods/run).
const isoDateArb = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const granularityArb = fc.constantFrom("week" as const, "month" as const);

const resourceArb: fc.Arbitrary<Resource> = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  firstName: fc.string(),
  lastName: fc.string(),
  roleId: fc.constant(null),
  utilizationMode: fc.constantFrom("percent" as const, "hours" as const),
  utilization: fc.dictionary(fc.string(), fc.double({ min: 0, max: 100, noNaN: true })),
});

describe("resource-capacity — properties", () => {
  test("generatePeriods returns [] iff start > end", () => {
    fc.assert(
      fc.property(isoDateArb, isoDateArb, granularityArb, (a, b, g) => {
        const [start, end] = a <= b ? [a, b] : [b, a];
        expect(generatePeriods(end, start, g).length === 0).toBe(end > start);
        // Valid window always yields at least one period.
        expect(generatePeriods(start, end, g).length).toBeGreaterThan(0);
      }),
    );
  });

  test("generated periods are chronologically ordered and individually well-formed", () => {
    fc.assert(
      fc.property(isoDateArb, isoDateArb, granularityArb, (a, b, g) => {
        const [start, end] = a <= b ? [a, b] : [b, a];
        const periods = generatePeriods(start, end, g);
        for (const p of periods) expect(p.start <= p.end).toBe(true);
        for (let i = 1; i < periods.length; i++) {
          expect(periods[i - 1].start < periods[i].start).toBe(true);
        }
      }),
    );
  });

  test("workdaysInRange is within [0, total calendar days]", () => {
    fc.assert(
      fc.property(isoDateArb, isoDateArb, (a, b) => {
        const [start, end] = a <= b ? [a, b] : [b, a];
        const days =
          Math.round(
            (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000,
          ) + 1;
        const wd = workdaysInRange(start, end, new Set());
        expect(wd).toBeGreaterThanOrEqual(0);
        expect(wd).toBeLessThanOrEqual(days);
      }),
    );
  });

  test("periodCapacityHours is never negative", () => {
    const periodArb: fc.Arbitrary<Period> = fc
      .tuple(isoDateArb, isoDateArb)
      .map(([a, b]) => {
        const [start, end] = a <= b ? [a, b] : [b, a];
        return { key: `${start}/${end}`, start, end };
      });
    fc.assert(
      fc.property(resourceArb, periodArb, fc.double({ min: 0, max: 24, noNaN: true }), (resource, period, hours) => {
        expect(periodCapacityHours(resource, period, [], hours, new Set())).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  test("convertUtilization with equal modes is identity and non-negative", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.double({ min: 0, max: 100, noNaN: true })),
        fc.constantFrom("percent" as const, "hours" as const),
        (util, mode) => {
          const out = convertUtilization(util, mode, mode, [], 8, new Set());
          expect(out).toBe(util); // same-mode returns the input reference
          for (const v of Object.values(out)) expect(v).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
