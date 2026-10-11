// src/app/wbs-plan/wbs-plan.ts
//
// Pure, i18n-free contract for AI work-breakdown optimisation ("optimize_wbs").
// Claude proposes WBS changes (split / regroup / new task / estimate / link)
// via one forced tool call. Its output is UNTRUSTED: this module only
// shape-validates it; every id, ref and piece is re-grounded against the live
// workspace later. No React, no fetch, no i18n, no side effects.
import type { Milestone, ProjectMeta, Task } from "../types";
import { htmlPlainProjection } from "../rich-text-plain";

/** Bound on how many items one proposal may carry (blast radius + token budget). */
export const MAX_WBS_ITEMS = 60;
/** Bound on how many pieces a single split may produce. */
export const MAX_SPLIT_PIECES = 6;
/** Largest estimate a proposal may carry, in minutes (20 days of 8h). */
export const MAX_WBS_ESTIMATE_MINUTES = 9600;
/** Bound on how many tasks are described to the model (token budget). */
export const WBS_CONTEXT_MAX_TASKS = 400;
/** Plain-text description length sent per task. */
export const WBS_CONTEXT_DESCRIPTION_CHARS = 300;

export type WbsTarget =
  | { kind: "task"; id: number }
  | { kind: "ref"; ref: string }
  | { kind: "piece"; taskId: number; piece: number }; // piece is 1-based; piece 1 = the original row

export type RawWbsItem =
  | {
      kind: "split";
      taskId: number;
      pieces: { taskName: string; description?: string; estimateMinutes?: number }[];
      why: string;
    }
  | { kind: "regroup"; taskId: number; group: string; why: string }
  | {
      kind: "newTask";
      ref: string;
      taskName: string;
      dueDate: string;
      group?: string;
      description?: string;
      assignee?: string;
      estimateMinutes?: number;
      why: string;
    }
  | { kind: "estimate"; target: WbsTarget; estimateMinutes: number; why: string }
  | { kind: "link"; from: WbsTarget; to: WbsTarget; why: string }; // FS: `from` must finish before `to` starts

export interface ParsedWbsProposal {
  items: RawWbsItem[];
  truncated: boolean;
}

export interface WbsContextArgs {
  tasks: readonly Task[];
  scopeIds: ReadonlySet<number>;
  milestones: readonly Milestone[];
  project: ProjectMeta | undefined;
}

function plainDescription(html: string | undefined): string {
  const text = htmlPlainProjection(html ?? "").replace(/\s+/g, " ").trim();
  return text.length > WBS_CONTEXT_DESCRIPTION_CHARS
    ? `${text.slice(0, WBS_CONTEXT_DESCRIPTION_CHARS)}…`
    : text;
}

function taskLine(t: Task, inScope: boolean): string {
  const deps = (t.dependencies ?? []).map((d) => d.taskId).join(",") || "-";
  const est = t.originalEstimateMinutes != null ? `${t.originalEstimateMinutes}m` : "-";
  const desc = plainDescription(t.description);
  return [
    `#${t.id}${inScope ? " [in scope]" : ""}`,
    JSON.stringify(t.taskName),
    `group=${t.group?.trim() || "-"}`,
    `status=${t.status}`,
    `assignee=${t.assignee?.trim() || "-"}`,
    `start=${t.startDate || "-"}`,
    `due=${t.dueDate || "-"}`,
    `estimate=${est}`,
    `deps=${deps}`,
    desc ? `desc=${JSON.stringify(desc)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Compact, token-bounded digest of the project's tasks, groups and milestones.
 *  Sent as the (volatile) user message — never in the cached system block. */
export function buildWbsContext(args: WbsContextArgs): string {
  const { tasks, scopeIds, milestones, project } = args;
  const lines: string[] = [];
  if (project) {
    lines.push(`PROJECT: ${project.name} ${project.startDate || "?"} .. ${project.endDate || "?"}`);
  }
  const groups = [...new Set(tasks.map((t) => t.group?.trim() ?? "").filter((g) => g !== ""))];
  lines.push(`GROUPS: ${groups.length > 0 ? groups.join(", ") : "(none)"}`);
  lines.push("MILESTONES:");
  if (milestones.length === 0) lines.push("(none)");
  for (const m of milestones) lines.push(`${m.date} ${m.name}`);

  const ordered = [
    ...tasks.filter((t) => scopeIds.has(t.id)),
    ...tasks.filter((t) => !scopeIds.has(t.id)),
  ];
  lines.push("TASKS (estimates in minutes; deps = predecessor ids):");
  for (const t of ordered.slice(0, WBS_CONTEXT_MAX_TASKS)) {
    lines.push(taskLine(t, scopeIds.has(t.id)));
  }
  if (ordered.length > WBS_CONTEXT_MAX_TASKS) {
    lines.push(`…(${ordered.length - WBS_CONTEXT_MAX_TASKS} more tasks omitted)`);
  }
  return lines.join("\n");
}

/** Stable, cacheable system prompt. */
export function buildWbsSystemPrompt(): string {
  return [
    "You are a senior project manager optimising a project's work breakdown structure (WBS).",
    "You may propose exactly four operations: split a task into smaller pieces, regroup a task into another group, add a new task, and set an estimate or add a finish-to-start link between tasks.",
    "This tool never deletes or cancels a task and never overwrites an existing estimate — it only proposes additions and fixes to what is missing or unclear; the user reviews every item before anything changes.",
    "Use ONLY the task ids listed in the digest. Reference a task you are adding in the same proposal by its `ref`, and a piece of a split by `taskId` plus a 1-based `piece` (piece 1 is the original row).",
    "Focus on tasks marked [in scope]; use the rest only as context.",
    "Estimates are in minutes. A link `from` → `to` means `from` must finish before `to` starts.",
    `Return at most ${MAX_WBS_ITEMS} items, at most ${MAX_SPLIT_PIECES} pieces per split. For a broad request, prioritise the most valuable changes rather than enumerating every task.`,
    "The digest may be truncated — a trailing '…(N more tasks omitted)' line means your view is partial.",
    "If nothing worthwhile can be proposed, return an empty `items` array rather than guessing.",
    "Call the propose_wbs_changes tool exactly once. Keep every `why` to one short line.",
  ].join(" ");
}

const TARGET_SCHEMA = {
  type: "object",
  description: "Exactly one of: {taskId}, {ref}, or {taskId, piece}.",
  properties: {
    taskId: { type: "integer", description: "Id of an existing task from the digest." },
    ref: { type: "string", description: "Ref of a newTask item in this proposal." },
    piece: { type: "integer", description: "1-based piece of a split of taskId (piece 1 = the original row)." },
  },
};

/** Anthropic tool definition, forced via tool_choice. */
export const PROPOSE_WBS_TOOL = {
  name: "propose_wbs_changes" as const,
  description:
    "Propose work-breakdown changes: split, regroup, newTask, estimate, link. Call exactly once; return an empty items array when nothing worthwhile applies.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        description: `At most ${MAX_WBS_ITEMS} items.`,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["split", "regroup", "newTask", "estimate", "link"] },
            why: { type: "string", description: "One short line of rationale." },
            taskId: { type: "integer", description: "split/regroup: the existing task." },
            pieces: {
              type: "array",
              description: `split: 2..${MAX_SPLIT_PIECES} pieces; the first becomes the original row.`,
              items: {
                type: "object",
                properties: {
                  taskName: { type: "string" },
                  description: { type: "string" },
                  estimateMinutes: { type: "integer", description: `Minutes, 1..${MAX_WBS_ESTIMATE_MINUTES}.` },
                },
                required: ["taskName"],
              },
            },
            group: { type: "string", description: "regroup/newTask: the group name." },
            ref: { type: "string", description: "newTask: a short unique handle other items may cite." },
            taskName: { type: "string" },
            dueDate: { type: "string", description: "newTask: YYYY-MM-DD." },
            description: { type: "string" },
            assignee: { type: "string" },
            estimateMinutes: { type: "integer", description: `Minutes, 1..${MAX_WBS_ESTIMATE_MINUTES}.` },
            target: TARGET_SCHEMA,
            from: TARGET_SCHEMA,
            to: TARGET_SCHEMA,
          },
          required: ["kind", "why"],
        },
      },
    },
    required: ["items"],
  },
};

function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
}

function toStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optStr(v: unknown): string | undefined {
  const s = toStr(v);
  return s === "" ? undefined : s;
}

/** An estimate in 1..MAX_WBS_ESTIMATE_MINUTES, or null when absent/unusable. */
function toEstimate(v: unknown): number | null {
  const n = toInt(v);
  return n !== null && n >= 1 && n <= MAX_WBS_ESTIMATE_MINUTES ? n : null;
}

function parseTarget(v: unknown): WbsTarget | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { taskId?: unknown; ref?: unknown; piece?: unknown };
  if (o.ref !== undefined) {
    const ref = toStr(o.ref);
    return o.taskId === undefined && o.piece === undefined && ref !== "" ? { kind: "ref", ref } : null;
  }
  const id = toInt(o.taskId);
  if (id === null) return null;
  if (o.piece === undefined) return { kind: "task", id };
  const piece = toInt(o.piece);
  return piece !== null && piece >= 1 ? { kind: "piece", taskId: id, piece } : null;
}

type SplitPieces = Extract<RawWbsItem, { kind: "split" }>["pieces"];

function parsePieces(v: unknown): SplitPieces | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const pieces: SplitPieces = [];
  for (const raw of v.slice(0, MAX_SPLIT_PIECES)) {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as { taskName?: unknown; description?: unknown; estimateMinutes?: unknown };
    const taskName = toStr(p.taskName);
    if (taskName === "") return null;
    const description = optStr(p.description);
    const estimateMinutes = toEstimate(p.estimateMinutes);
    pieces.push({
      taskName,
      ...(description ? { description } : {}),
      ...(estimateMinutes !== null ? { estimateMinutes } : {}),
    });
  }
  return pieces;
}

function parseNewTask(o: Record<string, unknown>, why: string): RawWbsItem | null {
  const ref = toStr(o.ref);
  const taskName = toStr(o.taskName);
  const dueDate = toStr(o.dueDate);
  if (ref === "" || taskName === "" || dueDate === "") return null;
  const group = optStr(o.group);
  const description = optStr(o.description);
  const assignee = optStr(o.assignee);
  const estimateMinutes = toEstimate(o.estimateMinutes);
  return {
    kind: "newTask",
    ref,
    taskName,
    dueDate,
    ...(group ? { group } : {}),
    ...(description ? { description } : {}),
    ...(assignee ? { assignee } : {}),
    ...(estimateMinutes !== null ? { estimateMinutes } : {}),
    why,
  };
}

function parseItem(raw: unknown): RawWbsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const why = toStr(o.why);
  switch (o.kind) {
    case "split": {
      const taskId = toInt(o.taskId);
      const pieces = parsePieces(o.pieces);
      return taskId !== null && pieces ? { kind: "split", taskId, pieces, why } : null;
    }
    case "regroup": {
      const taskId = toInt(o.taskId);
      const group = toStr(o.group);
      return taskId !== null && group !== "" ? { kind: "regroup", taskId, group, why } : null;
    }
    case "newTask":
      return parseNewTask(o, why);
    case "estimate": {
      const target = parseTarget(o.target);
      const estimateMinutes = toEstimate(o.estimateMinutes);
      return target && estimateMinutes !== null ? { kind: "estimate", target, estimateMinutes, why } : null;
    }
    case "link": {
      const from = parseTarget(o.from);
      const to = parseTarget(o.to);
      return from && to ? { kind: "link", from, to, why } : null;
    }
    default:
      return null;
  }
}

/** Parse the untrusted model tool input into shape-validated items. Returns
 *  null only when the overall shape is unusable (no `items` array); malformed
 *  items are dropped, not fatal. Stops at MAX_WBS_ITEMS and reports that via
 *  `truncated`. Ids/refs are grounded later against the live workspace. */
export function parseWbsProposal(input: unknown): ParsedWbsProposal | null {
  if (!input || typeof input !== "object") return null;
  const itemsRaw = (input as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) return null;
  const items: RawWbsItem[] = [];
  let truncated = false;
  for (const raw of itemsRaw) {
    if (items.length >= MAX_WBS_ITEMS) {
      truncated = true;
      break;
    }
    const item = parseItem(raw);
    if (item) items.push(item);
  }
  return { items, truncated };
}
