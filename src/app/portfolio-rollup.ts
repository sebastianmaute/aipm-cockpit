// src/app/portfolio-rollup.ts
// Pure, i18n-free cross-project health rollup engine.
// No React / I/O — safe to import from unit tests and the hook alike.

import type { Health } from "./health";
import type { SubStatus } from "./dashboard";

/** Bucketed milestone health for a single project, derived from
 *  DashboardModel.overdueMilestones / atRiskMilestones / dueSoonMilestones. */
export type MilestoneHealthBucket =
  | "overdue"
  | "at_risk"
  | "due_soon"
  | "on_track"
  | "no_milestones";

/** Per-project row in the portfolio health table. */
export type PortfolioRow = {
  id: string;
  name: string;
  /** Overall RAG — always present (computed from tasks). */
  overall: Health;
  /** Schedule RAG — always present. */
  schedule: Health;
  /** Budget RAG — null when no budgets are configured. */
  budget: SubStatus;
  /** Completion %, or null when the project HAS tasks but none in scope. An
   *  all-cancelled project's literal 0 reads as "not started yet" in a table
   *  scanned across projects, which is the misreading the dashboard already
   *  stopped showing (open-followups §64). */
  completionPercent: number | null;
  openRaidCount: number;
  milestoneHealth: MilestoneHealthBucket;
};

/** Aggregate KPIs derived from all portfolio rows. */
export type PortfolioAggregate = {
  projectCount: number;
  overallR: number;
  overallA: number;
  overallG: number;
  totalOpenRaid: number;
  /** Average completion % across the projects that HAVE a completion figure —
   *  a no-active-scope project is excluded from both sides of the average, not
   *  counted as 0. Falls back to 0 when none of them do. */
  avgCompletionPercent: number;
};

/**
 * Derive a milestone health bucket from the three DashboardModel milestone
 * arrays and the total milestone count for the project.
 */
export function deriveMilestoneHealthBucket(
  overdueCount: number,
  atRiskCount: number,
  dueSoonCount: number,
  totalMilestoneCount: number,
): MilestoneHealthBucket {
  if (totalMilestoneCount === 0) return "no_milestones";
  if (overdueCount > 0) return "overdue";
  if (atRiskCount > 0) return "at_risk";
  if (dueSoonCount > 0) return "due_soon";
  return "on_track";
}

/**
 * Aggregate a list of per-project rows into portfolio-level KPIs.
 * Pure — no side effects.
 */
export function aggregatePortfolio(rows: readonly PortfolioRow[]): PortfolioAggregate {
  if (rows.length === 0) {
    return {
      projectCount: 0,
      overallR: 0,
      overallA: 0,
      overallG: 0,
      totalOpenRaid: 0,
      avgCompletionPercent: 0,
    };
  }
  let overallR = 0;
  let overallA = 0;
  let overallG = 0;
  let totalOpenRaid = 0;
  let totalCompletion = 0;
  // ★ Counted separately from `rows.length` — the divisor must be the number of
  //   projects that actually contributed a figure, or a no-scope project pulls
  //   the average toward zero while contributing nothing to the numerator.
  let completionCount = 0;
  for (const row of rows) {
    if (row.overall === "R") overallR++;
    else if (row.overall === "A") overallA++;
    else overallG++;
    totalOpenRaid += row.openRaidCount;
    if (row.completionPercent !== null) {
      totalCompletion += row.completionPercent;
      completionCount += 1;
    }
  }
  return {
    projectCount: rows.length,
    overallR,
    overallA,
    overallG,
    totalOpenRaid,
    avgCompletionPercent:
      completionCount === 0 ? 0 : Math.round(totalCompletion / completionCount),
  };
}
