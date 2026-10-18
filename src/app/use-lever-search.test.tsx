import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import type { ScenarioDirectory } from "./forecast-added-people";
import { whatItTakesSync, type LeverTarget } from "./forecast-levers";
import { computeScenarioComparison, type ScenarioRunInput } from "./forecast-scenario-compare";
import type { TargetConfidence } from "./forecast-target";
import type { Milestone, Resource, Role, Task } from "./types";
import { leverKey, useLeverSearch } from "./use-lever-search";
import { workingDaysBefore } from "./working-days";

const TODAY = "2026-10-14"; // a Wednesday
const NONE: ReadonlySet<string> = new Set();
const PLAN_END = "2026-12-23";
const HISTORY = [...workingDaysBefore(TODAY, 39, NONE), TODAY]; // 40 working days, HISTORY[39] is today
const PATTERN = [1, 0, 0]; // a slow team: about 13 finished tasks over 40 working days
const OLA = 7;
const PER = 8;

function done(id: number, completedDate: string, assignee = ""): Task {
  return { id, taskName: `d${id}`, assignee, assigneeEmail: "", status: "Done", completedDate, originalEstimateMinutes: 120 } as Task;
}
function open(id: number): Task {
  return { id, taskName: `o${id}`, assignee: "", assigneeEmail: "", status: "To Do", originalEstimateMinutes: 120 } as Task;
}
const FINISHED: Task[] = [];
HISTORY.forEach((date, i) => {
  for (let k = 0; k < PATTERN[i % PATTERN.length]; k += 1) {
    FINISHED.push(done(FINISHED.length + 1, date, i === 0 && k === 0 ? "Ola Nord" : i === 3 && k === 0 ? "Per Sand" : ""));
  }
});
const OPEN: Task[] = Array.from({ length: 12 }, (_, i) => open(1001 + i));
const TASKS: readonly Task[] = [...FINISHED, ...OPEN];
// Beta: 6 linked open tasks, due soon; Empty: nothing linked; Old: overdue; Late: the rest, far out.
const MILESTONES: readonly Milestone[] = [
  { id: 1, name: "Beta", date: "2026-10-30", linkedTaskIds: OPEN.slice(0, 6).map((t) => t.id) },
  { id: 2, name: "Empty", date: "2026-11-30", linkedTaskIds: [] },
  { id: 3, name: "Old", date: "2026-10-01", linkedTaskIds: [OPEN[6].id] },
  { id: 4, name: "Late", date: "2026-11-27", linkedTaskIds: OPEN.slice(6).map((t) => t.id) },
];
const ROLE: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 80, externalRate: 120 };
const OLA_RES: Resource = { id: OLA, firstName: "Ola", lastName: "Nord", roleId: 1, utilizationMode: "percent", utilization: {} };
const PER_RES: Resource = { id: PER, firstName: "Per", lastName: "Sand", roleId: 1, utilizationMode: "percent", utilization: {} };
const DIRECTORY: ScenarioDirectory = {
  resources: [OLA_RES, PER_RES], roles: [ROLE], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};
const HOURS = [12, 16, 20];
const FACTS: ForecastFacts = {
  bac: 2000, ac: 800, ev: null, pv: 0, bucketsMissingPercent: [],
  dated: HISTORY.map((date, i) => ({ date, bookedFrom: date, value: HOURS[i % 3], spread: false })),
  planEnd: PLAN_END, today: TODAY, holidaySet: NONE, hasFixedPrice: false,
};
const FACTS_BY_UNIT: ForecastFactsByUnit = { eur: FACTS, hours: FACTS };

function input(over: Partial<ScenarioRunInput> = {}): ScenarioRunInput {
  return {
    tasks: TASKS, milestones: MILESTONES, today: TODAY, holidaySet: NONE, window: 60, unit: "tasks", planEnd: PLAN_END,
    directory: DIRECTORY, budgetFacts: FACTS_BY_UNIT, costOn: false, ...over,
  };
}
const BETA: LeverTarget = { kind: "milestone", id: 1 };
const EMPTY: LeverTarget = { kind: "milestone", id: 2 };
const OLD: LeverTarget = { kind: "milestone", id: 3 };
const LATE: LeverTarget = { kind: "milestone", id: 4 };
const PLAN: LeverTarget = { kind: "planEnd" };

const TARGETS: readonly LeverTarget[] = [BETA, LATE, PLAN, OLD, EMPTY];
const MAX_TICKS = 500;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function tick(): void {
  act(() => { vi.advanceTimersToNextTimer(); });
}
function settle(): void {
  for (let i = 0; i < MAX_TICKS && vi.getTimerCount() > 0; i += 1) tick();
}
function expected(inp: ScenarioRunInput, target: LeverTarget, goal: TargetConfidence) {
  const cmp = computeScenarioComparison(inp, []);
  return whatItTakesSync(inp, cmp.context, target, goal, cmp.asIs);
}
type Props = { input: ScenarioRunInput | null; goal: TargetConfidence; enabled: boolean };
function mount(initial: Props) {
  return renderHook((p: Props) => useLeverSearch({ ...p, targets: TARGETS }), { initialProps: initial });
}

describe("useLeverSearch", () => {
  it("reads pending for every target on the first render, then equals whatItTakesSync", () => {
    const inp = input();
    const { result } = mount({ input: inp, goal: 95, enabled: true });
    expect([...result.current.keys()].sort()).toEqual(TARGETS.map(leverKey).sort());
    expect([...result.current.values()].every((v) => v === "pending")).toBe(true);
    settle();
    for (const target of [BETA, LATE, PLAN]) {
      expect(result.current.get(leverKey(target))).toEqual(expected(inp, target, 95));
    }
  });

  it("omits a target whose As-is chance is null (overdue, nothing linked), as whatItTakesSync is null for it", () => {
    const inp = input();
    const { result } = mount({ input: inp, goal: 95, enabled: true });
    settle();
    expect(expected(inp, OLD, 95)).toBeNull();
    expect(expected(inp, EMPTY, 95)).toBeNull();
    expect(result.current.has(leverKey(OLD))).toBe(false);
    expect(result.current.has(leverKey(EMPTY))).toBe(false);
  });

  it("runs one probe per macrotask: a search is still pending after the first tick", () => {
    const { result } = mount({ input: input(), goal: 95, enabled: true });
    tick();
    expect(vi.getTimerCount()).toBe(1);
    expect(result.current.get(leverKey(LATE))).toBe("pending");
  });

  it("returns every key to pending when the goal changes, and no value of the old goal lands afterwards", () => {
    const inp = input();
    const { result, rerender } = mount({ input: inp, goal: 80, enabled: true });
    tick(); tick(); tick();
    rerender({ input: inp, goal: 95, enabled: true });
    expect([...result.current.values()].every((v) => v === "pending")).toBe(true);
    expect(vi.getTimerCount()).toBe(1); // the old run's timer was cancelled, not left running beside the new one
    settle();
    for (const target of [BETA, LATE, PLAN]) {
      expect(result.current.get(leverKey(target))).toEqual(expected(inp, target, 95));
    }
    expect(expected(inp, LATE, 80)).not.toEqual(expected(inp, LATE, 95));
  });

  it("returns to pending when the input changes (a task edited), then shows the new input's numbers", () => {
    const first = input();
    const { result, rerender } = mount({ input: first, goal: 95, enabled: true });
    settle();
    const edited = input({ tasks: [...TASKS, open(2001), open(2002), open(2003)] });
    rerender({ input: edited, goal: 95, enabled: true });
    expect(result.current.get(leverKey(PLAN))).toBe("pending");
    settle();
    expect(result.current.get(leverKey(PLAN))).toEqual(expected(edited, PLAN, 95));
  });

  it("is empty and schedules nothing when disabled or without an input", () => {
    const off = mount({ input: input(), goal: 95, enabled: false });
    expect(off.result.current.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const none = mount({ input: null, goal: 95, enabled: true });
    expect(none.result.current.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the finished result for the same input and goal: re-enabling schedules no new search", () => {
    const inp = input();
    const { result, rerender } = mount({ input: inp, goal: 95, enabled: true });
    settle();
    const done = result.current.get(leverKey(LATE));
    rerender({ input: inp, goal: 95, enabled: false });
    expect(result.current.size).toBe(0);
    rerender({ input: inp, goal: 95, enabled: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.get(leverKey(LATE))).toEqual(done);
  });
});
