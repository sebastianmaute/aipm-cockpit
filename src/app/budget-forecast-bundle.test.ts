import { describe, it, expect } from "vitest";
import { computeForecastBundle, type ForecastBundleInput } from "./budget-forecast-bundle";
import { computeBudgetForecastsByUnit } from "./budget-forecast";
import { computeBudgetReport } from "./budget-report";
import { computeBurndownSeries } from "./budget-burndown";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const none = new Set<string>();
const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 60, externalRate: 100 } as Role];
const today = "2026-09-14";
function input(buckets: BudgetBucket[]): ForecastBundleInput {
  const report = computeBudgetReport(buckets, plan, roles, [], 8, none, [], [], null);
  const burndown = computeBurndownSeries(buckets, plan, roles, [], 8, none, [], today, null);
  return {
    report, buckets, roles, fxRates: null, tasks: [], plan, burndown, holidaySet: none, today,
    resources: [], workdayHours: 8, absences: [], disciplines: [{ id: 1, name: "Dev" }], grades: [{ id: 1, name: "Senior" }],
    progress: new Map(),
  };
}
const bucket = {
  id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06-10": 8 } }],
} as BudgetBucket;

describe("computeForecastBundle", () => {
  it("carries the by-unit forecasts unchanged", () => {
    const inp = input([bucket]);
    const b = computeForecastBundle(inp);
    expect({ eur: b.eur, hours: b.hours }).toEqual(computeBudgetForecastsByUnit(inp));
  });
  it("attaches the rate mix and the earned-value history", () => {
    const b = computeForecastBundle(input([bucket]));
    expect(b.mix?.rows[0].name).toBe("Dev Senior");
    expect(b.evHistory).toEqual({ available: false, reason: "no-earned-value", buckets: [{ id: 1, name: "B1" }] });
  });
});
