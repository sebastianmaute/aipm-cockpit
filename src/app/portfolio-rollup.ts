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
  completionPercent: number;
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
  /** Average completion % across all projects (0 when projectCount === 0). */
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
  for (const row of rows) {
    if (row.overall === "R") overallR++;
    else if (row.overall === "A") overallA++;
    else overallG++;
    totalOpenRaid += row.openRaidCount;
    totalCompletion += row.completionPercent;
  }
  return {
    projectCount: rows.length,
    overallR,
    overallA,
    overallG,
    totalOpenRaid,
    avgCompletionPercent: Math.round(totalCompletion / rows.length),
  };
}
