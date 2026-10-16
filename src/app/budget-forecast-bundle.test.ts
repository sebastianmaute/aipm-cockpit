import { describe, it, expect } from "vitest";
import { computeForecastBundle, type ForecastBundleInput } from "./budget-forecast-bundle";
import { computeForecastFromFacts, forecastFactsByUnit } from "./budget-forecast";
import { computeBudgetReport } from "./budget-report";
import { computeBurndownSeries } from "./budget-burndown";
import { summarizeBudgetHistory, type BudgetHistoryEntry } from "./budget-history";
import type { BudgetBucket, ResourcePlan, Role } from "./types";
import type { BaselineEntry } from "./baseline-currency";

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
    progress: new Map(), budgetHistory: [], baselineHistory: [],
  };
}
const bucket = {
  id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06-10": 8 } }],
} as BudgetBucket;

describe("computeForecastBundle", () => {
  it("carries the by-unit forecasts unchanged, each built from its own unit's facts", () => {
    const inp = input([bucket]);
    const b = computeForecastBundle(inp);
    const facts = forecastFactsByUnit(inp);
    expect(b.facts).toEqual(facts);
    expect(b.eur).toEqual(computeForecastFromFacts(facts.eur));
    expect(b.hours).toEqual(computeForecastFromFacts(facts.hours));
    // Not the same figure twice: the hours forecast runs on the hours facts.
    expect(b.hours.facts.bac).toBe(100);
    expect(b.eur.facts.bac).not.toBe(b.hours.facts.bac);
  });
  it("attaches the rate mix and the earned-value history", () => {
    const b = computeForecastBundle(input([bucket]));
    expect(b.mix?.rows[0].name).toBe("Dev Senior");
    expect(b.evHistory).toEqual({ available: false, reason: "no-earned-value", buckets: [{ id: 1, name: "B1" }] });
  });
  it("carries the summarized budget history, or null when there is none yet", () => {
    const withoutHistory = computeForecastBundle({ ...input([bucket]), budgetHistory: [] });
    expect(withoutHistory.history).toBeNull();
    const history: BudgetHistoryEntry[] = [
      {
        id: "h1", at: "2026-01-01T00:00:00.000Z", date: "2026-01-01", kind: "baseline",
        bucketId: null, bucketName: "", projectBacHours: 100, projectBacValue: 15000, deltaHours: 0, deltaValue: 0,
      },
      {
        id: "h2", at: "2026-02-01T00:00:00.000Z", date: "2026-02-01", kind: "created",
        bucketId: 2, bucketName: "B2", projectBacHours: 120, projectBacValue: 18000, deltaHours: 20, deltaValue: 3000,
      },
    ];
    const withHistory = computeForecastBundle({ ...input([bucket]), budgetHistory: history });
    expect(withHistory.history).toEqual(summarizeBudgetHistory(history));
    expect(withHistory.history).not.toBeNull();
  });
  it("rebases the recorded budget history into the current baseline (§476)", () => {
    const history: BudgetHistoryEntry[] = [{
      id: "h1", at: "2026-01-01T00:00:00.000Z", date: "2026-01-01", kind: "baseline",
      bucketId: null, bucketName: "", projectBacHours: 100, projectBacValue: 15000, deltaHours: 0, deltaValue: 0,
    }];
    const baselineHistory: BaselineEntry[] = [
      { from: "2026-01-01", at: "2025-12-01T00:00:00.000Z", currency: "EUR" },
      { from: "2026-03-01", at: "2026-03-01T00:00:00.000Z", currency: "GBP", perPrevious: 0.85 },
    ];
    const b = computeForecastBundle({ ...input([bucket]), plan: { ...plan, currency: "GBP" }, budgetHistory: history, baselineHistory });
    expect(b.history?.baseline.value).toBeCloseTo(12750, 6);
    expect(b.currency).toBe("GBP");
  });
  it("leaves the budget history as recorded without a baseline switch", () => {
    const history: BudgetHistoryEntry[] = [{
      id: "h1", at: "2026-01-01T00:00:00.000Z", date: "2026-01-01", kind: "baseline",
      bucketId: null, bucketName: "", projectBacHours: 100, projectBacValue: 15000, deltaHours: 0, deltaValue: 0,
    }];
    const b = computeForecastBundle({ ...input([bucket]), budgetHistory: history });
    expect(b.history?.baseline.value).toBe(15000);
    expect(b.currency).toBe("EUR");
  });
});
