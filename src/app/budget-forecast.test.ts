import { describe, expect, it, vi } from "vitest";
import {
  computeBudgetForecast, computeBudgetForecastsByUnit, computeForecastFromFacts, computeProjectForecast,
  forecastFacts, forecastFactsByUnit, forecastGap,
  isEfficiencyAvailable, isPaceAvailable, paceVacHealth,
  type BudgetForecastInput, type DatedValue, type EfficiencyForecast, type ForecastFacts, type PaceForecast,
} from "./budget-forecast";
import { computeBudgetReport } from "./budget-report";
import { computeBurndownSeries } from "./budget-burndown";
import { resolveBucketChain } from "./budget-bucket-chain";
import { nthWorkingDayAfter, periodBounds, workingDaysBefore, workingDaysInRange } from "./working-days";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

// Wraps the REAL implementation (never replaces its behaviour) so a single
// test — "passes the bucket chain's own (narrower) span…" below — can assert
// on the SPAN ARGUMENT computeProjectForecast actually calls it with. That
// argument is the only reliable witness for review finding 3: PV is
// mathematically invariant to this narrowing for any valid chain (its bounds
// always subsume every contributing bucket's own dates), so no
// BudgetForecast-level return-value assertion can distinguish "spanned" from
// "always undefined" — verified empirically, not assumed (see task-3-report.md
// Fix round 1).
vi.mock("./budget-burndown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./budget-burndown")>();
  return { ...actual, computeBurndownSeries: vi.fn(actual.computeBurndownSeries) };
});

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

  it("no-burn uses a spread month period's start for the last booking, not its spread working day (M2)", () => {
    // The entry's `date` (2026-07-31, a working day the period's hours were
    // spread onto) sits before the pace window (2026-08-17–2026-09-11) — same
    // as `bookedFrom` (2026-07-01) — so this is still a no-burn fixture either
    // way; only `lastBookingDate` distinguishes the two.
    const f = computeForecastFromFacts(fixture({
      dated: [{ date: "2026-07-31", bookedFrom: "2026-07-01", value: 100, spread: true }],
    }));
    expect(f.pace).toMatchObject({ unavailable: "no-burn", lastBookingDate: "2026-07-01" });
  });

  it("no-burn: a later day-key booking still wins over an earlier spread period's start (M2)", () => {
    const f = computeForecastFromFacts(fixture({
      dated: [{ date: "2026-07-31", bookedFrom: "2026-07-01", value: 100, spread: true }, day("2026-08-15", 50)],
    }));
    expect(f.pace).toMatchObject({ unavailable: "no-burn", lastBookingDate: "2026-08-15" });
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

  it("uses the bucket's OWN budget hours for a fixed-price ratio, never the spillover-inflated report total (review finding 1)", () => {
    // Donor: T&M, closed, 50 own budgeted hours, nothing booked — spills its
    // whole 50h of remaining budget into the fixed-price successor, and
    // contributes 0 AC of its own (isolating the successor's contribution below).
    const donor = bucket(1, {
      status: "closed", successorId: 2, type: "tm",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 50 }, actualHours: {} }],
    } as Partial<BudgetBucket>);
    // Successor: fixed-price, 100 own budgeted hours, 50 actual — not overrun
    // against its OWN hours (50/100), but its REPORTED budgetHours (100+50
    // spilled-in = 150) would understate the ratio if used as the denominator.
    const succ = bucket(2, {
      type: "fixed", fixedPriceAmount: 100_000,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06": 50 } }],
    } as Partial<BudgetBucket>);
    const inp = input([donor, succ]);
    const succReport = inp.report.buckets.find((r) => r.bucketId === 2)!;
    // Confirm the spillover premise this test turns on.
    expect(succReport.spilloverInHours).toBe(50);
    expect(succReport.budgetHours).toBe(150);
    expect(succReport.consumedValue).toBeCloseTo(50_000, 6); // report's own ratio: 100,000 × (50÷100 own hours)

    const f = forecastFacts(inp);
    // Donor contributes 0 AC (no actual hours booked), so f.ac isolates the
    // successor's uncapped-ratio contribution — it must equal the report's
    // value for the (here, not overrun) uncapped share.
    expect(f.ac).toBeCloseTo(50_000, 6);
    expect(f.ac).toBeCloseTo(succReport.consumedValue, 6);
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

  it("derives PV from the burn-down series (review finding 2: literal values, not a re-derivation)", () => {
    // A re-derivation using the SAME burndown output (`s.plannedRemainingValue[s.todayIndex]`)
    // can't catch a mutated index — the mutant computes its wrong answer from the
    // same array the test then reads back. Assert literal numbers instead, at a
    // spot where todayIndex and todayIndex-1 give DIFFERENT results, so an
    // off-by-one can't hide behind a coincidental match.
    //
    // 100 h budgeted in June at 100/hr = 10,000 EUR is the bucket's only value.
    // With "today" inside June, plannedRemainingValue[todayIndex(June)] = 0 (June's
    // own budget is already included in the cumulative) while
    // plannedRemainingValue[todayIndex-1(May)] = 10,000 (nothing spent through May) —
    // so PV(correct) = 10,000 and PV(todayIndex-1 mutant) = 0.
    const inJune = input([withActual(1, {})], [], "2026-06-15");
    expect(inJune.burndown.todayIndex).toBe(5); // Jan=0 … Jun=5
    expect(forecastFacts(inJune).pv).toBe(10_000);
    // Before any budgeted period has started: literal 0, from BOTH the
    // todayIndex===-1 fallback and (independently) a positive-but-pre-activity index.
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

  it("excludes a period key that matches the week-key syntax but is never a real active period (ISO week 00; review finding 4)", () => {
    // "2026-W00" passes `granularityOfPeriodKey` (its regex allows week 00) but
    // ISO weeks start at 1, so `generatePeriods`/`bucketActivePeriods` never
    // produce it — it is dropped by the `!active.has(key)` check, NOT by
    // `periodBounds` returning null (that null branch needs a key `active` could
    // never contain in the first place, since `active` itself is built from the
    // same real-week keys `periodBounds` resolves — see the module's read-first
    // note). This exercises the week-granularity arm of that active-periods
    // exclusion (the month-granularity arm is covered by "2025-12" in the
    // "values exactly the keys" test above).
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
    // Two independent buckets, no successorId: multiple roots, no chain intent
    // → resolveBucketChain returns "unchained" → span stays undefined, same as
    // `input()`'s own (always-unspanned) burn-down call. Dated Feb–Mar and
    // Jun–Jul — deliberately NOT spanning the full Jan–Dec plan and NOT even
    // together covering it (review finding 3: the original version of this
    // test used full-plan-dated buckets, so a span accidentally derived from
    // bucket bounds would have coincided with "no span" and gone undetected;
    // these bounds would visibly narrow the burn-down if that ever happened).
    const b = [
      withActual(1, { "2026-02-10": 8 }, { startDate: "2026-02-01", endDate: "2026-03-31", allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-02": 100 }, actualHours: { "2026-02-10": 8 } }] } as Partial<BudgetBucket>),
      bucket(2, { startDate: "2026-06-01", endDate: "2026-07-31" } as Partial<BudgetBucket>),
    ];
    const direct = computeBudgetForecast(input(b));
    const forecast = computeProjectForecast({ buckets: b, plan, roles, resources: [], workdayHours: 8, holidaySet: none, absences: [], tasks: [], fxRates: null, today: "2026-09-14" });
    expect(forecast).toEqual(direct);
    // And explicitly: the full 12-period plan axis, not an 6-period Feb–Jul one.
    expect(computeBurndownSeries(b, plan, roles, [], 8, none, [], "2026-09-14", null).periods).toHaveLength(12);
  });

  it("passes the bucket chain's own (narrower) span to the burn-down, not the full plan window (review finding 3)", () => {
    // A single bucket dated narrower than the plan already resolves to a
    // "chain" (resolveBucketChain: one root, no break) whose start/end are the
    // bucket's own dates — narrower than the plan's Jan–Dec span.
    const b = bucket(1, {
      startDate: "2026-03-01", endDate: "2026-06-30",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-04": 40 }, actualHours: {} }],
    } as Partial<BudgetBucket>);
    const today = "2026-05-15";
    const chain = resolveBucketChain([b], { start: plan.startDate, end: plan.endDate });
    if (chain.kind !== "chain") throw new Error("expected a chain");
    expect(chain.start).toBe("2026-03-01");
    expect(chain.end).toBe("2026-06-30");

    const trimmed = computeBurndownSeries([b], plan, roles, [], 8, none, [], today, null, { start: chain.start, end: chain.end });
    const untrimmed = computeBurndownSeries([b], plan, roles, [], 8, none, [], today, null);
    // The genuinely observable fact the span controls: a shorter periods axis
    // and a DIFFERENT todayIndex position within it (May is index 4 of 12 in
    // the full-plan axis, index 2 of 4 in the March–June axis). PV itself is
    // NOT a reliable witness here — for a bucket whose own active periods
    // already sit entirely inside [chain.start, chain.end] (true by
    // construction: chain bounds are the min/max of every contributing
    // bucket's own dates), the cumulative-to-date sum at todayIndex is
    // identical whichever axis it's read from, so PV provably cannot diverge.
    expect(trimmed.periods).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
    expect(trimmed.periods.length).toBeLessThan(untrimmed.periods.length);
    expect(trimmed.todayIndex).toBe(2);
    expect(untrimmed.todayIndex).toBe(4);

    // The reliable witness: assert the ARGUMENT computeProjectForecast calls
    // computeBurndownSeries with, not its return value (a return-value equality
    // check here would pass even under the "always pass undefined" mutant —
    // confirmed by actually reverting the ternary and re-running this file: the
    // pv-based assertion stayed green, because PV is invariant here; this
    // spy-based one goes red as expected — see task-3-report.md Fix round 1).
    vi.mocked(computeBurndownSeries).mockClear();
    computeProjectForecast({ buckets: [b], plan, roles, resources: [], workdayHours: 8, holidaySet: none, absences: [], tasks: [], fxRates: null, today });
    expect(computeBurndownSeries).toHaveBeenCalledWith(
      [b], plan, roles, [], 8, none, [], today, null, { start: "2026-03-01", end: "2026-06-30" },
    );

    // And a consistency sanity check: the resulting forecast really is the one
    // built from the TRIMMED burndown (it happens to also equal the untrimmed
    // one here, per the PV-invariance above — both are asserted so neither
    // silently drifts).
    const forecast = computeProjectForecast({ buckets: [b], plan, roles, resources: [], workdayHours: 8, holidaySet: none, absences: [], tasks: [], fxRates: null, today });
    const direct = computeBudgetForecast({
      report: computeBudgetReport([b], plan, roles, [], 8, none, [], [], null),
      buckets: [b], roles, fxRates: null, tasks: [], plan, burndown: trimmed, holidaySet: none, today,
    });
    expect(forecast).toEqual(direct);
  });
});

describe("hours facts (MR 3 addendum §3.1)", () => {
  it("pins the hours scenario of spec §7 through the unchanged core", () => {
    const f = computeForecastFromFacts(fixture({
      bac: 2_000, ac: 1_450, ev: 1_240, pv: 176_000 / 120,
      dated: [day("2026-01-05", 1_230), ...workingDaysBefore("2026-09-14", 20, none).map((d) => day(d, 11))],
    }));
    if (!isPaceAvailable(f.pace) || !isEfficiencyAvailable(f.efficiency)) throw new Error("unavailable");
    expect(f.pace.burnRatePerDay).toBeCloseTo(11, 9);
    expect(f.pace.etc).toBeCloseTo(759, 6);
    expect(f.pace.eac).toBeCloseTo(2_209, 6);
    expect(f.pace.vac).toBeCloseTo(-209, 6);
    expect(f.pace.runOutDate).toBe("2026-11-23");
    expect(f.efficiency.cpi).toBeCloseTo(0.8552, 4);
    expect(f.efficiency.etc).toBeCloseTo(888.7, 1);
    expect(f.efficiency.eac).toBeCloseTo(2_338.7, 1);
    expect(f.gap?.eacDifference).toBeCloseTo(129.7, 1);
    expect(f.gap?.extraWorkingDays).toBe(12);
  });

  it("builds hours facts from the same walk: BAC/AC hours, day-key bookings valued as hours", () => {
    const { eur, hours } = forecastFactsByUnit(input([withActual(1, { "2026-06-10": 8 })]));
    expect(hours.bac).toBe(100);
    expect(hours.ac).toBe(8);
    expect(hours.dated).toEqual([{ date: "2026-06-10", bookedFrom: "2026-06-10", value: 8, spread: false }]);
    expect(eur.dated).toEqual([{ date: "2026-06-10", bookedFrom: "2026-06-10", value: 800, spread: false }]);
  });

  it("spreads a period key's hours evenly over its working days", () => {
    const { hours } = forecastFactsByUnit(input([withActual(1, { "2026-06": 22 })]));
    expect(hours.dated).toHaveLength(22);
    expect(hours.dated.every((d) => d.value === 1 && d.spread && d.bookedFrom === "2026-06-01")).toBe(true);
  });

  it("reads PV hours from the burn-down hours series", () => {
    const { eur, hours } = forecastFactsByUnit(input([withActual(1, {})]));
    expect(hours.pv).toBe(100);
    expect(eur.pv).toBe(10_000);
  });

  it("uses the reported, spillover-inclusive bucket hours for EV h (Ruling 1)", () => {
    const donor = bucket(1, {
      status: "closed", successorId: 2, percentComplete: 100,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 50 }, actualHours: {} }],
    } as Partial<BudgetBucket>);
    const succ = bucket(2, {
      percentComplete: 60,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
    } as Partial<BudgetBucket>);
    const { eur, hours } = forecastFactsByUnit(input([donor, succ]));
    // ★★ BAC is 150, NOT the 200 this pinned before §550: the donor's 50 h
    // remainder spills into the successor, and `report.project.budgetHours` now
    // sums each bucket's OWN budget so that remainder is counted once (it used
    // to be counted in both buckets). The project really does hold 150 h.
    //
    // ★★★ EV IS STILL ON THE REPORTED, SPILLOVER-INCLUSIVE BASIS — that is what
    // Ruling 1 says and what the 140 below pins (own-basis EV h would be
    // 50×100% + 100×60% = 110). So BAC and EV now sit on DIFFERENT bases and
    // ΣEV can in principle exceed BAC. The inconsistency is not new, it MOVED:
    // before §550, EV agreed with BAC and PV was the outlier (the burn-down
    // builds its totals straight from allocations, so `pv` never carried
    // spillover); now BAC agrees with PV and EV is the outlier. Re-basing EV is
    // a forecast-semantics ruling, deliberately NOT taken here.
    expect(hours.bac).toBe(150);
    expect(hours.ev).toBeCloseTo(140, 9);
    expect(eur.ev! / eur.bac).toBeCloseTo(hours.ev! / hours.bac, 9);
  });

  it("shares the missing-percent rule between units", () => {
    const { eur, hours } = forecastFactsByUnit(input([withActual(1, {}, { name: "Design" } as Partial<BudgetBucket>)]));
    expect(eur.ev).toBeNull();
    expect(hours.ev).toBeNull();
    expect(hours.bucketsMissingPercent).toEqual([{ id: 1, name: "Design" }]);
  });

  it("forecastFacts still returns the € facts, and the pair wrapper runs both", () => {
    const inp = input([withActual(1, { "2026-06-10": 8 })]);
    expect(forecastFacts(inp)).toEqual(forecastFactsByUnit(inp).eur);
    const both = computeBudgetForecastsByUnit(inp);
    expect(both.eur).toEqual(computeBudgetForecast(inp));
    expect(both.hours.facts.bac).toBe(100);
  });
});
