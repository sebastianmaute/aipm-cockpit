import { describe, expect, test } from "vitest";
import { computeBudgetReport } from "./budget-report";
import type { ResourcePlan, Role, BudgetBucket } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];

function bucket(id: number, extra: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id, name: `B${id}`, type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }],
    ...extra,
  };
}

describe("computeBudgetReport", () => {
  test("a closed bucket spills remaining budget into its successor", () => {
    const closed = bucket(1, { status: "closed", successorId: 2 });
    const succ = bucket(2);
    const report = computeBudgetReport([closed, succ], plan, roles, [], 8, new Set());
    const succReport = report.buckets.find((b) => b.bucketId === 2)!;
    expect(succReport.spilloverInHours).toBe(20);
    expect(succReport.spilloverInValue).toBe(3000);
    expect(succReport.budgetHours).toBe(120);
  });
  test("project rollup sums bucket revenue/cost and computes project CCI", () => {
    const report = computeBudgetReport([bucket(1), bucket(2)], plan, roles, [], 8, new Set());
    expect(report.project.revenue).toBe(2 * 80 * 150);
    expect(report.project.cost).toBe(2 * 80 * 100);
    expect(report.project.contributionMargin.amount).toBe(2 * (80 * 150 - 80 * 100));
  });
  test("spillover ignores a self/cyclic successor without throwing", () => {
    const a = bucket(1, { status: "closed", successorId: 2 });
    const b = bucket(2, { status: "closed", successorId: 1 });
    expect(() => computeBudgetReport([a, b], plan, roles, [], 8, new Set())).not.toThrow();
  });
});
