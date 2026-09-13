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
    const s = computeBurndownSeries([], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    expect(s.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.totalBudgetHours).toBe(0);
    expect(s.plannedRemainingHours).toEqual([0, 0, 0]);
    expect(s.actualRemainingHours).toEqual([0, 0, null]);
  });

  it("computes planned remaining hours descending to zero", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    expect(s.totalBudgetHours).toBe(300);
    expect(s.plannedRemainingHours).toEqual([200, 100, 0]);
  });

  it("computes actual remaining only up to today's period, null after", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    expect(s.todayIndex).toBe(1);
    expect(s.actualRemainingHours).toEqual([180, 90, null]);
  });

  it("computes € on the external-rate basis", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    expect(s.totalBudgetValue).toBe(60000);
    expect(s.plannedRemainingValue).toEqual([40000, 20000, 0]);
    expect(s.actualRemainingValue).toEqual([36000, 18000, null]);
  });

  it("marks every period null when today is before the plan start", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2025-12-01", null);
    expect(s.todayIndex).toBe(-1);
    expect(s.actualRemainingHours).toEqual([null, null, null]);
  });

  it("has no null when today is on or after the plan end", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, [], 8, new Set<string>(), [], "2026-03-31", null);
    expect(s.todayIndex).toBe(2);
    // cumulative actual 120,210,210 -> remaining 180,90,90
    expect(s.actualRemainingHours).toEqual([180, 90, 90]);
  });
});

describe("computeBurndownSeries — budget follows plan", () => {
  // ★ Named `followPlan*`, not `fp*` — an earlier revision of this fixture used
  // "FP" to mean "follows plan", which reads as "fixed-price" to anyone
  // scanning for fixed-price coverage. §472: that misleading name is what let a
  // real gap (no `type: "fixed"` fixture anywhere in this file) look covered —
  // see the dedicated "fixed-price buckets" describe block below for the
  // fixed-price basis this block does NOT exercise (this one is `type: "tm"`).
  const followPlanPlan: ResourcePlan = {
    startDate: "2026-01-01", endDate: "2026-03-31",
    granularity: "month", currency: "EUR", rows: [], budgetFollowsPlan: true,
  } as unknown as ResourcePlan;
  const followPlanRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  ] as unknown as Role[];
  const followPlanResource = {
    id: 5, firstName: "R5", lastName: "", roleId: 3,
    utilizationMode: "percent", utilization: { "2026-01": 100 },
  } as unknown as Resource;
  // A staffed row whose STORED budget (0) is stale vs the plan; under follow-plan
  // the budget hours ARE the planned capacity (Jan 2026 = 22 workdays × 8h = 176).
  const followPlanBucket: BudgetBucket = {
    id: 9, name: "FollowPlanTM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 0 }, actualHours: { "2026-01": 40 } }],
  } as unknown as BudgetBucket;
  const followPlanResources = [followPlanResource];

  it("derives budget hours from resource capacity for staffed rows (not the stale stored 0)", () => {
    const s = computeBurndownSeries([followPlanBucket], followPlanPlan, followPlanRoles, followPlanResources, 8, new Set<string>(), [], "2026-02-15", null);
    expect(s.totalBudgetHours).toBeCloseTo(176, 5);
    expect(s.totalBudgetValue).toBeCloseTo(176 * 150, 5);
  });

  // Scope: T&M bucket, no spillover — the case where the two totals must agree.
  // §472: the burn-down now models a fixed-price bucket's contract amount too
  // (see the "fixed-price buckets" describe block), so predecessor spillover is
  // the only thing left that the burn-down intentionally does not model — the
  // report can still legitimately diverge from it for a bucket with spillover.
  it("keeps the burndown budget total equal to the report budget total", () => {
    const s = computeBurndownSeries([followPlanBucket], followPlanPlan, followPlanRoles, followPlanResources, 8, new Set<string>(), [], "2026-02-15", null);
    const rep = computeBudgetReport([followPlanBucket], followPlanPlan, followPlanRoles, followPlanResources, 8, new Set<string>(), [], [], null);
    expect(s.totalBudgetHours).toBeCloseTo(rep.project.budgetHours, 5);
    expect(s.totalBudgetValue).toBeCloseTo(rep.project.budgetValue, 5);
  });
});

describe("computeBurndownSeries — fixed-price buckets (§472)", () => {
  // Same shape as the top-level `bucket()` helper (300 budgeted hours across
  // Jan-Mar, 210 actual hours in Jan+Feb) but `type: "fixed"` with a contract
  // amount instead of a role rate — so a mutant that deletes the fixed branch
  // and falls through to `hours * role.rates.external` (role 1's external
  // rate is 200, giving 60000/42000 instead of the contract-based figures
  // below) turns this red.
  const fixedBucket = bucket({ type: "fixed", fixedPriceAmount: 30000 });

  it("values the budget line from the contract amount, not hours × rate", () => {
    const s = computeBurndownSeries([fixedBucket], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    expect(s.totalBudgetHours).toBe(300); // hours are still summed, unaffected by valuation basis
    expect(s.totalBudgetValue).toBeCloseTo(30000, 5);
    expect(s.plannedRemainingValue).toEqual([20000, 10000, 0]);
  });

  it("values actual consumption as the contract amount scaled by the actual/budget hours ratio", () => {
    // actualHours 120 (Jan) + 90 (Feb) = 210 of 300 budgeted -> 30000 * 210/300 = 21000,
    // split back across periods by each period's share of the 210 actual hours.
    const s = computeBurndownSeries([fixedBucket], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    expect(s.todayIndex).toBe(1);
    expect(s.actualRemainingValue).toEqual([18000, 9000, null]);
  });

  it("matches computeBudgetReport's budget and consumed totals for the same bucket", () => {
    const s = computeBurndownSeries([fixedBucket], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    const rep = computeBudgetReport([fixedBucket], plan, roles, [], 8, new Set<string>(), [], [], null);
    expect(s.totalBudgetValue).toBeCloseTo(rep.project.budgetValue, 5);
    // rep.project.consumedValue is the report's basis for "consumed so far";
    // the burn-down's actual series sums to the same total once every period
    // is in the past (today on/after the plan end, mirroring the "has no null
    // when today is on or after the plan end" T&M case above).
    const full = computeBurndownSeries([fixedBucket], plan, roles, [], 8, new Set<string>(), [], "2026-03-31", null);
    const lastRemaining = full.actualRemainingValue[full.actualRemainingValue.length - 1] ?? 0;
    const totalConsumed = full.totalBudgetValue - lastRemaining;
    expect(totalConsumed).toBeCloseTo(rep.project.consumedValue, 5);
  });

  it("values the budget line from the contract amount even with zero budgeted hours, and reports zero consumption", () => {
    // Mirrors computeBucketReport: budgetValue is the full contract amount
    // regardless of hours; consumedValue is 0 whenever budgetHours is 0, even
    // with actual hours booked — an unstaffed contract must not read as
    // "fully consumed" just because someone logged time against it.
    const unstaffed = bucket({
      type: "fixed",
      fixedPriceAmount: 9000,
      allocations: [{
        roleId: 1, resourceIds: [],
        budgetHours: { "2026-01": 0, "2026-02": 0, "2026-03": 0 },
        actualHours: { "2026-01": 10 },
      }],
    });
    const s = computeBurndownSeries([unstaffed], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    expect(s.totalBudgetHours).toBe(0);
    expect(s.totalBudgetValue).toBeCloseTo(9000, 5);
    expect(s.actualRemainingValue).toEqual([9000, 9000, null]);
  });

  it("converts the contract amount through the same FX helper as the report", () => {
    const usdBucket = bucket({
      type: "fixed", currency: "USD", fxRateOverride: 2, fixedPriceAmount: 20000,
      allocations: [{
        roleId: 1, resourceIds: [],
        budgetHours: { "2026-01": 100 },
        actualHours: { "2026-01": 100 },
      }],
    });
    const s = computeBurndownSeries([usdBucket], plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    // 20000 USD at 2 USD/EUR (override) = 10000 EUR, fully consumed (100/100 hours).
    expect(s.totalBudgetValue).toBeCloseTo(10000, 5);
    expect(s.actualRemainingValue[0]).toBeCloseTo(0, 5);
  });
});

describe("computeBurndownSeries span", () => {
  // One bucket living entirely inside February, so a February span is a
  // strictly narrower window than the Jan-Mar plan.
  const febOnly = [
    bucket({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      allocations: [{
        roleId: 1, resourceIds: [],
        budgetHours: { "2026-02": 100 },
        actualHours: { "2026-02": 40 },
      }],
    }),
  ];

  it("slices the plan periods to the span without changing the totals", () => {
    const full = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    const sliced = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null,
      { start: "2026-02-01", end: "2026-02-28" });
    expect(full.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(sliced.periods).toEqual(["2026-02"]);
    expect(sliced.totalBudgetHours).toBe(full.totalBudgetHours);
    expect(sliced.totalBudgetValue).toBe(full.totalBudgetValue);
  });

  it("is identical to the un-sliced call when no span is given", () => {
    const a = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null);
    const b = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null, undefined);
    expect(b).toEqual(a);
  });

  it("extends the span forward to today so the marker is not clamped onto the last tick", () => {
    // Plan Jan-Dec, chain Jan-Mar, today in November: a window that stops at
    // March puts the today line on the March tick, implying the actuals series
    // is complete when eight months of it are simply off-axis.
    const yearPlan = { ...plan, endDate: "2026-12-31" } as ResourcePlan;
    const s = computeBurndownSeries(
      [bucket()], yearPlan, roles, [], 8, new Set<string>(), [], "2026-11-15", null,
      { start: "2026-01-01", end: "2026-03-31" },
    );
    expect(s.periods[s.periods.length - 1]).toBe("2026-11");
    expect(s.todayIndex).toBe(s.periods.length - 1);
  });

  it("does not extend the span backwards for a chain that starts after today", () => {
    const yearPlan = { ...plan, endDate: "2026-12-31" } as ResourcePlan;
    const s = computeBurndownSeries(
      [bucket()], yearPlan, roles, [], 8, new Set<string>(), [], "2026-02-15", null,
      { start: "2026-06-01", end: "2026-08-31" },
    );
    expect(s.periods).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(s.todayIndex).toBe(-1);
  });

  it("falls back to the full plan range when the span selects no period", () => {
    const r = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15", null,
      { start: "2099-01-01", end: "2099-12-31" });
    expect(r.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});
