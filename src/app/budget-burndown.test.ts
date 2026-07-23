import { describe, it, expect } from "vitest";
import { computeBurndownSeries } from "./budget-burndown";
import { computeBudgetReport } from "./budget-report";
import type { BudgetBucket, ResourcePlan, Role, Resource } from "./types";

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
    const s = computeBurndownSeries([], plan, roles, [], 8, new Set<string>(), [], "2026-02-15");
    expect(s.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.totalBudgetHours).toBe(0);
    expect(s.plannedRemainingHours).toEqual([0, 0, 0]);
    expect(s.actualRemainingHours).toEqual([0, 0, null]);
  });

  it("computes planned remaining hours descending to zero", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2026-02-15");
    expect(s.totalBudgetHours).toBe(300);
    expect(s.plannedRemainingHours).toEqual([200, 100, 0]);
  });

  it("computes actual remaining only up to today's period, null after", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2026-02-15");
    expect(s.todayIndex).toBe(1);
    expect(s.actualRemainingHours).toEqual([180, 90, null]);
  });

  it("computes € on the external-rate basis", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2026-02-15");
    expect(s.totalBudgetValue).toBe(60000);
    expect(s.plannedRemainingValue).toEqual([40000, 20000, 0]);
    expect(s.actualRemainingValue).toEqual([36000, 18000, null]);
  });

  it("marks every period null when today is before the plan start", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2025-12-01");
    expect(s.todayIndex).toBe(-1);
    expect(s.actualRemainingHours).toEqual([null, null, null]);
  });

  it("has no null when today is on or after the plan end", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2026-03-31");
    expect(s.todayIndex).toBe(2);
    // cumulative actual 120,210,210 -> remaining 180,90,90
    expect(s.actualRemainingHours).toEqual([180, 90, 90]);
  });
});

describe("computeBurndownSeries — budget follows plan", () => {
  const fpPlan: ResourcePlan = {
    startDate: "2026-01-01", endDate: "2026-03-31",
    granularity: "month", currency: "EUR", rows: [], budgetFollowsPlan: true,
  } as unknown as ResourcePlan;
  const fpRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  ] as unknown as Role[];
  const fpResource = {
    id: 5, firstName: "R5", lastName: "", roleId: 3,
    utilizationMode: "percent", utilization: { "2026-01": 100 },
  } as unknown as Resource;
  // A staffed row whose STORED budget (0) is stale vs the plan; under follow-plan
  // the budget hours ARE the planned capacity (Jan 2026 = 22 workdays × 8h = 176).
  const fpBucket: BudgetBucket = {
    id: 9, name: "FP", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 40 } }],
  } as unknown as BudgetBucket;
  const fpResources = [fpResource];

  it("derives budget hours from resource capacity for staffed rows (not the stale stored 0)", () => {
    const s = computeBurndownSeries([fpBucket], fpPlan, fpRoles, fpResources, 8, new Set<string>(), [], "2026-02-15");
    expect(s.totalBudgetHours).toBeCloseTo(176, 5);
    expect(s.totalBudgetValue).toBeCloseTo(176 * 150, 5);
  });

  // Scope: T&M bucket, no spillover — the case where the two totals must agree.
  // The burn-down intentionally models neither fixed-price amounts nor predecessor
  // spillover, so the report can legitimately diverge for those buckets.
  it("keeps the burndown budget total equal to the report budget total", () => {
    const s = computeBurndownSeries([fpBucket], fpPlan, fpRoles, fpResources, 8, new Set<string>(), [], "2026-02-15");
    const rep = computeBudgetReport([fpBucket], fpPlan, fpRoles, fpResources, 8, new Set<string>(), []);
    expect(s.totalBudgetHours).toBeCloseTo(rep.project.budgetHours, 5);
    expect(s.totalBudgetValue).toBeCloseTo(rep.project.budgetValue, 5);
  });
});
