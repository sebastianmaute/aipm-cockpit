// src/app/project-digest.ts
//
// Pure, i18n-free builder of the WIDE per-project digest a scheduled report sends to
// the model (§772). Unlike `buildAnalysisContext` (action-ai.ts) each line carries status, dates and
// urgency, open entities come most urgent first, and a budget line is added. Each category is still capped
// at `CONTEXT_CAP_PER_CATEGORY` lines (the rest is counted in a "…(N more)" line), and the whole is bounded
// by `DIGEST_MAX_CHARS`, dropping whole lines from the END so a cut never splits a line.
// Lines keep the `view#id: title` grounding format the analysis reply is validated against.
import { CONTEXT_CAP_PER_CATEGORY } from "./action-ai";
import type { AppMode } from "./feature-modules";
import { isTerminalChangeStatus } from "./change-log";
import { isRaidActiveForReview } from "./raid-review";
import { TEXTAREA_MAX } from "./sanitize-core";
import { isTaskClosed } from "./task-closed";
import type { ChangeItem, Milestone, RaidItem, Stakeholder, Task } from "./types";

export const DIGEST_MAX_CHARS = 24_000;
const TITLE_MAX_CHARS = 120;
const TRUNCATION_LINE = "…(truncated)";

export interface ProjectDigestInput {
  projectName: string;
  today: string;
  mode: AppMode;
  enabledModules: readonly string[];
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  milestones: readonly Milestone[];
  changes: readonly ChangeItem[];
  stakeholders: readonly Stakeholder[];
  /** `forecast` is absent when no pace forecast exists; the line then says n/a instead of repeating the plan. */
  budget?: { currency: string; planned: number; actual: number; forecast?: number };
  queue: readonly { title: string; why: string; tier: "now" | "soon" | "monitor" }[];
  instruction?: string;
}

const clip = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);

/** Keep the first `CONTEXT_CAP_PER_CATEGORY` lines and say how many were left out. */
function capLines(lines: readonly string[]): string[] {
  if (lines.length <= CONTEXT_CAP_PER_CATEGORY) return [...lines];
  return [...lines.slice(0, CONTEXT_CAP_PER_CATEGORY), `- …(${lines.length - CONTEXT_CAP_PER_CATEGORY} more)`];
}

/** Ascending by date; an empty date sorts last. */
const byDate = (a: string, b: string): number => (a === b ? 0 : a === "" ? 1 : b === "" ? -1 : a < b ? -1 : 1);

function taskLines(tasks: readonly Task[], today: string): string[] {
  return tasks
    .filter((t) => !isTaskClosed(t))
    .sort((a, b) => byDate(a.dueDate, b.dueDate) || a.id - b.id)
    .map((t) => {
      const overdue = t.dueDate !== "" && t.dueDate < today;
      const parts = [t.status, t.priority, t.assignee || "unassigned", t.dueDate ? `due ${t.dueDate}` : "no due date"];
      if (overdue) parts.push("overdue");
      return `- open-points#${t.id}: ${clip(t.taskName)} [${parts.join(", ")}]`;
    });
}

const isRaidOverdue = (r: RaidItem, today: string): boolean => !!r.targetDate && r.targetDate < today;

/** Nearest target date first, which puts every overdue item ahead of the rest; undated items last. */
function raidLines(raid: readonly RaidItem[], today: string): string[] {
  return raid
    .filter(isRaidActiveForReview)
    .sort((a, b) => byDate(a.targetDate ?? "", b.targetDate ?? "") || a.id - b.id)
    .map((r) => {
      const parts = [r.category, r.severity ?? "unrated", r.status, r.owner || "no owner"];
      if (r.targetDate) parts.push(`target ${r.targetDate}`);
      if (isRaidOverdue(r, today)) parts.push("overdue");
      return `- raid#${r.id}: ${clip(r.title)} [${parts.join(", ")}]`;
    });
}

function milestoneLines(milestones: readonly Milestone[], today: string): string[] {
  return milestones
    .filter((m) => !m.achievedDate)
    .sort((a, b) => byDate(a.date, b.date) || a.id - b.id)
    .map((m) => `- milestones#${m.id}: ${clip(m.name)} [${m.date}${m.date && m.date < today ? ", overdue" : ""}]`);
}

function changeLines(changes: readonly ChangeItem[]): string[] {
  return changes
    .filter((c) => !isTerminalChangeStatus(c.status))
    .sort((a, b) => a.id - b.id)
    .map((c) => `- changes#${c.id}: ${clip(c.title)} [${c.status}${c.decisionDate ? `, decided ${c.decisionDate}` : ""}]`);
}

const stakeholderLines = (stakeholders: readonly Stakeholder[]): string[] =>
  stakeholders.map((s) => `- stakeholders#${s.id}: ${clip(s.name)} [${s.title || s.organization || s.category}]`);

/** Keep whole lines from the front while they fit `budget` chars; append the marker. */
function fitLines(lines: readonly string[], budget: number): string[] {
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= budget) return [...lines];
  let used = TRUNCATION_LINE.length + 1;
  const kept: string[] = [];
  for (const line of lines) {
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  // A section heading left without any entry under it carries no information.
  while (kept.length > 0 && /^(## |$)/.test(kept[kept.length - 1]!)) kept.pop();
  return [...kept, TRUNCATION_LINE];
}

export function buildProjectDigest(input: ProjectDigestInput, maxChars: number = DIGEST_MAX_CHARS): string {
  const queue = input.queue.length
    ? input.queue.map((q) => `- [${q.tier}] ${clip(q.title)} — ${clip(q.why)}`)
    : ["(none)"];
  const openTasks = taskLines(input.tasks, input.today);
  const instruction = input.instruction?.slice(0, TEXTAREA_MAX);
  const body = [
    `Project: ${input.projectName}. Today: ${input.today}. Mode: ${input.mode}.`,
    `Enabled modules: ${input.enabledModules.join(", ") || "(none)"}. Open task count: ${openTasks.length}.`,
    'Entities are listed as "view#id: title"; reference an entity only by an id shown here.',
    ...(input.budget
      ? [`Budget (${input.budget.currency}): planned ${Math.round(input.budget.planned)}, actual ${Math.round(input.budget.actual)}, forecast ${input.budget.forecast === undefined ? "n/a" : Math.round(input.budget.forecast)}.`]
      : []),
    "",
    "## Current rule-based action queue", ...capLines(queue),
    "", "## Open tasks", ...capLines(openTasks),
    "", "## Active RAID", ...capLines(raidLines(input.raid, input.today)),
    "", "## Upcoming milestones", ...capLines(milestoneLines(input.milestones, input.today)),
    "", "## Pending changes", ...capLines(changeLines(input.changes)),
    "", "## Stakeholders", ...capLines(stakeholderLines(input.stakeholders)),
  ];
  const tail = instruction ? `\n\n## Job instruction\n${instruction}` : "";
  const fitted = fitLines(body, Math.max(0, maxChars - tail.length));
  return fitted.join("\n") + tail;
}
