import { describe, expect, it } from "vitest";
import { workloadProvider } from "./workload";
import type { ActionInput } from "../types";

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
  it("emits nothing when there are no alerts", () => {
    expect(workloadProvider.provide(input([]))).toEqual([]);
    expect(workloadProvider.provide(input(undefined))).toEqual([]);
  });
});
