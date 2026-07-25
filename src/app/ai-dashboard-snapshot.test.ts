import { describe, expect, it } from "vitest";
import { buildDashboardSnapshot } from "./ai-dashboard-snapshot";
import { type DashboardModel } from "./dashboard";
import { type ProjectReport } from "./budget-report";

function model(over: Partial<DashboardModel> = {}): DashboardModel {
  return {
    overall: { computed: "G", effective: "A", overridden: true },
    schedule: { computed: "G", effective: "G", overridden: false },
    budget: { computed: "R", effective: "R", overridden: false },
    scope: { computed: null, effective: null, overridden: false },
    changes: { pending: 2, approved: 1, implemented: 4, total: 7 },
    topChanges: [],
    progress: { total: 10, completed: 4, percent: 40, counts: { R: 1, A: 2, G: 7 } },
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
  } as ProjectReport;
}

describe("buildDashboardSnapshot", () => {
  it("emits the effective RAG values plus their override flags", () => {
    const snap = buildDashboardSnapshot(model(), report(), "2026-07-25");

    expect(snap.today).toBe("2026-07-25");
    expect(snap.rag.overall).toBe("A");
    expect(snap.rag.overridden.overall).toBe(true);
    expect(snap.rag.schedule).toBe("G");
    expect(snap.rag.overridden.schedule).toBe(false);
    expect(snap.rag.scope).toBeNull();
  });

  it("passes EVM nulls through unchanged", () => {
    const snap = buildDashboardSnapshot(model(), report(), "2026-07-25");

    expect(snap.evm.spi).toBe(0.8);
    expect(snap.evm.cpi).toBeNull();
    expect(snap.evm.coverage).toEqual({ withEstimate: 6, total: 10 });
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
