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
/** The last n weekdays up to and including TODAY, oldest first. */
function steadyDays(n: number): string[] {
  const out: string[] = [];
  for (let d = new Date(`${TODAY}T00:00:00Z`); out.length < n; d.setUTCDate(d.getUTCDate() - 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
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

  test("a young project is forecast from its own days, not padded to the window (R14)", () => {
    // The reviewer probe: 15 working days at 2 a day, 60 open tasks, the default window 60.
    // Padding the window with 45 pre-project zero days put P50 at about 119 days instead of 30.
    const history = steadyDays(15).flatMap((d, i) => [done(5000 + 2 * i, d), done(5001 + 2 * i, d)]);
    const r = computeScheduleForecast(input([...open(60), ...history], { window: 60 }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.windowDays).toBe(15);
    expect(r.when.map((w) => w.daysAhead)).toEqual([30, 30, 30]);
  });

  test("the days floor bites on a fixed window too (R14)", () => {
    const fiveDays = steadyDays(5).flatMap((d, i) => [done(6000 + 2 * i, d), done(6001 + 2 * i, d)]);
    const r = computeScheduleForecast(input([...open(5), ...fiveDays], { window: 30 }));
    expect(r).toMatchObject({ kind: "insufficient", finished: 10, days: 5, neededDays: 10 });
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
    // 1 task a day over 10 days of history (R14): 2000 tasks need 2000 days, past the 1300-day horizon.
    const r = computeScheduleForecast(input([...open(2000), ...recentDone(10)], { trials: 100 }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.when[0].daysAhead).toBe("beyond");
    expect(r.when[0].date).toBeNull();
    expect(r.beyondShare).toBeGreaterThan(0.5);
  });
});

describe("computeScheduleForecast effort mode", () => {
  // Unequal estimates 30 / 60 / 600 so median, mean and max differ; the median is 60.
  const ESTIMATES = [30, 60, 600];
  const estimated = (n: number, withEstimate: number) =>
    Array.from({ length: n }, (_, i) => task(i + 1, i < withEstimate ? { originalEstimateMinutes: ESTIMATES[i % 3] } : {}));

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
    expect(r.backlog).toBe(1590); // 1410 estimated + 3 x median 60
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
    const daysAhead = (r: typeof a) => r.when[0].daysAhead as number;
    expect(daysAhead(c)).toBeGreaterThanOrEqual(daysAhead(a));
    expect(c.when).not.toEqual(a.when);
  });
});

describe("computeScheduleForecast effort what-if and history", () => {
  const sized = (...mins: number[]) => mins.map((m, i) => task(i + 1, { originalEstimateMinutes: m }));

  test("effort scope -100% with unequal estimates and no history is done today", () => {
    const r = computeScheduleForecast(input(sized(10, 10, 1000), { unit: "effort", whatIf: { ...NEUTRAL, scopePercent: -100 } }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.unit).toBe("effort");
    expect(r.backlog).toBe(0);
    expect(r.when.every((w) => w.daysAhead === 0 && w.date === TODAY)).toBe(true);
  });

  test("effort scopeTasks = -open.length empties the backlog", () => {
    const r = computeScheduleForecast(input(sized(10, 10, 1000), { unit: "effort", whatIf: { ...NEUTRAL, scopeTasks: -3 } }));
    expect(r).toMatchObject({ kind: "forecast", backlog: 0 });
  });

  test("effort scope percent is a percent of the effort sum", () => {
    const r = computeScheduleForecast(input([...sized(10, 10, 1000), ...recentDone(10, 30)], { unit: "effort", whatIf: { ...NEUTRAL, scopePercent: 50 } }));
    expect(r).toMatchObject({ kind: "forecast", backlog: 1530 });
  });

  test("effort history counts unestimated Done tasks at the median estimate", () => {
    const r = computeScheduleForecast(input([...sized(30, 60, 600), ...recentDone(10)], { unit: "effort" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.unit).toBe("effort");
    expect(r.when[0].daysAhead).not.toBe("beyond");
  });

  test("10 finished over only 9 working days is insufficient", () => {
    const days = ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"];
    const finished = Array.from({ length: 10 }, (_, i) => done(3000 + i, days[Math.min(i, 8)]));
    const r = computeScheduleForecast(input([...open(3), ...finished], { window: "all" }));
    expect(r).toMatchObject({ kind: "insufficient", finished: 10, days: 9 });
  });

  test("trials below 1 is clamped", () => {
    const r = computeScheduleForecast(input([...open(3), ...recentDone(10)], { trials: 0 }));
    expect(r).toMatchObject({ kind: "forecast", trials: 1 });
  });
});

describe("computeScheduleForecast how many", () => {
  /** Two tasks done on each of the 30 working days before Saturday 2026-10-17. */
  function steadyTwoPerDay(): Task[] {
    const out: Task[] = [];
    let id = 4000;
    for (let d = new Date("2026-10-16T00:00:00Z"), n = 0; n < 30; d.setUTCDate(d.getUTCDate() - 1)) {
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      const iso = d.toISOString().slice(0, 10);
      out.push(done(id++, iso), done(id++, iso));
      n += 1;
    }
    return out;
  }

  test("counts the working days in (today, target] from a weekend today", () => {
    const r = computeScheduleForecast(input([...open(5), ...steadyTwoPerDay()], { today: "2026-10-17", howManyTarget: "2026-10-23" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    // Mon-Fri = 5 working days at exactly 2 per day.
    expect(r.howMany.map((h) => h.amount)).toEqual([10, 10, 10]);
  });

  test("a target on or before today yields 0", () => {
    const r = computeScheduleForecast(input([...open(5), ...steadyTwoPerDay()], { today: "2026-10-17", howManyTarget: "2026-10-17" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.howMany.map((h) => h.amount)).toEqual([0, 0, 0]);
  });

  test("a far target is capped at the horizon (R15)", () => {
    // A year-2206 typo would otherwise simulate ~47,000 days per trial; 2 a day x 1300 days = 2600.
    const tasks = [...open(5), ...steadyTwoPerDay()];
    const r = computeScheduleForecast(input(tasks, { today: "2026-10-17", howManyTarget: "2206-10-14", trials: 3 }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.howMany.map((h) => h.amount)).toEqual([2600, 2600, 2600]);
  });

  test("higher confidence promises no more than lower confidence", () => {
    // Uneven days (3, 2, then 1s): since R14 the window holds no pre-history zeros to spread the draws.
    const uneven = [done(1500, "2026-10-14"), done(1501, "2026-10-14"), done(1502, "2026-10-13")];
    const r = computeScheduleForecast(input([...open(5), ...recentDone(12), ...uneven], { howManyTarget: "2026-11-13" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    const [p50, p80, p95] = r.howMany.map((h) => h.amount);
    expect(p95).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p50);
    expect(p95).toBeLessThan(p50);
  });
});

describe("clampWhatIf", () => {
  test("replaces non-finite fields with the defaults and rounds scope tasks", () => {
    expect(clampWhatIf({ scopeTasks: Number.NaN, scopePercent: Number.NaN, capacityPercent: Number.NaN }, 10)).toEqual(NEUTRAL);
    expect(clampWhatIf({ scopeTasks: 2.6, scopePercent: 0, capacityPercent: 100 }, 10).scopeTasks).toBe(3);
  });

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
