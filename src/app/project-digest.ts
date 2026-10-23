// src/app/project-digest.ts
//
// Pure, i18n-free builder of the WIDE per-project digest a scheduled report sends to
// the model (§772). Unlike `buildAnalysisContext` (action-ai.ts) it is not capped per
// category: it lists every open entity, most urgent first, and is bounded as a whole
// by `DIGEST_MAX_CHARS`, dropping whole lines from the END so a cut never splits a line.
// Lines keep the `view#id: title` grounding format the analysis reply is validated against.
import type { AppMode } from "./feature-modules";
import { isTerminalChangeStatus } from "./change-log";
import { isRaidActiveForReview } from "./raid-review";
import { isTaskClosed } from "./task-closed";
import type { ChangeItem, Milestone, RaidItem, Stakeholder, Task } from "./types";

export const DIGEST_MAX_CHARS = 24_000;
const TITLE_MAX_CHARS = 120;
const TRUNCATION_LINE = "…(truncated)";
const SEVERITY_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

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
  budget?: { currency: string; planned: number; actual: number; forecast: number };
  queue: readonly { title: string; why: string; tier: "now" | "soon" | "monitor" }[];
  instruction?: string;
}

const clip = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);

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

function raidLines(raid: readonly RaidItem[]): string[] {
  return raid
    .filter(isRaidActiveForReview)
    .sort((a, b) => (SEVERITY_RANK[b.severity ?? ""] ?? 0) - (SEVERITY_RANK[a.severity ?? ""] ?? 0) || a.id - b.id)
    .map((r) => {
      const parts = [r.category, r.severity ?? "unrated", r.status, r.owner || "no owner"];
      if (r.targetDate) parts.push(`target ${r.targetDate}`);
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
    .map((c) => `- changes#${c.id}: ${clip(c.title)} [${c.status}]`);
}

const stakeholderLines = (stakeholders: readonly Stakeholder[]): string[] =>
  stakeholders.map((s) => `- stakeholders#${s.id}: ${clip(s.name)} [${s.category}]`);

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
  const body = [
    `Project: ${input.projectName}. Today: ${input.today}. Mode: ${input.mode}.`,
    `Enabled modules: ${input.enabledModules.join(", ") || "(none)"}. Open task count: ${openTasks.length}.`,
    'Entities are listed as "view#id: title"; reference an entity only by an id shown here.',
    ...(input.budget
      ? [`Budget (${input.budget.currency}): planned ${input.budget.planned}, actual ${input.budget.actual}, forecast ${input.budget.forecast}.`]
      : []),
    "",
    "## Current rule-based action queue", ...queue,
    "", "## Open tasks", ...openTasks,
    "", "## Active RAID", ...raidLines(input.raid),
    "", "## Upcoming milestones", ...milestoneLines(input.milestones, input.today),
    "", "## Pending changes", ...changeLines(input.changes),
    "", "## Stakeholders", ...stakeholderLines(input.stakeholders),
  ];
  const tail = input.instruction ? `\n\n## Job instruction\n${input.instruction}` : "";
  const fitted = fitLines(body, Math.max(0, maxChars - tail.length));
  return fitted.join("\n") + tail;
}
