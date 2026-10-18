// §502 part 4 — the forecast decision an export carries (spec §3.8): the pure model, run against the real engine.
import { describe, expect, it, vi } from "vitest";
import type { ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import type { ScenarioDirectory } from "./forecast-added-people";
import { buildForecastDecision, forecastDecisionSource, type ForecastDecision, type ForecastDecisionArgs } from "./forecast-decision";
import { whatItTakesSync } from "./forecast-levers";
import { computeScenarioComparison, type ScenarioRunInput } from "./forecast-scenario-compare";
import type { ForecastScenario } from "./forecast-scenarios";
import type { Milestone, Resource, Role, Task } from "./types";
import { workingDaysBefore } from "./working-days";

// The lever engine's fixture shape (forecast-levers.test.ts): a slow team, 12 open tasks, four milestones.
const TODAY = "2026-10-14";
const NONE: ReadonlySet<string> = new Set();
const PLAN_END = "2026-12-23";
const HISTORY = [...workingDaysBefore(TODAY, 39, NONE), TODAY];
const PATTERN = [1, 0, 0];

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
  // On target: one task, far out — its chance is at or above every goal, so it is never listed.
  { id: 5, name: "Easy", date: "2026-12-18", linkedTaskIds: [OPEN[0].id] },
];
const ROLE: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 80, externalRate: 120 };
const DIRECTORY: ScenarioDirectory = {
  resources: [
    { id: 7, firstName: "Ola", lastName: "Nord", roleId: 1, utilizationMode: "percent", utilization: {} } as Resource,
    { id: 8, firstName: "Per", lastName: "Sand", roleId: 1, utilizationMode: "percent", utilization: {} } as Resource,
  ],
  roles: [ROLE], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
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
const ADD_ONE: ForecastScenario = {
  id: 5, name: "Contractor from Nov",
  changes: [{ kind: "scope", tasks: -4, on: TODAY }],
};

function args(over: Partial<ForecastDecisionArgs> = {}): ForecastDecisionArgs {
  return { simulationActive: true, input: input(), scenarios: [], settingsOverrides: undefined, ...over };
}
function ready(d: ForecastDecision | null): Extract<ForecastDecision, { insufficient: false }> {
  if (d === null || d.insufficient) throw new Error("expected a decision with a forecast");
  return d;
}

describe("buildForecastDecision (§502 part 4)", () => {
  it("is null while the simulation is off — the export then OMITS the section, it never empties it", () => {
    expect(buildForecastDecision(args({ simulationActive: false }))).toBeNull();
  });

  it("is null while the input is not ready (the holiday calendar is loading)", () => {
    expect(buildForecastDecision(args({ input: null }))).toBeNull();
  });

  it("says insufficient below the history floor, and runs no lever search", () => {
    const d = buildForecastDecision(args({ input: input({ tasks: OPEN }) }));
    expect(d).toEqual({ insufficient: true, goal: 80 });
  });

  it("reads the goal from the project's target confidence (absent = 80)", () => {
    expect(ready(buildForecastDecision(args())).goal).toBe(80);
    expect(ready(buildForecastDecision(args({ settingsOverrides: { forecast: { targetConfidence: 95 } } }))).goal).toBe(95);
  });

  it("lists only milestones WITH a chance below the goal, worst first, each with its whatItTakesSync answer", () => {
    const d = ready(buildForecastDecision(args()));
    const { asIs, context } = computeScenarioComparison(input(), []);
    // Overdue ("Old") and unlinked ("Empty") milestones have no chance: never listed.
    const names = d.below.map((m) => m.name);
    expect(names).not.toContain("Old");
    expect(names).not.toContain("Empty");
    expect(names).not.toContain("Easy");
    expect(names.length).toBeGreaterThan(0);
    if (asIs.forecast.kind !== "forecast") throw new Error("fixture must forecast");
    const easy = asIs.forecast.milestones.find((m) => m.id === 5);
    expect(easy?.state === "chance" && easy.chance >= 0.95).toBe(true);
    for (const m of d.below) expect(m.chance).toBeLessThan(0.8);
    const chances = d.below.map((m) => m.chance);
    expect(chances).toEqual([...chances].sort((a, b) => a - b));
    const beta = d.below.find((m) => m.name === "Beta");
    expect(beta?.date).toBe("2026-10-30");
    expect(beta?.take).toEqual(whatItTakesSync(input(), context, { kind: "milestone", id: 1 }, 80, asIs));
  });

  it("matches the As-is run's P80 and chance on time, and carries the plan end and the trial count", () => {
    const d = ready(buildForecastDecision(args()));
    const { asIs } = computeScenarioComparison(input(), []);
    if (asIs.forecast.kind !== "forecast") throw new Error("fixture must forecast");
    expect(d.p80).toBe(asIs.forecast.when.find((w) => w.p === 80)?.date ?? null);
    expect(d.chanceOnTime).toBe(asIs.chanceOnTime);
    expect(d.planEnd).toBe(PLAN_END);
    expect(d.trials).toBe(10000);
  });

  it("has a cost only with the cost pass on, in the baseline currency", () => {
    expect(ready(buildForecastDecision(args())).cost).toBeNull();
    const cost = ready(buildForecastDecision(args({ input: input({ costOn: true }) }))).cost;
    expect(cost).not.toBeNull();
    expect(cost?.currency).toBe("EUR");
  });

  it("carries the proposal when the stored id names a saved scenario", () => {
    const d = ready(buildForecastDecision(args({ scenarios: [ADD_ONE], settingsOverrides: { forecast: { proposalScenarioId: 5 } } })));
    expect(d.proposal?.name).toBe("Contractor from Nov");
    expect(typeof d.proposal?.p80).toBe("string");
    expect(d.proposal?.costP80).toBeNull();
  });

  it("reads a proposal id naming no saved scenario (deleted, or never there) as NO proposal — the stale-id rule", () => {
    const stale = ready(buildForecastDecision(args({ scenarios: [ADD_ONE], settingsOverrides: { forecast: { proposalScenarioId: 99 } } })));
    expect(stale.proposal).toBeNull();
    const none = ready(buildForecastDecision(args({ scenarios: [ADD_ONE] })));
    expect(none.proposal).toBeNull();
  });
});

describe("forecastDecisionSource", () => {
  it("builds nothing until asked, then once: later calls answer from the cache", () => {
    const read = vi.fn(() => args());
    const source = forecastDecisionSource(read);
    expect(read).not.toHaveBeenCalled();
    const first = source();
    expect(source()).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("caches a null (simulation off) too", () => {
    const read = vi.fn(() => args({ simulationActive: false }));
    const source = forecastDecisionSource(read);
    expect(source()).toBeNull();
    expect(source()).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
