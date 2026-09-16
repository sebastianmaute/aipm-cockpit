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
 * §550 — closing a bucket must not change the project's budget.
 *
 * Spillover is a REALLOCATION of an existing bucket's unconsumed remainder to
 * its successor, not new scope: the closed predecessor goes on reporting its
 * own full budget while the successor's reported figures absorb the remainder,
 * so a project rollup summing the REPORTED per-bucket figures counts that
 * remainder twice. Closing a bucket then reports a healthier project with
 * nothing added and nothing delivered.
 *
 * Every case is written as the SAME honest total in both the open and the
 * closed state, because that invariance IS the property — a one-state
 * assertion would pin whatever the engine happens to produce.
 *
 * ★ Each case first pins that its fixture really spills. With no spillover
 * every assertion below holds trivially, so the anti-vacuity guard is what
 * makes the rest evidence rather than arithmetic about zero.
 */
describe("computeBudgetReport — project rollup excludes spilled-in budget (§550)", () => {
  const noHolidays = new Set<string>();

  function alloc(budgetHours: number, actualHours: number): BudgetBucket["allocations"] {
    return [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": budgetHours }, actualHours: { "2026-01": actualHours } }];
  }
  const run = (bs: BudgetBucket[]) => computeBudgetReport(bs, plan, roles, [], 8, noHolidays, [], [], null);

  describe("a time-and-materials successor", () => {
    // 100 h budget / 40 h actual → a 60 h (9000 EUR) remainder spills on close.
    const pred = (status: BudgetBucket["status"]) => bucket(1, { status, successorId: 2, allocations: alloc(100, 40) });
    const succ = bucket(2, { allocations: alloc(50, 0) });
    const open = run([pred("open"), succ]);
    const closed = run([pred("closed"), succ]);

    test("the fixture really spills — without this the case is vacuous", () => {
      expect(closed.buckets.find((b) => b.bucketId === 2)!.spilloverInHours).toBe(60);
      expect(closed.buckets.find((b) => b.bucketId === 2)!.spilloverInValue).toBe(9000);
    });

    test("project budget hours are the two own budgets, open or closed", () => {
      expect(open.project.budgetHours).toBe(150);
      expect(closed.project.budgetHours).toBe(150);
    });
    test("project win/loss hours are own budget less actual, open or closed", () => {
      expect(open.project.winLossHours).toBe(150 - 40);
      expect(closed.project.winLossHours).toBe(150 - 40);
    });
    test("project budget value is the two own budgets, open or closed", () => {
      expect(open.project.budgetValue).toBe(22500);
      expect(closed.project.budgetValue).toBe(22500);
    });
    test("project win/loss value is own budget less consumed, open or closed", () => {
      expect(open.project.winLossValue).toBe(22500 - 6000);
      expect(closed.project.winLossValue).toBe(22500 - 6000);
    });
    // Consumption rides `budgetValue`, so an inflated denominator makes a
    // project look less burned the moment a bucket is closed.
    test("project consumption percent is unchanged by closing the predecessor", () => {
      expect(closed.project.consumption.percent).toBeCloseTo(open.project.consumption.percent!, 9);
    });
  });

  describe("a fixed-price successor receiving spillover", () => {
    // The asymmetry: `computeBucketReport` adds spilled-in HOURS to every
    // bucket's reported budget hours but adds spilled-in VALUE only to a T&M
    // bucket — a fixed-price budget IS its contract amount. So the hours here
    // are inflated while the value is not, and a project-level rollup that
    // subtracted the spilled-in value from every bucket would UNDER-count this
    // project by 9000 EUR.
    // ★★ The successor books 20 of its 50 h ON PURPOSE. A fixed-price bucket's
    // win/loss is `revenue − cost` (20000 − 2000 = 18000), never
    // `budget − consumed` (20000 − 8000 = 12000); with 0 actual hours the two
    // expressions collapse to the same number and a rollup taking the wrong one
    // would pass. These figures are what separate them.
    const pred = (status: BudgetBucket["status"]) => bucket(1, { status, successorId: 2, allocations: alloc(100, 40) });
    const succ = bucket(2, { type: "fixed", fixedPriceAmount: 20000, allocations: alloc(50, 20) });
    const open = run([pred("open"), succ]);
    const closed = run([pred("closed"), succ]);

    test("the fixture really spills into the fixed-price bucket", () => {
      const succRep = closed.buckets.find((b) => b.bucketId === 2)!;
      expect(succRep.spilloverInHours).toBe(60);
      expect(succRep.spilloverInValue).toBe(9000);
      // …and that value is correctly ignored by the bucket's own budget.
      expect(succRep.budgetValue).toBe(20000);
      // The two win/loss expressions really do differ on this fixture.
      expect(succRep.consumedValue).toBe(8000);
      expect(succRep.winLossValue).toBe(18000);
    });

    test("project budget hours are the two own budgets, open or closed", () => {
      expect(open.project.budgetHours).toBe(150);
      expect(closed.project.budgetHours).toBe(150);
    });
    test("project win/loss hours are own budget less actual, open or closed", () => {
      expect(open.project.winLossHours).toBe(150 - 60);
      expect(closed.project.winLossHours).toBe(150 - 60);
    });
    test("project budget value keeps the fixed contract WHOLE — never 26000", () => {
      expect(open.project.budgetValue).toBe(15000 + 20000);
      expect(closed.project.budgetValue).toBe(15000 + 20000);
    });
    test("project win/loss value uses revenue−cost for the fixed bucket", () => {
      expect(open.project.winLossValue).toBe(9000 + 18000);
      expect(closed.project.winLossValue).toBe(9000 + 18000);
    });
  });

  describe("two predecessors chaining into one successor", () => {
    const p1 = (status: BudgetBucket["status"]) => bucket(1, { status, successorId: 3, allocations: alloc(100, 40) });
    const p2 = (status: BudgetBucket["status"]) => bucket(2, { status, successorId: 3, allocations: alloc(50, 10) });
    const succ = bucket(3, { allocations: alloc(30, 0) });
    const open = run([p1("open"), p2("open"), succ]);
    const closed = run([p1("closed"), p2("closed"), succ]);

    test("both remainders really accumulate into the one successor", () => {
      const succRep = closed.buckets.find((b) => b.bucketId === 3)!;
      expect(succRep.spilloverInHours).toBe(60 + 40);
      expect(succRep.spilloverInValue).toBe(9000 + 6000);
    });

    test("project budget hours are the three own budgets, open or closed", () => {
      expect(open.project.budgetHours).toBe(180);
      expect(closed.project.budgetHours).toBe(180);
    });
    test("project win/loss hours are own budget less actual, open or closed", () => {
      expect(open.project.winLossHours).toBe(180 - 50);
      expect(closed.project.winLossHours).toBe(180 - 50);
    });
    test("project budget value is the three own budgets, open or closed", () => {
      expect(open.project.budgetValue).toBe(27000);
      expect(closed.project.budgetValue).toBe(27000);
    });
    test("project win/loss value is own budget less consumed, open or closed", () => {
      expect(open.project.winLossValue).toBe(27000 - 7500);
      expect(closed.project.winLossValue).toBe(27000 - 7500);
    });
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
