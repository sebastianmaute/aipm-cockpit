import { describe, expect, test } from "vitest";
import { computeBudgetReport } from "./budget-report";
import { resolveRate } from "./fx";
import type { ResourcePlan, Role, BudgetBucket, FxRates } from "./types";

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
    const report = computeBudgetReport([closed, succ], plan, roles, [], 8, new Set(), [], [], null);
    const succReport = report.buckets.find((b) => b.bucketId === 2)!;
    expect(succReport.spilloverInHours).toBe(20);
    expect(succReport.spilloverInValue).toBe(3000);
    expect(succReport.budgetHours).toBe(120);
  });
  test("project rollup sums bucket revenue/cost and computes project CCI", () => {
    const report = computeBudgetReport([bucket(1), bucket(2)], plan, roles, [], 8, new Set(), [], [], null);
    expect(report.project.revenue).toBe(2 * 80 * 150);
    expect(report.project.cost).toBe(2 * 80 * 100);
    expect(report.project.contributionMargin.amount).toBe(2 * (80 * 150 - 80 * 100));
  });
  test("spillover ignores a self/cyclic successor without throwing", () => {
    const a = bucket(1, { status: "closed", successorId: 2 });
    const b = bucket(2, { status: "closed", successorId: 1 });
    expect(() => computeBudgetReport([a, b], plan, roles, [], 8, new Set(), [], [], null)).not.toThrow();
  });
});

/**
 * The vacuity trap these pin against: every other fixture in this file is
 * `currency: "EUR"` and passes `fxRates: null`, and under EITHER condition
 * `resolveRate` returns 1 and `currencyToEur` is the identity — so a currency
 * test written with the wrong fixture passes identically before and after the
 * conversion exists. Both cases below therefore use a NON-EUR bucket AND a
 * real rate table, and both are mutation-proved (the conversion itself, and
 * the `fxRates` thread into `computeSpillover`, kill them independently).
 */
describe("computeBudgetReport — currencies do not leak across buckets", () => {
  const fx: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.1, GBP: 0.85 } };

  test("the fixture actually converts — a rate of 1 would make this whole describe vacuous", () => {
    expect(resolveRate(bucket(9, { currency: "USD" }), fx)).toBe(1.1);
  });

  test("a closed USD fixed predecessor spills EUR into its T&M successor", () => {
    const pred = bucket(1, {
      type: "fixed", currency: "USD", fixedPriceAmount: 10000, status: "closed", successorId: 2,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 50 } }],
    });
    const succ = bucket(2, {
      type: "tm", currency: "EUR",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 0 } }],
    });
    const rep = computeBudgetReport([pred, succ], plan, roles, [], 8, new Set<string>(), [], [], fx);
    const successor = rep.buckets.find((b) => b.bucketId === 2)!;
    // The predecessor's remaining budget is (contract − consumed) in EUR.
    // Raw, it would spill 10000 − 5000 = 5000 DOLLARS into a EUR bucket.
    const spilledEur = 10000 / 1.1 - (10000 / 1.1) * 0.5;
    expect(successor.spilloverInValue).toBeCloseTo(spilledEur, 5);
    expect(successor.budgetValue).toBeCloseTo(100 * 150 + spilledEur, 5);
  });

  test("a project mixing USD fixed, GBP fixed and T&M sums one unit", () => {
    const usd = bucket(1, { type: "fixed", currency: "USD", fixedPriceAmount: 11000,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 0 } }] });
    const gbp = bucket(2, { type: "fixed", currency: "GBP", fixedPriceAmount: 8500,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 0 } }] });
    const tm = bucket(3, { type: "tm", currency: "EUR",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }] });
    const rep = computeBudgetReport([usd, gbp, tm], plan, roles, [], 8, new Set<string>(), [], [], fx);
    expect(rep.project.revenue).toBeCloseTo(11000 / 1.1 + 8500 / 0.85 + 10 * 150, 5);
  });
});
