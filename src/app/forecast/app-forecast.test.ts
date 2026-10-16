import { afterEach, describe, expect, test, vi } from "vitest";
import type { Task } from "../types";
import { addCalendarDays, countWorkingDays } from "../working-days";
import * as indexModule from "./index";
import { effortCoverage } from "./index";
import { computeAppForecast, toHistoryEntry } from "./app-forecast";
import { MIN_FINISHED_TASKS, MIN_HISTORY_WORKING_DAYS } from "./constants";

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

function task(id: number, over: Partial<Task> = {}): Task {
  return { id, title: `t${id}`, dueDate: "", priority: "Medium", status: "Open", ...over } as Task;
}
/** The last n weekdays up to and including TODAY, oldest first. */
function steadyDays(n: number): string[] {
  const out: string[] = [];
  for (let d = new Date(`${TODAY}T00:00:00Z`); out.length < n; d.setUTCDate(d.getUTCDate() - 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}
function finished(n: number): Task[] {
  const days = steadyDays(20);
  return Array.from({ length: n }, (_, i) => task(1000 + i, { status: "Done", completedDate: days[i % days.length] }));
}
function openTasks(n: number, over: Partial<Task> = {}): Task[] {
  return Array.from({ length: n }, (_, i) => task(i + 1, over));
}
function args(tasks: Task[], over: Partial<Parameters<typeof computeAppForecast>[0]> = {}) {
  return { tasks, milestones: [], planEnd: "2027-03-31", today: TODAY, holidaySet: NO_HOLIDAYS, ...over };
}

describe("computeAppForecast", () => {
  test("forecasts with ordered percentiles and the default trial count", () => {
    const r = computeAppForecast(args([...finished(20), ...openTasks(10)]));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.trials).toBe(10000);
    expect(r.p50 && r.p80 && r.p95).toBeTruthy();
    expect(r.p50! <= r.p80!).toBe(true);
    expect(r.p80! <= r.p95!).toBe(true);
  });

  test("carries the per-trial finish days and the window dates from the same run", () => {
    const r = computeAppForecast(args([...finished(20), ...openTasks(10)]));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.windowDates).toHaveLength(r.windowDays);
    expect(r.trialDays).toHaveLength(r.trials);
    expect(Array.from(r.trialDays).sort((a, b) => a - b)).toEqual(Array.from(r.distribution));
  });

  test("is insufficient below the history floor and has no history entry", () => {
    const r = computeAppForecast(args([...finished(5), ...openTasks(10)]));
    expect(r.kind).toBe("insufficient");
    if (r.kind !== "insufficient") throw new Error("expected insufficient");
    // The engine's floor figures ride along, so the strip can say what is short.
    expect(r.finished).toBe(5);
    expect(r.neededFinished).toBe(MIN_FINISHED_TASKS);
    expect(r.neededDays).toBe(MIN_HISTORY_WORKING_DAYS);
    expect(toHistoryEntry(r, TODAY)).toBeNull();
  });

  test("history entry carries the day and the forecast figures", () => {
    const r = computeAppForecast(args([...finished(20), ...openTasks(10)]));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(toHistoryEntry(r, TODAY)).toEqual({
      date: TODAY,
      p50: r.p50,
      p80: r.p80,
      p95: r.p95,
      chanceOnTime: r.chanceOnTime,
    });
  });

  test("chanceOnTime is null for a blank or impossible plan end", () => {
    const t = [...finished(20), ...openTasks(10)];
    for (const planEnd of ["", "2026-11-31"]) {
      const r = computeAppForecast(args(t, { planEnd }));
      expect(r).toMatchObject({ kind: "forecast", chanceOnTime: null });
    }
  });

  test("chanceOnTime is 0 when the plan end is before today and work is open", () => {
    const r = computeAppForecast(args([...finished(20), ...openTasks(10)], { planEnd: "2026-10-01" }));
    expect(r).toMatchObject({ kind: "forecast", chanceOnTime: 0 });
  });

  test("chanceOnTime is 1 with no open tasks and a valid plan end", () => {
    const r = computeAppForecast(args(finished(20)));
    expect(r).toMatchObject({ kind: "forecast", chanceOnTime: 1, p50: TODAY });
  });

  test("chanceOnTime is the share of trials finishing within the plan's working days", () => {
    const planEnd = "2026-11-10";
    const r = computeAppForecast(args([...finished(20), ...openTasks(10)], { planEnd }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    const n = countWorkingDays(addCalendarDays(TODAY, 1), addCalendarDays(planEnd, 1), NO_HOLIDAYS);
    const within = r.distribution.filter((d) => d <= n).length;
    expect(r.chanceOnTime).toBe(within / r.distribution.length);
  });

  test("a far plan end never counts beyond-horizon trials as on time", () => {
    const r = computeAppForecast(args([...finished(20), ...openTasks(3000)], { planEnd: "2099-12-31" }));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.p95).toBeNull();
    expect(r.chanceOnTime).toBe(0);
  });

  test("estimateCoverage is null when nothing is open (no remaining work to cover)", () => {
    const r = computeAppForecast(args(finished(20)));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.estimateCoverage).toBeNull();
  });

  test("estimateCoverage equals effortCoverage of the open tasks", () => {
    const open = [...openTasks(3, { originalEstimateMinutes: 60 }), task(50)];
    const r = computeAppForecast(args([...finished(20), ...open]));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    expect(r.estimateCoverage).toBe(effortCoverage(open));
  });

  test("memoises on collection references and scalar values", () => {
    const tasks = [...finished(20), ...openTasks(10)];
    const a = args(tasks);
    const first = computeAppForecast(a);
    expect(computeAppForecast({ ...a })).toBe(first);
    expect(computeAppForecast({ ...a, tasks: [...tasks] })).not.toBe(first);
  });

  // Each memo key on its own: a dropped `today` check would record yesterday's forecast under today's date.
  test.each([
    ["milestones", { milestones: [] }],
    ["holidaySet", { holidaySet: new Set<string>() }],
    ["planEnd", { planEnd: "2027-04-30" }],
    ["today", { today: "2026-10-15" }],
  ] as const)("recomputes when only %s changes", (_key, change) => {
    const a = args([...finished(20), ...openTasks(10)]);
    const first = computeAppForecast(a);
    expect(computeAppForecast({ ...a })).toBe(first);
    expect(computeAppForecast({ ...a, ...change })).not.toBe(first);
  });

  test("is deterministic across un-memoised runs", () => {
    const a = computeAppForecast(args([...finished(20), ...openTasks(10)]));
    const b = computeAppForecast(args([...finished(20), ...openTasks(10)]));
    if (a.kind !== "forecast" || b.kind !== "forecast") throw new Error("expected forecast");
    expect(a).not.toBe(b);
    expect([b.p50, b.p80, b.p95, b.chanceOnTime]).toEqual([a.p50, a.p80, a.p95, a.chanceOnTime]);
  });

  test("carries the engine working-days-ahead for each percentile as markers", () => {
    const r = computeAppForecast(args([...finished(20), ...openTasks(10)]));
    if (r.kind !== "forecast") throw new Error("expected forecast");
    const sorted = [...r.distribution].sort((a, b) => a - b);
    const nearestRank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
    expect(r.markers).toEqual({ p50: nearestRank(50), p80: nearestRank(80), p95: nearestRank(95) });
    expect(r.markers.p50 <= r.markers.p80 && r.markers.p80 <= r.markers.p95).toBe(true);
  });

  describe("milestone chances", () => {
    afterEach(() => vi.restoreAllMocks());

    function milestoneArgs() {
      const tasks = [...finished(20), ...openTasks(10)];
      const milestones = [{ id: 7, name: "M", date: "2027-01-31", linkedTaskIds: [1, 2] }];
      return args(tasks, { milestones });
    }

    test("carries the engine's milestone chances from the same run", () => {
      const spy = vi.spyOn(indexModule, "computeScheduleForecast");
      const f = computeAppForecast(milestoneArgs());
      if (f.kind !== "forecast") throw new Error("expected forecast");
      const engine = spy.mock.results[0].value;
      if (engine.kind !== "forecast") throw new Error("expected engine forecast");
      expect(f.milestones).toBe(engine.milestones);
      expect(f.milestones.map((m) => m.id)).toEqual([7]);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("a second call with the same references reuses the run", () => {
      const spy = vi.spyOn(indexModule, "computeScheduleForecast");
      const a = milestoneArgs();
      const f1 = computeAppForecast(a);
      const f2 = computeAppForecast({ ...a });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(f2).toBe(f1);
    });
  });
});
