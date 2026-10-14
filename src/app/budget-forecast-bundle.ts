/**
 * Forecast bundle (MR 3 addendum §3). One call builds the € and hours
 * forecasts, the rate mix and the earned-value history from the inputs the
 * Budget report and the dashboard already hold. A separate module because
 * `budget-rate-mix.ts` imports from `budget-forecast.ts` (plan Ruling 2 — no
 * import cycle). `budget-ev-history.ts` does not: it imports
 * `budget-earned-value`, `task-status`, `budget-report`, `types` and
 * `snapshot` (type-only, for `SnapshotRecord`).
 */
import { computeBudgetForecastsByUnit, type BudgetForecast, type BudgetForecastInput } from "./budget-forecast";
import { actualPointDates } from "./budget-burndown";
import { computeEvHistory, type BucketProgressRecord, type EvHistory } from "./budget-ev-history";
import { computeRateMix, type RateMix } from "./budget-rate-mix";
import { summarizeBudgetHistory, type BudgetHistoryEntry, type BudgetHistorySummary } from "./budget-history";
import { rebaseBudgetHistory, type BaselineEntry } from "./baseline-currency";
import type { Absence, BudgetCurrency, Discipline, Grade, Resource, Task } from "./types";

export type ForecastBundle = {
  eur: BudgetForecast; hours: BudgetForecast; mix: RateMix | null; evHistory: EvHistory;
  /** The recorded budget-at-completion series (`budget-history.ts`),
   *  summarized — or null before the first recorded budget change (the
   *  budget commit boundary is the only writer of that series). */
  history: BudgetHistorySummary | null;
  /** The baseline every money figure above is in (`plan.currency`, §476), so a
   *  surface formats the bundle without being handed the plan separately. */
  currency: BudgetCurrency;
};
export type ForecastBundleInput = BudgetForecastInput & {
  tasks: readonly Pick<Task, "id" | "status" | "completedDate">[];
  resources: readonly Resource[]; workdayHours: number; absences: readonly Absence[];
  disciplines: readonly Discipline[]; grades: readonly Grade[];
  /** Recorded percents of hand-entered buckets, from `bucketProgressSeries`. */
  progress: ReadonlyMap<number, readonly BucketProgressRecord[]>;
  /** The project's recorded budget-at-completion history (`useWorkspace().budgetHistory`). */
  budgetHistory: readonly BudgetHistoryEntry[];
  /** The project's baseline-currency switches (`useWorkspace().baselineHistory`, §476).
   *  The recorded budget history stays in the currency it was captured in and
   *  is rebased into the current baseline here, before it is summarized. */
  baselineHistory: readonly BaselineEntry[];
};

export function computeForecastBundle(input: ForecastBundleInput): ForecastBundle {
  const { eur, hours } = computeBudgetForecastsByUnit(input);
  const mix = computeRateMix({
    buckets: input.buckets, roles: input.roles, disciplines: input.disciplines, grades: input.grades,
    plan: input.plan, resources: input.resources, workdayHours: input.workdayHours,
    holidaySet: input.holidaySet, absences: input.absences, eur, hours, fxRates: input.fxRates,
  });
  const evHistory = computeEvHistory({
    report: input.report, buckets: input.buckets, tasks: input.tasks,
    dates: actualPointDates(input.burndown, input.today), today: input.today,
    progress: input.progress,
  });
  const history = summarizeBudgetHistory(rebaseBudgetHistory(input.budgetHistory, input.baselineHistory));
  return { eur, hours, mix, evHistory, history, currency: input.plan.currency };
}
