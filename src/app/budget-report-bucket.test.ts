import { describe, expect, test } from "vitest";
import { computeBucketReport } from "./budget-report";
import { resolveRate } from "./fx";
import type { ResourcePlan, Resource, Role, BudgetBucket, FxRates } from "./types";

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
  const rep = computeBucketReport(tmBucket(), plan, roles, resources, 8, noHolidays, 0, 0, [], [], null);
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
  test("consumption: the consumed value (external basis), matching its percent", () => {
    expect(rep.consumption.amount).toBe(80 * 150);
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
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays, 0, 0, [], [], null);
    expect(rep.revenue).toBe(20000);
    expect(rep.cost).toBe(80 * 100);
    expect(rep.winLossValue).toBe(20000 - 8000);
    expect(rep.consumption.percent).toBeNull();
  });
});

describe("computeBucketReport — fixed-price ignores spilled-in value in budget", () => {
  test("budgetValue stays the contract amount; spillover hours still count", () => {
    const b: BudgetBucket = {
      id: 1, name: "FX", type: "fixed", currency: "EUR", fixedPriceAmount: 20000,
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 100 } }],
    };
    // spilloverInHours = 10, spilloverInValue = 5000
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays, 10, 5000, [], [], null);
    expect(rep.budgetValue).toBe(20000);                 // NOT 25000
    expect(rep.budgetHours).toBe(110);                   // 100 + 10 spilled hours
    expect(rep.consumption.amount).toBe(20000);          // fully burned (100/100 of contract)
    expect(rep.consumption.percent).toBeCloseTo(100, 5);
  });
});

describe("computeBucketReport — a fixed-price bucket in a non-EUR currency", () => {
  const fx: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.1, GBP: 0.85 } };
  const usd: BudgetBucket = {
    id: 1, name: "FX", type: "fixed", currency: "USD", fixedPriceAmount: 10000,
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 50 } }],
  };

  test("the fixture actually converts — a rate of 1 would make this whole describe vacuous", () => {
    expect(resolveRate(usd, fx)).toBe(1.1);
  });

  test("revenue is the contract amount in EUR, not the raw bucket-currency number", () => {
    const rep = computeBucketReport(usd, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    expect(rep.revenue).toBeCloseTo(10000 / 1.1, 5);   // NOT 10000
  });

  test("the other two fixed-branch terms convert too — budgetValue and consumedValue", () => {
    // These three read ONE `const fixedPrice`, so they cannot drift today; pinned
    // so that splitting it later cannot convert revenue alone. `consumedValue` is
    // the one with arithmetic of its own (min(price, price * actual/budget)), so
    // its figure is distinct from revenue's rather than a restatement of it.
    // NOT consumption.percent: both its operands scale by 1/rate, so it is
    // rate-invariant and could not tell a converted run from an unconverted one.
    const rep = computeBucketReport(usd, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    expect(rep.budgetValue).toBeCloseTo(10000 / 1.1, 5);
    expect(rep.consumedValue).toBeCloseTo((10000 / 1.1) * 0.5, 5);   // 50 of 100 budget hours
  });

  test("margin is computed across one unit: EUR revenue minus EUR cost", () => {
    const rep = computeBucketReport(usd, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    const revenueEur = 10000 / 1.1;
    expect(rep.cost).toBe(50 * 100);                    // EUR by construction (role rates)
    expect(rep.contributionMargin.amount).toBeCloseTo(revenueEur - 50 * 100, 5);
    expect(rep.contributionMargin.percent).toBeCloseTo(((revenueEur - 5000) / revenueEur) * 100, 5);
  });

  test("win/loss is EUR", () => {
    const rep = computeBucketReport(usd, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    expect(rep.winLossValue).toBeCloseTo(10000 / 1.1 - 50 * 100, 5);
  });

  test("an EUR bucket is unchanged — the conversion is identity at rate 1", () => {
    const eur: BudgetBucket = { ...usd, currency: "EUR" };
    const rep = computeBucketReport(eur, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    expect(rep.revenue).toBe(10000);
  });

  test("an EUR bucket carrying a stale override is unchanged too — the half the fixture above cannot reach", () => {
    // `usd` has no override, so the test above exercises only resolveRate's EUR
    // short-circuit. The modal's currency <select> never clears the override, so
    // a bucket switched USD -> EUR keeps one; if it were honoured the contract
    // amount would be divided here and the project rollup (EUR, unconverted)
    // would print 9,090 for a 10,000 EUR contract.
    const eur: BudgetBucket = { ...usd, currency: "EUR", fxRateOverride: 1.1 };
    const rep = computeBucketReport(eur, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    expect(rep.revenue).toBe(10000);
    expect(rep.budgetValue).toBe(10000);
  });

  test("a T&M bucket is not converted — only the fixed branch reads the contract amount", () => {
    // The negative half of the claim: a T&M bucket's money comes from role rates,
    // which are EUR already, so the SAME bucket must produce identical figures
    // with rates and without them. `toBe`, not `toBeCloseTo` — identity is the claim.
    const tm: BudgetBucket = { ...usd, type: "tm" };
    const withFx = computeBucketReport(tm, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    const withNull = computeBucketReport(tm, plan, roles, resources, 8, noHolidays, 0, 0, [], [], null);
    expect(withFx.revenue).toBe(withNull.revenue);
    expect(withFx.budgetValue).toBe(withNull.budgetValue);
  });

  test("no rates means no conversion — the honest degradation, not an oversight", () => {
    // resolveRate falls back to 1 with no override and no cached ECB rate, so the
    // amount is read as EUR. The display path multiplies by the same 1, so the
    // figure is self-consistent end to end. Pinned so a future "default the rate"
    // change cannot make this silently lossy.
    const rep = computeBucketReport(usd, plan, roles, resources, 8, noHolidays, 0, 0, [], [], null);
    expect(rep.revenue).toBe(10000);
  });
});
