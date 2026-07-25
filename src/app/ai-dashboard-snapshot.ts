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
import { type DashboardModel, type SubStatus } from "./dashboard";
import { type CostUnknownReason, type ProjectReport, costIsKnowable } from "./budget-report";
import { type Health } from "./health";

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

export interface DashboardSnapshot {
  today: string;
  rag: {
    overall: Health;
    schedule: Health;
    budget: SubStatus;
    scope: SubStatus;
    overridden: { overall: boolean; schedule: boolean; budget: boolean; scope: boolean };
  };
  progress: { total: number; completed: number; percent: number };
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
      completed: model.progress.completed,
      percent: model.progress.percent,
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
            // budget panel's CPI tile itself shows. Adding the gate here would
            // make this payload diverge from the panel.
            earnedValue: project.earnedValue,
            costPerformanceIndex: project.costPerformanceIndex,
            costUnknownReason: project.costUnknownReason,
          },
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
