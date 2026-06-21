import { describe, expect, test } from "vitest";
import { computeCompletionTrend, MAX_POINTS } from "./completion-trend";
import type { SnapshotRecord } from "./snapshot";
import type { ActivityEntry } from "./activity-log";

function snap(capturedAt: string, pct: number): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket: capturedAt.slice(0, 10), cadence: "daily",
    trigger: "manual", isBaseline: false, remainingHours: null, remainingCost: null,
    pctComplete: pct, forecastEndDate: "2026-12-31", planEndDate: "2026-12-31",
    spi: null, cpi: null, overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    currency: "EUR", milestones: [], series: [],
  };
}

let nextId = 1;
function ev(timestamp: string, kind: ActivityEntry["kind"]): ActivityEntry {
  return { id: nextId++, timestamp, kind, args: [] };
}

describe("computeCompletionTrend", () => {
  test("prefers snapshots when >= 2 (exact pctComplete, log ignored)", () => {
    const snapshots = [snap("2026-06-10T00:00:00.000Z", 20), snap("2026-06-14T00:00:00.000Z", 55)];
    const activity = [ev("2026-06-12T00:00:00.000Z", "task.completed")];
    const out = computeCompletionTrend({ snapshots, activity, currentDone: 9, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.percent)).toEqual([20, 55]);
    expect(out[1].label).toBe("06-14");
  });

  test("falls back to activity-log reconstruction when < 2 snapshots", () => {
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.completed"),
      ev("2026-06-20T09:00:00.000Z", "task.completed"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, currentDone: 6, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.percent)).toEqual([50, 60]);
    expect(out.map((p) => p.label)).toEqual(["06-18", "06-20"]);
  });

  test("created/deleted shift total; reopened decrements done", () => {
    const activity = [
      ev("2026-06-15T09:00:00.000Z", "task.created"),
      ev("2026-06-17T09:00:00.000Z", "task.reopened"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, currentDone: 5, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.percent)).toEqual([60, 50]);
  });

  test("fewer than 2 points -> empty", () => {
    expect(computeCompletionTrend({ snapshots: [], activity: [], currentDone: 0, currentTotal: 0, today: "2026-06-21" })).toEqual([]);
    expect(computeCompletionTrend({ snapshots: [snap("2026-06-10T00:00:00.000Z", 20)], activity: [], currentDone: 1, currentTotal: 5, today: "2026-06-21" })).toEqual([]);
  });

  test("caps to the trailing MAX_POINTS", () => {
    const snapshots = Array.from({ length: MAX_POINTS + 5 }, (_, i) =>
      snap(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, i),
    );
    const out = computeCompletionTrend({ snapshots, activity: [], currentDone: 1, currentTotal: 2, today: "2026-06-30" });
    expect(out.length).toBe(MAX_POINTS);
    expect(out[out.length - 1].label).toBe(`06-${MAX_POINTS + 5}`);
  });

  test("total 0 -> 0% (no divide by zero)", () => {
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.deleted"),
      ev("2026-06-20T09:00:00.000Z", "task.deleted"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, currentDone: 0, currentTotal: 0, today: "2026-06-21" });
    expect(out.every((p) => p.percent === 0)).toBe(true);
  });

  test("ignores future-dated events (clock-skew guard) and non-task kinds", () => {
    const activity = [
      ev("2026-06-18T09:00:00.000Z", "task.completed"),
      ev("2026-06-19T09:00:00.000Z", "raid.created"),
      ev("2027-01-01T09:00:00.000Z", "task.completed"),
      ev("2026-06-20T09:00:00.000Z", "task.completed"),
    ];
    const out = computeCompletionTrend({ snapshots: [], activity, currentDone: 6, currentTotal: 10, today: "2026-06-21" });
    expect(out.map((p) => p.label)).toEqual(["06-18", "06-20"]);
  });
});
