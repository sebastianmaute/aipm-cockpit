import { describe, expect, test } from "vitest";
import type { Task } from "../types";
import { addCalendarDays, countWorkingDays } from "../working-days";
import { effortCoverage } from "./index";
import { computeAppForecast, toHistoryEntry } from "./app-forecast";

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

  test("is insufficient below the history floor and has no history entry", () => {
    const r = computeAppForecast(args([...finished(5), ...openTasks(10)]));
    expect(r.kind).toBe("insufficient");
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

  test("is deterministic across un-memoised runs", () => {
    const a = computeAppForecast(args([...finished(20), ...openTasks(10)]));
    const b = computeAppForecast(args([...finished(20), ...openTasks(10)]));
    if (a.kind !== "forecast" || b.kind !== "forecast") throw new Error("expected forecast");
    expect(a).not.toBe(b);
    expect([b.p50, b.p80, b.p95, b.chanceOnTime]).toEqual([a.p50, a.p80, a.p95, a.chanceOnTime]);
  });
});
