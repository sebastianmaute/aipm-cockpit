// src/app/alloc-plan/alloc-project-digest.ts
//
// Pure, i18n-free project lines for the "Plan with AI" digest (§769): open tasks, milestones and the R/A
// holders of each milestone. Every name is free text, so each goes through `oneLine` — a line break in a
// name cannot start a fake row (§770). Ids carry a `#` prefix like the RESOURCES lines.
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
  resources: readonly Resource[];
  /** The user's free-text request: names and periods in it decide which tasks survive truncation. */
  instruction: string;
  hoursCtx: HoursMoveCtx;
}

interface DateRange { start: string; end: string }

/** The plan periods the instruction names, by period key or by English month name. */
function namedRanges(instruction: string, ctx: HoursMoveCtx): DateRange[] {
  const text = instruction.toLowerCase();
  if (!text) return [];
  const { plan } = ctx;
  return generatePeriods(plan.startDate, plan.endDate, plan.granularity)
    .filter((p) => {
      if (text.includes(p.key.toLowerCase())) return true;
      const month = MONTH_NAMES[Number(p.start.slice(5, 7)) - 1];
      return month !== undefined && new RegExp(`\\b${month}\\b`).test(text);
    })
    .map((p) => ({ start: p.start, end: p.end }));
}

function ownerOf(task: Task, byId: ReadonlyMap<number, Resource>): { token: string; name: string } {
  const listed = task.resourceId === undefined ? undefined : byId.get(task.resourceId);
  if (listed) return { token: `#${listed.id}`, name: resourceDisplayName(listed) };
  const typed = oneLine(task.assignee ?? "");
  if (typed) return { token: `name:${typed}`, name: typed };
  return { token: "unassigned", name: "" };
}

function formatTaskLine(task: Task, owner: string, openIds: ReadonlySet<number>, milestoneIds: readonly number[], ctx: HoursMoveCtx): string {
  const minutes = task.remainingEstimateMinutes;
  const remaining = minutes !== undefined && minutes > 0 ? `${Math.round((minutes / 60) * 10) / 10}h` : "-";
  const parts = [`#${task.id} ${oneLine(task.taskName)}`, `owner=${owner}`, `remaining=${remaining}`];
  if (task.startDate) parts.push(`start=${task.startDate}`);
  parts.push(`due=${task.dueDate}`, `status=${task.status}`);
  const after = (task.dependencies ?? []).filter((d) => d.type === "FS" && d.taskId !== task.id && openIds.has(d.taskId));
  if (after.length > 0) parts.push(`after=${after.map((d) => `#${d.taskId}`).join(",")}`);
  if (milestoneIds.length > 0) parts.push(`milestones=${milestoneIds.map((id) => `#${id}`).join(",")}`);
  const hours = splitTaskHoursByPeriod(task, ctx);
  if (hours.length > 0) parts.push(`hours=${hours.map((h) => `${h.periodKey}=${h.hours}`).join(" ")}`);
  return parts.join(" ");
}

/** Lower is shown first: owner named in the instruction, then overlapping a named period, then the rest. */
function relevanceTier(task: Task, ownerName: string, instruction: string, ranges: readonly DateRange[]): number {
  if (ownerName && instruction.toLowerCase().includes(ownerName.toLowerCase())) return 0;
  const start = task.startDate && task.startDate < task.dueDate ? task.startDate : task.dueDate;
  return ranges.some((r) => start <= r.end && task.dueDate >= r.start) ? 1 : 2;
}

function milestoneIdsByTask(milestones: readonly Milestone[]): ReadonlyMap<number, number[]> {
  const map = new Map<number, number[]>();
  for (const m of milestones) {
    for (const taskId of m.linkedTaskIds) map.set(taskId, [...(map.get(taskId) ?? []), m.id]);
  }
  return map;
}

function taskSection(args: ProjectDigestArgs, byId: ReadonlyMap<number, Resource>): string[] {
  const { tasks, milestones, instruction, hoursCtx } = args;
  const open = tasks.filter((t) => !isTaskClosed(t));
  if (open.length === 0) return [];
  const openIds = new Set(open.map((t) => t.id));
  const links = milestoneIdsByTask(milestones);
  const ranges = namedRanges(instruction, hoursCtx);
  const ranked = open
    .map((task) => {
      const owner = ownerOf(task, byId);
      return { task, owner: owner.token, tier: relevanceTier(task, owner.name, instruction, ranges) };
    })
    .sort((a, b) => a.tier - b.tier || a.task.dueDate.localeCompare(b.task.dueDate) || a.task.id - b.task.id);
  const lines = ["TASKS (open only):"];
  for (const { task, owner } of ranked.slice(0, ALLOC_CONTEXT_MAX_TASKS)) {
    lines.push(formatTaskLine(task, owner, openIds, links.get(task.id) ?? [], hoursCtx));
  }
  if (ranked.length > ALLOC_CONTEXT_MAX_TASKS) {
    lines.push(`…(${ranked.length - ALLOC_CONTEXT_MAX_TASKS} more tasks truncated)`);
  }
  return lines;
}

function raciSection(shown: readonly Milestone[], stakeholders: readonly Stakeholder[], byId: ReadonlyMap<number, Resource>): string[] {
  const holders = stakeholders.filter((s) => s.resourceId != null && byId.has(s.resourceId));
  const lines: string[] = [];
  for (const m of shown) {
    const ids = (letter: string): string[] =>
      holders.filter((s) => s.raci[String(m.id)] === letter).map((s) => `#${s.resourceId}`);
    const r = ids("R");
    const a = ids("A");
    const parts = [...(r.length > 0 ? [`R=${r.join(",")}`] : []), ...(a.length > 0 ? [`A=${a.join(",")}`] : [])];
    if (parts.length > 0) lines.push(`milestone #${m.id}: ${parts.join(" ")}`);
  }
  return lines.length > 0 ? ["RACI (R/A only):", ...lines] : [];
}

function milestoneSection(args: ProjectDigestArgs, byId: ReadonlyMap<number, Resource>): string[] {
  const { milestones, stakeholders } = args;
  if (milestones.length === 0) return [];
  const ranked = [...milestones].sort(
    (a, b) => Number(!!a.achievedDate) - Number(!!b.achievedDate) || a.date.localeCompare(b.date) || a.id - b.id,
  );
  const shown = ranked.slice(0, ALLOC_CONTEXT_MAX_MILESTONES);
  const lines = ["MILESTONES:"];
  for (const m of shown) lines.push(`#${m.id} ${oneLine(m.name)} date=${m.date} ${m.achievedDate ? "achieved" : "open"}`);
  if (ranked.length > ALLOC_CONTEXT_MAX_MILESTONES) {
    lines.push(`…(${ranked.length - ALLOC_CONTEXT_MAX_MILESTONES} more milestones truncated)`);
  }
  return [...lines, ...raciSection(shown, stakeholders, byId)];
}

/** TASKS, MILESTONES and RACI lines for the allocation digest; empty when there is nothing to describe. */
export function buildProjectDigest(args: ProjectDigestArgs): string[] {
  const byId = new Map(args.resources.map((r) => [r.id, r] as const));
  return [...taskSection(args, byId), ...milestoneSection(args, byId)];
}
