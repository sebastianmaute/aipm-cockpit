import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { computeCompletionTrend, MAX_POINTS } from "./completion-trend";
import type { ActivityEntry } from "./activity-log";

const KINDS = ["task.created", "task.completed", "task.reopened", "task.deleted", "raid.created"] as const;

function entryArb() {
  return fc.record({
    ms: fc.integer({ min: 0, max: 60 * 24 * 60 * 60 * 1000 }),
    k: fc.constantFrom(...KINDS),
  });
}

describe("computeCompletionTrend properties", () => {
  test("percents always in [0,100], never throws, capped", () => {
    fc.assert(
      fc.property(
        fc.array(entryArb(), { maxLength: 80 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (raw, done, totalRaw) => {
          const base = Date.UTC(2026, 0, 1);
          const activity: ActivityEntry[] = raw.map((r, i) => ({
            id: i + 1,
            timestamp: new Date(base + r.ms).toISOString(),
            kind: r.k as ActivityEntry["kind"],
            args: [],
          }));
          const total = Math.max(done, totalRaw);
          const out = computeCompletionTrend({
            snapshots: [], activity, currentDone: done, currentTotal: total, today: "2026-12-31",
          });
          expect(out.length).toBeLessThanOrEqual(MAX_POINTS);
          for (const p of out) {
            expect(p.percent).toBeGreaterThanOrEqual(0);
            expect(p.percent).toBeLessThanOrEqual(100);
            expect(typeof p.label).toBe("string");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
