// Pure milestone-domain logic. No React, no I/O — testable core.
import { workdaysUntil } from "./due-dates";
import type { Milestone, Task } from "./types";

export type MilestoneStatus = "achieved" | "overdue" | "at-risk" | "due-soon" | "on-track";
export const MILESTONE_DUE_SOON_WORKDAYS = 3;

export function isAchieved(m: Milestone): boolean {
  return !!m.achievedDate;
}

/** Not achieved AND some linked task's effective end (completedDate||dueDate)
 *  lands after the milestone date — the gating work will be late. */
export function isAtRisk(m: Milestone, tasksById: ReadonlyMap<number, Task>): boolean {
  if (m.achievedDate) return false;
  for (const id of m.linkedTaskIds) {
    const t = tasksById.get(id);
    if (!t) continue;
    const end = t.completedDate || t.dueDate;
    if (end && end > m.date) return true;
  }
  return false;
}

export function milestoneStatus(
  m: Milestone,
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays: number = MILESTONE_DUE_SOON_WORKDAYS,
): MilestoneStatus {
  if (m.achievedDate) return "achieved";
  // A milestone dated today is NOT overdue yet — it falls through to due-soon
  // (0 workdays away). Matches the task overdue convention in dashboard.ts.
  if (m.date < todayISO) return "overdue";
  if (isAtRisk(m, tasksById)) return "at-risk";
  const hs = holidaySet instanceof Set ? holidaySet : new Set<string>(holidaySet);
  if (workdaysUntil(m.date, todayISO, hs) <= leadWorkdays) return "due-soon";
  return "on-track";
}

export function sortMilestones(milestones: readonly Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

export function partitionMilestones(
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays: number = MILESTONE_DUE_SOON_WORKDAYS,
): { overdue: Milestone[]; atRisk: Milestone[]; dueSoon: Milestone[] } {
  const overdue: Milestone[] = [];
  const atRisk: Milestone[] = [];
  const dueSoon: Milestone[] = [];
  for (const m of milestones) {
    const s = milestoneStatus(m, tasksById, todayISO, holidaySet, leadWorkdays);
    if (s === "overdue") overdue.push(m);
    else if (s === "at-risk") atRisk.push(m);
    else if (s === "due-soon") dueSoon.push(m);
  }
  const byDate = (a: Milestone, b: Milestone) => a.date.localeCompare(b.date) || a.id - b.id;
  overdue.sort(byDate); atRisk.sort(byDate); dueSoon.sort(byDate);
  return { overdue, atRisk, dueSoon };
}

export type MilestoneFilterStatus = "all" | "pending" | "achieved" | "overdue";

export function filterMilestones(
  milestones: readonly Milestone[],
  opts: { query: string; status: MilestoneFilterStatus; today: string },
): Milestone[] {
  const q = opts.query.trim().toLowerCase();
  return milestones.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q)) return false;
    const achieved = !!m.achievedDate;
    const overdue = !achieved && m.date < opts.today;
    switch (opts.status) {
      case "achieved": return achieved;
      case "overdue": return overdue;
      case "pending": return !achieved && !overdue;
      case "all": default: return true;
    }
  });
}

/** Schedule RAG contribution: overdue->R, at-risk/due-soon->A, else null. */
export function milestoneScheduleContribution(
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays: number = MILESTONE_DUE_SOON_WORKDAYS,
): "R" | "A" | null {
  const { overdue, atRisk, dueSoon } = partitionMilestones(milestones, tasksById, todayISO, holidaySet, leadWorkdays);
  if (overdue.length > 0) return "R";
  if (atRisk.length > 0 || dueSoon.length > 0) return "A";
  return null;
}

export type MilestoneHorizon = "overdue" | "thisWeek" | "next2Weeks" | "later";
export type HorizonEntry = { milestone: Milestone; status: MilestoneStatus };
export type MilestoneHorizonBuckets = Record<MilestoneHorizon, HorizonEntry[]>;

/** Calendar-day window thresholds for the dashboard horizon strip. */
export const HORIZON_THIS_WEEK_DAYS = 7;
export const HORIZON_NEXT_DAYS = 21;

/** Whole calendar days from `fromISO` to `toISO` (both YYYY-MM-DD, parsed as
 *  UTC midnight). SIGNED: positive when `toISO` is in the future relative to
 *  `fromISO`, negative when in the past. NaN when either is unparseable. Pure —
 *  no "now". */
function calendarDaysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return NaN;
  return Math.round((to - from) / 86_400_000);
}

/** Bucket non-achieved milestones into a forward time horizon for the dashboard
 *  "what's coming" strip. Overdue first; the rest by calendar days until due.
 *  Each entry carries its `milestoneStatus` so callers can flag at-risk. */
export function bucketMilestonesByHorizon(
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays: number = MILESTONE_DUE_SOON_WORKDAYS,
): MilestoneHorizonBuckets {
  const buckets: MilestoneHorizonBuckets = { overdue: [], thisWeek: [], next2Weeks: [], later: [] };
  for (const m of milestones) {
    if (m.achievedDate) continue;
    const status = milestoneStatus(m, tasksById, todayISO, holidaySet, leadWorkdays);
    if (status === "overdue") {
      buckets.overdue.push({ milestone: m, status });
      continue;
    }
    const d = calendarDaysBetween(todayISO, m.date);
    // Safety net: a non-overdue status with a PAST date (negative d) still
    // belongs in `overdue`, not `thisWeek`. Currently unreachable (milestoneStatus
    // strict-`<`-dates to "overdue" first), but robust if that logic ever changes.
    if (!Number.isNaN(d) && d < 0) buckets.overdue.push({ milestone: m, status });
    else if (!Number.isNaN(d) && d <= HORIZON_THIS_WEEK_DAYS) buckets.thisWeek.push({ milestone: m, status });
    else if (!Number.isNaN(d) && d <= HORIZON_NEXT_DAYS) buckets.next2Weeks.push({ milestone: m, status });
    else buckets.later.push({ milestone: m, status });
  }
  const byDate = (a: HorizonEntry, b: HorizonEntry) =>
    a.milestone.date.localeCompare(b.milestone.date) || a.milestone.id - b.milestone.id;
  (Object.keys(buckets) as MilestoneHorizon[]).forEach((k) => buckets[k].sort(byDate));
  return buckets;
}
