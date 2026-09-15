import { describe, it, expect } from "vitest";
import { computeRateMix, rateMixSignal, RATE_DRIFT_SIGNAL_RATIO, RATE_MIX_DRIVER_MIN_DIFFERENCE } from "./budget-rate-mix";
import { bucketRateRows, computeBudgetReport } from "./budget-report";
import { computeForecastFromFacts, type DatedValue, type ForecastFacts } from "./budget-forecast";
import { workingDaysBefore } from "./working-days";
import type { BudgetBucket, Discipline, Grade, ResourcePlan, Role } from "./types";

const none = new Set<string>();
const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const disciplines: Discipline[] = [{ id: 1, name: "Consultant" }, { id: 2, name: "Analyst" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }, { id: 2, name: "Regular" }, { id: 3, name: "Junior" }];
const roles = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 90, externalRate: 150 },
  { id: 2, disciplineId: 1, gradeId: 2, internalRate: 70, externalRate: 120 },
  { id: 3, disciplineId: 1, gradeId: 3, internalRate: 50, externalRate: 90 },
  { id: 4, disciplineId: 2, gradeId: 1, internalRate: 60, externalRate: 100 },
] as Role[];
const day = (date: string, value: number): DatedValue => ({ date, bookedFrom: date, value, spread: false });
function facts(bac: number, ac: number, ev: number, pv: number, windowValue: number): ForecastFacts {
  return {
    bac, ac, ev, pv, bucketsMissingPercent: [],
    dated: [day("2026-01-05", ac - windowValue), ...workingDaysBefore("2026-09-14", 20, none).map((d) => day(d, windowValue / 20))],
    planEnd: "2026-12-18", today: "2026-09-14", holidaySet: none, hasFixedPrice: false,
  };
}
const EUR = computeForecastFromFacts(facts(240_000, 168_000, 148_800, 176_000, 27_000));
const hoursForecast = (ac: number, windowHours: number) => computeForecastFromFacts(facts(2_000, ac, 1_240, 176_000 / 120, windowHours));

function scenarioBucket(booked: [number, number, number]): BudgetBucket {
  return {
    id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [
      { roleId: 1, resourceIds: [], budgetHours: { "2026-06": 600 }, actualHours: { "2026-06": booked[0] } },
      { roleId: 2, resourceIds: [], budgetHours: { "2026-06": 800 }, actualHours: { "2026-06": booked[1] } },
      { roleId: 3, resourceIds: [], budgetHours: { "2026-06": 600 }, actualHours: { "2026-06": booked[2] } },
    ],
  } as BudgetBucket;
}
function mix(buckets: BudgetBucket[], hours = hoursForecast(1_450, 220)) {
  return computeRateMix({
    buckets, roles, disciplines, grades, plan, resources: [], workdayHours: 8, holidaySet: none, absences: [],
    eur: EUR, hours,
  });
}

describe("bucketRateRows ids", () => {
  it("tags role rows with roleId and blended rows with disciplineId", () => {
    expect(bucketRateRows(scenarioBucket([0, 0, 0]), roles)[0].roleId).toBe(1);
    const blended = {
      ...scenarioBucket([0, 0, 0]), planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 2, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
    } as BudgetBucket;
    expect(bucketRateRows(blended, roles)[0].disciplineId).toBe(2);
  });
});

describe("computeRateMix — spec §7 scenarios", () => {
  it("cheaper roles overburn: drift −3.45%, junior drives, hours worse, warning", () => {
    const m = mix([scenarioBucket([339, 572, 539])], hoursForecast(1_450, 220))!;
    expect(m.drift).toBeCloseTo((168_000 / 1_450) / 120 - 1, 9);
    expect(m.bookedRate).toBeCloseTo(168_000 / 1_450, 9);
    expect(m.plannedRate).toBe(120);
    expect(m.rows.map((r) => r.name)).toEqual(["Consultant Senior", "Consultant Regular", "Consultant Junior"]);
    expect(m.rows[2].plannedShare).toBeCloseTo(0.3, 9);
    expect(m.rows[2].bookedShare).toBeCloseTo(539 / 1_450, 9);
    expect(m.rows[2].usedOfBudget).toBeCloseTo(539 / 600, 9);
    expect(m.rows[1].plannedRate).toBe(120);
    expect(m.driver?.id).toBe(3);
    expect(m).toMatchObject({ triggered: true, direction: "hours-worse", severity: "warning" });
  });

  it("senior roles overburn: drift +3.70%, senior drives, € worse, info", () => {
    const m = mix([scenarioBucket([505, 540, 305])], hoursForecast(1_350, 205))!;
    expect(m.drift).toBeCloseTo((168_000 / 1_350) / 120 - 1, 9);
    expect(m.driver?.id).toBe(1);
    expect(m).toMatchObject({ triggered: true, direction: "eur-worse", severity: "info" });
  });

  it("mix on plan: no drift, no driver, not triggered", () => {
    const m = mix([scenarioBucket([420, 560, 420])], hoursForecast(1_400, 225))!;
    expect(m.drift).toBeCloseTo(0, 9);
    expect(m.driver).toBeNull();
    expect(m).toMatchObject({ triggered: false, direction: null, severity: null });
  });
});

describe("computeRateMix — rules", () => {
  it("excludes fixed-price buckets from drift and rows", () => {
    const fixed = { ...scenarioBucket([900, 0, 0]), id: 2, type: "fixed", fixedPriceAmount: 50_000 } as BudgetBucket;
    const with_ = mix([scenarioBucket([339, 572, 539]), fixed])!;
    const without = mix([scenarioBucket([339, 572, 539])])!;
    expect(with_.drift).toBeCloseTo(without.drift, 12);
    expect(with_.actualHours).toBe(without.actualHours);
  });

  it("groups blended buckets by discipline, named by the discipline", () => {
    const blended = {
      ...scenarioBucket([0, 0, 0]), id: 2, planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 2, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06": 100 } }],
    } as BudgetBucket;
    const m = mix([scenarioBucket([339, 572, 539]), blended])!;
    const analyst = m.rows.find((r) => r.kind === "discipline")!;
    expect(analyst).toMatchObject({ id: 2, name: "Analyst", budgetHours: 100, actualHours: 100 });
  });

  it("names a dangling discipline '—'", () => {
    const rated = scenarioBucket([339, 572, 539]);
    const blended = {
      ...rated, id: 2, planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 99, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06": 80 } }],
    } as BudgetBucket;
    const m = mix([rated, blended])!;
    const row = m.rows.find((r) => r.kind === "discipline")!;
    expect(row.name).toBe("—");
  });

  it("matches the report's own hours and value for hourly buckets (parity)", () => {
    const b = [scenarioBucket([339, 572, 539])];
    const m = mix(b)!;
    const report = computeBudgetReport(b, plan, roles, [], 8, none, [], [], null);
    const hourly = report.buckets.filter((r) => r.type !== "fixed");
    expect(m.budgetHours).toBeCloseTo(hourly.reduce((s, r) => s + r.budgetHours - r.spilloverInHours, 0), 9);
    expect(m.actualHours).toBeCloseTo(hourly.reduce((s, r) => s + r.actualHours, 0), 9);
    expect(m.bookedValue).toBeCloseTo(hourly.reduce((s, r) => s + r.consumedValue, 0), 9);
  });

  it("is null without booked hours or without hourly budget", () => {
    expect(mix([scenarioBucket([0, 0, 0])])).toBeNull();
    expect(mix([])).toBeNull();
  });

  it("is null when budget value is zero despite positive hours (unrated role)", () => {
    const zeroRateRoles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 50, externalRate: 0 }] as Role[];
    const bucket: BudgetBucket = {
      id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 500 }, actualHours: { "2026-06": 300 } }],
    } as BudgetBucket;
    const result = computeRateMix({
      buckets: [bucket], roles: zeroRateRoles, disciplines, grades, plan, resources: [], workdayHours: 8, holidaySet: none, absences: [],
      eur: EUR, hours: hoursForecast(1_450, 220),
    });
    expect(result).toBeNull();
  });

  it("names a dangling role '—'", () => {
    const rated = scenarioBucket([339, 572, 539]);
    const dangling = {
      ...rated,
      allocations: [...rated.allocations, { roleId: 99, resourceIds: [], budgetHours: { "2026-06": 10 }, actualHours: { "2026-06": 5 } }],
    } as BudgetBucket;
    const m = mix([dangling])!;
    const row = m.rows.find((r) => r.id === 99)!;
    expect(row.name).toBe("—");
  });

  it("reports null plannedRate and usedOfBudget for a row with hours booked but no budget", () => {
    const rated = scenarioBucket([339, 572, 539]);
    const withUnbudgeted = {
      ...rated,
      allocations: [...rated.allocations, { roleId: 4, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 20 } }],
    } as BudgetBucket;
    const m = mix([withUnbudgeted])!;
    const row = m.rows.find((r) => r.id === 4)!;
    expect(row.budgetHours).toBe(0);
    expect(row.plannedRate).toBeNull();
    expect(row.usedOfBudget).toBeNull();
  });

  it("aggregates a role's rows across multiple buckets into one group", () => {
    const b1: BudgetBucket = {
      id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 300 }, actualHours: { "2026-06": 150 } }],
    } as BudgetBucket;
    const b2: BudgetBucket = {
      id: 2, name: "B2", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 200 }, actualHours: { "2026-06": 100 } }],
    } as BudgetBucket;
    const m = mix([b1, b2])!;
    const row = m.rows.find((r) => r.id === 1)!;
    expect(row.budgetHours).toBe(500);
    expect(row.actualHours).toBe(250);
  });

  it("driver picks the largest of several rows crossing the threshold", () => {
    const bucket: BudgetBucket = {
      id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
      allocations: [
        { roleId: 1, resourceIds: [], budgetHours: { "2026-06": 500 }, actualHours: { "2026-06": 650 } },
        { roleId: 2, resourceIds: [], budgetHours: { "2026-06": 500 }, actualHours: { "2026-06": 600 } },
        { roleId: 3, resourceIds: [], budgetHours: { "2026-06": 500 }, actualHours: { "2026-06": 700 } },
        { roleId: 4, resourceIds: [], budgetHours: { "2026-06": 500 }, actualHours: { "2026-06": 50 } },
      ],
    } as BudgetBucket;
    const m = mix([bucket])!;
    expect(m.driver?.id).toBe(3);
    expect(m.driver?.difference).toBeCloseTo(0.1, 9);
    // sanity: every candidate above crossed the threshold, confirming the reduce
    // actually compared multiple non-null candidates rather than short-circuiting.
    expect(
      m.rows.filter((r) => r.difference >= RATE_MIX_DRIVER_MIN_DIFFERENCE).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("honors the plan's budgetFollowsPlan flag (budget hours match the report's)", () => {
    const followPlan = { ...plan, budgetFollowsPlan: true };
    // The senior allocation is staffed by a resource planned at 700 h in June,
    // so with the flag ON its budget hours are the live 700, not the stored
    // 600. Without a staffed allocation `effectiveBudgetHours` returns the
    // stored map either way and this test could not see the flag at all.
    const resources = [{
      id: 1, firstName: "A", lastName: "B", roleId: 1,
      utilizationMode: "hours" as const, utilization: { "2026-06": 700 },
    }];
    const base = scenarioBucket([339, 572, 539]);
    const b = [{ ...base, allocations: base.allocations.map((a, i) => (i === 0 ? { ...a, resourceIds: [1] } : a)) }];
    const m = computeRateMix({
      buckets: b, roles, disciplines, grades, plan: followPlan, resources, workdayHours: 8, holidaySet: none, absences: [],
      eur: EUR, hours: hoursForecast(1_450, 220),
    })!;
    const report = computeBudgetReport(b, followPlan, roles, resources, 8, none, [], [], null);
    const hourly = report.buckets.filter((r) => r.type !== "fixed");
    expect(m.budgetHours).toBeCloseTo(2_100, 9);
    expect(m.budgetHours).toBeCloseTo(hourly.reduce((s, r) => s + r.budgetHours - r.spilloverInHours, 0), 9);
  });
});

describe("rateMixSignal", () => {
  const hours = hoursForecast(1_400, 225); // same rating band as EUR (A)
  it("fires at exactly the drift threshold and not just below it", () => {
    expect(rateMixSignal(RATE_DRIFT_SIGNAL_RATIO, EUR, hours).triggered).toBe(true);
    expect(rateMixSignal(-RATE_DRIFT_SIGNAL_RATIO, EUR, hours).triggered).toBe(true);
    expect(rateMixSignal(0.0299, EUR, hours).triggered).toBe(false);
  });
  it("fires on differing ratings alone, as a warning", () => {
    expect(rateMixSignal(0, EUR, hoursForecast(1_450, 220))).toEqual({ triggered: true, direction: "hours-worse", severity: "warning" });
  });
  it("never fires without both pace forecasts", () => {
    const noPace = computeForecastFromFacts({ ...facts(2_000, 1_450, 1_240, 1, 220), dated: [] });
    expect(rateMixSignal(0.5, EUR, noPace)).toEqual({ triggered: false, direction: null, severity: null });
  });
  it("never fires when the EUR forecast itself has no pace", () => {
    const noPaceEur = computeForecastFromFacts({ ...facts(240_000, 168_000, 148_800, 176_000, 27_000), dated: [] });
    expect(rateMixSignal(0.5, noPaceEur, hours).triggered).toBe(false);
  });
  it("never fires when the EUR forecast has non-positive BAC", () => {
    const zeroBacEur = computeForecastFromFacts(facts(0, 168_000, 148_800, 176_000, 27_000));
    expect(rateMixSignal(0.5, zeroBacEur, hours).triggered).toBe(false);
  });
  it("never fires when the hours forecast has non-positive BAC", () => {
    const zeroBacHours = computeForecastFromFacts(facts(0, 1_450, 1_240, 176_000 / 120, 220));
    expect(rateMixSignal(0.5, EUR, zeroBacHours).triggered).toBe(false);
  });
});
