// §502 part 4 — a run input for the forecast decision tests, in the lever engine's fixture shape
// (forecast-levers.test.ts): a slow team, 12 open tasks, five milestones.
import type { ForecastFacts, ForecastFactsByUnit } from "../app/budget-forecast";
import type { ScenarioDirectory } from "../app/forecast-added-people";
import type { ScenarioRunInput } from "../app/forecast-scenario-compare";
import type { Milestone, Resource, Role, Task } from "../app/types";
import { workingDaysBefore } from "../app/working-days";

export const TODAY = "2026-10-14";
const NONE: ReadonlySet<string> = new Set();
export const PLAN_END = "2026-12-23";
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
export const OPEN: readonly Task[] = Array.from({ length: 12 }, (_, i) => open(1001 + i));
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

export function decisionInput(over: Partial<ScenarioRunInput> = {}): ScenarioRunInput {
  return {
    tasks: TASKS, milestones: MILESTONES, today: TODAY, holidaySet: NONE, window: 60, unit: "tasks", planEnd: PLAN_END,
    directory: DIRECTORY, budgetFacts: FACTS_BY_UNIT, costOn: false, ...over,
  };
}
