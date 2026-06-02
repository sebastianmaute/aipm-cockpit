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
