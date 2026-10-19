import { describe, expect, it } from "vitest";
import type { ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import { entityToken } from "./ai-entity-token";
import type { ScenarioDirectory } from "./forecast-added-people";
import {
  buildForecastReport, scenarioValidationContext, type ColumnReport, type ForecastReport, type ForecastReportInput,
  type WhatItTakesReport, WHAT_IT_TAKES_MILESTONE_CAP,
} from "./forecast-ai-report";
import { computeScenarioComparison, type ScenarioRunInput } from "./forecast-scenario-compare";
import type { ForecastScenario, ScenarioChange } from "./forecast-scenarios";
import type { ForecastHistoryEntry } from "./forecast-history";
import { whatItTakesSync } from "./forecast-levers";
import { withProposal, withTargetConfidence } from "./forecast-target";
import type { SettingsOverrides } from "./settings-types";
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
const availability = (percent: number): ScenarioChange => ({ kind: "availability", percent, from: TODAY, until: "" });
const addPerson = (resourceId: number): ScenarioChange =>
  ({ kind: "addPeople", who: { resourceId, hoursPerWeek: 40 }, from: TODAY, until: "", rampWeeks: 4 });


function reportInput(
  over: Partial<ScenarioRunInput> = {}, scenarios: readonly ForecastScenario[] = [],
  settingsOverrides: SettingsOverrides | undefined = undefined,
): ForecastReportInput {
  return { run: input(over), history: [], scenarios, currency: "EUR", settingsOverrides };
}
/** The searched take of a call without `whatIf`. */
function takesOf(r: ForecastReport): WhatItTakesReport {
  if ("omitted" in r.whatItTakes) throw new Error("expected a searched whatItTakes");
  return r.whatItTakes;
}
function forecastColumn(c: ColumnReport) {
  if (c.status !== "forecast") throw new Error("expected a forecast column");
  return c;
}

describe("buildForecastReport", () => {
  it("a whatIf equal to a saved scenario gives that scenario's result (common random numbers)", () => {
    const changes = [availability(130), addPerson(PER)];
    const report = buildForecastReport(reportInput({}, [scenario(1, changes)]), changes);
    expect(report.whatIf).toBeDefined();
    expect(report.whatIf?.result).toEqual(report.scenarios[0].result);
    expect(report.whatIf?.rows).toEqual(report.scenarios[0].rows);
    // Not two As-is copies agreeing: the change moved the finish.
    expect(report.scenarios[0].result).not.toEqual(report.asIs);
  });

  it("omits whatIf when none is given", () => {
    expect(buildForecastReport(reportInput(), null).whatIf).toBeUndefined();
  });

  it("a scenario with no changes gives the As-is result", () => {
    const report = buildForecastReport(reportInput({}, [scenario(1, [])]), null);
    expect(forecastColumn(report.asIs).cost).not.toBeNull();
    expect(report.scenarios[0].result).toEqual(report.asIs);
  });

  it("states the window, the unit and the trial count", () => {
    const { settings } = buildForecastReport(reportInput(), null);
    expect(settings).toEqual({
      historyWindowWorkingDays: 60, unit: "tasks", trials: 10000, currency: "EUR", planEnd: PLAN_END, today: TODAY,
    });
  });

  it("reports P-dates, on-time chance, joined milestones and cost for a forecast", () => {
    const col = forecastColumn(buildForecastReport(reportInput(), null).asIs);
    expect(col.p50).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(col.p80 >= col.p50).toBe(true);
    expect(col.chanceOnTime).not.toBeNull();
    expect(col.milestones.map((m) => [m.id, m.name, m.date])).toEqual([[1, "Beta", "2026-11-20"], [2, "Launch", "2027-01-29"]]);
    expect(col.cost).toMatchObject({ chanceOverBudget: expect.any(Number) });
    expect(typeof (col.cost as { p80: unknown }).p80).toBe("number");
  });

  it("an overdue milestone appears with its state and no chance", () => {
    const overdue: Milestone = { id: 3, name: "Gone", date: "2026-10-01", linkedTaskIds: OPEN.slice(35, 40).map((x) => x.id) };
    const col = forecastColumn(buildForecastReport(reportInput({ milestones: [...MILESTONES, overdue] }), null).asIs);
    expect(col.milestones.find((m) => m.id === 3)).toEqual({ id: 3, name: "Gone", date: "2026-10-01", state: "overdue" });
    expect(col.milestones.find((m) => m.id === 1)).toHaveProperty("chance");
  });

  it("reports the window exactly as run", () => {
    expect(buildForecastReport(reportInput({ window: 30 }), null).settings.historyWindowWorkingDays).toBe(30);
    expect(buildForecastReport(reportInput({ window: "all" }), null).settings.historyWindowWorkingDays).toBe("all");
  });

  it("cost is null when the cost switch is off", () => {
    expect(forecastColumn(buildForecastReport(reportInput({ costOn: false }), null).asIs).cost).toBeNull();
  });

  it("cost passes an unavailable reason through", () => {
    const flat = facts(() => 0, 40_000, 100_000);
    const col = forecastColumn(buildForecastReport(reportInput({ budgetFacts: { eur: flat, hours: FACTS.hours } }), null).asIs);
    expect(col.cost).toEqual({ unavailable: "spend-history" });
  });

  it("below the floor every column is insufficient and the reason names the short part", () => {
    const tasks = [...historyTasks(HISTORY.slice(-5)), ...OPEN];
    const report = buildForecastReport(reportInput({ tasks }, [scenario(1, [availability(150)])]), [availability(150)]);
    expect(report.asIs.status).toBe("insufficient");
    expect(report.scenarios[0].result).toEqual(report.asIs);
    expect(report.whatIf?.result).toEqual(report.asIs);
    if (report.asIs.status !== "insufficient") return;
    const { finished, neededFinished, days, neededDays, reason } = report.asIs;
    expect(days).toBeLessThan(neededDays);
    expect(reason).toBe(
      finished < neededFinished
        ? `Not enough history: ${finished} of ${neededFinished} finished tasks and ${days} of ${neededDays} working days in the window.`
        : `Not enough history: ${days} of ${neededDays} working days in the window.`,
    );
    expect(report.settings.trials).toBe(10000);
    // ★ Not "beyond": that means past the horizon, and below the floor there is no P80 to compare.
    expect(report.weeklyChange).toBeNull();
    // CONTROL: a forecast reports a change (pending, with no week-old history), so null is the floor's alone.
    expect(buildForecastReport(reportInput(), null).weeklyChange).toMatchObject({ kind: "pending" });
  });

  it("an addPeople placeholder row carries its sizing; a team member is inert", () => {
    const placeholder: ScenarioChange = {
      kind: "addPeople", who: { label: "Contractor", count: 1, hoursPerWeek: 40, rate: 90, currency: "EUR" },
      from: TODAY, until: "", rampWeeks: 4,
    };
    const report = buildForecastReport(
      reportInput({}, [scenario(1, [placeholder]), scenario(2, [addPerson(OLA)])]), null,
    );
    expect(report.scenarios[0].rows[0]).toMatchObject({
      index: 0, kind: "addPeople", sizing: { name: "Contractor", weeklyHours: 40, ratePerHour: 90, rateNote: "ok" },
    });
    expect(report.scenarios[1].rows[0]).toEqual({ index: 0, kind: "addPeople", inert: "on-team" });
  });

  it("maps availability and scope rows one to one", () => {
    const changes: ScenarioChange[] = [availability(120), { kind: "scope", tasks: 2, on: TODAY, milestoneId: 99 }];
    const report = buildForecastReport(reportInput({}, [scenario(1, changes)]), null);
    expect(report.scenarios[0].rows).toEqual([
      { index: 0, kind: "availability", ended: false },
      { index: 1, kind: "scope", milestoneGone: true },
    ]);
  });

  it("expectedToken is the scenario's entity token", () => {
    const s = scenario(3, [availability(120)]);
    expect(buildForecastReport(reportInput({}, [s]), null).scenarios[0].expectedToken).toBe(entityToken("forecastScenario", s));
  });

  it("a precomputed comparison gives the same report as one built inside", () => {
    const inp = reportInput({}, [scenario(1, [availability(130)])]);
    const comparison = computeScenarioComparison(inp.run, inp.scenarios);
    expect(buildForecastReport(inp, [availability(90)], comparison)).toEqual(buildForecastReport(inp, [availability(90)]));
  });

  it("is JSON-safe", () => {
    const report = buildForecastReport(reportInput({}, [scenario(1, [availability(120), addPerson(PER)])]), [availability(90)]);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("buildForecastReport — target, what it would take, proposal and P80 history (§502 part 4)", () => {
  // Gamma: Beta's 15 tasks due two weeks sooner, about a 68 % chance — below the 80 target, above even odds.
  const GAMMA: Milestone = { id: 9, name: "Gamma", date: "2026-11-05", linkedTaskIds: OPEN.slice(0, 15).map((t) => t.id) };
  const WITH_GAMMA = { milestones: [...MILESTONES, GAMMA] };

  it("reports the stored target confidence, and 80 when none is stored", () => {
    expect(buildForecastReport(reportInput(), null).targetConfidence).toBe(80);
    expect(buildForecastReport(reportInput({}, [], withTargetConfidence(undefined, 95)), null).targetConfidence).toBe(95);
  });

  it("lists each below-target milestone with the lever engine's own answer, and the plan end's", () => {
    const inp = reportInput(WITH_GAMMA);
    const whatItTakes = takesOf(buildForecastReport(inp, null));
    const { asIs, context } = computeScenarioComparison(inp.run, []);
    // Beta and Launch are on target, so only Gamma is listed.
    expect(whatItTakes.milestones.map((m) => [m.id, m.name])).toEqual([[9, "Gamma"]]);
    const engine = whatItTakesSync(inp.run, context, { kind: "milestone", id: 9 }, 80, asIs);
    expect(engine?.people).toMatchObject({ state: "reaches", n: 1 });
    expect(whatItTakes.milestones[0].take).toEqual(engine);
    expect(whatItTakes.planEnd).toEqual(whatItTakesSync(inp.run, context, { kind: "planEnd" }, 80, asIs));
    expect(whatItTakes.planEnd?.tasks).toMatchObject({ state: "reaches" });
  });

  it("measures below target against the stored target, not a fixed 80", () => {
    const report = buildForecastReport(reportInput(WITH_GAMMA, [], withTargetConfidence(undefined, 50)), null);
    expect(takesOf(report).milestones).toEqual([]);
    expect(takesOf(report).planEnd).toMatchObject({ people: { state: "on-target" }, tasks: { state: "on-target" } });
  });

  it("below the history floor, what it would take is empty (no plan-end take, no milestone)", () => {
    const tasks = [...historyTasks(HISTORY.slice(-5)), ...OPEN];
    const report = buildForecastReport(reportInput({ tasks, ...WITH_GAMMA }, [], withTargetConfidence(undefined, 95)), null);
    expect(report.asIs.status).toBe("insufficient");
    expect(report.whatItTakes).toEqual({ planEnd: null, milestones: [], notSearched: [] });
    expect(report.targetConfidence).toBe(95);
  });

  it(`searches at most ${WHAT_IT_TAKES_MILESTONE_CAP} below-target milestones, worst first, and names the rest as not searched (§502 gate 1)`, () => {
    // Seven milestones on Beta's 15 tasks, all due before Gamma, so all seven are below the 80 target.
    const dates = ["2026-10-21", "2026-10-23", "2026-10-27", "2026-10-29", "2026-11-02", "2026-11-03", "2026-11-04"];
    const many: Milestone[] = dates.map((date, i) => ({ id: 20 + i, name: `M${i}`, date, linkedTaskIds: OPEN.slice(0, 15).map((t) => t.id) }));
    const report = buildForecastReport(reportInput({ milestones: [...MILESTONES, ...many] }), null);
    const takes = takesOf(report);
    expect(WHAT_IT_TAKES_MILESTONE_CAP).toBe(5);
    expect(takes.milestones).toHaveLength(5);
    expect(takes.notSearched).toHaveLength(2);
    const searched = takes.milestones.map((m) => m.id);
    const rest = takes.notSearched.map((m) => m.id);
    expect([...searched, ...rest].sort((a, b) => a - b)).toEqual(many.map((m) => m.id));
    // Worst first: no milestone left unsearched has a lower chance than one that was searched.
    const chanceOf = new Map(forecastColumn(report.asIs).milestones.flatMap((m) => ("chance" in m ? [[m.id, m.chance] as const] : [])));
    const worstSearched = Math.max(...searched.map((id) => chanceOf.get(id) ?? NaN));
    for (const id of rest) expect(chanceOf.get(id)).toBeGreaterThanOrEqual(worstSearched);
    expect(takes.notSearched[0]).toEqual({ id: rest[0], name: many.find((m) => m.id === rest[0])?.name });
  });

  it("names the proposal; a stale id, or none, reads as no proposal", () => {
    const scenarios = [scenario(1, [availability(120)]), scenario(2, [availability(90)])];
    expect(buildForecastReport(reportInput({}, scenarios, withProposal(undefined, 2)), null).proposal)
      .toEqual({ id: 2, name: "S2" });
    expect(buildForecastReport(reportInput({}, scenarios, withProposal(undefined, 7)), null).proposal).toBeNull();
    expect(buildForecastReport(reportInput({}, scenarios), null).proposal).toBeNull();
  });

  it("carries the last 26 recorded P80s, oldest first, date and P80 only", () => {
    const days = workingDaysBefore(TODAY, 30, NONE); // 30 working days before today, oldest first
    const history: ForecastHistoryEntry[] = days.map((date, i) => ({
      date, p50: "2026-12-01", p80: i === 29 ? null : `2027-01-${String((i % 28) + 1).padStart(2, "0")}`, p95: null,
      chanceOnTime: 0.5,
    }));
    const { p80History } = buildForecastReport({ ...reportInput(), history }, null);
    expect(p80History).toHaveLength(26);
    expect(p80History).toEqual(history.slice(4).map(({ date, p80 }) => ({ date, p80 })));
    expect(p80History[25]).toEqual({ date: days[29], p80: null });
  });

  it("a call with a whatIf omits what it would take, keeps the other three reads; a plain call carries it", () => {
    const scenarios = [scenario(1, [availability(120)])];
    const history: ForecastHistoryEntry[] = [{ date: "2026-10-13", p50: null, p80: "2027-01-04", p95: null, chanceOnTime: 0.5 }];
    const inp = { ...reportInput(WITH_GAMMA, scenarios, withProposal(withTargetConfidence(undefined, 95), 1)), history };
    const drafted = buildForecastReport(inp, [availability(90)]);
    expect(drafted.whatItTakes).toEqual({ omitted: "whatIf" });
    expect(drafted.whatIf).toBeDefined();
    expect(drafted.targetConfidence).toBe(95);
    expect(drafted.proposal).toEqual({ id: 1, name: "S1" });
    expect(drafted.p80History).toEqual([{ date: "2026-10-13", p80: "2027-01-04" }]);
    // CONTROL: the same input without the draft searches, and lists Gamma.
    const plain = buildForecastReport(inp, null);
    expect(takesOf(plain).milestones.map((m) => m.id)).toEqual([9]);
    expect({ ...plain, whatItTakes: undefined }).toEqual({ ...drafted, whatItTakes: undefined, whatIf: undefined });
  });

  it("is JSON-safe with every new part filled", () => {
    const scenarios = [scenario(1, [availability(120)])];
    const report = buildForecastReport(reportInput(WITH_GAMMA, scenarios, withProposal(undefined, 1)), null);
    expect(takesOf(report).milestones).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("scenarioValidationContext", () => {
  it("built from a given comparison context, equals the one it builds itself", () => {
    const inp = reportInput();
    const { context } = computeScenarioComparison(inp.run, []);
    const ctx = scenarioValidationContext(inp, context);
    expect(ctx).toEqual(scenarioValidationContext(inp));
    expect(ctx.onTeam).toBe(context.onTeam);
  });

  it("takes onTeam from the As-is run and the lists from the run", () => {
    const ctx = scenarioValidationContext(reportInput());
    expect(ctx.onTeam.has(OLA)).toBe(true);
    expect(ctx.onTeam.has(PER)).toBe(false);
    expect(ctx.milestones).toBe(MILESTONES);
    expect(ctx.resources).toBe(DIRECTORY.resources);
  });
});
