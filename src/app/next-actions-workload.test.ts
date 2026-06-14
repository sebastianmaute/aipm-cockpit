import { describe, expect, it } from "vitest";
import { buildWorkloadAlerts } from "./next-actions-workload";
import type { Resource, ResourcePlan } from "./types";

function res(id: number, firstName: string, extra: Partial<Resource> = {}): Resource {
  return {
    id,
    firstName,
    lastName: "X",
    email: "",
    department: "",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...extra,
  } as unknown as Resource;
}

describe("buildWorkloadAlerts", () => {
  const base = {
    resources: [res(1, "Aria")],
    tasks: [],
    absences: [],
    shifts: [],
    raid: [],
    today: "2026-06-15",
    workdayHours: 8,
    holidaySet: new Set<string>(),
    overdueThreshold: 3,
  };

  it("flags overload when a resource has >= threshold overdue tasks", () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      taskName: "t",
      dueDate: "2026-06-01",
      assignee: "Aria",
      assigneeEmail: "",
      resourceId: 1,
      lastUpdateDate: "2026-05-01",
      priority: "Medium",
      blockers: "",
      notes: "",
    })) as unknown as never[];
    const alerts = buildWorkloadAlerts({ ...base, tasks });
    expect(alerts.some((a) => a.reason === "overload" && a.resourceId === 1 && a.value === 3)).toBe(true);
  });

  it("flags over-allocated when near-term planned utilization > 100%", () => {
    // ResourcePlan is { startDate, endDate, granularity, currency } — it carries
    // the date range + canonical granularity only. Per-resource utilization lives
    // on Resource.utilization (periodKey "2026-06" for a month granularity).
    const plan: ResourcePlan = {
      startDate: "2026-06-01",
      endDate: "2026-08-31",
      granularity: "month",
      currency: "EUR",
    };
    const resources = [res(1, "Aria", { utilizationMode: "percent", utilization: { "2026-06": 135 } })];
    const alerts = buildWorkloadAlerts({ ...base, resources, plan });
    expect(alerts.some((a) => a.reason === "over-allocated" && a.resourceId === 1 && a.value === 135)).toBe(true);
  });

  it("honors an overridden overAllocatedPct threshold", () => {
    const plan: ResourcePlan = {
      startDate: "2026-06-01", endDate: "2026-08-31", granularity: "month", currency: "EUR",
    };
    const resources = [res(1, "Aria", { utilizationMode: "percent", utilization: { "2026-06": 105 } })];
    // 105% does not exceed the default 100? it does (>100) → fires by default. Raise the
    // threshold to 110 so 105% no longer fires.
    expect(buildWorkloadAlerts({ ...base, resources, plan }).some((a) => a.reason === "over-allocated")).toBe(true);
    expect(buildWorkloadAlerts({ ...base, resources, plan, overAllocatedPct: 110 }).some((a) => a.reason === "over-allocated")).toBe(false);
  });

  it("returns nothing for a healthy resource", () => {
    expect(buildWorkloadAlerts(base)).toEqual([]);
  });
});
