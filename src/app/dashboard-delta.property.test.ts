import { describe, expect, test } from "vitest";
import * as fc from "fast-check";
import { computeDelta, type RagScope } from "./dashboard-delta";
import type { ActivityEntry, ActivityKind } from "./activity-log";
import type { Health } from "./health";

const KINDS: ActivityKind[] = ["task.created", "task.updated", "task.completed", "task.deleted", "raid.statusChanged", "milestone.created", "change.updated"];
const HEALTH: (Health | null)[] = ["R", "A", "G", null];

const isoArb = fc.integer({ min: 0, max: 4_102_444_800_000 }).map((ms) => new Date(ms).toISOString());

const activityArb = fc.array(
  fc.record({
    id: fc.integer({ min: 1, max: 100000 }).map((n) => String(n)),
    timestamp: isoArb,
    kind: fc.constantFrom(...KINDS),
    args: fc.constant([] as (string | number)[]),
  }),
  { maxLength: 30 },
) as fc.Arbitrary<ActivityEntry[]>;

const ragArb = fc.record({
  overall: fc.constantFrom(...HEALTH),
  schedule: fc.constantFrom(...HEALTH),
  budget: fc.constantFrom(...HEALTH),
  scope: fc.constantFrom(...HEALTH),
}) as fc.Arbitrary<Record<RagScope, Health | null>>;

function stripNull(rag: Record<RagScope, Health | null>): Partial<Record<RagScope, Health>> {
  const out: Partial<Record<RagScope, Health>> = {};
  for (const k of ["overall", "schedule", "budget", "scope"] as const) {
    const v = rag[k];
    if (v) out[k] = v;
  }
  return out;
}

describe("computeDelta properties", () => {
  test("counts are never negative and total >= 0", () => {
    fc.assert(fc.property(activityArb, isoArb, ragArb, (activity, lastVisitAt, currentRag) => {
      const r = computeDelta({ prior: { lastVisitAt }, activity, currentRag, overdue: [], today: "2026-06-21" });
      for (const g of ["tasks", "raid", "milestone", "change"] as const) {
        for (const v of ["created", "updated", "completed", "statusChanged"] as const) {
          expect(r.counts[g][v]).toBeGreaterThanOrEqual(0);
        }
      }
      expect(r.total).toBeGreaterThanOrEqual(0);
    }));
  });

  test("total === 0 iff no activity-after-since, no newOverdue, no flips", () => {
    fc.assert(fc.property(activityArb, isoArb, ragArb, (activity, lastVisitAt, currentRag) => {
      const r = computeDelta({ prior: { lastVisitAt }, activity, currentRag, overdue: [], today: "2026-06-21" });
      const hasSignal = r.ragFlips.length > 0 || r.newOverdue.length > 0 ||
        (["tasks", "raid", "milestone", "change"] as const).some((g) =>
          (["created", "updated", "completed", "statusChanged"] as const).some((v) => r.counts[g][v] > 0));
      expect(r.total === 0).toBe(!hasSignal);
    }));
  });

  test("first visit (no lastVisitAt) is always empty", () => {
    fc.assert(fc.property(activityArb, ragArb, (activity, currentRag) => {
      const r = computeDelta({ prior: {}, activity, currentRag, overdue: [], today: "2026-06-21" });
      expect(r.isFirstVisit).toBe(true);
      expect(r.total).toBe(0);
    }));
  });

  test("a flip is emitted exactly when from != to", () => {
    fc.assert(fc.property(isoArb, ragArb, ragArb, (lastVisitAt, priorRag, currentRag) => {
      const r = computeDelta({ prior: { lastVisitAt, rag: stripNull(priorRag) }, activity: [], currentRag, overdue: [], today: "2026-06-21" });
      const flipped = new Set(r.ragFlips.map((f) => f.scope));
      for (const scope of ["overall", "schedule", "budget", "scope"] as const) {
        const from = priorRag[scope]; const to = currentRag[scope];
        expect(flipped.has(scope)).toBe(from !== to);
      }
    }));
  });
});
