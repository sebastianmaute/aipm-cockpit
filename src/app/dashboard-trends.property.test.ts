import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { computeMetricTrends, type MetricKey, type MetricSnapshot } from "./dashboard-trends";

const KEYS: readonly MetricKey[] = ["complete", "overdue", "openRaid"];

const intArb = fc.integer({ min: -1000, max: 1000 });

const currentArb = fc.record<Record<MetricKey, number>>({
  complete: intArb,
  overdue: intArb,
  openRaid: intArb,
});

// Each key independently present (int) or absent (undefined).
const optionalIntArb = fc.option(intArb, { nil: undefined });
const priorArb: fc.Arbitrary<MetricSnapshot | undefined> = fc.option(
  fc.record<MetricSnapshot>({
    complete: optionalIntArb,
    overdue: optionalIntArb,
    openRaid: optionalIntArb,
  }),
  { nil: undefined },
);

describe("computeMetricTrends properties", () => {
  test("improved is null iff delta is null iff prior value for that key is absent", () => {
    fc.assert(
      fc.property(priorArb, currentArb, (prior, current) => {
        const trends = computeMetricTrends(prior, current);
        for (const key of KEYS) {
          const priorAbsent = prior === undefined || prior[key] === undefined;
          const t = trends[key];
          expect(t.delta === null).toBe(priorAbsent);
          expect(t.improved === null).toBe(priorAbsent);
          expect(t.improved === null).toBe(t.delta === null);
        }
      }),
    );
  });

  test("nonzero non-null delta drives direction and improved correctly per key", () => {
    fc.assert(
      fc.property(priorArb, currentArb, (prior, current) => {
        const trends = computeMetricTrends(prior, current);
        for (const key of KEYS) {
          const t = trends[key];
          if (t.delta !== null && t.delta !== 0) {
            expect(t.direction).toBe(t.delta > 0 ? "up" : "down");
            const expectedImproved = key === "complete" ? t.delta > 0 : t.delta < 0;
            expect(t.improved).toBe(expectedImproved);
          }
        }
      }),
    );
  });

  test("zero delta is flat direction and improved false", () => {
    fc.assert(
      fc.property(priorArb, currentArb, (prior, current) => {
        const trends = computeMetricTrends(prior, current);
        for (const key of KEYS) {
          const t = trends[key];
          if (t.delta === 0) {
            expect(t.direction).toBe("flat");
            expect(t.improved).toBe(false);
          }
        }
      }),
    );
  });

  test("value always equals the supplied current value", () => {
    fc.assert(
      fc.property(priorArb, currentArb, (prior, current) => {
        const trends = computeMetricTrends(prior, current);
        for (const key of KEYS) {
          expect(trends[key].value).toBe(current[key]);
        }
      }),
    );
  });
});
