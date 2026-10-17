import { describe, expect, test } from "vitest";
import type { Milestone, Task } from "../types";
import { clampWhatIf, computeScheduleForecast, effortCoverage, type ScheduleForecastInput, type ScopeArrival, type WhatIf } from "./index";
import { FORECAST_TRIALS, MAX_HORIZON_WORKING_DAYS } from "./constants";
import { seedFrom } from "./rng";
import { PRIORITIES } from "../types";
import { addCalendarDays, nthWorkingDayAfter } from "../working-days";

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

  test("exposes trialDays and the history window dates without changing any result", () => {
    const f = computeScheduleForecast(input([...open(5), ...recentDone(10)], { window: "all" }));
    if (f.kind !== "forecast") throw new Error("expected forecast");
    expect(f.windowDates).toHaveLength(f.windowDays);
    expect(Array.from(f.trialDays).sort((a, b) => a - b)).toEqual(Array.from(f.distribution));
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
    // The view says the window was cut at the first completion; "all" always starts there, so it says nothing.
    expect(r).toMatchObject({ windowCutAt: steadyDays(5)[0] });
    expect(computeScheduleForecast(input([...open(5), ...fiveDays], { window: "all" }))).toMatchObject({ windowCutAt: null });
  });

  test("a fixed window short only of finished tasks, or with no completion at all, is not called cut", () => {
    // 30 days back reach past the first completion only when it is younger: 3 old finishes keep the window whole.
    const r = computeScheduleForecast(input([...open(5), done(7000, "2026-08-03"), ...recentDone(3)], { window: 30 }));
    expect(r).toMatchObject({ kind: "insufficient", days: 30, windowCutAt: null });
    expect(computeScheduleForecast(input(open(5), { window: 30 }))).toMatchObject({ kind: "insufficient", days: 0, windowCutAt: null });
  });

  test("insufficient carries the Done-without-date count", () => {
    const r = computeScheduleForecast(input([...open(2), task(50, { status: "Done" })]));
    expect(r).toMatchObject({ kind: "insufficient", doneWithoutDate: 1 });
  });
});

describe("computeScheduleForecast backlog", () => {
  test("scope -100% empties the backlog and finishes today", () => {
    const r = computeScheduleForecast(input([...open(5), ...recentDone(10)], { whatIf: { ...NEUTRAL, scopePercent: -100 } }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.backlog).toBe(0);
    expect(r.when.every((w) => w.daysAhead === 0 && w.date === TODAY)).toBe(true);
  });

  test("a what-if that empties the backlog still needs the history floor", () => {
    const r = computeScheduleForecast(input(open(5), { whatIf: { ...NEUTRAL, scopePercent: -100 } }));
    expect(r.kind, "the floor reads the open backlog before the what-if").toBe("insufficient");
  });

  test("a what-if that adds scope to an empty backlog still needs the history floor", () => {
    const r = computeScheduleForecast(input([], { whatIf: { ...NEUTRAL, scopeTasks: 5 } }));
    expect(r.kind, "the floor applies to the simulated backlog too").toBe("insufficient");
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

  test("effort scope -100% with unequal estimates is done today", () => {
    const r = computeScheduleForecast(input([...sized(10, 10, 1000), ...recentDone(10, 30)], { unit: "effort", whatIf: { ...NEUTRAL, scopePercent: -100 } }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.unit).toBe("effort");
    expect(r.backlog).toBe(0);
    expect(r.when.every((w) => w.daysAhead === 0 && w.date === TODAY)).toBe(true);
  });

  test("effort scopeTasks = -open.length empties the backlog", () => {
    const r = computeScheduleForecast(input([...sized(10, 10, 1000), ...recentDone(10, 30)], { unit: "effort", whatIf: { ...NEUTRAL, scopeTasks: -3 } }));
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

describe("trial count", () => {
  test("always FORECAST_TRIALS, a What-if extreme included, the same on every call", () => {
    const tasks = [...open(5), ...recentDone(10)];
    const extreme = { scopeTasks: 1000, scopePercent: 0, capacityPercent: 10 };
    const a = computeScheduleForecast(input(tasks, { trials: undefined, whatIf: extreme }));
    const b = computeScheduleForecast(input(tasks, { trials: undefined, whatIf: extreme }));
    if (a.kind !== "forecast") throw new Error("expected forecast");
    expect(a.trials).toBe(FORECAST_TRIALS);
    expect(a.distribution).toHaveLength(FORECAST_TRIALS);
    expect(b).toEqual(a);
    // An explicit count is honoured as given.
    expect(computeScheduleForecast(input(tasks, { whatIf: extreme }))).toMatchObject({ trials: 300 });
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
    // 50 open, so the backlog cap (below) stays out of the way.
    const r = computeScheduleForecast(input([...open(50), ...steadyTwoPerDay()], { today: "2026-10-17", howManyTarget: "2026-10-23" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    // Mon-Fri = 5 working days at exactly 2 per day.
    expect(r.howMany.map((h) => h.amount)).toEqual([10, 10, 10]);
  });

  test("How-many is capped at the open backlog", () => {
    // 2 a day for 5 working days would be 10, but only 5 tasks are open.
    const r = computeScheduleForecast(input([...open(5), ...steadyTwoPerDay()], { today: "2026-10-17", howManyTarget: "2026-10-23" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.howMany.map((h) => h.amount), "How-many is capped at the backlog").toEqual([5, 5, 5]);
  });

  test("a target on or before today yields 0", () => {
    const r = computeScheduleForecast(input([...open(5), ...steadyTwoPerDay()], { today: "2026-10-17", howManyTarget: "2026-10-17" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.howMany.map((h) => h.amount)).toEqual([0, 0, 0]);
  });

  test("a far target is capped at the horizon (R15)", () => {
    // A year-2206 typo would otherwise simulate ~47,000 days per trial; 2 a day x 1300 days = 2600.
    // 3000 open, so the backlog cap stays out of the way.
    const tasks = [...open(3000), ...steadyTwoPerDay()];
    const r = computeScheduleForecast(input(tasks, { today: "2026-10-17", howManyTarget: "2206-10-14", trials: 3 }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.howMany.map((h) => h.amount)).toEqual([2600, 2600, 2600]);
  });

  test("higher confidence promises no more than lower confidence", () => {
    // Uneven days (3, 2, then 1s): since R14 the window holds no pre-history zeros to spread the draws.
    const uneven = [done(1500, "2026-10-14"), done(1501, "2026-10-14"), done(1502, "2026-10-13")];
    // 100 open, so no percentile reaches the backlog cap.
    const r = computeScheduleForecast(input([...open(100), ...recentDone(12), ...uneven], { howManyTarget: "2026-11-13" }));
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

describe("computeScheduleForecast with dated changes", () => {
  const FLAT = () => new Float64Array(MAX_HORIZON_WORKING_DAYS + 1).fill(1);
  /** Uneven history (3, 2, then 1s over 12 days) so trials spread; M1 and M2 sit mid-distribution. */
  const tasks = [...open(40), ...recentDone(12), done(1500, "2026-10-14"), done(1501, "2026-10-14"), done(1502, "2026-10-13")];
  const milestones: Milestone[] = [
    { id: 1, name: "M1", date: nthWorkingDayAfter(TODAY, 15, NO_HOLIDAYS), linkedTaskIds: [20] },
    { id: 2, name: "M2", date: nthWorkingDayAfter(TODAY, 30, NO_HOLIDAYS), linkedTaskIds: [40] },
    { id: 3, name: "M3", date: nthWorkingDayAfter(TODAY, 30, NO_HOLIDAYS), linkedTaskIds: [39], achievedDate: "2026-10-01" },
  ];
  const chances = (r: ReturnType<typeof computeScheduleForecast>) => {
    if (r.kind !== "forecast") throw new Error("expected forecast");
    return r.milestones;
  };

  test("changes with a flat 1.0 schedule and no arrivals equal the plain run", () => {
    const plain = computeScheduleForecast(input(tasks, { milestones }));
    if (plain.kind !== "forecast") throw new Error("expected forecast");
    const between = plain.milestones.filter((m) => m.state === "chance" && m.chance > 0 && m.chance < 1);
    expect(between, "some trials reach and some miss each open milestone").toHaveLength(2);
    expect(new Set(plain.distribution).size, "trials finish on different days").toBeGreaterThan(1);
    expect(computeScheduleForecast(input(tasks, { milestones, changes: { capacityByDay: FLAT(), arrivals: [] } }))).toEqual(plain);
  });

  test("an arrival on an achieved milestone counts as unattributed", () => {
    const run = (milestoneId: number | null) =>
      chances(computeScheduleForecast(input(tasks, { milestones, changes: { capacityByDay: FLAT(), arrivals: [{ day: 5, tasks: 4, milestoneId }] } })));
    const unattributed = run(null);
    expect(run(1), "attributing to an open milestone moves it").not.toEqual(unattributed);
    expect(run(3)).toEqual(unattributed);
    expect(run(99), "a milestone that does not exist").toEqual(unattributed);
  });

  test("effort unit: an arrival of 2 tasks adds 2 × the median estimate", () => {
    // Estimates 30 / 60 / 600 on 7 of 10 tasks: base 1410 + 3 x median 60 = 1590.
    const estimates = [30, 60, 600];
    const estimated = Array.from({ length: 10 }, (_, i) => task(i + 1, i < 7 ? { originalEstimateMinutes: estimates[i % 3] } : {}));
    const r = computeScheduleForecast(
      input([...estimated, ...recentDone(10, 30)], {
        unit: "effort",
        // `changes` replaces the What-if: its scope does not reach the backlog.
        whatIf: { ...NEUTRAL, scopeTasks: 5 },
        changes: { capacityByDay: FLAT(), arrivals: [{ day: 3, tasks: 2, milestoneId: null }] },
      }),
    );
    expect(r).toMatchObject({ kind: "forecast", unit: "effort", backlog: 1590 + 120 });
  });

  test("an attributed removal lowers the backlog and the cap only by what came off its milestone", () => {
    // 10 open tasks at queue positions 1..10, exactly 1 done a day. M1 owns task 5 only, so -3 on M1 removes 1:
    // M2 moves 10 -> 9 and the arrived work 10 -> 9, so M2 is reached on day 9. The raw -3 would cap done at 7.
    const ms: Milestone[] = [
      { id: 1, name: "M1", date: nthWorkingDayAfter(TODAY, 4, NO_HOLIDAYS), linkedTaskIds: [5] },
      { id: 2, name: "M2", date: nthWorkingDayAfter(TODAY, 9, NO_HOLIDAYS), linkedTaskIds: [10] },
    ];
    const r = computeScheduleForecast(
      input([...open(10), ...recentDone(12)], { milestones: ms, changes: { capacityByDay: FLAT(), arrivals: [{ day: 0, tasks: -3, milestoneId: 1 }] } }),
    );
    if (r.kind !== "forecast") throw new Error("expected forecast");
    const m2 = r.milestones.find((m) => m.id === 2);
    expect(m2?.state === "chance" && m2.chance).toBeGreaterThan(0);
    expect(m2).toEqual({ id: 2, state: "chance", chance: 1, chancePrioritised: 1 });
    expect(r.backlog).toBe(9);
  });

  test("a removal on a later milestone does not make an earlier one unreachable", () => {
    // 11 open tasks at positions 1..11, exactly 1 done a day. M owns task 10 (day 12); L owns tasks 1 and 11
    // (position 11, day 30). -2 on L moves L only: M keeps position 10 and the work ahead of it, as if unattributed.
    const ms: Milestone[] = [
      { id: 1, name: "M", date: nthWorkingDayAfter(TODAY, 12, NO_HOLIDAYS), linkedTaskIds: [10] },
      { id: 2, name: "L", date: nthWorkingDayAfter(TODAY, 30, NO_HOLIDAYS), linkedTaskIds: [1, 11] },
    ];
    const run = (milestoneId: number | null) =>
      chances(computeScheduleForecast(input([...open(11), ...recentDone(12)], { milestones: ms, changes: { capacityByDay: FLAT(), arrivals: [{ day: 0, tasks: -2, milestoneId }] } })));
    const m = (r: ReturnType<typeof run>) => r.find((x) => x.id === 1);
    expect(m(run(2))).toEqual({ id: 1, state: "chance", chance: 1, chancePrioritised: 1 });
    expect(m(run(2))).toEqual(m(run(null)));
  });

  test("arrivals alone still need the history floor", () => {
    const changes = (n: number) => ({ capacityByDay: FLAT(), arrivals: n === 0 ? [] : [{ day: 2, tasks: n, milestoneId: null }] });
    expect(computeScheduleForecast(input(recentDone(3), { changes: changes(0) })).kind, "no work at all skips the floor").toBe("forecast");
    expect(computeScheduleForecast(input(recentDone(3), { changes: changes(5) })).kind).toBe("insufficient");
  });

  test("a higher capacity never makes any trial later (shared draws)", () => {
    const run = (over: Partial<ScheduleForecastInput>) => {
      const r = computeScheduleForecast(input(tasks, { milestones, ...over }));
      if (r.kind !== "forecast") throw new Error("expected forecast");
      return r;
    };
    const quick = run({ whatIf: NEUTRAL });
    const more = run({ whatIf: { ...NEUTRAL, capacityPercent: 130 } });
    expect(Array.from(more.trialDays).every((d, t) => d <= quick.trialDays[t])).toBe(true);
    expect(Array.from(more.trialDays).some((d, t) => d < quick.trialDays[t]), "some trial finishes earlier").toBe(true);
  });

  test("a later scope arrival never makes any trial finish earlier", () => {
    const run = (arrivals: ScopeArrival[]) => {
      const r = computeScheduleForecast(input(tasks, { milestones, changes: { capacityByDay: FLAT(), arrivals } }));
      if (r.kind !== "forecast") throw new Error("expected forecast");
      return r;
    };
    const none = run([]);
    const added = run([{ day: 20, tasks: 5, milestoneId: null }]);
    expect(Array.from(added.trialDays).every((d, t) => d >= none.trialDays[t])).toBe(true);
    expect(Array.from(added.trialDays).some((d, t) => d > none.trialDays[t]), "some trial finishes later").toBe(true);
  });

  test("a flat 130 % schedule plus a day-0 arrival equals the What-if it came from (tasks unit)", () => {
    // 50 open: the What-if adds 3 + round(10 % of 50) = 8 tasks at 130 % capacity.
    const fifty = [...open(50), ...recentDone(12), done(1500, "2026-10-14"), done(1501, "2026-10-14"), done(1502, "2026-10-13")];
    const whatIf = computeScheduleForecast(input(fifty, { milestones, whatIf: { scopeTasks: 3, scopePercent: 10, capacityPercent: 130 } }));
    const dated = computeScheduleForecast(
      input(fifty, {
        milestones,
        changes: {
          capacityByDay: new Float64Array(MAX_HORIZON_WORKING_DAYS + 1).fill(1.3),
          arrivals: [{ day: 0, tasks: 8, milestoneId: null }],
        },
      }),
    );
    if (whatIf.kind !== "forecast" || dated.kind !== "forecast") throw new Error("expected forecast");
    expect(whatIf.backlog).toBe(58);
    expect(new Set(whatIf.trialDays).size, "trials finish on different days").toBeGreaterThan(1);
    expect(dated.backlog).toBe(whatIf.backlog);
    expect(Array.from(dated.trialDays)).toEqual(Array.from(whatIf.trialDays));
    expect(dated.when).toEqual(whatIf.when);
    expect(dated.howMany).toEqual(whatIf.howMany);
    expect(dated.milestones).toEqual(whatIf.milestones);
  });

  test("insufficient carries the window dates", () => {
    const r = computeScheduleForecast(input([...open(5), ...recentDone(9)]));
    if (r.kind !== "insufficient") throw new Error("expected insufficient");
    expect(r.windowDates).toHaveLength(r.days);
    expect(r.windowDates[0]).toBe("2026-10-02");
    expect(r.windowDates[r.windowDates.length - 1]).toBe(TODAY);
  });
});

describe("pinned digests", () => {
  // One number per result: every trial's day, every How-many amount and every milestone chance. A change
  // to the engine that moves any of them moves the digest, so these pin that a refactor moves nothing.
  function digest(r: ReturnType<typeof computeScheduleForecast>): number {
    if (r.kind !== "forecast") throw new Error("expected forecast");
    return seedFrom([
      ...r.trialDays,
      ...r.howMany.map((h) => h.amount),
      ...r.milestones.flatMap((m): (string | number)[] => (m.state === "chance" ? [m.chance, m.chancePrioritised] : [m.state])),
    ]);
  }
  /** 40 open tasks: mixed due dates (every third blank) and priorities; estimated when `estimate`. */
  function mixedOpen(estimate: boolean): Task[] {
    return Array.from({ length: 40 }, (_, i) =>
      task(i + 1, {
        dueDate: (i + 1) % 3 === 0 ? "" : addCalendarDays(TODAY, ((i + 1) * 7) % 50),
        priority: PRIORITIES[(i + 1) % PRIORITIES.length],
        originalEstimateMinutes: estimate ? 30 + (((i + 1) * 37) % 240) : undefined,
      }),
    );
  }
  /** 1 to 3 completions on each of the last 30 working days. */
  function steadyHistory(estimate: boolean): Task[] {
    let id = 8000;
    return steadyDays(30).flatMap((d, j) =>
      Array.from({ length: 1 + (j % 3) }, () => {
        const k = id++;
        return done(k, d, estimate ? 60 + ((k * 13) % 120) : undefined);
      }),
    );
  }
  function fixture(unit: "tasks" | "effort"): ScheduleForecastInput {
    const estimate = unit === "effort";
    const milestones: Milestone[] = [
      { id: 1, name: "M1", date: nthWorkingDayAfter(TODAY, 20, NO_HOLIDAYS), linkedTaskIds: [12] },
      { id: 2, name: "M2", date: nthWorkingDayAfter(TODAY, 60, NO_HOLIDAYS), linkedTaskIds: [35] },
    ];
    return input([...mixedOpen(estimate), ...steadyHistory(estimate)], {
      milestones,
      window: 30,
      unit,
      whatIf: { scopeTasks: 3, scopePercent: 10, capacityPercent: 130 },
      howManyTarget: "2026-11-30",
      trials: 500,
    });
  }

  test("tasks unit", () => {
    const r = computeScheduleForecast(fixture("tasks"));
    expect(r).toMatchObject({ kind: "forecast", unit: "tasks" });
    expect(digest(r)).toBe(3246131170);
  });

  test("effort unit", () => {
    const r = computeScheduleForecast(fixture("effort"));
    expect(r).toMatchObject({ kind: "forecast", unit: "effort" });
    expect(digest(r)).toBe(814886283);
  });
});
