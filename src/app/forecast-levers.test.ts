import { describe, expect, it } from "vitest";
import type { ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import type { ScheduleForecast } from "./forecast";
import type { ScenarioDirectory } from "./forecast-added-people";
import {
  applyProbe, chanceFor, leverBound, leverChange, meanTaskHours, nextProbe, placeholderWho, searchOutcome, settlePlan,
  startSearch, whatItTakesSync,
  type LeverOutcome, type LeverSearch, type LeverTarget,
} from "./forecast-levers";
import {
  computeScenarioColumn, computeScenarioComparison, type ScenarioColumn, type ScenarioRunInput,
} from "./forecast-scenario-compare";
import { ADDED_COUNT_MAX, DEFAULT_RAMP_WEEKS } from "./forecast-scenarios";
import type { Milestone, Resource, Role, Task } from "./types";
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

function setup(over: Partial<ScenarioRunInput> = {}) {
  const inp = input(over);
  const cmp = computeScenarioComparison(inp, []);
  return { inp, asIs: cmp.asIs, context: cmp.context };
}

/** Runs the step machine against a function, returning the end state and the probes it took. */
function drive(bound: number, goal: number, chance: (n: number) => number | null): { s: LeverSearch; probes: number[] } {
  let s = startSearch(bound, goal);
  const probes: number[] = [];
  for (let n = nextProbe(s); n !== null; n = nextProbe(s)) {
    probes.push(n);
    s = applyProbe(s, n, chance(n));
  }
  return { s, probes };
}

describe("chanceFor", () => {
  it("reads a milestone's chance and the plan end's chanceOnTime", () => {
    const { asIs } = setup();
    expect(asIs.forecast.kind).toBe("forecast");
    const beta = chanceFor(asIs, BETA);
    expect(beta).not.toBeNull();
    expect(chanceFor(asIs, PLAN)).toBe(asIs.chanceOnTime);
    expect(asIs.chanceOnTime).not.toBeNull();
  });

  it("is null for an overdue milestone, one without linked tasks, or one that does not exist", () => {
    const { asIs } = setup();
    expect(chanceFor(asIs, OLD)).toBeNull();
    expect(chanceFor(asIs, EMPTY)).toBeNull();
    expect(chanceFor(asIs, { kind: "milestone", id: 99 })).toBeNull();
  });
});

describe("the probe step machine", () => {
  const monotone = (n: number) => (n >= 7 ? 0.85 : 0.5);

  it("finds the smallest n that reaches the goal within 1 + ceil(log2(bound)) probes", () => {
    const { s, probes } = drive(20, 80, monotone);
    expect(searchOutcome(s)).toEqual({ state: "reaches", n: 7, chance: 0.85, hours: null });
    expect(probes[0]).toBe(20); // the bound first
    expect(probes.length).toBeLessThanOrEqual(1 + Math.ceil(Math.log2(20)));
    expect(new Set(probes).size).toBe(probes.length); // never probes the same n twice
  });

  it("finds the edges: n = 1 and n = bound", () => {
    expect(searchOutcome(drive(20, 80, () => 0.9).s)).toMatchObject({ state: "reaches", n: 1 });
    expect(searchOutcome(drive(20, 80, (n) => (n >= 20 ? 0.9 : 0.1)).s)).toMatchObject({ state: "reaches", n: 20 });
  });

  it("is out of reach after exactly one probe when the bound does not reach the goal", () => {
    const { s, probes } = drive(5, 80, () => 0.5);
    expect(probes).toEqual([5]);
    expect(searchOutcome(s)).toEqual({ state: "out-of-reach" });
  });

  it("treats a null chance as not reaching, and a bound of 0 as nothing to probe", () => {
    expect(searchOutcome(drive(5, 80, () => null).s)).toEqual({ state: "out-of-reach" });
    const zero = startSearch(0, 80);
    expect(nextProbe(zero)).toBeNull();
    expect(searchOutcome(zero)).toEqual({ state: "out-of-reach" });
  });

  it("is immutable: applying a probe leaves the earlier state untouched", () => {
    const s0 = startSearch(20, 80);
    const frozen = JSON.stringify(s0);
    applyProbe(s0, 20, 0.9);
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(nextProbe(s0)).toBe(20);
  });
});

describe("leverBound and leverChange", () => {
  it("bounds people by the team and the cap, tasks by half the open work", () => {
    const { context } = setup();
    expect(context.onTeam.size).toBeGreaterThan(0);
    expect(leverBound("people", BETA, context)).toBe(Math.min(context.onTeam.size, ADDED_COUNT_MAX));
    expect(leverBound("tasks", BETA, context)).toBe(3); // 6 open linked
    expect(leverBound("tasks", PLAN, context)).toBe(6); // 12 open
    expect(leverBound("tasks", EMPTY, context)).toBe(0);
  });

  it("builds an add-people change and a scope change", () => {
    const who = { label: "Placeholder", count: 1, rate: 80, currency: "EUR" as const, hoursPerWeek: 20 };
    expect(leverChange("people", 3, BETA, who, TODAY)).toEqual({
      kind: "addPeople", who: { ...who, count: 3 }, from: TODAY, until: "", rampWeeks: DEFAULT_RAMP_WEEKS,
    });
    expect(leverChange("tasks", 2, BETA, null, TODAY)).toEqual({ kind: "scope", tasks: -2, on: TODAY, milestoneId: 1 });
    const plan = leverChange("tasks", 2, PLAN, null, TODAY);
    expect(plan).toEqual({ kind: "scope", tasks: -2, on: TODAY });
    expect("milestoneId" in plan).toBe(false);
  });
});

describe("placeholderWho", () => {
  it("sizes a placeholder from the team's booked hours and the team's mean rate", () => {
    const { context } = setup();
    const who = placeholderWho(context, DIRECTORY);
    expect(who).not.toBeNull();
    const expectedHours = Math.min(60, Math.max(1, Math.round(((context.teamHours ?? 0) * 5) / context.onTeam.size)));
    expect(who).toEqual({ label: "Placeholder", count: 1, rate: 80, currency: "EUR", hoursPerWeek: expectedHours });
  });

  it("is null without booked hours or without a team", () => {
    expect(placeholderWho(setup({ budgetFacts: null }).context, DIRECTORY)).toBeNull();
    const { context } = setup();
    expect(placeholderWho({ ...context, onTeam: new Set() }, DIRECTORY)).toBeNull();
  });
});

describe("whatItTakesSync", () => {
  it("reports for each lever exactly the chance of the column it names (common random numbers), and the smallest n", () => {
    const { inp, asIs, context } = setup();
    const goal = 95;
    const w = whatItTakesSync(inp, context, LATE, goal, asIs);
    expect(w).not.toBeNull();
    expect(w?.chance).toBe(chanceFor(asIs, LATE));
    expect(w?.people.state).toBe("reaches"); // else the people equality below could hold vacuously
    const who = placeholderWho(context, DIRECTORY);
    const outcomes: [("people" | "tasks"), LeverOutcome | undefined][] = [["people", w?.people], ["tasks", w?.tasks]];
    let checked = 0;
    for (const [kind, o] of outcomes) {
      if (o?.state !== "reaches") continue;
      const col = computeScenarioColumn(inp, [leverChange(kind, o.n, LATE, who, TODAY)], context);
      expect(o.chance).toBe(chanceFor(col, LATE));
      expect(o.chance).toBeGreaterThanOrEqual(goal / 100);
      if (o.n > 1) { // minimal: one fewer does not reach
        const less = computeScenarioColumn(inp, [leverChange(kind, o.n - 1, LATE, who, TODAY)], context);
        expect(chanceFor(less, LATE) ?? 0).toBeLessThan(goal / 100);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0); // at least one lever reaches, or this proved nothing
  });

  it("without hours facts the people lever is inert and the tasks lever is still computed", () => {
    const { inp, asIs, context } = setup({ budgetFacts: null });
    const w = whatItTakesSync(inp, context, LATE, 95, asIs);
    expect(w?.people).toEqual({ state: "inert", reason: "needs-booked-hours" });
    expect(w?.tasks.state).not.toBe("inert");
  });

  it("a target already at or above the goal is on-target for both levers", () => {
    const { inp, asIs, context } = setup();
    expect(chanceFor(asIs, PLAN) ?? 0).toBeGreaterThanOrEqual(0.95);
    const w = whatItTakesSync(inp, context, PLAN, 95, asIs);
    expect(w).toMatchObject({ people: { state: "on-target" }, tasks: { state: "on-target" } });
  });

  it("a target with no chance (overdue, nothing linked) is not defined: null", () => {
    const { inp, asIs, context } = setup();
    expect(whatItTakesSync(inp, context, EMPTY, 95, asIs)).toBeNull();
    expect(whatItTakesSync(inp, context, OLD, 95, asIs)).toBeNull();
  });

  it("a milestone below the goal with no open linked tasks has an inert tasks lever", () => {
    // The engine never produces this (no open work reads 100 %), so the As-is column is stubbed to reach the branch.
    const { inp, asIs, context } = setup();
    const f = asIs.forecast as ScheduleForecast;
    const stub: ScenarioColumn = {
      ...asIs,
      forecast: { ...f, milestones: [{ id: 2, state: "chance", chance: 0.3, chancePrioritised: 0.3 }] },
    };
    const w = whatItTakesSync(inp, context, EMPTY, 80, stub);
    expect(w?.tasks).toEqual({ state: "inert", reason: "no-open-tasks" });
  });
});

describe("the tasks lever in hours (§502 part 4)", () => {
  it("meanTaskHours is the mean estimate of the target's estimated open tasks, null when none carries one", () => {
    const { context } = setup();
    expect(meanTaskHours(BETA, context)).toBe(2); // every open task is estimated at 120 minutes
    expect(meanTaskHours(PLAN, context)).toBe(2);
    const mixed = context.tasks.map((t) => (t.id === OPEN[0].id ? { ...t, originalEstimateMinutes: 480 } : t.id === OPEN[1].id ? { ...t, originalEstimateMinutes: undefined } : t));
    expect(meanTaskHours(BETA, { ...context, tasks: mixed })).toBe((480 + 4 * 120) / 5 / 60); // the unestimated one is left out
    const none = context.tasks.map((t) => ({ ...t, originalEstimateMinutes: undefined }));
    expect(meanTaskHours(BETA, { ...context, tasks: none })).toBeNull();
    expect(meanTaskHours(EMPTY, context)).toBeNull();
  });

  it("settlePlan gives a reaching tasks lever n × the mean, rounded; people and an unestimated plan get null", () => {
    const base = { target: BETA, chance: 0.3, prioritised: 0.4 };
    const reaches = (n: number): LeverOutcome => ({ state: "reaches", n, chance: 0.85, hours: null });
    expect(settlePlan({ base, people: reaches(2), tasks: reaches(9), taskHours: 6 }).tasks).toEqual({ state: "reaches", n: 9, chance: 0.85, hours: 54 });
    expect(settlePlan({ base, people: reaches(2), tasks: reaches(3), taskHours: 1.7 }).tasks).toMatchObject({ hours: 5 });
    expect(settlePlan({ base, people: reaches(2), tasks: reaches(9), taskHours: 6 }).people).toMatchObject({ hours: null });
    expect(settlePlan({ base, people: reaches(2), tasks: reaches(9), taskHours: null }).tasks).toMatchObject({ hours: null });
  });

  it("whatItTakesSync carries the hours with estimates and null without", () => {
    let checked = 0;
    for (const target of [BETA, LATE]) {
      for (const goal of [80, 95] as const) {
        const { inp, asIs, context } = setup();
        const w = whatItTakesSync(inp, context, target, goal, asIs);
        if (w?.tasks.state !== "reaches") continue;
        expect(w.tasks.hours).toBe(w.tasks.n * 2);
        const bare = setup({ tasks: TASKS.map((t) => ({ ...t, originalEstimateMinutes: undefined })) });
        const without = whatItTakesSync(bare.inp, bare.context, target, goal, bare.asIs);
        if (without?.tasks.state === "reaches") expect(without.tasks.hours).toBeNull();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
