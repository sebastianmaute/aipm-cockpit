// src/app/ai-dashboard-snapshot.ts
//
// Pure, i18n-free projection of the dashboard render model + budget rollup into
// the compact payload the `get_dashboard_snapshot` chat tool returns. Curated on
// purpose: DashboardModel carries whole Task/ChangeItem arrays and a five-array
// burndown, and this payload stays in the chat transcript for the rest of the
// turn — entity lists are the other tools' job.
//
// HONESTY RULE: never emit a number the panel would refuse to show. When the
// cost basis is unsound (costIsKnowable === false) the money figures are null
// and the reason rides costUnknownReason — never 0, which reads as "free" and
// makes margin look perfect.
import { type DashboardModel, type SubStatus, hasNoActiveScope } from "./dashboard";
import { type CostUnknownReason, type ProjectReport, costIsKnowable } from "./budget-report";
import { type Health } from "./health";
import type { BudgetForecast } from "./budget-forecast";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { BudgetHistoryEntry, ProjectBac } from "./budget-history";
import type { RateMix, RateMixRow } from "./budget-rate-mix";

/** The latest budget changes the snapshot carries (§545). The recorded series
 *  is uncapped, and this payload stays in the chat transcript for the rest of
 *  the turn; `changeCount` says how many there are in all. */
export const SNAPSHOT_BUDGET_CHANGES = 20;

export interface DashboardSnapshotBudget {
  budgetHours: number;
  actualHours: number;
  budgetValue: number;
  consumedValue: number;
  /** null when the cost basis is unsound — see costUnknownReason. */
  cost: number | null;
  revenue: number | null;
  contributionMarginPct: number | null;
  /** EVM earned value; null unless every budgeted bucket is scored. */
  earnedValue: number | null;
  /** EV / AC; null when earnedValue is null or actual cost is 0. */
  costPerformanceIndex: number | null;
  costUnknownReason: CostUnknownReason | null;
}

/** The budget forecast the Budget report and the dashboard show (§545). The
 *  `eur` and `hours` forecasts are the engine's own output, unchanged. The
 *  earned-value history series is left out: it is a chart series, long, and
 *  nothing a model needs to state a forecast. */
export interface DashboardSnapshotForecast {
  eur: BudgetForecast;
  hours: BudgetForecast;
  /** Booked versus planned rate, summarised by the role or discipline driving
   *  the difference; the per-row table is the Budget report's job. */
  rateMix: (Pick<RateMix, "triggered" | "direction" | "severity" | "drift" | "bookedRate" | "plannedRate" | "excludedActualHours"> & {
    driver: Pick<RateMixRow, "kind" | "name" | "plannedRate" | "plannedShare" | "bookedShare" | "difference"> | null;
  }) | null;
  /** null before the first recorded budget change. */
  budgetHistory: {
    baselineDate: string;
    baseline: ProjectBac;
    attributed: ProjectBac;
    changeCount: number;
    /** The latest `SNAPSHOT_BUDGET_CHANGES`, oldest first. */
    recentChanges: readonly BudgetHistoryEntry[];
  } | null;
}

function snapshotForecast(bundle: ForecastBundle | null | undefined): DashboardSnapshotForecast | null {
  if (!bundle) return null;
  const { mix, history } = bundle;
  return {
    eur: bundle.eur,
    hours: bundle.hours,
    rateMix: mix === null ? null : {
      triggered: mix.triggered, direction: mix.direction, severity: mix.severity,
      drift: mix.drift, bookedRate: mix.bookedRate, plannedRate: mix.plannedRate,
      excludedActualHours: mix.excludedActualHours,
      driver: mix.driver === null ? null : {
        kind: mix.driver.kind, name: mix.driver.name, plannedRate: mix.driver.plannedRate,
        plannedShare: mix.driver.plannedShare, bookedShare: mix.driver.bookedShare, difference: mix.driver.difference,
      },
    },
    budgetHistory: history === null ? null : {
      baselineDate: history.baselineDate,
      baseline: history.baseline,
      attributed: history.attributed,
      changeCount: history.changes.length,
      recentChanges: history.changes.slice(-SNAPSHOT_BUDGET_CHANGES),
    },
  };
}

export interface DashboardSnapshot {
  today: string;
  rag: {
    overall: Health;
    schedule: Health;
    budget: SubStatus;
    scope: SubStatus;
    overridden: { overall: boolean; schedule: boolean; budget: boolean; scope: boolean };
  };
  /** `total` is every task; `inScope` is the denominator `percent` divides by
   *  (total minus cancelled). BOTH are emitted: a model asked "how many tasks
   *  are there" wants `total`, and without `inScope` the triple can look like an
   *  arithmetic error (5 done of 10 total, 100% complete).
   *  `noActiveScope` is true when the project HAS tasks but none are in scope,
   *  so the model is not handed a bare 0 that reads as "not started yet". */
  progress: { total: number; inScope: number; completed: number; percent: number; noActiveScope: boolean };
  /** TASK-EFFORT earned value, in HOURS, from task estimates (`evm.ts`). Its
   *  `spi` / `cpi` are effort indices — not the budget's money CPI
   *  (`budget.costPerformanceIndex`) and not the forecast's efficiency
   *  indices. The keys keep their names because scheduled-job prompts read them
   *  (§545); the tool description says what they measure. */
  evm: {
    pv: number;
    ev: number;
    ac: number;
    spi: number | null;
    cpi: number | null;
    coverage: { withEstimate: number; total: number };
  };
  /** null when the budget module is off. */
  budget: DashboardSnapshotBudget | null;
  /** null when the dashboard has no forecast (no budget, or no burndown yet). */
  forecast: DashboardSnapshotForecast | null;
  counts: {
    overdueTasks: number;
    dueSoonTasks: number;
    openRaid: number;
    overdueMilestones: number;
    atRiskMilestones: number;
    changes: { pending: number; approved: number; implemented: number; total: number };
  };
}

/** Project the live dashboard model + budget rollup into the tool payload. */
export function buildDashboardSnapshot(
  model: DashboardModel,
  project: ProjectReport | null,
  today: string,
): DashboardSnapshot {
  const knowable = project !== null && costIsKnowable(project);
  return {
    today,
    rag: {
      overall: model.overall.effective,
      schedule: model.schedule.effective,
      budget: model.budget.effective,
      scope: model.scope.effective,
      overridden: {
        overall: model.overall.overridden,
        schedule: model.schedule.overridden,
        budget: model.budget.overridden,
        scope: model.scope.overridden,
      },
    },
    progress: {
      total: model.progress.total,
      inScope: model.progress.inScope,
      completed: model.progress.completed,
      percent: model.progress.percent,
      // ★ Without this the model is handed a bare 0 for an all-cancelled
      //   project and can restate it as "0% complete" — the misreading the UI
      //   already stopped showing (open-followups §64). `inScope: 0` alone does
      //   not carry it: an empty project has that too and must stay at 0%.
      noActiveScope: hasNoActiveScope(model.progress),
    },
    evm: {
      pv: model.evm.pv,
      ev: model.evm.ev,
      ac: model.evm.ac,
      spi: model.evm.spi,
      cpi: model.evm.cpi,
      coverage: {
        withEstimate: model.evm.coverage.withEstimate,
        total: model.evm.coverage.total,
      },
    },
    budget:
      project === null
        ? null
        : {
            budgetHours: project.budgetHours,
            actualHours: project.actualHours,
            budgetValue: project.budgetValue,
            consumedValue: project.consumedValue,
            cost: knowable ? project.cost : null,
            revenue: knowable ? project.revenue : null,
            contributionMarginPct: knowable ? project.contributionMargin.percent : null,
            // Deliberately NOT gated on `knowable`: these two already self-null
            // inside computeBudgetReport via its own independent earned-value
            // check (see ProjectReport.costPerformanceIndex), and in a
            // mixed-bucket case can legitimately be non-null even when the
            // project-level costUnknownReason is set — matching what the
            // budget panel's internal-cost-index tile itself shows. Adding the
            // gate here would make this payload diverge from the panel.
            earnedValue: project.earnedValue,
            costPerformanceIndex: project.costPerformanceIndex,
            costUnknownReason: project.costUnknownReason,
          },
    forecast: snapshotForecast(model.forecastBundle),
    counts: {
      overdueTasks: model.overdue.length,
      dueSoonTasks: model.dueSoon.length,
      openRaid: model.openRaidCount,
      overdueMilestones: model.overdueMilestones.length,
      atRiskMilestones: model.atRiskMilestones.length,
      changes: {
        pending: model.changes.pending,
        approved: model.changes.approved,
        implemented: model.changes.implemented,
        total: model.changes.total,
      },
    },
  };
}
