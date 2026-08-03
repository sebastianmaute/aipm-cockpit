// src/app/gantt-status-buckets.ts — pure, i18n-free mapping from an entity to
// the Gantt status-filter buckets it belongs to. No clock: `today` is passed in.
import { isTaskClosed } from "./task-closed";
import { type GanttStatus } from "./gantt-engine";
import { type Milestone, type Task } from "./types";

/** Which buckets a task belongs to. A task can be in several (an unfinished
 *  task past its end is both open and overdue). Cancelled counts as COMPLETED:
 *  it is closed, and reporting it as open work is what the wiring fixes. */
export function taskStatusBuckets(
  task: Pick<Task, "status">,
  bar: { end: Date },
  today: Date,
): ReadonlySet<GanttStatus> {
  if (isTaskClosed(task)) return new Set<GanttStatus>(["completed"]);
  const out = new Set<GanttStatus>(["open"]);
  if (bar.end.getTime() < today.getTime()) out.add("overdue");
  return out;
}

/** A milestone belongs to exactly one bucket. An EMPTY or missing date falls to
 *  "open" rather than "overdue" — a record with no date is not a schedule slip.
 *
 *  Scoped deliberately to empty: the comparison below is a raw string compare,
 *  so a malformed-but-non-empty date ("01.07.2026") would still read as
 *  "overdue". No guard for that, because `sanitizeMilestone` runs
 *  `sanitizeIsoDate` and DROPS the whole record when it fails — every load path
 *  yields either a valid YYYY-MM-DD or no milestone at all. Add the guard only
 *  if a call site ever bypasses that sanitizer. */
export function milestoneStatusBucket(
  milestone: Pick<Milestone, "date" | "achievedDate">,
  todayISO: string,
): GanttStatus {
  if (milestone.achievedDate) return "completed";
  const date = (milestone.date ?? "").trim();
  if (!date) return "open";
  return date < todayISO ? "overdue" : "open";
}
