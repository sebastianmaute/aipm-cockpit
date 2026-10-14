import { describe, expect, test } from "vitest";
import type { Milestone, Task } from "../types";
import { clampWhatIf, computeScheduleForecast, effortCoverage, type ScheduleForecastInput, type WhatIf } from "./index";

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";
const NO_HOLIDAYS: ReadonlySet<string> = new Set();
const NEUTRAL: WhatIf = { scopeTasks: 0, scopePercent: 0, capacityPercent: 100 };

function task(id: number, over: Partial<Task> = {}): Task {
  return { id, title: `t${id}`, dueDate: "", priority: "Medium", status: "Open", ...over } as Task;
}
function done(id: number, completedDate: string, minutes?: number): Task {
  return task(id, { status: "Done", completedDate, originalEstimateMinutes: minutes });
}
/** n tasks done on distinct recent weekdays (ids from 1000). */
function recentDone(n: number, minutes?: number): Task[] {
  const days = ["2026-10-14", "2026-10-13", "2026-10-12", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05", "2026-10-02", "2026-10-01", "2026-09-30", "2026-09-29"];
  return Array.from({ length: n }, (_, i) => done(1000 + i, days[i % days.length], minutes));
}
function open(n: number, over: Partial<Task> = {}): Task[] {
  return Array.from({ length: n }, (_, i) => task(i + 1, over));
}
function input(tasks: Task[], over: Partial<ScheduleForecastInput> = {}): ScheduleForecastInput {
  return {
    tasks,
    milestones: [],
    today: TODAY,
    holidaySet: NO_HOLIDAYS,
    window: 30,
    unit: "tasks",
    whatIf: NEUTRAL,
    howManyTarget: "2026-10-21",
    trials: 300,
    ...over,
  };
}

describe("computeScheduleForecast floor", () => {
  test("returns insufficient below 10 finished tasks", () => {
    const r = computeScheduleForecast(input([...open(5), ...recentDone(9)]));
    expect(r).toMatchObject({ kind: "insufficient", finished: 9, neededFinished: 10, neededDays: 10 });
  });

  test("forecasts at exactly 10 finished and 10 days", () => {
    const r = computeScheduleForecast(input([...open(5), ...recentDone(10)], { window: "all" }));
    expect(r).toMatchObject({ kind: "forecast", finished: 10, windowDays: 10 });
  });

  test("a paused team is insufficient for window 60 but forecasts for all", () => {
    const old = Array.from({ length: 12 }, (_, i) => done(2000 + i, `2026-0${1 + (i % 3)}-1${i % 9}`));
    const tasks = [...open(5), ...old];
    expect(computeScheduleForecast(input(tasks, { window: 60 })).kind).toBe("insufficient");
    expect(computeScheduleForecast(input(tasks, { window: "all" })).kind).toBe("forecast");
  });

  test("insufficient carries the Done-without-date count", () => {
    const r = computeScheduleForecast(input([...open(2), task(50, { status: "Done" })]));
    expect(r).toMatchObject({ kind: "insufficient", doneWithoutDate: 1 });
  });
});

describe("computeScheduleForecast backlog", () => {
  test("scope -100% empties the backlog and finishes today", () => {
    const r = computeScheduleForecast(input(open(5), { whatIf: { ...NEUTRAL, scopePercent: -100 } }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.backlog).toBe(0);
    expect(r.when.every((w) => w.daysAhead === 0 && w.date === TODAY)).toBe(true);
  });

  test("an empty backlog skips the floor and keeps milestone states", () => {
    const ms: Milestone[] = [{ id: 1, name: "M", date: "2026-11-01", linkedTaskIds: [] }];
    const r = computeScheduleForecast(input([], { milestones: ms }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.milestones).toEqual([{ id: 1, state: "no-linked-tasks" }]);
  });

  test("Cancelled tasks are not in the backlog", () => {
    const tasks = [...open(3), task(90, { status: "Cancelled" }), ...recentDone(10)];
    const r = computeScheduleForecast(input(tasks));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.backlog).toBe(3);
  });

  test("scope tasks and percent add to the backlog, rounded half-up", () => {
    const tasks = [...open(10), ...recentDone(10)];
    const r = computeScheduleForecast(input(tasks, { whatIf: { ...NEUTRAL, scopeTasks: 2, scopePercent: 25 } }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.backlog).toBe(15); // 10 + 2 + round(2.5)=3
  });

  test("huge backlog reports beyond without hanging", () => {
    const r = computeScheduleForecast(input([...open(1000), ...recentDone(10)], { trials: 100 }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.when[0].daysAhead).toBe("beyond");
    expect(r.when[0].date).toBeNull();
    expect(r.beyondShare).toBeGreaterThan(0.5);
  });
});

describe("computeScheduleForecast effort mode", () => {
  const estimated = (n: number, withEstimate: number) =>
    Array.from({ length: n }, (_, i) => task(i + 1, i < withEstimate ? { originalEstimateMinutes: 60 } : {}));

  test("effortCoverage is the estimated share, 0 when empty", () => {
    expect(effortCoverage([])).toBe(0);
    expect(effortCoverage(estimated(10, 7))).toBe(0.7);
  });

  test("effort requested under 70% coverage falls back to tasks", () => {
    const r = computeScheduleForecast(input([...estimated(10, 6), ...recentDone(10, 30)], { unit: "effort" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.unit).toBe("tasks");
    expect(r.backlog).toBe(10);
  });

  test("effort at 70% coverage is honoured, unestimated tasks count at the median", () => {
    const r = computeScheduleForecast(input([...estimated(10, 7), ...recentDone(10, 30)], { unit: "effort" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.unit).toBe("effort");
    expect(r.backlog).toBe(600);
  });
});

describe("computeScheduleForecast determinism", () => {
  test("same input gives the same percentiles; changing capacity changes them", () => {
    const tasks = [...open(40), ...recentDone(12)];
    const a = computeScheduleForecast(input(tasks));
    const b = computeScheduleForecast(input(tasks));
    expect(a).toEqual(b);
    const c = computeScheduleForecast(input(tasks, { whatIf: { ...NEUTRAL, capacityPercent: 50 } }));
    if (a.kind !== "forecast" || c.kind !== "forecast") throw new Error("expected forecast");
    expect(c.when).not.toEqual(a.when);
  });
});

describe("clampWhatIf", () => {
  test("clamps every field", () => {
    expect(clampWhatIf({ scopeTasks: -50, scopePercent: -500, capacityPercent: 5 }, 10)).toEqual({
      scopeTasks: -10,
      scopePercent: -100,
      capacityPercent: 10,
    });
    expect(clampWhatIf({ scopeTasks: 5000, scopePercent: 900, capacityPercent: 999 }, 10)).toEqual({
      scopeTasks: 1000,
      scopePercent: 500,
      capacityPercent: 300,
    });
  });
});
