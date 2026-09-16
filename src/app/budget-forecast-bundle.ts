/**
 * Forecast bundle (MR 3 addendum §3). One call builds the € and hours
 * forecasts, the rate mix and the earned-value history from the inputs the
 * Budget report and the dashboard already hold. A separate module because
 * `budget-rate-mix.ts` imports from `budget-forecast.ts` (plan Ruling 2 — no
 * import cycle). `budget-ev-history.ts` does not: it imports
 * `budget-earned-value`, `task-status`, `budget-report` and `types` only.
 */
import { computeBudgetForecastsByUnit, type BudgetForecast, type BudgetForecastInput } from "./budget-forecast";
import { actualPointDates } from "./budget-burndown";
import { computeEvHistory, type EvHistory } from "./budget-ev-history";
import { computeRateMix, type RateMix } from "./budget-rate-mix";
import type { Absence, Discipline, Grade, Resource, Task } from "./types";

export type ForecastBundle = { eur: BudgetForecast; hours: BudgetForecast; mix: RateMix | null; evHistory: EvHistory };
export type ForecastBundleInput = BudgetForecastInput & {
  tasks: readonly Pick<Task, "id" | "status" | "completedDate">[];
  resources: readonly Resource[]; workdayHours: number; absences: readonly Absence[];
  disciplines: readonly Discipline[]; grades: readonly Grade[];
};

export function computeForecastBundle(input: ForecastBundleInput): ForecastBundle {
  const { eur, hours } = computeBudgetForecastsByUnit(input);
  const mix = computeRateMix({
    buckets: input.buckets, roles: input.roles, disciplines: input.disciplines, grades: input.grades,
    plan: input.plan, resources: input.resources, workdayHours: input.workdayHours,
    holidaySet: input.holidaySet, absences: input.absences, eur, hours,
  });
  const evHistory = computeEvHistory({
    report: input.report, buckets: input.buckets, tasks: input.tasks,
    dates: actualPointDates(input.burndown, input.today), today: input.today,
  });
  return { eur, hours, mix, evHistory };
}
