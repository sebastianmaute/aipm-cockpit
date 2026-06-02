// Pure aggregation for the project-health dashboard. No React, no I/O — the
// single testable unit behind dashboard-panel.tsx.

import { computeGroupHealth, type Health } from "./health";
import { computeBudgetReport, type CciValue, type ProjectReport } from "./budget-report";
import { isTerminalStatus, riskSeverityFromMatrix } from "./raid";
import { workdaysUntil } from "./due-dates";
import { partitionMilestones, milestoneScheduleContribution } from "./milestones";
import type {
  Absence, BudgetBucket, Milestone, ProjectStatus, RaidItem, RaidSeverity,
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
  budget: { computed: SubStatus; effective: SubStatus; overridden: boolean };
  scope: { effective: SubStatus };
  progress: DashboardProgress;
  burn: DashboardBurn | null;
  topRaid: RaidItem[];
  overdue: Task[];
  dueSoon: Task[];
  overdueMilestones: Milestone[];
  atRiskMilestones: Milestone[];
  dueSoonMilestones: Milestone[];
  recentActivity: ActivityEntry[];
  narrative: { text: string; updatedAt?: string };
};

export interface DashboardInput {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  budgets: readonly BudgetBucket[];
  plan: ResourcePlan;
  roles: readonly Role[];
  resources: readonly Resource[];
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  status: ProjectStatus;
  activity: readonly ActivityEntry[];
  today: string;
  milestones: readonly Milestone[];
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
  const taskSchedule = computeScheduleStatus(input.tasks, today, holidaySet, dueSoonWorkdays);
  const msContribution = milestoneScheduleContribution(input.milestones, tasksById, today, holidaySet, dueSoonWorkdays);
  const scheduleComputed: Health =
    taskSchedule === "R" || msContribution === "R" ? "R"
    : taskSchedule === "A" || msContribution === "A" ? "A"
    : "G";
  const ms = partitionMilestones(input.milestones, tasksById, today, holidaySet, dueSoonWorkdays);

  const project: ProjectReport | null = input.budgets.length > 0
    ? computeBudgetReport(input.budgets, input.plan, input.roles, input.resources, input.workdayHours, holidaySet, input.absences).project
    : null;
  const budgetComputed = computeBudgetStatus(project, amberRatio);
  const burn: DashboardBurn | null = project
    ? {
        budgetValue: project.budgetValue, consumedValue: project.consumedValue,
        budgetHours: project.budgetHours, actualHours: project.actualHours,
        cost: project.cost, costPerformance: project.costPerformance, consumption: project.consumption,
      }
    : null;

  const { overdue, dueSoon } = partitionUpcoming(input.tasks, today, holidaySet, dueSoonWorkdays);

  return {
    overall: { computed: overallComputed, effective: status.ragOverride ?? overallComputed, overridden: !!status.ragOverride },
    schedule: { computed: scheduleComputed, effective: status.scheduleOverride ?? scheduleComputed, overridden: !!status.scheduleOverride },
    budget: { computed: budgetComputed, effective: status.budgetOverride ?? budgetComputed, overridden: !!status.budgetOverride },
    scope: { effective: status.scopeOverride ?? null },
    progress: computeDashboardProgress(input.tasks, today, holidaySet),
    burn,
    topRaid: selectTopRaid(input.raid, topRaidN),
    overdue,
    dueSoon,
    overdueMilestones: ms.overdue,
    atRiskMilestones: ms.atRisk,
    dueSoonMilestones: ms.dueSoon,
    recentActivity: recentActivity(input.activity, recentN),
    narrative: { text: status.narrative ?? "", updatedAt: status.narrativeUpdatedAt },
  };
}
