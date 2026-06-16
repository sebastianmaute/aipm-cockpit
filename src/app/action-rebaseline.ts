import { milestoneForecast } from "./snapshot";
import type { Milestone, Task } from "./types";

/** Prefill target for a milestone re-baseline: the later of its forecast finish
 *  (max of its date and any linked task's effective end) and today. Guarantees a
 *  future-or-today date even for an overdue milestone with no slipping linked tasks. */
export function milestoneRebaselineDate(
  m: Milestone, tasks: readonly Task[], today: string,
): string {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const forecast = milestoneForecast(m, tasksById);
  return forecast > today ? forecast : today;
}

/** Immutable; returns the SAME array ref when no milestone matches (mirrors
 *  applyEscalation / applyOwnerAssignment so the caller can short-circuit). */
export function applyMilestoneRebaseline(
  milestones: readonly Milestone[], id: number, newDate: string,
): readonly Milestone[] {
  if (!milestones.some((m) => m.id === id)) return milestones;
  return milestones.map((m) => (m.id === id ? { ...m, date: newDate } : m));
}

/** Strict YYYY-MM-DD validity (shape + real calendar date). */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
