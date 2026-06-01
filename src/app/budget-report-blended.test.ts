import { describe, expect, test } from "vitest";
import { computeBucketReport } from "./budget-report";
import type { ResourcePlan, Resource, Role, BudgetBucket } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
// Discipline 1 has two grades: rates avg to internal 120, external 180.
const roles: Role[] = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 2, disciplineId: 1, gradeId: 2, internalRate: 140, externalRate: 210 },
];
const resources: Resource[] = [];
const noHolidays = new Set<string>();

function blendedBucket(): BudgetBucket {
  return {
    id: 1, name: "Blend", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    planningMode: "blended",
    allocations: [],
    disciplineAllocations: [
      { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } },
    ],
  };
}

describe("computeBucketReport — blended (discipline-only)", () => {
  test("uses the discipline's blended rate for cost and revenue", () => {
    const rep = computeBucketReport(blendedBucket(), plan, roles, resources, 8, noHolidays);
    expect(rep.budgetHours).toBe(100);
    expect(rep.actualHours).toBe(80);
    expect(rep.cost).toBe(80 * 120);     // blended internal
    expect(rep.revenue).toBe(80 * 180);  // blended external
  });

  test("a per-bucket override replaces both blended rates", () => {
    const b: BudgetBucket = { ...blendedBucket(), rateOverrideInternal: 90, rateOverrideExternal: 200 };
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays);
    expect(rep.cost).toBe(80 * 90);
    expect(rep.revenue).toBe(80 * 200);
  });

  test("discipline with no matching roles yields zero rates (documents known fallback)", () => {
    const b: BudgetBucket = { ...blendedBucket(), disciplineAllocations: [
      { disciplineId: 99, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 50 } },
    ]};
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays);
    expect(rep.cost).toBe(0);
    expect(rep.revenue).toBe(0);
  });

  test("blended bucket with no discipline allocations yields zero totals", () => {
    const b: BudgetBucket = { ...blendedBucket(), disciplineAllocations: [] };
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays);
    expect(rep.budgetHours).toBe(0);
    expect(rep.actualHours).toBe(0);
    expect(rep.cost).toBe(0);
    expect(rep.revenue).toBe(0);
  });
});

describe("computeBucketReport — override in detailed mode", () => {
  test("override replaces role rates", () => {
    const b: BudgetBucket = {
      id: 2, name: "Det", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      rateOverrideInternal: 50, rateOverrideExternal: 75,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    };
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays);
    expect(rep.cost).toBe(10 * 50);
    expect(rep.revenue).toBe(10 * 75);
  });
});
