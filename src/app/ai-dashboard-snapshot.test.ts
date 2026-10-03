import { describe, expect, it } from "vitest";
import { buildDashboardSnapshot } from "./ai-dashboard-snapshot";
import { type DashboardModel } from "./dashboard";
import { type ProjectReport } from "./budget-report";
import type { BudgetForecast } from "./budget-forecast";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { BudgetHistoryEntry } from "./budget-history";
import type { RateMix, RateMixRow } from "./budget-rate-mix";

function model(over: Partial<DashboardModel> = {}): DashboardModel {
  return {
    overall: { computed: "G", effective: "A", overridden: true },
    schedule: { computed: "G", effective: "G", overridden: false },
    budget: { computed: "R", effective: "R", overridden: false },
    scope: { computed: null, effective: null, overridden: false },
    changes: { pending: 2, approved: 1, implemented: 4, total: 7 },
    topChanges: [],
    progress: { total: 10, inScope: 10, completed: 4, percent: 40, counts: { R: 1, A: 2, G: 7 } },
    burn: null,
    burndown: null,
    bucketChain: null,
    evm: {
      pv: 100, ev: 80, ac: 0,
      spi: 0.8, cpi: null,
      sv: -20, cv: 80,
      money: null,
      coverage: { withEstimate: 6, total: 10 },
    },
    topRaid: [],
    openRaidCount: 3,
    overdue: [],
    dueSoon: [],
    overdueMilestones: [],
    atRiskMilestones: [],
    dueSoonMilestones: [],
    recentActivity: [],
    narrative: { text: "" },
    ...over,
  } as DashboardModel;
}

function report(over: Partial<ProjectReport> = {}): ProjectReport {
  return {
    budgetHours: 200, plannedHours: 180, actualHours: 90,
    budgetValue: 20000, consumedValue: 9000,
    revenue: 20000, cost: 8000,
    winLossHours: 10, winLossValue: 1000,
    contributionMargin: { amount: 12000, percent: 60 },
    costPerformance: { amount: 1000, percent: 110 },
    consumption: { amount: 9000, percent: 45 },
    earnedValue: 7000, costPerformanceIndex: 0.875,
    budgetMirrorsPlan: false,
    costUnknownReason: null,
    unpricedDisciplineIds: [],
    ...over,
  } satisfies ProjectReport;
}

describe("buildDashboardSnapshot", () => {
  it("emits the effective RAG values plus their override flags", () => {
    const snap = buildDashboardSnapshot(model(), report(), "2026-07-25");

    expect(snap.today).toBe("2026-07-25");
    expect(snap.rag.overall).toBe("A");
    expect(snap.rag.overridden.overall).toBe(true);
    expect(snap.rag.schedule).toBe("G");
    expect(snap.rag.overridden.schedule).toBe(false);
    expect(snap.rag.budget).toBe("R");
    expect(snap.rag.overridden.budget).toBe(false);
    expect(snap.rag.scope).toBeNull();
  });

  it("passes EVM nulls through unchanged", () => {
    const snap = buildDashboardSnapshot(model(), report(), "2026-07-25");

    expect(snap.evm.pv).toBe(100);
    expect(snap.evm.ev).toBe(80);
    expect(snap.evm.ac).toBe(0);
    expect(snap.evm.spi).toBe(0.8);
    expect(snap.evm.cpi).toBeNull();
    expect(snap.evm.coverage).toEqual({ withEstimate: 6, total: 10 });
  });

  it("emits the progress shape exactly, without leaking counts into it", () => {
    const snap = buildDashboardSnapshot(model(), report(), "2026-07-25");

    expect(snap.progress).toEqual({ total: 10, inScope: 10, completed: 4, percent: 40, noActiveScope: false });
  });


  it("carries inScope so the model can reconcile percent with the pair", () => {
    // 5 Done + 5 Cancelled: total:10/completed:5/percent:100 alone is an
    // arithmetic contradiction. inScope is the denominator percent used.
    const m = model();
    (m as { progress: Record<string, unknown> }).progress = { total: 10, inScope: 5, completed: 5, percent: 100, counts: { R: 0, A: 0, G: 10 } };
    const snap = buildDashboardSnapshot(m, report(), "2026-07-25");

    expect(snap.progress).toEqual({ total: 10, inScope: 5, completed: 5, percent: 100, noActiveScope: false });
  });
  it("passes real cost figures through when cost is knowable", () => {
    const snap = buildDashboardSnapshot(model(), report(), "2026-07-25");

    expect(snap.budget?.cost).toBe(8000);
    expect(snap.budget?.revenue).toBe(20000);
    expect(snap.budget?.contributionMarginPct).toBe(60);
    expect(snap.budget?.costUnknownReason).toBeNull();
    expect(snap.budget?.budgetHours).toBe(200);
    expect(snap.budget?.actualHours).toBe(90);
    expect(snap.budget?.budgetValue).toBe(20000);
    expect(snap.budget?.consumedValue).toBe(9000);
    expect(snap.budget?.earnedValue).toBe(7000);
    expect(snap.budget?.costPerformanceIndex).toBe(0.875);
  });

  it("passes a null earnedValue through as null, not 0", () => {
    const snap = buildDashboardSnapshot(
      model(),
      report({ earnedValue: null, costPerformanceIndex: null }),
      "2026-07-25",
    );

    expect(snap.budget?.earnedValue).toBeNull();
    expect(snap.budget?.costPerformanceIndex).toBeNull();
  });

  it("nulls cost figures and keeps the reason when cost is not knowable", () => {
    const snap = buildDashboardSnapshot(
      model(),
      report({ costUnknownReason: "no-rates", cost: 0, revenue: 0 }),
      "2026-07-25",
    );

    expect(snap.budget?.cost).toBeNull();
    expect(snap.budget?.revenue).toBeNull();
    expect(snap.budget?.contributionMarginPct).toBeNull();
    expect(snap.budget?.costUnknownReason).toBe("no-rates");
    expect(snap.budget?.budgetHours).toBe(200);
  });

  it("emits budget: null when there is no rollup", () => {
    const snap = buildDashboardSnapshot(model(), null, "2026-07-25");

    expect(snap.budget).toBeNull();
  });

  it("emits counts, never the underlying entity arrays", () => {
    const snap = buildDashboardSnapshot(
      model({
        overdue: [{ id: 1 }, { id: 2 }] as DashboardModel["overdue"],
        openRaidCount: 3,
      }),
      report(),
      "2026-07-25",
    );

    expect(snap.counts.overdueTasks).toBe(2);
    expect(snap.counts.openRaid).toBe(3);
    expect(snap.counts.changes).toEqual({ pending: 2, approved: 1, implemented: 4, total: 7 });
    expect(JSON.stringify(snap)).not.toContain("topChanges");
  });
});

describe("no-active-scope disclosure (open-followups §64)", () => {
  it("tells the model when a project has tasks but none in scope", () => {
    const m = model();
    (m as { progress: Record<string, unknown> }).progress = {
      total: 2, inScope: 0, completed: 0, percent: 0, counts: { R: 0, A: 0, G: 0 }, outOfScope: 2,
    };
    const snap = buildDashboardSnapshot(m, report(), "2026-07-25");
    // Without this the model gets a bare 0 and can restate it as "0% complete",
    // which is the misreading the UI already stopped showing.
    expect(snap.progress.noActiveScope).toBe(true);
  });

  it("stays false for a brand-new empty project", () => {
    const m = model();
    (m as { progress: Record<string, unknown> }).progress = {
      total: 0, inScope: 0, completed: 0, percent: 0, counts: { R: 0, A: 0, G: 0 }, outOfScope: 0,
    };
    const snap = buildDashboardSnapshot(m, report(), "2026-07-25");
    // `total === 0` is deliberately excluded — an empty project must keep
    // reading 0%, not "no active scope".
    expect(snap.progress.noActiveScope).toBe(false);
  });
});

// §545 — the budget forecast the Budget report and the dashboard show was
// absent from the payload, so the model could not answer "where will we land".
describe("budget forecast (open-followups §545)", () => {
  const eurForecast: BudgetForecast = {
    facts: { bac: 20000, ac: 9000, remaining: 11000, ev: 7000, percentComplete: 35 },
    pace: {
      burnRatePerDay: 300, windowDays: 20, windowStart: "2026-06-01", windowEnd: "2026-06-30",
      spreadPeriodHoursUsed: false, workingDaysLeft: 40,
      etc: 12000, eac: 21000, vac: -1000, runOutDate: "2026-08-20", daysBeforePlannedEnd: 5,
    },
    efficiency: { unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 2, name: "Build" }] },
    gap: null,
    hasFixedPrice: false,
  };
  const hoursForecast: BudgetForecast = { ...eurForecast, facts: { ...eurForecast.facts, bac: 200, ac: 90, remaining: 110 } };
  const driver: RateMixRow = {
    key: "r3", kind: "role", id: 3, name: "Consulting Senior", plannedRate: 100,
    budgetHours: 200, actualHours: 90, plannedShare: 0.5, bookedShare: 0.7, difference: 0.2, usedOfBudget: 0.45,
  };
  const mix: RateMix = {
    triggered: true, direction: "eur-worse", severity: "warning",
    drift: 0.05, bookedRate: 105, plannedRate: 100, budgetHours: 200, actualHours: 90,
    budgetValue: 20000, bookedValue: 9450, rows: [driver, { ...driver, key: "r4", id: 4, name: "Other" }],
    driver, excludedActualHours: 0,
  };
  function entry(i: number): BudgetHistoryEntry {
    return {
      id: `h${i}`, at: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`, date: "2026-05-01",
      kind: "created", bucketId: i, bucketName: `B${i}`,
      projectBacHours: 100 + i, projectBacValue: 10000 + i, deltaHours: 1, deltaValue: 100,
    };
  }
  function bundle(changeCount: number): ForecastBundle {
    return {
      eur: eurForecast, hours: hoursForecast, mix,
      evHistory: { available: true, points: [] },
      history: changeCount < 0 ? null : {
        baselineDate: "2026-04-01",
        baseline: { hours: 100, value: 10000 },
        attributed: { hours: 120, value: 12000 },
        changes: Array.from({ length: changeCount }, (_, i) => entry(i)),
      },
    };
  }

  it("carries the € and hours forecasts exactly as the engine computed them", () => {
    const snap = buildDashboardSnapshot(model({ forecastBundle: bundle(2) }), report(), "2026-07-25");
    expect(snap.forecast?.eur).toEqual(eurForecast);
    expect(snap.forecast?.hours).toEqual(hoursForecast);
  });

  it("summarises the rate mix by its driver instead of every row", () => {
    const snap = buildDashboardSnapshot(model({ forecastBundle: bundle(2) }), report(), "2026-07-25");
    expect(snap.forecast?.rateMix).toEqual({
      triggered: true, direction: "eur-worse", severity: "warning",
      drift: 0.05, bookedRate: 105, plannedRate: 100, excludedActualHours: 0,
      driver: { kind: "role", name: "Consulting Senior", plannedRate: 100, plannedShare: 0.5, bookedShare: 0.7, difference: 0.2 },
    });
    expect(JSON.stringify(snap.forecast)).not.toContain("\"Other\"");
  });

  it("caps the budget change history at the latest 20 and says how many there are", () => {
    const snap = buildDashboardSnapshot(model({ forecastBundle: bundle(25) }), report(), "2026-07-25");
    const history = snap.forecast?.budgetHistory;
    expect(history?.changeCount).toBe(25);
    expect(history?.recentChanges).toHaveLength(20);
    // The LATEST twenty: the first five are the ones dropped.
    expect(history?.recentChanges[0].id).toBe("h5");
    expect(history?.recentChanges[19].id).toBe("h24");
    expect(history?.baseline).toEqual({ hours: 100, value: 10000 });
    expect(history?.attributed).toEqual({ hours: 120, value: 12000 });
  });

  it("emits a short history whole, and null before the first recorded change", () => {
    expect(buildDashboardSnapshot(model({ forecastBundle: bundle(3) }), report(), "2026-07-25")
      .forecast?.budgetHistory?.recentChanges).toHaveLength(3);
    expect(buildDashboardSnapshot(model({ forecastBundle: bundle(-1) }), report(), "2026-07-25")
      .forecast?.budgetHistory).toBeNull();
  });

  it("emits forecast: null when the dashboard has no forecast", () => {
    expect(buildDashboardSnapshot(model({ forecastBundle: null }), report(), "2026-07-25").forecast).toBeNull();
  });
});
