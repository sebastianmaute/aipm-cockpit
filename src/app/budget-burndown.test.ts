import { describe, it, expect } from "vitest";
import { computeBurndownSeries } from "./budget-burndown";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const plan: ResourcePlan = {
  startDate: "2026-01-01", endDate: "2026-03-31",
  granularity: "month", currency: "EUR", rows: [],
} as unknown as ResourcePlan;

const roles: Role[] = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 },
] as unknown as Role[];

function bucket(over: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id: 1, name: "B1", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-03-31", status: "open",
    allocations: [{
      roleId: 1, resourceIds: [],
      budgetHours: { "2026-01": 100, "2026-02": 100, "2026-03": 100 },
      actualHours: { "2026-01": 120, "2026-02": 90 },
    }],
    ...over,
  } as unknown as BudgetBucket;
}

describe("computeBurndownSeries", () => {
  it("returns a zeroed series when there are no buckets", () => {
    const s = computeBurndownSeries([], plan, roles, "2026-02-15");
    expect(s.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.totalBudgetHours).toBe(0);
    expect(s.plannedRemainingHours).toEqual([0, 0, 0]);
    expect(s.actualRemainingHours).toEqual([0, 0, null]);
  });

  it("computes planned remaining hours descending to zero", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, "2026-02-15");
    expect(s.totalBudgetHours).toBe(300);
    expect(s.plannedRemainingHours).toEqual([200, 100, 0]);
  });

  it("computes actual remaining only up to today's period, null after", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, "2026-02-15");
    expect(s.todayIndex).toBe(1);
    expect(s.actualRemainingHours).toEqual([180, 90, null]);
  });

  it("computes € on the external-rate basis", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, "2026-02-15");
    expect(s.totalBudgetValue).toBe(60000);
    expect(s.plannedRemainingValue).toEqual([40000, 20000, 0]);
    expect(s.actualRemainingValue).toEqual([36000, 18000, null]);
  });
});
