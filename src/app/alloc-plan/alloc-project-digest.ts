// src/app/alloc-plan/alloc-project-digest.ts
//
// Pure, i18n-free project lines for the "Plan with AI" digest (§769): open tasks, milestones and the R/A
// holders of each milestone. Every name is free text, so each goes through `quoted` (one line, then a JSON
// string): a line break cannot start a fake row (§770), and a `key=value` inside a name cannot pose as one of
// the line's own tokens. Ids carry a `#` prefix like the RESOURCES lines.
import { generatePeriods } from "../resource-capacity";
import { oneLine } from "../rich-text-plain";
import { resourceDisplayName } from "../resource-foundation";
import { splitTaskHoursByPeriod, type HoursMoveCtx } from "../reassign-hours";
import { isTaskClosed } from "../task-closed";
import { type Milestone, type Resource, type Stakeholder, type Task } from "../types";

/** Bound on how many task lines are described to the model (token budget). */
export const ALLOC_CONTEXT_MAX_TASKS = 150;
/** Bound on how many milestone lines are described to the model (token budget). */
export const ALLOC_CONTEXT_MAX_MILESTONES = 40;

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

export interface ProjectDigestArgs {
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  /** Every resource, shown or not: an owner who is not shown is still named, by name only. */
  resources: readonly Resource[];
  /** Ids of the resources the RESOURCES section actually lists; only these can be an `owner=#id` or in RACI.
   *  Default: all of `resources`. */
  shownResourceIds?: ReadonlySet<number>;
  /** The user's free-text request: names and periods in it decide which tasks survive truncation. */
  instruction: string;
  hoursCtx: HoursMoveCtx;
}

interface DateRange { start: string; end: string }

const quoted = (v: string): string => JSON.stringify(oneLine(v));

/** A month name matches alone, except "may", which is also a verb: it needs a year or a day beside it. */
function mentionsMonth(text: string, month: string): boolean {
  if (month !== "may") return new RegExp(`\\b${month}\\b`).test(text);
  return /\b(\d{1,2}(st|nd|rd|th)?\s+may|may\s+(\d{4}|\d{1,2}(st|nd|rd|th)?))\b/.test(text);
}

/** The plan periods the instruction names, by period key or by English month name. */
function namedRanges(instruction: string, ctx: HoursMoveCtx): DateRange[] {
  const text = instruction.toLowerCase();
  if (!text) return [];
  const { plan } = ctx;
  return generatePeriods(plan.startDate, plan.endDate, plan.granularity)
    .filter((p) => {
      if (text.includes(p.key.toLowerCase())) return true;
      const month = MONTH_NAMES[Number(p.start.slice(5, 7)) - 1];
      return month !== undefined && mentionsMonth(text, month);
    })
    .map((p) => ({ start: p.start, end: p.end }));
}

/** The dates a task's hours are spread over, as `splitTaskHoursByPeriod` sees them: a task with no due date or
 *  an overdue one sits on today, and the span never starts before today. */
function effectiveRange(task: Task, today: string): DateRange {
  const due = task.dueDate;
  if (!due || due < today) return { start: today, end: today };
  const start = task.startDate && task.startDate > today ? task.startDate : today;
  return { start: start > due ? due : start, end: due };
}

function ownerOf(
  task: Task,
  all: ReadonlyMap<number, Resource>,
  shown: ReadonlySet<number>,
): { token: string; name: string } {
  const resource = task.resourceId === undefined ? undefined : all.get(task.resourceId);
  if (resource && shown.has(resource.id)) return { token: `#${resource.id}`, name: resourceDisplayName(resource) };
  const name = resource ? resourceDisplayName(resource) : oneLine(task.assignee ?? "");
  if (name) return { token: `name:${quoted(name)}`, name };
  return { token: "unassigned", name: "" };
}

function formatTaskLine(task: Task, owner: string, openIds: ReadonlySet<number>, milestoneIds: readonly number[], ctx: HoursMoveCtx): string {
  const minutes = task.remainingEstimateMinutes;
  const remaining = minutes !== undefined && minutes > 0 ? `${Math.round((minutes / 60) * 10) / 10}h` : "-";
  const parts = [`#${task.id} ${quoted(task.taskName)}`, `owner=${owner}`, `remaining=${remaining}`];
  if (task.startDate) parts.push(`start=${task.startDate}`);
  parts.push(`due=${task.dueDate || "-"}`, `status=${task.status}`);
  const after = (task.dependencies ?? []).filter((d) => d.type === "FS" && d.taskId !== task.id && openIds.has(d.taskId));
  if (after.length > 0) parts.push(`after=${after.map((d) => `#${d.taskId}`).join(",")}`);
  if (milestoneIds.length > 0) parts.push(`milestones=${milestoneIds.map((id) => `#${id}`).join(",")}`);
  const hours = splitTaskHoursByPeriod(task, ctx);
  if (hours.length > 0) parts.push(`hours=${hours.map((h) => `${h.periodKey}=${h.hours}`).join(" ")}`);
  return parts.join(" ");
}

/** Lower is shown first: owner named in the instruction, then overlapping a named period, then the rest. */
function relevanceTier(task: Task, ownerName: string, instruction: string, ranges: readonly DateRange[], today: string): number {
  if (ownerName && instruction.toLowerCase().includes(ownerName.toLowerCase())) return 0;
  const span = effectiveRange(task, today);
  return ranges.some((r) => span.start <= r.end && span.end >= r.start) ? 1 : 2;
}

/** Due date ascending; a task with NO due date sorts after every dated one (nothing says when it is needed). */
function compareDue(a: Task, b: Task): number {
  if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1;
  return a.dueDate.localeCompare(b.dueDate);
}

function milestoneIdsByTask(milestones: readonly Milestone[]): ReadonlyMap<number, number[]> {
  const map = new Map<number, number[]>();
  for (const m of milestones) {
    for (const taskId of m.linkedTaskIds) map.set(taskId, [...(map.get(taskId) ?? []), m.id]);
  }
  return map;
}

function taskSection(args: ProjectDigestArgs, all: ReadonlyMap<number, Resource>, shown: ReadonlySet<number>): string[] {
  const { tasks, milestones, instruction, hoursCtx } = args;
  const open = tasks.filter((t) => !isTaskClosed(t));
  if (open.length === 0) return [];
  const openIds = new Set(open.map((t) => t.id));
  const links = milestoneIdsByTask(milestones);
  const ranges = namedRanges(instruction, hoursCtx);
  const ranked = open
    .map((task) => {
      const owner = ownerOf(task, all, shown);
      return { task, owner: owner.token, tier: relevanceTier(task, owner.name, instruction, ranges, hoursCtx.today) };
    })
    .sort((a, b) => a.tier - b.tier || compareDue(a.task, b.task) || a.task.id - b.task.id);
  const lines = ["TASKS (open only):"];
  for (const { task, owner } of ranked.slice(0, ALLOC_CONTEXT_MAX_TASKS)) {
    lines.push(formatTaskLine(task, owner, openIds, links.get(task.id) ?? [], hoursCtx));
  }
  if (ranked.length > ALLOC_CONTEXT_MAX_TASKS) {
    lines.push(`…(${ranked.length - ALLOC_CONTEXT_MAX_TASKS} more tasks truncated)`);
  }
  return lines;
}

function raciSection(shownMilestones: readonly Milestone[], stakeholders: readonly Stakeholder[], shown: ReadonlySet<number>): string[] {
  const holders = stakeholders.filter((s) => s.resourceId != null && shown.has(s.resourceId));
  const lines: string[] = [];
  for (const m of shownMilestones) {
    const ids = (letter: string): string[] =>
      holders.filter((s) => s.raci[String(m.id)] === letter).map((s) => `#${s.resourceId}`);
    const r = ids("R");
    const a = ids("A");
    const parts = [...(r.length > 0 ? [`R=${r.join(",")}`] : []), ...(a.length > 0 ? [`A=${a.join(",")}`] : [])];
    if (parts.length > 0) lines.push(`milestone #${m.id}: ${parts.join(" ")}`);
  }
  return lines.length > 0 ? ["RACI (R/A only):", ...lines] : [];
}

function milestoneSection(args: ProjectDigestArgs, shown: ReadonlySet<number>): string[] {
  const { milestones, stakeholders } = args;
  if (milestones.length === 0) return [];
  const ranked = [...milestones].sort(
    (a, b) => Number(!!a.achievedDate) - Number(!!b.achievedDate) || a.date.localeCompare(b.date) || a.id - b.id,
  );
  const shownMilestones = ranked.slice(0, ALLOC_CONTEXT_MAX_MILESTONES);
  const lines = ["MILESTONES:"];
  for (const m of shownMilestones) lines.push(`#${m.id} ${quoted(m.name)} date=${m.date} ${m.achievedDate ? "achieved" : "open"}`);
  if (ranked.length > ALLOC_CONTEXT_MAX_MILESTONES) {
    lines.push(`…(${ranked.length - ALLOC_CONTEXT_MAX_MILESTONES} more milestones truncated)`);
  }
  return [...lines, ...raciSection(shownMilestones, stakeholders, shown)];
}

/** TASKS, MILESTONES and RACI lines for the allocation digest; empty when there is nothing to describe. */
export function buildProjectDigest(args: ProjectDigestArgs): string[] {
  const all = new Map(args.resources.map((r) => [r.id, r] as const));
  const shown = args.shownResourceIds ?? new Set(all.keys());
  return [...taskSection(args, all, shown), ...milestoneSection(args, shown)];
}
