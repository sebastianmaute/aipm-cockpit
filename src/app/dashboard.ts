// Pure aggregation for the project-health dashboard. No React, no I/O — the
// single testable unit behind dashboard-panel.tsx.

import { computeGroupHealth, type Health } from "./health";
import { computeBudgetReport, type CciValue, type ProjectReport } from "./budget-report";
import { isTerminalStatus, riskSeverityFromMatrix } from "./raid";
import { workdaysUntil } from "./due-dates";
import { partitionMilestones } from "./milestones";
import { computeEvm, projectBlendedInternalRate, type EvmMetrics } from "./evm";
import { computeBurndownSeries, type BurndownSeries } from "./budget-burndown";
import { computeScopeStatus, countByStatus, isPendingChange, selectTopChanges, SCOPE_PENDING_RED } from "./change-log";
import type {
  Absence, BudgetBucket, ChangeItem, Milestone, ProjectStatus, RaidItem, RaidSeverity,
  Resource, ResourcePlan, Role, Task,
} from "./types";
import type { ActivityEntry } from "./activity-log";

export type SubStatus = Health | null;

export const DASHBOARD_DEFAULTS = {
  dueSoonWorkdays: 3,
  topRaid: 5,
  recentActivity: 8,
  budgetAmberRatio: 0.9,
} as const;

/** EVM index (SPI/CPI) thresholds for the dashboard RAGs: an index of 1.0 is
 *  on plan, lower means behind schedule / over cost. Below RED is serious. */
export const EVM_INDEX_AMBER = 0.9;
export const EVM_INDEX_RED = 0.8;

/** Health contribution from an EVM index (SPI or CPI): Red below 0.8, Amber
 *  below 0.9, else null (healthy or undefined ⇒ no contribution). Callers pass
 *  a finite positive index or null (computeEvm yields null, never NaN, for a
 *  zero divisor); a non-finite value falls through to null (healthy). */
export function evmIndexHealth(index: number | null): "R" | "A" | null {
  if (index === null) return null;
  if (index < EVM_INDEX_RED) return "R";
  if (index < EVM_INDEX_AMBER) return "A";
  return null;
}

const HEALTH_RANK: Record<Health, number> = { R: 3, A: 2, G: 1 };

/** Worst-of combine over health signals: returns the most severe present
 *  (R > A > G), or null when every signal is absent (null). */
function worstHealth(...signals: SubStatus[]): SubStatus {
  let best: SubStatus = null;
  let bestRank = 0;
  for (const s of signals) {
    if (s === null) continue;
    const rank = HEALTH_RANK[s];
    if (rank > bestRank) { bestRank = rank; best = s; }
  }
  return best;
}

export type DashboardProgress = {
  total: number;
  completed: number;
  percent: number;
  counts: Record<Health, number>;
};

/** % complete (completedDate-based) + R/A/G health counts from
 *  computeGroupHealth. Note: completed tasks are counted in BOTH `completed`
 *  and `counts.G` (computeGroupHealth colors a completed task Green), so
 *  `counts.G` includes done items, not just active on-track ones. */
export function computeDashboardProgress(
  tasks: readonly Task[],
  todayISO: string,
  holidaySet: ReadonlySet<string>,
): DashboardProgress {
  const counts = computeGroupHealth(tasks, todayISO, holidaySet).counts;
  const total = tasks.length;
  const completed = tasks.filter((t) => !!t.completedDate).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, percent, counts };
}

/** Date-driven schedule RAG: Red if any task is overdue, Amber if any is due
 *  within `dueSoonWorkdays` working days, else Green. Completed tasks ignored. */
export function computeScheduleStatus(
  tasks: readonly Task[],
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  dueSoonWorkdays: number = DASHBOARD_DEFAULTS.dueSoonWorkdays,
): Health {
  const hs = holidaySet instanceof Set ? holidaySet : new Set<string>(holidaySet);
  let overdue = 0;
  let dueSoon = 0;
  for (const t of tasks) {
    if (t.completedDate || !t.dueDate) continue;
    if (t.dueDate < todayISO) { overdue++; continue; }
    // workdaysUntil returns 0 for a same-day (or past) dueDate, so a task due
    // today counts as due-soon here (it already failed the overdue check above).
    if (workdaysUntil(t.dueDate, todayISO, hs) <= dueSoonWorkdays) dueSoon++;
  }
  return overdue > 0 ? "R" : dueSoon > 0 ? "A" : "G";
}

/** Budget RAG from the project budget report: Red if over budget, Amber at or
 *  above `amberRatio` consumption, else Green. null when no budget is set. */
export function computeBudgetStatus(
  project: ProjectReport | null,
  amberRatio: number = DASHBOARD_DEFAULTS.budgetAmberRatio,
): SubStatus {
  if (!project || project.budgetValue <= 0) return null;
  if (project.consumedValue > project.budgetValue) return "R";
  if (project.consumedValue / project.budgetValue >= amberRatio) return "A";
  return "G";
}

const SEVERITY_RANK: Record<RaidSeverity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

function effectiveSeverity(item: RaidItem): RaidSeverity | undefined {
  if (item.severity) return item.severity;
  if (item.category === "R" && item.probability && item.impact) {
    return riskSeverityFromMatrix(item.probability, item.impact);
  }
  return undefined;
}

/** Open RAID items, sorted by severity (Critical->Low, unknown last), tie-broken
 *  by most-recently-raised first, then id, capped at `limit`. */
export function selectTopRaid(
  raid: readonly RaidItem[],
  limit: number = DASHBOARD_DEFAULTS.topRaid,
): RaidItem[] {
  return raid
    .filter((r) => !isTerminalStatus(r.status, r.category))
    .map((r) => {
      const sev = effectiveSeverity(r);
      return { r, rank: sev ? SEVERITY_RANK[sev] : 0 };
    })
    .sort((a, b) => b.rank - a.rank || b.r.raisedDate.localeCompare(a.r.raisedDate) || a.r.id - b.r.id)
    .slice(0, limit)
    .map((x) => x.r);
}

/** Non-completed tasks split into overdue (dueDate < today) and due-soon
 *  (within `dueSoonWorkdays`), each sorted by dueDate then id. */
export function partitionUpcoming(
  tasks: readonly Task[],
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  dueSoonWorkdays: number = DASHBOARD_DEFAULTS.dueSoonWorkdays,
): { overdue: Task[]; dueSoon: Task[] } {
  const hs = holidaySet instanceof Set ? holidaySet : new Set<string>(holidaySet);
  const overdue: Task[] = [];
  const dueSoon: Task[] = [];
  for (const t of tasks) {
    if (t.completedDate || !t.dueDate) continue;
    if (t.dueDate < todayISO) overdue.push(t);
    else if (workdaysUntil(t.dueDate, todayISO, hs) <= dueSoonWorkdays) dueSoon.push(t);
  }
  const byDue = (a: Task, b: Task) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id;
  overdue.sort(byDue);
  dueSoon.sort(byDue);
  return { overdue, dueSoon };
}

/** Last `limit` activity entries, newest first. Assumes `entries` is in
 *  chronological (oldest-first) order, which is the contract of
 *  loadActivityLog() / appendActivity (they append to the end). */
export function recentActivity(
  entries: readonly ActivityEntry[],
  limit: number = DASHBOARD_DEFAULTS.recentActivity,
): ActivityEntry[] {
  return entries.slice(-limit).reverse();
}

export type DashboardBurn = {
  budgetValue: number;
  consumedValue: number;
  budgetHours: number;
  actualHours: number;
  cost: number;
  costPerformance: CciValue;
  consumption: CciValue;
};

export type DashboardModel = {
  overall: { computed: Health; effective: Health; overridden: boolean };
  schedule: { computed: Health; effective: Health; overridden: boolean };
  // computed/effective are null when there is neither a budget nor CPI data.
  budget: { computed: SubStatus; effective: SubStatus; overridden: boolean };
  scope: { computed: SubStatus; effective: SubStatus; overridden: boolean };
  changes: { pending: number; approved: number; implemented: number; total: number };
  topChanges: ChangeItem[];
  progress: DashboardProgress;
  burn: DashboardBurn | null;
  burndown: BurndownSeries | null;
  evm: EvmMetrics;
  topRaid: RaidItem[];
  /** Total open (non-terminal) RAID items — the trend-arrow source, since
   *  `topRaid` is capped and can't reflect the true count. */
  openRaidCount: number;
  overdue: Task[];
  dueSoon: Task[];
  overdueMilestones: Milestone[];
  atRiskMilestones: Milestone[];
  dueSoonMilestones: Milestone[];
  recentActivity: ActivityEntry[];
  narrative: { text: string; updatedAt?: string };
};

/** The workspace entities `computeDashboard` reads. `milestones`/`changes` are
 *  optional here (default `[]` in `buildDashboardInput`) so callers needn't
 *  repeat `?? []`. Callers do their OWN gating (feature-module off, no-plan
 *  budgets, …) BEFORE building — pass an empty array for a gated-off entity. */
export interface DashboardEntities {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  budgets: readonly BudgetBucket[];
  plan: ResourcePlan;
  roles: readonly Role[];
  resources: readonly Resource[];
  absences: readonly Absence[];
  milestones?: readonly Milestone[];
  changes?: readonly ChangeItem[];
}

/** The non-entity context (today/zone-derived date, settings-derived scalars,
 *  live status + activity log) every dashboard computation needs. */
export interface DashboardContext {
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  status: ProjectStatus;
  activity: readonly ActivityEntry[];
  today: string;
}

/** Full `computeDashboard` input — DERIVED from entities + context so the field
 *  shape lives in exactly ONE place: add a field to `DashboardEntities` or
 *  `DashboardContext`, never here. `Required<>` makes the optional-on-input
 *  `milestones`/`changes` non-optional once assembled. */
export type DashboardInput = DashboardContext & Required<DashboardEntities>;

/** Assemble a `DashboardInput` from entities + context — applies the `?? []`
 *  defaults for `milestones`/`changes` so all four call sites (dashboard panel,
 *  task-manager snapshot + render model, portfolio rollup) share one assembler
 *  and can't drift on defaults. */
export function buildDashboardInput(e: DashboardEntities, ctx: DashboardContext): DashboardInput {
  return {
    tasks: e.tasks,
    raid: e.raid,
    budgets: e.budgets,
    plan: e.plan,
    roles: e.roles,
    resources: e.resources,
    absences: e.absences,
    milestones: e.milestones ?? [],
    changes: e.changes ?? [],
    workdayHours: ctx.workdayHours,
    holidaySet: ctx.holidaySet,
    status: ctx.status,
    activity: ctx.activity,
    today: ctx.today,
  };
}

export interface DashboardOptions {
  dueSoonWorkdays?: number;
  topRaid?: number;
  recentActivity?: number;
  budgetAmberRatio?: number;
}

export function computeDashboard(input: DashboardInput, opts: DashboardOptions = {}): DashboardModel {
  const dueSoonWorkdays = opts.dueSoonWorkdays ?? DASHBOARD_DEFAULTS.dueSoonWorkdays;
  const topRaidN = opts.topRaid ?? DASHBOARD_DEFAULTS.topRaid;
  const recentN = opts.recentActivity ?? DASHBOARD_DEFAULTS.recentActivity;
  const amberRatio = opts.budgetAmberRatio ?? DASHBOARD_DEFAULTS.budgetAmberRatio;
  const { status, today, holidaySet } = input;

  const overallComputed = computeGroupHealth(input.tasks, today, holidaySet).color;
  const tasksById = new Map(input.tasks.map((t) => [t.id, t] as const));
  const evm = computeEvm(input.tasks, today, { blendedRate: projectBlendedInternalRate(input.roles) });

  const taskSchedule = computeScheduleStatus(input.tasks, today, holidaySet, dueSoonWorkdays);
  const ms = partitionMilestones(input.milestones, tasksById, today, holidaySet, dueSoonWorkdays);
  const msContribution: "R" | "A" | null =
    ms.overdue.length > 0 ? "R" : ms.atRisk.length > 0 || ms.dueSoon.length > 0 ? "A" : null;
  // SPI feeds the Schedule RAG (worst-of with tasks + milestones). taskSchedule
  // is always non-null, so the `?? "G"` is a type-level coercion (SubStatus ->
  // Health), not a runtime fallback.
  const scheduleComputed: Health =
    worstHealth(taskSchedule, msContribution, evmIndexHealth(evm.spi)) ?? "G";

  const project: ProjectReport | null = input.budgets.length > 0
    ? computeBudgetReport(input.budgets, input.plan, input.roles, input.resources, input.workdayHours, holidaySet, input.absences).project
    : null;
  // CPI feeds the Budget RAG (worst-of with the budget-bucket status); it can
  // surface a Budget RAG even when no buckets are configured.
  const budgetComputed = worstHealth(computeBudgetStatus(project, amberRatio), evmIndexHealth(evm.cpi));
  const burn: DashboardBurn | null = project
    ? {
        budgetValue: project.budgetValue, consumedValue: project.consumedValue,
        budgetHours: project.budgetHours, actualHours: project.actualHours,
        cost: project.cost, costPerformance: project.costPerformance, consumption: project.consumption,
      }
    : null;
  const burndown: BurndownSeries | null =
    input.budgets.length > 0
      ? computeBurndownSeries(input.budgets, input.plan, input.roles, today)
      : null;

  const scopeComputed = computeScopeStatus(input.changes, SCOPE_PENDING_RED);
  const changeStatusCounts = countByStatus(input.changes);
  const changesSummary = {
    pending: input.changes.filter((c) => isPendingChange(c.status)).length,
    approved: changeStatusCounts.Approved,
    implemented: changeStatusCounts.Implemented,
    total: input.changes.length,
  };

  const { overdue, dueSoon } = partitionUpcoming(input.tasks, today, holidaySet, dueSoonWorkdays);

  return {
    overall: { computed: overallComputed, effective: status.ragOverride ?? overallComputed, overridden: !!status.ragOverride },
    schedule: { computed: scheduleComputed, effective: status.scheduleOverride ?? scheduleComputed, overridden: !!status.scheduleOverride },
    budget: { computed: budgetComputed, effective: status.budgetOverride ?? budgetComputed, overridden: !!status.budgetOverride },
    scope: { computed: scopeComputed, effective: status.scopeOverride ?? scopeComputed, overridden: !!status.scopeOverride },
    changes: changesSummary,
    topChanges: selectTopChanges(input.changes, topRaidN),
    progress: computeDashboardProgress(input.tasks, today, holidaySet),
    burn,
    burndown,
    evm,
    topRaid: selectTopRaid(input.raid, topRaidN),
    openRaidCount: input.raid.filter((r) => !isTerminalStatus(r.status, r.category)).length,
    overdue,
    dueSoon,
    overdueMilestones: ms.overdue,
    atRiskMilestones: ms.atRisk,
    dueSoonMilestones: ms.dueSoon,
    recentActivity: recentActivity(input.activity, recentN),
    narrative: { text: status.narrative ?? "", updatedAt: status.narrativeUpdatedAt },
  };
}
