import { describe, it, expect } from "vitest";
import {
  METRIC_FIELD, insightMetricValue, insightMetricSnapshot, metricAtActionPatch,
  baselineOf, computeOutcome,
} from "./outcome";
import { detectInsights, type InsightInput } from "./detect";
import type { Insight } from "./insight";
import type { Task, Milestone } from "../types";

function ins(over: Partial<Insight> = {}): Insight {
  return {
    id: 1, key: "k", type: "milestoneSlip", severity: "high",
    data: { name: "M1", daysOverdue: 5 }, status: "active",
    firstSeenAt: "2026-06-01", lastSeenAt: "2026-06-01", occurrences: 1,
    ...over,
  };
}

describe("insightMetricValue", () => {
  it("reads the per-type field", () => {
    expect(insightMetricValue("milestoneSlip", { daysOverdue: 5 })).toBe(5);
    expect(insightMetricValue("overdueTrend", { current: 12, prior: 9, delta: 3 })).toBe(12);
    expect(insightMetricValue("stalledWork", { count: 3 })).toBe(3);
    expect(insightMetricValue("budgetVariance", { variancePct: 22 })).toBe(22);
    expect(insightMetricValue("raidAging", { daysSinceUpdate: 9 })).toBe(9);
  });

  it("returns null when the field is missing or not finite", () => {
    expect(insightMetricValue("stalledWork", {})).toBeNull();
    expect(insightMetricValue("stalledWork", { count: "abc" })).toBeNull();
  });

  it("coerces a numeric string", () => {
    expect(insightMetricValue("stalledWork", { count: "4" })).toBe(4);
  });
});

describe("insightMetricSnapshot / metricAtActionPatch", () => {
  it("snapshots under the per-type field name", () => {
    expect(insightMetricSnapshot(ins())).toEqual({ daysOverdue: 5 });
  });

  it("returns undefined when no metric is extractable", () => {
    expect(insightMetricSnapshot(ins({ data: { name: "M1" } }))).toBeUndefined();
  });

  it("patches on first act only — a re-act never overwrites the baseline", () => {
    expect(metricAtActionPatch(ins())).toEqual({ metricAtAction: { daysOverdue: 5 } });
    const already = ins({ metricAtAction: { daysOverdue: 9 }, data: { daysOverdue: 2 } });
    expect(metricAtActionPatch(already)).toEqual({});
  });

  it("patches empty when the metric is absent", () => {
    expect(metricAtActionPatch(ins({ data: { name: "M1" } }))).toEqual({});
  });

  // The re-fire path clears metricAtAction (reconcile), so the NEXT act on a
  // recurring problem captures a fresh baseline instead of silently measuring
  // against the previous cycle's number.
  it("captures a NEW baseline once a re-fire has cleared the old one", () => {
    const afterRefire = ins({ data: { daysOverdue: 40 }, metricAtAction: undefined });
    expect(metricAtActionPatch(afterRefire)).toEqual({ metricAtAction: { daysOverdue: 40 } });
  });

  it("both acted sites can share one spreadable patch (no drift)", () => {
    const i = ins({ data: { daysOverdue: 5 } });
    const manual = { ...i, status: "acted" as const, actedAt: "2026-06-02", ...metricAtActionPatch(i) };
    const viaAi = { ...i, status: "acted" as const, actedAt: "2026-06-02", ...metricAtActionPatch(i) };
    expect(manual.metricAtAction).toEqual(viaAi.metricAtAction);
    expect(manual.metricAtAction).toEqual({ daysOverdue: 5 });
  });
});

describe("baselineOf", () => {
  it("reads the captured baseline by the type's field", () => {
    expect(baselineOf(ins({ metricAtAction: { daysOverdue: 7 } }))).toBe(7);
  });
  it("returns null with no capture", () => {
    expect(baselineOf(ins())).toBeNull();
  });
});

describe("computeOutcome", () => {
  it("improved when the metric fell (lower is better)", () => {
    expect(computeOutcome(10, 4, "2026-06-10")).toEqual({
      direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-10",
    });
  });
  it("worsened when the metric rose", () => {
    expect(computeOutcome(4, 10, "2026-06-10")).toMatchObject({ direction: "worsened", delta: -6 });
  });
  it("unchanged when equal", () => {
    expect(computeOutcome(4, 4, "2026-06-10")).toMatchObject({ direction: "unchanged", delta: 0 });
  });
});

describe("METRIC_FIELD guard", () => {
  it("covers every insight type exactly once", () => {
    expect(Object.keys(METRIC_FIELD).sort()).toEqual(
      // Deliberately a hand-written list, not `[...INSIGHT_TYPES].sort()` — a
      // derived expectation would pass against ANY map and pin nothing. Adding
      // an insight type is meant to land here and force the metric decision.
      ["budgetVariance", "milestoneSlip", "overdueTrend", "raidAging", "stalledWork",
        "timelogCapPerDay", "timelogCapPerEntry", "timelogNonWorkingDay", "timelogWorkingHours"],
    );
  });

  // Guards the map against detector drift: each METRIC_FIELD value must be a key
  // the matching detector actually emits in `data`. Renaming a detector's data key
  // without updating METRIC_FIELD would silently strand extraction at null.
  const TODAY = "2026-06-15";

  function task(over: Partial<Task>): Task {
    return {
      id: 1, taskName: "T", assignee: "", assigneeEmail: "",
      // Overdue vs TODAY, and untouched well past STALE_DAYS (14) so the same
      // tasks feed BOTH the overdueTrend and stalledWork detectors.
      dueDate: "2026-06-01", lastUpdateDate: "2026-05-01",
      priority: "Medium", status: "To Do", blockers: "", description: "",
      ...over,
    };
  }
  function milestone(over: Partial<Milestone>): Milestone {
    return { id: 1, name: "M", date: "2026-06-01", linkedTaskIds: [], ...over };
  }

  const input: InsightInput = {
    tasks: [task({ id: 1 }), task({ id: 2 }), task({ id: 3 })],
    milestones: [milestone({ id: 9, name: "Go-live" })],
    raid: [], budgets: [], roles: [], resources: [], plan: null,
    priorOverdueCount: 0, holidaySet: new Set<string>(),
    // One violation per guardrail rule: without them the loop below iterates the
    // five core detections only and says nothing about the four guardrail types,
    // whose METRIC_FIELD is `count` — a key the detector must put in `data`.
    timelogViolations: [
      { rule: "timelogCapPerEntry", timelogUserId: 7, resourceId: null, count: 1, worstHours: 9, threshold: 8 },
      { rule: "timelogCapPerDay", timelogUserId: 7, resourceId: null, count: 2, worstHours: 12, threshold: 8 },
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: null, count: 1, worstHours: 4, threshold: 0 },
      { rule: "timelogWorkingHours", timelogUserId: 7, resourceId: null, count: 3, worstHours: 10, threshold: 8 },
    ],
  };

  it("names a data key every fired detector actually emits", () => {
    const detected = detectInsights(input, TODAY);
    // Fixture must genuinely exercise several detectors, not degenerate to one.
    expect(detected.length).toBeGreaterThan(2);
    for (const d of detected) {
      expect(Object.prototype.hasOwnProperty.call(d.data, METRIC_FIELD[d.type])).toBe(true);
    }
  });
});
