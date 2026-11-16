// The forecast scenario fixture shared by `forecast-ai-report.test.ts` and `use-forecast-tools.test.tsx`: a 60-day
// history, 50 open tasks, two milestones, a directory with one person on the team (Ola) and one not (Per), and
// budget facts with booked hours, so an added directory person is sized (not inert).
import type { ForecastFacts, ForecastFactsByUnit } from "../app/budget-forecast";
import type { ScenarioDirectory } from "../app/forecast-added-people";
import type { ScenarioRunInput } from "../app/forecast-scenario-compare";
import type { ForecastScenario, ScenarioChange } from "../app/forecast-scenarios";
import type { Milestone, Resource, Role, Shift, Task } from "../app/types";
import { workingDaysBefore } from "../app/working-days";
export const TODAY = "2026-10-14"; // a Wednesday
export const NONE: ReadonlySet<string> = new Set();
export const PLAN_END = "2026-12-23"; // about 50 working days out, near the As-is median
/** The 60-day history window, oldest first; HISTORY[59] is today. */
export const HISTORY = [...workingDaysBefore(TODAY, 59, NONE), TODAY];
export const PATTERN = [1, 2, 0]; // completions per day: steady 1 a day on average, the first day non-zero (no R14 cut)
export const OLA = 7; // completes a task 40 working days ago: on the team at window 60, not at window 30
export const PER = 8; // never on the team
export const OPEN_ESTIMATES = [60, 120, 180, 240]; // over 50 tasks: median 120, mean 147.6

export function done(id: number, completedDate: string, assignee = ""): Task {
  return {
    id, taskName: `d${id}`, assignee, assigneeEmail: "", status: "Done", completedDate, originalEstimateMinutes: 120,
  } as Task;
}
export function open(id: number, i: number): Task {
  return {
    id, taskName: `o${id}`, assignee: "", assigneeEmail: "", status: "To Do",
    originalEstimateMinutes: OPEN_ESTIMATES[i % OPEN_ESTIMATES.length],
  } as Task;
}

export function historyTasks(days: readonly string[]): Task[] {
  const out: Task[] = [];
  days.forEach((date, i) => {
    for (let k = 0; k < PATTERN[i % PATTERN.length]; k += 1) {
      const fortyAgo = date === HISTORY[59 - 40] && k === 0;
      out.push(done(out.length + 1, date, fortyAgo ? "Ola Nord" : ""));
    }
  });
  return out;
}
export const OPEN = Array.from({ length: 50 }, (_, i) => open(1001 + i, i));
export const TASKS: readonly Task[] = [...historyTasks(HISTORY), ...OPEN];
export const MILESTONES: readonly Milestone[] = [
  { id: 1, name: "Beta", date: "2026-11-20", linkedTaskIds: OPEN.slice(0, 15).map((t) => t.id) },
  { id: 2, name: "Launch", date: "2027-01-29", linkedTaskIds: OPEN.slice(15, 35).map((t) => t.id) },
];

export function resource(id: number, firstName: string, lastName: string): Resource {
  return { id, firstName, lastName, roleId: 1, utilizationMode: "percent", utilization: {} };
}
export const ROLE: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 80, externalRate: 120 };
export const SHIFT: Shift = { id: 1, assignee: "", resourceId: PER, hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] };
export const DIRECTORY: ScenarioDirectory = {
  resources: [resource(OLA, "Ola", "Nord"), resource(PER, "Per", "Sand")], roles: [ROLE], shifts: [SHIFT], absences: [],
  budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};

export const HOURS = [12, 16, 20]; // 16 h a day on average
export const TEAM_RATE = 50; // the team books 50 per hour; an added person at the role's 80 costs more per delivered task
export function facts(value: (i: number) => number, ac: number, bac: number): ForecastFacts {
  return {
    bac, ac, ev: null, pv: 0, bucketsMissingPercent: [],
    dated: HISTORY.map((date, i) => ({ date, bookedFrom: date, value: value(i), spread: false })),
    planEnd: PLAN_END, today: TODAY, holidaySet: NONE, hasFixedPrice: false,
  };
}
export const FACTS: ForecastFactsByUnit = {
  eur: facts((i) => HOURS[i % 3] * TEAM_RATE, 40_000, 100_000),
  hours: facts((i) => HOURS[i % 3], 800, 2_000),
};

export function input(over: Partial<ScenarioRunInput> = {}): ScenarioRunInput {
  return {
    tasks: TASKS, milestones: MILESTONES, today: TODAY, holidaySet: NONE, window: 60, unit: "tasks", planEnd: PLAN_END,
    directory: DIRECTORY, budgetFacts: FACTS, costOn: true, ...over,
  };
}
export function scenario(id: number, changes: readonly ScenarioChange[]): ForecastScenario {
  return { id, name: `S${id}`, changes };
}
export const availability = (percent: number): ScenarioChange => ({ kind: "availability", percent, from: TODAY, until: "" });
export const addPerson = (resourceId: number): ScenarioChange =>
  ({ kind: "addPeople", who: { resourceId, hoursPerWeek: 40 }, from: TODAY, until: "", rampWeeks: 4 });
