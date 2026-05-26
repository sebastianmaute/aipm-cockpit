import { describe, expect, test } from "vitest";
import { computeBucketReport } from "./budget-report";
import type { ResourcePlan, Resource, Role, BudgetBucket } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const resources: Resource[] = [];
const noHolidays = new Set<string>();

function tmBucket(): BudgetBucket {
  return {
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
  };
}

describe("computeBucketReport — T&M", () => {
  const rep = computeBucketReport(tmBucket(), plan, roles, resources, 8, noHolidays);
  test("hours roll up", () => {
    expect(rep.budgetHours).toBe(100);
    expect(rep.actualHours).toBe(80);
  });
  test("cost = internal * actual; revenue = external * actual", () => {
    expect(rep.cost).toBe(80 * 100);
    expect(rep.revenue).toBe(80 * 150);
  });
  test("contribution margin", () => {
    expect(rep.contributionMargin.amount).toBe(80 * 150 - 80 * 100);
    expect(rep.contributionMargin.percent).toBeCloseTo((4000 / (80 * 150)) * 100, 5);
  });
  test("cost performance (CPI): budgetCost vs actualCost", () => {
    expect(rep.costPerformance.amount).toBe(100 * 100 - 80 * 100);
    expect(rep.costPerformance.percent).toBeCloseTo((10000 / 8000) * 100, 5);
  });
  test("consumption: budgetValue - consumedValue (external basis)", () => {
    expect(rep.consumption.amount).toBe(100 * 150 - 80 * 150);
    expect(rep.consumption.percent).toBeCloseTo((12000 / 15000) * 100, 5);
  });
  test("win/loss = budget - actual (hours & external value)", () => {
    expect(rep.winLossHours).toBe(20);
    expect(rep.winLossValue).toBe(20 * 150);
  });
});

describe("computeBucketReport — fixed-price", () => {
  test("revenue = fixed price; win/loss = price - cost; zero-denominator => null %", () => {
    const b: BudgetBucket = { ...tmBucket(), type: "fixed", fixedPriceAmount: 20000,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 80 } }] };
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays);
    expect(rep.revenue).toBe(20000);
    expect(rep.cost).toBe(80 * 100);
    expect(rep.winLossValue).toBe(20000 - 8000);
    expect(rep.consumption.percent).toBeNull();
  });
});
