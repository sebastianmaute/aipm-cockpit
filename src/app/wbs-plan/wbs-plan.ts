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

/** Collapse newlines/control chars so a name cannot inject extra digest lines. */
function oneLine(v: string): string {
  return v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();
}

function plainDescription(html: string | undefined): string {
  const text = oneLine(htmlPlainProjection(html ?? "").replace(/\s+/g, " "));
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
    JSON.stringify(oneLine(t.taskName)),
    `group=${oneLine(t.group ?? "") || "-"}`,
    `status=${t.status}`,
    `assignee=${oneLine(t.assignee ?? "") || "-"}`,
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
    lines.push(`PROJECT: ${oneLine(project.name)} ${project.startDate || "?"} .. ${project.endDate || "?"}`);
  }
  const groups = [...new Set(tasks.map((t) => oneLine(t.group ?? "")).filter((g) => g !== ""))];
  lines.push(`GROUPS: ${groups.length > 0 ? groups.join(", ") : "(none)"}`);
  lines.push("MILESTONES:");
  if (milestones.length === 0) lines.push("(none)");
  for (const m of milestones) lines.push(`${oneLine(m.date)} ${oneLine(m.name)}`);

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
              description: `split: at most ${MAX_SPLIT_PIECES} pieces; the first becomes the original row.`,
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

const INT_STRING_RE = /^-?\d+$/;

/** An integer given as a number, or as a string of decimal digits only —
 *  never `Number()`'s looser readings ("0x10", "1e2", ""). */
function toInt(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && INT_STRING_RE.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** A string kept VERBATIM (empty and blank included) — the grounding step
 *  reports bad values to the user, so the parser must not hide them. */
function toStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** An optional estimate: kept verbatim when it is a finite number, else omitted. */
function optEstimate(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseTarget(v: unknown): WbsTarget | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { taskId?: unknown; ref?: unknown; piece?: unknown };
  if (o.ref !== undefined) {
    const ref = toStr(o.ref);
    return o.taskId === undefined && o.piece === undefined && ref !== null ? { kind: "ref", ref } : null;
  }
  const id = toInt(o.taskId);
  if (id === null) return null;
  if (o.piece === undefined) return { kind: "task", id };
  const piece = toInt(o.piece);
  return piece !== null ? { kind: "piece", taskId: id, piece } : null;
}

type SplitPieces = Extract<RawWbsItem, { kind: "split" }>["pieces"];

function parsePieces(v: unknown): SplitPieces | null {
  if (!Array.isArray(v)) return null;
  const pieces: SplitPieces = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as { taskName?: unknown; description?: unknown; estimateMinutes?: unknown };
    const taskName = toStr(p.taskName);
    if (taskName === null) return null;
    const description = optStr(p.description);
    const estimateMinutes = optEstimate(p.estimateMinutes);
    pieces.push({
      taskName,
      ...(description !== undefined ? { description } : {}),
      ...(estimateMinutes !== undefined ? { estimateMinutes } : {}),
    });
  }
  return pieces;
}

function parseNewTask(o: Record<string, unknown>, why: string): RawWbsItem | null {
  const ref = toStr(o.ref);
  const taskName = toStr(o.taskName);
  const dueDate = toStr(o.dueDate);
  if (ref === null || taskName === null || dueDate === null) return null;
  const group = optStr(o.group);
  const description = optStr(o.description);
  const assignee = optStr(o.assignee);
  const estimateMinutes = optEstimate(o.estimateMinutes);
  return {
    kind: "newTask",
    ref,
    taskName,
    dueDate,
    ...(group !== undefined ? { group } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(estimateMinutes !== undefined ? { estimateMinutes } : {}),
    why,
  };
}

/** SHAPE check only: the kind is known, required fields exist with the right
 *  JS type, targets have a valid shape. VALUES (empty strings, piece counts,
 *  estimate ranges, dates) are kept so the grounding step can report them. */
function parseItem(raw: unknown): RawWbsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const why = optStr(o.why) ?? ""; // a missing explanation must not discard a valid change
  switch (o.kind) {
    case "split": {
      const taskId = toInt(o.taskId);
      const pieces = parsePieces(o.pieces);
      return taskId !== null && pieces ? { kind: "split", taskId, pieces, why } : null;
    }
    case "regroup": {
      const taskId = toInt(o.taskId);
      const group = toStr(o.group);
      return taskId !== null && group !== null ? { kind: "regroup", taskId, group, why } : null;
    }
    case "newTask":
      return parseNewTask(o, why);
    case "estimate": {
      const target = parseTarget(o.target);
      const estimateMinutes = typeof o.estimateMinutes === "number" && Number.isFinite(o.estimateMinutes) ? o.estimateMinutes : null;
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
 *  null only when the overall shape is unusable (no `items` array); items that
 *  are structurally malformed are dropped, not fatal. Stops at MAX_WBS_ITEMS
 *  and reports that via `truncated`. Values are NOT judged here — ids, refs,
 *  pieces and ranges are grounded later against the live workspace. */
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
