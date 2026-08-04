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
 *  so a malformed-but-non-empty date ("01.07.2026") reads as "overdue" (it
 *  sorts below any ISO date). That is not guarded, and an earlier revision of
 *  this comment justified it with a guarantee that DOES NOT HOLD — it claimed
 *  `sanitizeMilestone` drops such a record on every load path. Only the JSON
 *  path calls that sanitizer. CSV, Markdown and both Turso schemas decode via
 *  `buildMilestoneFromObj`, which accepts any non-empty string as a date — the
 *  decoders-never-call-the-entity-sanitizer rule AGENTS.md documents.
 *
 *  Left unguarded anyway, because the whole app already string-compares these
 *  dates (`milestoneStatus` does the same), so a guard here would make this one
 *  bucket disagree with every other surface rather than fix anything. The fix
 *  belongs at the decode boundary, not here. */
export function milestoneStatusBucket(
  milestone: Pick<Milestone, "date" | "achievedDate">,
  todayISO: string,
): GanttStatus {
  if (milestone.achievedDate) return "completed";
  const date = (milestone.date ?? "").trim();
  if (!date) return "open";
  return date < todayISO ? "overdue" : "open";
}
