import { describe, expect, it } from "vitest";
import { baselineMilestoneTargets, bucketKey, buildSnapshot, computeVariance, detectGaps, expectedBuckets, forecastEndDate, hasCapturableContent, milestoneForecast, withoutCompletionVariance } from "./snapshot";
import type { Milestone, Task } from "./types";
import type { SnapshotMilestone, SnapshotRecord } from "./snapshot";
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
  status: "To Do" as const,
  priority: "Medium" as const, blockers: "", description: "",
};

describe("forecastEndDate", () => {
  it("is the latest incomplete task dueDate when it slips past the plan end", () => {
    const tasks = [
      { ...baseTask, id: 1, dueDate: "2026-07-01" },
      { ...baseTask, id: 2, dueDate: "2026-09-15" },
      { ...baseTask, id: 3, dueDate: "2026-12-31", status: "Done" as const, completedDate: "2026-06-01" }, // completed -> ignored
    ];
    expect(forecastEndDate(tasks, [], new Map(), "2026-08-01")).toBe("2026-09-15");
  });
  it("falls back to the plan end date when nothing slips", () => {
    const tasks = [{ ...baseTask, id: 1, dueDate: "2026-05-01" }];
    expect(forecastEndDate(tasks, [], new Map(), "2026-08-01")).toBe("2026-08-01");
  });
  it("a cancelled task does not push out the forecast end date", () => {
    const tasks = [{ ...baseTask, id: 1, status: "Cancelled" as const, dueDate: "2027-12-31" }];
    expect(forecastEndDate(tasks, [], new Map(), "2026-08-31")).toBe("2026-08-31");
  });
  it("a cancelled task LINKED TO A MILESTONE does not push out the forecast either", () => {
    // The task loop skips it, but it re-enters through the milestone loop unless
    // milestoneForecast skips it too.
    const t = { ...baseTask, id: 1, status: "Cancelled" as const, dueDate: "2027-12-31" };
    const ms: Milestone[] = [{ id: 1, name: "M", date: "2026-09-01", linkedTaskIds: [1] }];
    expect(forecastEndDate([t], ms, new Map([[1, t]]), "2026-08-31")).toBe("2026-09-01");
  });
});

describe("milestoneForecast", () => {
  const ms = (linkedTaskIds: number[]): Milestone =>
    ({ id: 1, name: "M", date: "2026-09-01", linkedTaskIds });

  it("ignores a cancelled linked task's dueDate", () => {
    const t = { ...baseTask, id: 1, status: "Cancelled" as const, dueDate: "2027-12-31" };
    expect(milestoneForecast(ms([1]), new Map([[1, t]]))).toBe("2026-09-01");
  });

  it("still takes a DELIVERED linked task's completedDate (a real historical end)", () => {
    const t = { ...baseTask, id: 1, status: "Done" as const, dueDate: "2026-10-01", completedDate: "2026-11-15" };
    expect(milestoneForecast(ms([1]), new Map([[1, t]]))).toBe("2026-11-15");
  });

  it("still takes an OPEN linked task's dueDate", () => {
    const t = { ...baseTask, id: 1, dueDate: "2026-12-01" };
    expect(milestoneForecast(ms([1]), new Map([[1, t]]))).toBe("2026-12-01");
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

  it("does not let a cancelled linked task drive a milestone's captured forecast", () => {
    const t = { ...baseTask, id: 1, status: "Cancelled" as const, dueDate: "2027-12-31" };
    const milestones: Milestone[] = [{ id: 1, name: "M", date: "2026-09-01", linkedTaskIds: [1] }];
    const rec = buildSnapshot({
      model, tasks: [t], milestones, planEndDate: "2026-07-31", currency: "EUR",
      capturedAt: "2026-06-03T09:00:00.000Z", cadence: "weekly", trigger: "manual",
    });
    expect(rec.milestones[0].forecast).toBe("2026-09-01");
    expect(rec.forecastEndDate).toBe("2026-09-01");
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

function recWith(over: Partial<SnapshotRecord>): SnapshotRecord {
  return {
    id: "x", capturedAt: "x", bucket: "b", cadence: "weekly", trigger: "manual",
    isBaseline: false, remainingHours: 0, remainingCost: 0, pctComplete: 0,
    forecastEndDate: "2026-07-31", planEndDate: "2026-07-31", spi: null, cpi: null,
    overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [], ...over,
  };
}

describe("withoutCompletionVariance", () => {
  // The row is DROPPED, not zeroed: for a project with no active scope the 0%
  // is an empty denominator, so `worseIfLower` flags a fall that never happened.
  // ★ The health assertion pins AMBER. Both the review that found this surface
  // and the first draft of the comment on `withoutCompletionVariance` said the
  // dot was RED; `worseIfLower` only ever returns "A" or "G". This assertion is
  // what disproved it, and it stays so the claim cannot drift back.
  it("removes only the completion row and keeps the rest in order", () => {
    const rows = computeVariance(recWith({ pctComplete: 40 }), recWith({ pctComplete: 0 }));
    expect(rows.find((r) => r.key === "pctComplete")?.health).toBe("A");
    const kept = withoutCompletionVariance(rows);
    expect(kept.find((r) => r.key === "pctComplete")).toBeUndefined();
    expect(kept.map((r) => r.key)).toEqual(rows.filter((r) => r.key !== "pctComplete").map((r) => r.key));
  });
  it("leaves the input untouched", () => {
    const rows = computeVariance(recWith({ pctComplete: 40 }), recWith({ pctComplete: 0 }));
    const before = rows.length;
    withoutCompletionVariance(rows);
    expect(rows).toHaveLength(before);
  });
});

describe("computeVariance", () => {
  it("flags a later forecast end as Red (schedule slip)", () => {
    const baseline = recWith({ forecastEndDate: "2026-07-31" });
    const current = recWith({ forecastEndDate: "2026-09-15" });
    const rows = computeVariance(baseline, current);
    const slip = rows.find((r) => r.key === "forecastEndDate");
    expect(slip?.deltaDays).toBe(46);
    expect(slip?.health).toBe("R");
  });
  it("flags higher remaining cost as Amber, lower as Green", () => {
    const worse = computeVariance(recWith({ remainingCost: 100 }), recWith({ remainingCost: 150 }));
    expect(worse.find((r) => r.key === "remainingCost")?.health).toBe("A");
    const better = computeVariance(recWith({ remainingCost: 100 }), recWith({ remainingCost: 80 }));
    expect(better.find((r) => r.key === "remainingCost")?.health).toBe("G");
  });
  it("returns a null baseline when baseline is null", () => {
    const rows = computeVariance(null, recWith({ pctComplete: 40 }));
    const pct = rows.find((r) => r.key === "pctComplete");
    expect(pct?.baseline).toBeNull();
    expect(pct?.current).toBe(40);
    expect(pct?.health).toBeNull();
  });
});

describe("baselineMilestoneTargets", () => {
  const ms = (id: number, target: string): SnapshotMilestone => ({ id, name: `M${id}`, target, forecast: target });

  it("returns an empty map when there are no snapshots", () => {
    expect(baselineMilestoneTargets([]).size).toBe(0);
  });

  it("returns an empty map when no snapshot is the baseline", () => {
    const a = snap("2026-06-01T00:00:00Z", "2026-W23");
    a.milestones = [ms(1, "2026-07-01")];
    expect(baselineMilestoneTargets([a]).size).toBe(0);
  });

  it("maps each milestone id to its target date from the baseline snapshot", () => {
    const older = snap("2026-06-01T00:00:00Z", "2026-W23");
    older.milestones = [ms(1, "2026-06-15")];
    const base = snap("2026-06-08T00:00:00Z", "2026-W24");
    base.isBaseline = true;
    base.milestones = [ms(1, "2026-07-01"), ms(2, "2026-08-01")];
    const map = baselineMilestoneTargets([older, base]);
    expect(map.get(1)).toBe("2026-07-01");
    expect(map.get(2)).toBe("2026-08-01");
    expect(map.size).toBe(2);
  });
});

describe("hasCapturableContent", () => {
  const empty = {
    tasks: [] as readonly Task[],
    milestones: [] as readonly Milestone[],
    model: { burndown: null } as unknown as DashboardModel,
  };

  it("is false for a project with no tasks, no milestones and no burndown", () => {
    expect(hasCapturableContent(empty)).toBe(false);
  });

  it("is true when the project has at least one task", () => {
    const task = { id: 1, taskName: "T1" } as unknown as Task;
    expect(hasCapturableContent({ ...empty, tasks: [task] })).toBe(true);
  });

  it("is true when the project has at least one milestone", () => {
    const ms = { id: 1, name: "M1", date: "2026-07-31" } as unknown as Milestone;
    expect(hasCapturableContent({ ...empty, milestones: [ms] })).toBe(true);
  });

  it("is true when a burndown exists even with no tasks or milestones", () => {
    const model = { burndown: { periods: [] } } as unknown as DashboardModel;
    expect(hasCapturableContent({ ...empty, model })).toBe(true);
  });
});
