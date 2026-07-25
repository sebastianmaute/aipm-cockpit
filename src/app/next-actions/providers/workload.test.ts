import { describe, expect, it } from "vitest";
import { workloadProvider } from "./workload";
import type { ActionInput } from "../types";
import { ACTION_WEIGHTS } from "../score";

function input(workloadAlerts: ActionInput["workloadAlerts"]): ActionInput {
  return {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
    dashboard: {} as ActionInput["dashboard"], features: ["resources"], today: "2026-06-15",
    projectName: "", now: new Date("2026-06-15T00:00:00Z"), reminderLeadDays: 0, dueSoonWorkdays: 3,
    raidReviewIntervalDays: 30, dismissed: new Set(), workloadAlerts,
  } as ActionInput;
}

describe("workloadProvider", () => {
  it("maps an over-allocated alert to an action", () => {
    const a = workloadProvider.provide(input([{ resourceId: 1, resourceName: "Aria", reason: "over-allocated", value: 135 }]));
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe("workload:1:over-allocated");
    expect(a[0].source).toBe("workload");
    expect(a[0].why).toEqual({ key: "actionWorkloadWhyOverAllocated", params: [135] });
    expect(a[0].cta).toEqual({ kind: "open", view: "workload", id: 1 });
  });
  it("maps an overload alert to an action", () => {
    const a = workloadProvider.provide(input([{ resourceId: 2, resourceName: "Bo", reason: "overload", value: 4 }]));
    expect(a[0].why).toEqual({ key: "actionWorkloadWhyOverload", params: [4] });
  });
  it("routes an overload alert to the person's tasks, not the workload view", () => {
    const a = workloadProvider.provide(input([{ resourceId: 2, resourceName: "Bo", reason: "overload", value: 4 }]));
    expect(a[0].cta).toEqual({ kind: "open-tasks-for", resourceId: 2, resourceName: "Bo" });
  });

  it("leaves an over-allocated alert on the workload view", () => {
    const a = workloadProvider.provide(input([{ resourceId: 1, resourceName: "Aria", reason: "over-allocated", value: 135 }]));
    expect(a[0].cta).toEqual({ kind: "open", view: "workload", id: 1 });
  });

  it("emits nothing when there are no alerts", () => {
    expect(workloadProvider.provide(input([]))).toEqual([]);
    expect(workloadProvider.provide(input(undefined))).toEqual([]);
  });
  it("includes the semi-clarity bonus in the over-allocated score", () => {
    const [a] = workloadProvider.provide(input([{ resourceId: 1, resourceName: "Aria", reason: "over-allocated", value: 135 }]));
    expect(a.score).toBe(ACTION_WEIGHTS.riskCritical + ACTION_WEIGHTS.urgencySoon + ACTION_WEIGHTS.semiClarityBonus);
  });
  it("honors overridden over-allocation and overload escalation thresholds", () => {
    const overAlloc = [{ resourceId: 1, resourceName: "Aria", reason: "over-allocated" as const, value: 120 }];
    // value 120 < default critical 130 → riskHigh; with override critical 110 → riskCritical (higher score).
    const baseScore = workloadProvider.provide(input(overAlloc))[0].score;
    const escalated = workloadProvider.provide({ ...input(overAlloc), workloadAllocatedCritical: 110 })[0].score;
    expect(escalated).toBeGreaterThan(baseScore);

    const overload = [{ resourceId: 2, resourceName: "Bo", reason: "overload" as const, value: 4 }];
    // value 4 < default urgent 5 → urgencyToday; with override urgent 3 → urgencyOverdue (higher score).
    const baseOverload = workloadProvider.provide(input(overload))[0].score;
    const escalatedOverload = workloadProvider.provide({ ...input(overload), workloadOverdueUrgent: 3 })[0].score;
    expect(escalatedOverload).toBeGreaterThan(baseOverload);
  });
});
