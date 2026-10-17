import { describe, expect, it } from "vitest";
import type { ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import { simulateCostFromRun } from "./budget-sim";
import { DEFAULT_WHAT_IF, computeScheduleForecast, type ScheduleForecast, type ScheduleForecastResult } from "./forecast";
import type { ScenarioDirectory } from "./forecast-added-people";
import {
  buildScheduleContext,
  computeScenarioColumn,
  computeScenarioComparison,
  type ScenarioRunInput,
} from "./forecast-scenario-compare";
import { whatIfToScenarioChanges, type ForecastScenario, type ScenarioChange } from "./forecast-scenarios";
import type { Milestone, Resource, Role, Shift, Task } from "./types";
import { workingDaysBefore } from "./working-days";

const TODAY = "2026-10-14"; // a Wednesday
const NONE: ReadonlySet<string> = new Set();
const PLAN_END = "2026-12-23"; // about 50 working days out, near the As-is median
/** The 60-day history window, oldest first; HISTORY[59] is today. */
const HISTORY = [...workingDaysBefore(TODAY, 59, NONE), TODAY];
const PATTERN = [1, 2, 0]; // completions per day: steady 1 a day on average, the first day non-zero (no R14 cut)
const OLA = 7; // completes a task 40 working days ago: on the team at window 60, not at window 30
const PER = 8; // never on the team
const OPEN_ESTIMATES = [60, 120, 180, 240]; // over 50 tasks: median 120, mean 147.6

function done(id: number, completedDate: string, assignee = ""): Task {
  return {
    id, taskName: `d${id}`, assignee, assigneeEmail: "", status: "Done", completedDate, originalEstimateMinutes: 120,
  } as Task;
}
function open(id: number, i: number): Task {
  return {
    id, taskName: `o${id}`, assignee: "", assigneeEmail: "", status: "To Do",
    originalEstimateMinutes: OPEN_ESTIMATES[i % OPEN_ESTIMATES.length],
  } as Task;
}

function historyTasks(days: readonly string[]): Task[] {
  const out: Task[] = [];
  days.forEach((date, i) => {
    for (let k = 0; k < PATTERN[i % PATTERN.length]; k += 1) {
      const fortyAgo = date === HISTORY[59 - 40] && k === 0;
      out.push(done(out.length + 1, date, fortyAgo ? "Ola Nord" : ""));
    }
  });
  return out;
}
const OPEN = Array.from({ length: 50 }, (_, i) => open(1001 + i, i));
const TASKS: readonly Task[] = [...historyTasks(HISTORY), ...OPEN];
const MILESTONES: readonly Milestone[] = [
  { id: 1, name: "Beta", date: "2026-11-20", linkedTaskIds: OPEN.slice(0, 15).map((t) => t.id) },
  { id: 2, name: "Launch", date: "2027-01-29", linkedTaskIds: OPEN.slice(15, 35).map((t) => t.id) },
];

function resource(id: number, firstName: string, lastName: string): Resource {
  return { id, firstName, lastName, roleId: 1, utilizationMode: "percent", utilization: {} };
}
const ROLE: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 80, externalRate: 120 };
const SHIFT: Shift = { id: 1, assignee: "", resourceId: PER, hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] };
const DIRECTORY: ScenarioDirectory = {
  resources: [resource(OLA, "Ola", "Nord"), resource(PER, "Per", "Sand")], roles: [ROLE], shifts: [SHIFT], absences: [],
  budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};

const HOURS = [12, 16, 20]; // 16 h a day on average
const TEAM_RATE = 50; // the team books 50 per hour; an added person at the role's 80 costs more per delivered task
function facts(value: (i: number) => number, ac: number, bac: number): ForecastFacts {
  return {
    bac, ac, ev: null, pv: 0, bucketsMissingPercent: [],
    dated: HISTORY.map((date, i) => ({ date, bookedFrom: date, value: value(i), spread: false })),
    planEnd: PLAN_END, today: TODAY, holidaySet: NONE, hasFixedPrice: false,
  };
}
const FACTS: ForecastFactsByUnit = {
  eur: facts((i) => HOURS[i % 3] * TEAM_RATE, 40_000, 100_000),
  hours: facts((i) => HOURS[i % 3], 800, 2_000),
};

function input(over: Partial<ScenarioRunInput> = {}): ScenarioRunInput {
  return {
    tasks: TASKS, milestones: MILESTONES, today: TODAY, holidaySet: NONE, window: 60, unit: "tasks", planEnd: PLAN_END,
    directory: DIRECTORY, budgetFacts: FACTS, costOn: true, ...over,
  };
}
function scenario(id: number, changes: readonly ScenarioChange[]): ForecastScenario {
  return { id, name: `S${id}`, changes };
}
function forecastOf(r: ScheduleForecastResult): ScheduleForecast {
  if (r.kind !== "forecast") throw new Error(`expected a forecast, got ${r.kind}`);
  return r;
}
function p80Days(r: ScheduleForecastResult): number {
  const d = forecastOf(r).when.find((w) => w.p === 80)?.daysAhead;
  if (typeof d !== "number") throw new Error("P80 beyond the horizon");
  return d;
}
function p80Cost(c: { kind: string; p80?: number | "beyond" } | null): number {
  if (c === null || c.kind !== "sim" || typeof c.p80 !== "number") throw new Error("expected a simulated cost");
  return c.p80;
}
const availability = (percent: number): ScenarioChange => ({ kind: "availability", percent, from: TODAY, until: "" });
const addPerson = (resourceId: number): ScenarioChange =>
  ({ kind: "addPeople", who: { resourceId, hoursPerWeek: 40 }, from: TODAY, until: "", rampWeeks: 4 });

describe("computeScenarioComparison", () => {
  it("a scenario with no changes shows exactly the As-is numbers", () => {
    // §5.4. A neutral 100 % availability row is a change list that changes nothing, too.
    const c = computeScenarioComparison(input(), [scenario(1, []), scenario(2, [availability(100)])]);
    expect(c.asIs.schedule).toBeNull();
    expect(c.asIs.cost?.kind).toBe("sim"); // not two nulls agreeing
    const onTime = c.asIs.chanceOnTime ?? -1;
    expect(onTime > 0 && onTime < 1).toBe(true); // a figure that could differ
    for (const { column } of c.scenarios) {
      expect(column.schedule).not.toBeNull();
      expect(column.forecast).toEqual(c.asIs.forecast);
      expect(column.cost).toEqual(c.asIs.cost);
      expect(column.chanceOnTime).toBe(c.asIs.chanceOnTime);
    }
  });

  it("Save as scenario shows what What-if showed (tasks unit)", () => {
    const whatIf = { scopeTasks: 3, scopePercent: 10, capacityPercent: 130 };
    const { changes } = whatIfToScenarioChanges(whatIf, 50, TODAY);
    const c = computeScenarioComparison(input(), [scenario(1, changes)]);
    const column = c.scenarios[0].column;
    const run = forecastOf(computeScheduleForecast({
      tasks: TASKS, milestones: MILESTONES, today: TODAY, holidaySet: NONE, window: 60, unit: "tasks",
      whatIf, howManyTarget: TODAY,
    }));
    const got = forecastOf(column.forecast);
    expect(got.when).toEqual(run.when);
    expect(got.trialDays).toEqual(run.trialDays);
    expect(got.milestones).toEqual(run.milestones);
    expect(column.cost).toEqual(simulateCostFromRun(run, FACTS.eur, "eur", 1.3));
    // The What-if moved something, so the equalities above are not As is meeting As is.
    expect(got.when).not.toEqual(forecastOf(c.asIs.forecast).when);
    expect(column.cost).not.toEqual(c.asIs.cost);
  });

  it("added people bring the finish forward and raise cost at finish", () => {
    const c = computeScenarioComparison(input(), [scenario(1, [addPerson(PER)])]);
    const column = c.scenarios[0].column;
    // Sized against the HOURS facts: 16 h a day, so 8 h a day is +50 % at full speed.
    expect(c.context.teamHours).toBeCloseTo(16, 12);
    expect(column.schedule?.rows[0]).toMatchObject({ kind: "addPeople", status: { kind: "sized", ratePerHour: 80 } });
    expect(column.schedule?.addedShareAtFullSpeed).toBeCloseTo(0.5, 12);
    expect(p80Days(column.forecast)).toBeLessThan(p80Days(c.asIs.forecast));
    expect(p80Cost(column.cost)).toBeGreaterThan(p80Cost(c.asIs.cost));
  });

  it("an availability change barely moves cost at finish", () => {
    const c = computeScenarioComparison(input(), [scenario(1, [availability(150)])]);
    const column = c.scenarios[0].column;
    expect(p80Days(column.forecast)).toBeLessThan(p80Days(c.asIs.forecast));
    const asIsCost = p80Cost(c.asIs.cost);
    // Without the spend scale the fewer days would cut the remaining cost by a third (about 13,000 here).
    expect(Math.abs(p80Cost(column.cost) - asIsCost)).toBeLessThan(0.05 * asIsCost);
  });

  it("the on-team check follows the run's window", () => {
    // Review Focus 3: Ola completed a task 40 working days ago.
    const at30 = computeScenarioComparison(input({ window: 30 }), [scenario(1, [addPerson(OLA)])]);
    const at60 = computeScenarioComparison(input({ window: 60 }), [scenario(1, [addPerson(OLA)])]);
    expect(at30.scenarios[0].column.schedule?.rows[0]).toMatchObject({ kind: "addPeople", status: { kind: "sized" } });
    expect(at60.scenarios[0].column.schedule?.rows[0])
      .toEqual({ kind: "addPeople", status: { kind: "inert", reason: "on-team" } });
  });

  it("the editor's context is the one the columns used", () => {
    // Review Focus 3, at a window that is not the default, so a context built from any other window fails.
    for (const window of [30, 60] as const) {
      const run = input({ window });
      const c = computeScenarioComparison(run, [scenario(1, [addPerson(OLA)])]);
      const windowDates = c.asIs.forecast.windowDates;
      expect(windowDates).toHaveLength(window);
      expect(c.context).toEqual(buildScheduleContext(run, windowDates));
      expect(c.context.windowDates).toBe(windowDates);
      const inert = c.scenarios[0].column.schedule?.rows[0];
      expect(c.context.onTeam.has(OLA)).toBe(inert?.kind === "addPeople" && inert.status.kind === "inert");
      expect(c.context.onTeam.has(OLA)).toBe(window === 60);
    }
  });

  it("effort unit sizes scope rows at the median estimate", () => {
    // Review Focus 5: the median of the open estimates is 120 minutes (their mean, 147.6, would give 295.2).
    const run = input({ unit: "effort" });
    const c = computeScenarioComparison(run, [scenario(1, [{ kind: "scope", tasks: 2, on: TODAY }])]);
    const asIs = forecastOf(c.asIs.forecast);
    expect(asIs.unit).toBe("effort");
    expect(asIs.backlog).toBe(7380);
    expect(forecastOf(c.scenarios[0].column.forecast).backlog).toBe(asIs.backlog + 2 * 120);
  });

  it("below the floor every column is insufficient and costs nothing", () => {
    const fewDays = HISTORY.slice(-5);
    const tasks = [...historyTasks(fewDays), ...OPEN];
    const run = input({ tasks });
    const c = computeScenarioComparison(run, [scenario(1, [availability(150)]), scenario(2, [addPerson(PER)])]);
    for (const column of [c.asIs, ...c.scenarios.map((s) => s.column)]) {
      expect(column.forecast.kind).toBe("insufficient");
      expect(column.cost).toBeNull();
      expect(column.chanceOnTime).toBeNull();
    }
    expect(c.scenarios[0].column.schedule).not.toBeNull();
    // The context still comes from the insufficient run's window.
    expect(c.context.windowDates).toEqual(fewDays);
    expect(c.context).toEqual(buildScheduleContext(run, fewDays));
  });

  it("no budget facts: no cost and added people inert with needs-booked-hours", () => {
    const c = computeScenarioComparison(input({ budgetFacts: null }), [scenario(1, [addPerson(PER), availability(150)])]);
    const column = c.scenarios[0].column;
    expect(c.asIs.cost).toBeNull();
    expect(column.cost).toBeNull();
    expect(c.context.teamHours).toBeNull();
    expect(column.schedule?.rows[0]).toEqual({ kind: "addPeople", status: { kind: "inert", reason: "needs-booked-hours" } });
    // The availability row still works.
    expect(p80Days(column.forecast)).toBeLessThan(p80Days(c.asIs.forecast));
  });

  it("with the cost switch off there is no cost even with facts, and the schedule is unchanged", () => {
    const on = computeScenarioComparison(input(), [scenario(1, [addPerson(PER)])]);
    const off = computeScenarioComparison(input({ costOn: false }), [scenario(1, [addPerson(PER)])]);
    expect(on.asIs.cost).not.toBeNull();
    expect(off.asIs.cost).toBeNull();
    expect(off.scenarios[0].column.cost).toBeNull();
    // Added people are still sized from the hours facts: the switch hides cost rows, not delivery.
    expect(off.scenarios[0].column.forecast).toEqual(on.scenarios[0].column.forecast);
  });
});

describe("chance on time per column", () => {
  it("a scenario that removes every open task is on time even past the plan end", () => {
    // `hasOpen` comes from the column's own trials, not from the open tasks As is still has.
    const run = input({ planEnd: "2026-10-01" });
    const c = computeScenarioComparison(run, [scenario(1, [{ kind: "scope", tasks: -50, on: TODAY }])]);
    expect(c.asIs.chanceOnTime).toBe(0);
    expect(c.scenarios[0].column.chanceOnTime).toBe(1);
  });
});

describe("computeScenarioColumn", () => {
  it("a null change list is As is; an unsaved list matches the same saved scenario", () => {
    const run = input();
    const c = computeScenarioComparison(run, [scenario(1, [availability(120), addPerson(PER)])]);
    expect(computeScenarioColumn(run, null, c.context)).toEqual(c.asIs);
    expect(computeScenarioColumn(run, [availability(120), addPerson(PER)], c.context)).toEqual(c.scenarios[0].column);
    // As is runs the plain default What-if.
    const plain = computeScheduleForecast({
      tasks: TASKS, milestones: MILESTONES, today: TODAY, holidaySet: NONE, window: 60, unit: "tasks",
      whatIf: DEFAULT_WHAT_IF, howManyTarget: TODAY,
    });
    expect(c.asIs.forecast).toEqual(plain);
  });
});
