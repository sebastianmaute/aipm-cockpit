import { describe, expect, it } from "vitest";
import {
  computeBudgetForecast, computeForecastFromFacts, computeProjectForecast, forecastFacts, forecastGap,
  isEfficiencyAvailable, isPaceAvailable, paceVacHealth,
  type BudgetForecastInput, type DatedValue, type EfficiencyForecast, type ForecastFacts, type PaceForecast,
} from "./budget-forecast";
import { computeBudgetReport } from "./budget-report";
import { computeBurndownSeries } from "./budget-burndown";
import { nthWorkingDayAfter, periodBounds, workingDaysBefore, workingDaysInRange } from "./working-days";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const none = new Set<string>();
const day = (date: string, value: number, spread = false): DatedValue => ({ date, bookedFrom: date, value, spread });

function fixture(over: Partial<ForecastFacts> = {}): ForecastFacts {
  return {
    bac: 240_000, ac: 168_000, ev: 148_800, pv: 176_000, bucketsMissingPercent: [],
    dated: [day("2026-01-05", 141_000), ...workingDaysBefore("2026-09-14", 20, none).map((d) => day(d, 1_350))],
    planEnd: "2026-12-18", today: "2026-09-14", holidaySet: none, hasFixedPrice: false,
    ...over,
  };
}

describe("computeForecastFromFacts — spec §5.6 acceptance fixture", () => {
  const f = computeForecastFromFacts(fixture());

  it("facts", () => {
    expect(f.facts).toEqual({ bac: 240_000, ac: 168_000, remaining: 72_000, ev: 148_800, percentComplete: 62 });
  });

  it("current pace", () => {
    if (!isPaceAvailable(f.pace)) throw new Error("pace unavailable");
    expect(f.pace.burnRatePerDay).toBe(1_350);
    expect(f.pace.windowDays).toBe(20);
    expect(f.pace.windowStart).toBe("2026-08-17");
    expect(f.pace.windowEnd).toBe("2026-09-11");
    expect(f.pace.workingDaysLeft).toBe(69);
    expect(f.pace.etc).toBe(93_150);
    expect(f.pace.eac).toBe(261_150);
    expect(f.pace.vac).toBe(-21_150);
    expect(f.pace.runOutDate).toBe("2026-11-27");
    expect(f.pace.daysBeforePlannedEnd).toBe(21);
    expect(f.pace.spreadPeriodHoursUsed).toBe(false);
  });

  it("current efficiency", () => {
    if (!isEfficiencyAvailable(f.efficiency)) throw new Error("efficiency unavailable");
    expect(f.efficiency.pv).toBe(176_000);
    expect(f.efficiency.cpi).toBeCloseTo(0.885714, 6);
    expect(f.efficiency.spi).toBeCloseTo(0.845455, 6);
    expect(f.efficiency.etc).toBeCloseTo(102_967.74, 2);
    expect(f.efficiency.eac).toBeCloseTo(270_967.74, 2);
    expect(f.efficiency.vac).toBeCloseTo(-30_967.74, 2);
  });

  it("gap", () => {
    expect(f.gap).not.toBeNull();
    expect(f.gap!.eacDifference).toBeCloseTo(9_817.74, 2);
    expect(f.gap!.percentOfBac).toBeCloseTo(0.040907, 6);
    expect(f.gap!.severity).toBe("info");
    expect(f.gap!.extraWorkingDays).toBe(8);
  });
});

describe("computeForecastFromFacts — pace window", () => {
  it("skips a holiday and ignores a booking on it", () => {
    const hs = new Set(["2026-09-07"]);
    const f = computeForecastFromFacts(fixture({ holidaySet: hs, dated: [day("2026-01-05", 1), day("2026-09-07", 9_999), day("2026-08-14", 2_000)] }));
    if (!isPaceAvailable(f.pace)) throw new Error("pace unavailable");
    expect(f.pace.windowStart).toBe("2026-08-14");
    expect(f.pace.burnRatePerDay).toBe(100);
  });

  it("flags spread period hours only when they fall in the window", () => {
    const inWindow = computeForecastFromFacts(fixture({ dated: [day("2026-01-05", 1), { date: "2026-09-01", bookedFrom: "2026-09-01", value: 100, spread: true }] }));
    const outside = computeForecastFromFacts(fixture({ dated: [{ date: "2026-01-05", bookedFrom: "2026-01-01", value: 100, spread: true }, day("2026-09-01", 100)] }));
    expect(isPaceAvailable(inWindow.pace) && inWindow.pace.spreadPeriodHoursUsed).toBe(true);
    expect(isPaceAvailable(outside.pace) && outside.pace.spreadPeriodHoursUsed).toBe(false);
  });

  it("returns no run-out when the budget is already used up", () => {
    const f = computeForecastFromFacts(fixture({ ac: 250_000 }));
    expect(isPaceAvailable(f.pace) && f.pace.runOutDate).toBeNull();
    expect(isPaceAvailable(f.pace) && f.pace.daysBeforePlannedEnd).toBeNull();
  });

  it("returns no run-out when remaining is exactly 0 (controller ruling 2, <= not < mutant killer)", () => {
    const f = computeForecastFromFacts(fixture({ ac: 240_000 }));
    expect(isPaceAvailable(f.pace) && f.pace.runOutDate).toBeNull();
    expect(isPaceAvailable(f.pace) && f.pace.daysBeforePlannedEnd).toBeNull();
  });

  it("keeps the run-out day count tolerance-safe against float division rounding (controller ruling 1, probe: burn=3/20, remaining=burn×54)", () => {
    const burnRatePerDay = 3 / 20;
    const ac = 100_000;
    const remaining = burnRatePerDay * 54;
    const bac = ac + remaining;
    const f = computeForecastFromFacts(fixture({
      bac, ac, dated: [day("2026-01-05", 1), day("2026-08-20", 3)],
    }));
    if (!isPaceAvailable(f.pace)) throw new Error("pace unavailable");
    expect(f.pace.burnRatePerDay).toBe(burnRatePerDay);
    expect(f.pace.runOutDate).toBe(nthWorkingDayAfter("2026-09-14", 54, none));
    expect(f.pace.runOutDate).not.toBe(nthWorkingDayAfter("2026-09-14", 55, none));
  });

  it("counts a run-out after the plan end as negative days", () => {
    const f = computeForecastFromFacts(fixture({ planEnd: "2026-10-30" }));
    if (!isPaceAvailable(f.pace)) throw new Error("pace unavailable");
    expect(f.pace.runOutDate).toBe("2026-11-27");
    expect(f.pace.daysBeforePlannedEnd).toBe(-28);
  });

  it("has no working days left when the plan has ended", () => {
    const f = computeForecastFromFacts(fixture({ planEnd: "2026-09-01" }));
    expect(isPaceAvailable(f.pace) && f.pace.workingDaysLeft).toBe(0);
    expect(isPaceAvailable(f.pace) && f.pace.etc).toBe(0);
  });
});

describe("computeForecastFromFacts — pace unavailable", () => {
  it("not-enough-bookings with transparency fields", () => {
    const dated = workingDaysInRange("2026-09-15", "2026-10-01", none).map((d) => day(d, 100));
    const f = computeForecastFromFacts(fixture({ today: "2026-10-02", dated }));
    expect(f.pace).toEqual({ unavailable: "not-enough-bookings", firstBookingDate: "2026-09-15", bookedWorkingDays: 13, availableFrom: "2026-10-13" });
  });

  it("counts from a weekend first booking across a holiday", () => {
    const hs = new Set(["2026-09-21"]);
    const f = computeForecastFromFacts(fixture({ today: "2026-09-25", holidaySet: hs, dated: [day("2026-09-19", 50)] }));
    expect(f.pace).toEqual({ unavailable: "not-enough-bookings", firstBookingDate: "2026-09-19", bookedWorkingDays: 3, availableFrom: "2026-10-20" });
  });

  it("uses a period's start as the first booking date", () => {
    const f = computeForecastFromFacts(fixture({ today: "2026-09-25", dated: [{ date: "2026-09-15", bookedFrom: "2026-09-01", value: 10, spread: true }] }));
    expect(f.pace).toMatchObject({ unavailable: "not-enough-bookings", firstBookingDate: "2026-09-01" });
  });

  it("nothing booked", () => {
    const f = computeForecastFromFacts(fixture({ dated: [] }));
    expect(f.pace).toEqual({ unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null });
  });

  it("no-burn names the window and the last booking", () => {
    const f = computeForecastFromFacts(fixture({ dated: [day("2026-01-05", 100), day("2026-08-03", 50)] }));
    expect(f.pace).toEqual({ unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: "2026-08-03" });
  });

  it("no-burn ignores bookings dated today or later for the last booking", () => {
    const f = computeForecastFromFacts(fixture({ dated: [day("2026-01-05", 100), day("2026-09-14", 50)] }));
    expect(f.pace).toMatchObject({ unavailable: "no-burn", lastBookingDate: "2026-01-05" });
  });
});

describe("computeForecastFromFacts — efficiency unavailable", () => {
  it("needs percent complete, names buckets in order", () => {
    const missing = [{ id: 2, name: "Design" }, { id: 3, name: "Rollout" }];
    const f = computeForecastFromFacts(fixture({ ev: null, bucketsMissingPercent: missing }));
    expect(f.efficiency).toEqual({ unavailable: "needs-percent-complete", bucketsMissingPercent: missing });
    expect(f.facts.percentComplete).toBeNull();
    expect(f.gap).toBeNull();
  });

  it("no actual cost", () => {
    expect(computeForecastFromFacts(fixture({ ac: 0 })).efficiency).toEqual({ unavailable: "no-actual-cost" });
  });

  it("no earned value", () => {
    expect(computeForecastFromFacts(fixture({ ev: 0 })).efficiency).toEqual({ unavailable: "no-earned-value" });
  });

  it("no actual cost wins over no earned value when both are 0 (controller ruling 2, check-order mutant killer)", () => {
    const f = computeForecastFromFacts(fixture({ ac: 0, ev: 0 }));
    expect(f.efficiency).toEqual({ unavailable: "no-actual-cost" });
  });

  it("SPI is null when nothing is planned yet", () => {
    const f = computeForecastFromFacts(fixture({ pv: 0 }));
    expect(isEfficiencyAvailable(f.efficiency) && f.efficiency.spi).toBeNull();
  });

  it("needs-percent-complete wins over no-actual-cost when ev is null and ac is 0 (order mutant killer)", () => {
    const f = computeForecastFromFacts(fixture({ ev: null, ac: 0 }));
    expect(f.efficiency).toEqual({ unavailable: "needs-percent-complete", bucketsMissingPercent: [] });
  });
});

describe("forecastGap", () => {
  const pace = { burnRatePerDay: 1_000, workingDaysLeft: 40, eac: 100_000 } as PaceForecast;
  const eff = (eac: number, etc = 50_000) => ({ eac, etc } as EfficiencyForecast);

  it("warns at exactly 10% of BAC and not at 9.99%", () => {
    expect(forecastGap(pace, eff(110_000), 100_000)!.severity).toBe("warning");
    expect(forecastGap(pace, eff(109_990), 100_000)!.severity).toBe("info");
  });

  it("uses the absolute EAC difference", () => {
    expect(forecastGap(pace, eff(90_000), 100_000)!.eacDifference).toBe(10_000);
  });

  it("extra working days only when positive", () => {
    expect(forecastGap(pace, eff(110_000), 100_000)!.extraWorkingDays).toBe(10);
    expect(forecastGap({ ...pace, workingDaysLeft: 50 }, eff(110_000), 100_000)!.extraWorkingDays).toBeNull();
    expect(forecastGap({ ...pace, workingDaysLeft: 60 }, eff(110_000), 100_000)!.extraWorkingDays).toBeNull();
  });

  it("zero BAC reads as info", () => {
    expect(forecastGap(pace, eff(110_000), 0)).toMatchObject({ percentOfBac: 0, severity: "info" });
  });

  it("returns null when the burn rate is zero or negative (controller ruling 3)", () => {
    expect(forecastGap({ ...pace, burnRatePerDay: 0 }, eff(110_000), 100_000)).toBeNull();
    expect(forecastGap({ ...pace, burnRatePerDay: -5 }, eff(110_000), 100_000)).toBeNull();
  });

  it("keeps extraWorkingDays tolerance-safe against float division rounding", () => {
    const burnRatePerDay = 3 / 20;
    const workingDaysLeft = 40;
    // Reproduces the same float-drift shape as the run-out probe: `etc` arrives
    // from an upstream subtraction of a large base (bac - ev, in real use),
    // which is what actually introduces the rounding error — the bare
    // multiplication `burn × 54` alone stays exact.
    const base = 100_000;
    const etc = base + burnRatePerDay * (workingDaysLeft + 14) - base;
    const g = forecastGap({ ...pace, burnRatePerDay, workingDaysLeft }, eff(100_000, etc), 100_000);
    expect(g!.extraWorkingDays).toBe(14);
  });
});

describe("paceVacHealth", () => {
  it("green, amber, red at the 10% line", () => {
    expect(paceVacHealth(0, 100)).toBe("G");
    expect(paceVacHealth(-9.99, 100)).toBe("A");
    expect(paceVacHealth(-10, 100)).toBe("R");
    expect(paceVacHealth(-1, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assembler — forecastFacts / computeBudgetForecast / computeProjectForecast

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles = [{ id: 1, disciplineId: 1, name: "Dev", gradeId: 1, internalRate: 60, externalRate: 100 } as Role];
function bucket(id: number, over: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id, name: `B${id}`, type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
    ...over,
  } as BudgetBucket;
}
function input(buckets: BudgetBucket[], tasks: BudgetForecastInput["tasks"] = [], today = "2026-09-14"): BudgetForecastInput {
  const report = computeBudgetReport(buckets, plan, roles, [], 8, none, [], [], null);
  const burndown = computeBurndownSeries(buckets, plan, roles, [], 8, none, [], today, null);
  return { report, buckets, roles, fxRates: null, tasks, plan, burndown, holidaySet: none, today };
}
const withActual = (id: number, actual: Record<string, number>, over: Partial<BudgetBucket> = {}) =>
  bucket(id, { allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: actual }], ...over } as Partial<BudgetBucket>);

describe("forecastFacts", () => {
  it("values exactly the keys the report counts, so the dated values sum to AC", () => {
    const b = withActual(1, { "2026-06-10": 8, "2026-06": 20, "2026-W24": 5, "2025-12": 3, "2026-07-01": 0 });
    const inp = input([b]);
    const f = forecastFacts(inp);
    expect(f.ac).toBe(inp.report.project.consumedValue);
    expect(f.ac).toBe(2_800);
    expect(f.dated.reduce((s, d) => s + d.value, 0)).toBeCloseTo(2_800, 6);
    const june = f.dated.filter((d) => d.spread);
    expect(june).toHaveLength(22);
    expect(june.every((d) => d.bookedFrom === "2026-06-01")).toBe(true);
    expect(f.dated.find((d) => d.date === "2026-06-10" && !d.spread)?.value).toBe(800);
  });

  it("values a fixed-price bucket uncapped", () => {
    const b = withActual(1, { "2026-06-10": 150 }, { type: "fixed", fixedPriceAmount: 100_000 } as Partial<BudgetBucket>);
    const inp = input([b]);
    const f = forecastFacts(inp);
    expect(inp.report.project.consumedValue).toBe(100_000);
    expect(f.ac).toBe(150_000);
    expect(f.dated[0].value).toBe(150_000);
    expect(f.hasFixedPrice).toBe(true);
  });

  it("sums earned value over budgeted buckets", () => {
    const f = forecastFacts(input([withActual(1, {}, { percentComplete: 50 } as Partial<BudgetBucket>)]));
    expect(f.ev).toBe(5_000);
    expect(f.bucketsMissingPercent).toEqual([]);
  });

  it("names every budgeted bucket without a percent complete, in bucket order", () => {
    const f = forecastFacts(input([
      withActual(1, {}, { percentComplete: 50 } as Partial<BudgetBucket>),
      withActual(2, {}, { name: "Design" } as Partial<BudgetBucket>),
      withActual(3, {}, { name: "Rollout" } as Partial<BudgetBucket>),
    ]));
    expect(f.ev).toBeNull();
    expect(f.bucketsMissingPercent).toEqual([{ id: 2, name: "Design" }, { id: 3, name: "Rollout" }]);
  });

  it("derives PV from the burn-down series", () => {
    const inp = input([withActual(1, {})]);
    const s = inp.burndown;
    expect(forecastFacts(inp).pv).toBe(s.todayIndex >= 0 ? s.totalBudgetValue - s.plannedRemainingValue[s.todayIndex] : 0);
    expect(forecastFacts(input([withActual(1, {})], [], "2025-06-01")).pv).toBe(0);
  });

  it("excludes non-positive hours from dated bookings entirely (controller ruling 4)", () => {
    const b = withActual(1, { "2026-06-10": 0, "2026-06-11": -5, "2026-06": 0 });
    const f = forecastFacts(input([b]));
    expect(f.dated).toEqual([]);
  });

  it("excludes a day-keyed booking whose owning period is not active for the bucket", () => {
    const b = withActual(1, { "2026-03-15": 8 }, { startDate: "2026-06-01", endDate: "2026-12-31" } as Partial<BudgetBucket>);
    const f = forecastFacts(input([b]));
    expect(f.dated).toEqual([]);
  });

  it("excludes a period key whose granularity has no calendar bounds (week 00)", () => {
    const weekPlan: ResourcePlan = { ...plan, granularity: "week" };
    const b = bucket(1, { allocations: [{ roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-W00": 40 } }] });
    const report = computeBudgetReport([b], weekPlan, roles, [], 8, none, [], [], null);
    const burndown = computeBurndownSeries([b], weekPlan, roles, [], 8, none, [], "2026-09-14", null);
    const f = forecastFacts({ report, buckets: [b], roles, fxRates: null, tasks: [], plan: weekPlan, burndown, holidaySet: none, today: "2026-09-14" });
    expect(f.dated).toEqual([]);
  });

  it("places a period's hours on its first calendar day when it has no working days (spec §5.4)", () => {
    const weekPlan: ResourcePlan = { ...plan, granularity: "week" };
    const key = "2026-W10";
    const bounds = periodBounds(key)!;
    // Turn every weekday of that ISO week into a holiday, so the period itself
    // has zero working days left to spread over.
    const holidaySet = new Set(workingDaysInRange(bounds.start, bounds.end, none));
    const b = bucket(1, {
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { [key]: 40 } }],
    });
    const report = computeBudgetReport([b], weekPlan, roles, [], 8, holidaySet, [], [], null);
    const burndown = computeBurndownSeries([b], weekPlan, roles, [], 8, holidaySet, [], "2026-09-14", null);
    const f = forecastFacts({ report, buckets: [b], roles, fxRates: null, tasks: [], plan: weekPlan, burndown, holidaySet, today: "2026-09-14" });
    expect(f.dated).toEqual([{ date: bounds.start, bookedFrom: bounds.start, value: 4_000, spread: true }]);
  });
});

describe("computeProjectForecast", () => {
  it("is null without buckets", () => {
    expect(computeProjectForecast({ buckets: [], plan, roles, resources: [], workdayHours: 8, holidaySet: none, absences: [], tasks: [], fxRates: null, today: "2026-09-14" })).toBeNull();
  });

  it("matches computeBudgetForecast on the same inputs", () => {
    const b = [withActual(1, { "2026-06-10": 8 })];
    const direct = computeBudgetForecast(input(b));
    expect(computeProjectForecast({ buckets: b, plan, roles, resources: [], workdayHours: 8, holidaySet: none, absences: [], tasks: [], fxRates: null, today: "2026-09-14" })).toEqual(direct);
  });

  it("does not trim the burn-down window when the buckets do not form one chain", () => {
    const b = [withActual(1, { "2026-06-10": 8 }), bucket(2)];
    const direct = computeBudgetForecast(input(b));
    expect(computeProjectForecast({ buckets: b, plan, roles, resources: [], workdayHours: 8, holidaySet: none, absences: [], tasks: [], fxRates: null, today: "2026-09-14" })).toEqual(direct);
  });
});
