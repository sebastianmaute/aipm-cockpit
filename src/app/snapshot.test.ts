import { describe, expect, it } from "vitest";
import { bucketKey, buildSnapshot, detectGaps, expectedBuckets, forecastEndDate } from "./snapshot";
import type { SnapshotRecord } from "./snapshot";
import type { DashboardModel } from "./dashboard";

function snap(capturedAt: string, bucket: string): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket, cadence: "weekly", trigger: "auto",
    isBaseline: false, remainingHours: null, remainingCost: null, pctComplete: 0,
    forecastEndDate: "", planEndDate: "", spi: null, cpi: null,
    overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [],
  };
}

describe("bucketKey", () => {
  it("formats a daily bucket as YYYY-MM-DD", () => {
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "daily")).toBe("2026-06-03");
  });
  it("formats a monthly bucket as YYYY-MM", () => {
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "monthly")).toBe("2026-06");
  });
  it("formats a weekly bucket as ISO year-week", () => {
    // 2026-06-03 is a Wednesday in ISO week 23.
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "weekly")).toBe("2026-W23");
  });
  it("uses the ISO week-year at a year boundary (2027-01-01 is in week 53 of 2026)", () => {
    expect(bucketKey(new Date("2027-01-01T10:00:00Z"), "weekly")).toBe("2026-W53");
  });
});

describe("expectedBuckets", () => {
  it("enumerates inclusive weekly buckets across a year boundary", () => {
    const out = expectedBuckets(new Date("2026-12-21T00:00:00Z"), new Date("2027-01-04T00:00:00Z"), "weekly");
    expect(out).toEqual(["2026-W52", "2026-W53", "2027-W01"]);
  });
  it("enumerates inclusive daily buckets", () => {
    expect(expectedBuckets(new Date("2026-06-01T00:00:00Z"), new Date("2026-06-03T00:00:00Z"), "daily"))
      .toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });
  it("enumerates inclusive monthly buckets", () => {
    expect(expectedBuckets(new Date("2026-05-15T00:00:00Z"), new Date("2026-07-02T00:00:00Z"), "monthly"))
      .toEqual(["2026-05", "2026-06", "2026-07"]);
  });
});

describe("detectGaps", () => {
  it("returns no gaps when every expected bucket has a snapshot", () => {
    const snaps = [snap("2026-06-01T00:00:00Z", "2026-W23"), snap("2026-06-08T00:00:00Z", "2026-W24")];
    expect(detectGaps(snaps, "weekly", new Date("2026-06-08T00:00:00Z"))).toEqual([]);
  });
  it("flags an interior missing bucket", () => {
    const snaps = [snap("2026-06-01T00:00:00Z", "2026-W23"), snap("2026-06-15T00:00:00Z", "2026-W25")];
    expect(detectGaps(snaps, "weekly", new Date("2026-06-15T00:00:00Z"))).toEqual(["2026-W24"]);
  });
  it("returns [] for an empty history", () => {
    expect(detectGaps([], "weekly", new Date("2026-06-15T00:00:00Z"))).toEqual([]);
  });
});

const baseTask = {
  taskName: "t", assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "",
  priority: "Medium" as const, blockers: "", notes: "",
};

describe("forecastEndDate", () => {
  it("is the latest incomplete task dueDate when it slips past the plan end", () => {
    const tasks = [
      { ...baseTask, id: 1, dueDate: "2026-07-01" },
      { ...baseTask, id: 2, dueDate: "2026-09-15" },
      { ...baseTask, id: 3, dueDate: "2026-12-31", completedDate: "2026-06-01" }, // completed -> ignored
    ];
    expect(forecastEndDate(tasks, [], new Map(), "2026-08-01")).toBe("2026-09-15");
  });
  it("falls back to the plan end date when nothing slips", () => {
    const tasks = [{ ...baseTask, id: 1, dueDate: "2026-05-01" }];
    expect(forecastEndDate(tasks, [], new Map(), "2026-08-01")).toBe("2026-08-01");
  });
});

describe("buildSnapshot", () => {
  const model = {
    overall: { computed: "G", effective: "A", overridden: true },
    schedule: { computed: "R", effective: "R", overridden: false },
    budget: { computed: "A", effective: "A", overridden: false },
    scope: { effective: null },
    progress: { total: 4, completed: 1, percent: 25, counts: { R: 1, A: 1, G: 2 } },
    burn: null,
    burndown: {
      periods: ["2026-06", "2026-07"],
      plannedRemainingHours: [50, 0], plannedRemainingValue: [5000, 0],
      actualRemainingHours: [60, null], actualRemainingValue: [6000, null],
      todayIndex: 0, totalBudgetHours: 100, totalBudgetValue: 10000,
    },
    evm: { pv: 0, ev: 0, ac: 0, spi: 0.8, cpi: 1.1, sv: 0, cv: 0, money: null, coverage: { withEstimate: 0, total: 0 } },
    topRaid: [], overdue: [], dueSoon: [],
    overdueMilestones: [], atRiskMilestones: [], dueSoonMilestones: [],
    recentActivity: [], narrative: { text: "" },
  } as unknown as DashboardModel;

  it("captures effective RAGs, %complete, EVM indices, currency, and the last actual remaining", () => {
    const rec = buildSnapshot({
      model, tasks: [], milestones: [], planEndDate: "2026-07-31", currency: "EUR",
      capturedAt: "2026-06-03T09:00:00.000Z", cadence: "weekly", trigger: "manual",
    });
    expect(rec.id).toBe("2026-06-03T09:00:00.000Z");
    expect(rec.bucket).toBe("2026-W23");
    expect(rec.trigger).toBe("manual");
    expect(rec.pctComplete).toBe(25);
    expect(rec.overallRag).toBe("A"); // effective, not computed
    expect(rec.scheduleRag).toBe("R");
    expect(rec.scopeRag).toBe("");    // null -> ""
    expect(rec.spi).toBe(0.8);
    expect(rec.cpi).toBe(1.1);
    expect(rec.currency).toBe("EUR");
    expect(rec.remainingHours).toBe(60); // last non-null actualRemainingHours
    expect(rec.remainingCost).toBe(6000);
    expect(rec.series).toHaveLength(2);
    expect(rec.series[0]).toEqual({ period: "2026-06", plannedHours: 50, actualHours: 60, plannedCost: 5000, actualCost: 6000 });
    expect(rec.series[1].actualHours).toBeNull();
  });

  it("yields null remaining + empty series when there is no burndown", () => {
    const rec = buildSnapshot({
      model: { ...model, burndown: null } as DashboardModel, tasks: [], milestones: [],
      planEndDate: "2026-07-31", currency: "USD",
      capturedAt: "2026-06-03T09:00:00.000Z", cadence: "weekly", trigger: "auto",
    });
    expect(rec.remainingHours).toBeNull();
    expect(rec.remainingCost).toBeNull();
    expect(rec.series).toEqual([]);
  });
});
