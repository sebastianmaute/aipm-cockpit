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
    resources: [res(1, "Ava")],
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
      assignee: "Ava",
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
    const resources = [res(1, "Ava", { utilizationMode: "percent", utilization: { "2026-06": 135 } })];
    const alerts = buildWorkloadAlerts({ ...base, resources, plan });
    expect(alerts.some((a) => a.reason === "over-allocated" && a.resourceId === 1 && a.value === 135)).toBe(true);
  });

  it("honors an overridden overAllocatedPct threshold", () => {
    const plan: ResourcePlan = {
      startDate: "2026-06-01", endDate: "2026-08-31", granularity: "month", currency: "EUR",
    };
    const resources = [res(1, "Ava", { utilizationMode: "percent", utilization: { "2026-06": 105 } })];
    // 105% does not exceed the default 100? it does (>100) → fires by default. Raise the
    // threshold to 110 so 105% no longer fires.
    expect(buildWorkloadAlerts({ ...base, resources, plan }).some((a) => a.reason === "over-allocated")).toBe(true);
    expect(buildWorkloadAlerts({ ...base, resources, plan, overAllocatedPct: 110 }).some((a) => a.reason === "over-allocated")).toBe(false);
  });

  // §747: the near-term period is the one containing `today`, not the plan's first.
  describe("reads the period that contains today (§747)", () => {
    const longPlan: ResourcePlan = {
      startDate: "2026-03-01", endDate: "2026-12-31", granularity: "month", currency: "EUR",
    };
    const overAlloc = (args: Parameters<typeof buildWorkloadAlerts>[0]) =>
      buildWorkloadAlerts(args).filter((a) => a.reason === "over-allocated");

    it("flags an overload in the current month of a plan that started months ago", () => {
      const resources = [res(1, "Ava", { utilization: { "2026-03": 50, "2026-09": 135 } })];
      expect(overAlloc({ ...base, resources, plan: longPlan, today: "2026-09-21" })).toEqual([
        { resourceId: 1, resourceName: expect.any(String), reason: "over-allocated", value: 135 },
      ]);
    });

    it("ignores an overload that sits only in the plan's first month", () => {
      const resources = [res(1, "Ava", { utilization: { "2026-03": 135, "2026-09": 50 } })];
      expect(overAlloc({ ...base, resources, plan: longPlan, today: "2026-09-21" })).toEqual([]);
    });

    it("reads the current ISO week at week granularity", () => {
      const plan: ResourcePlan = { ...longPlan, granularity: "week" };
      const resources = [res(1, "Ava", { utilization: { "2026-W10": 50, "2026-W39": 140 } })];
      expect(overAlloc({ ...base, resources, plan, today: "2026-09-21" }).map((a) => a.value)).toEqual([140]);
    });

    it("reads the first period while the plan has not started yet", () => {
      const resources = [res(1, "Ava", { utilization: { "2026-03": 120 } })];
      expect(overAlloc({ ...base, resources, plan: longPlan, today: "2026-02-10" }).map((a) => a.value)).toEqual([120]);
    });

    it("raises nothing once the plan has ended", () => {
      const resources = [res(1, "Ava", { utilization: { "2026-12": 150 } })];
      expect(overAlloc({ ...base, resources, plan: longPlan, today: "2027-01-15" })).toEqual([]);
    });
  });

  it("returns nothing for a healthy resource", () => {
    expect(buildWorkloadAlerts(base)).toEqual([]);
  });
});
