// src/app/wbs-plan/wbs-plan.ts
//
// Pure, i18n-free contract for AI work-breakdown optimisation ("optimize_wbs").
// Claude proposes WBS changes (split / regroup / new task / estimate / link)
// via one forced tool call. Its output is UNTRUSTED: `parseWbsProposal` only
// shape-validates it, and `groundWbsProposal` judges every id, ref, piece and
// value against the live workspace. No React, no fetch, no i18n, no side effects.
import { DEFAULT_TASK_STATUS, type Milestone, type ProjectMeta, type Task } from "../types";
import { htmlPlainProjection } from "../rich-text-plain";
import { sanitizeAiRichText } from "../ai-rich-text";
import {
  sanitizeAssignee,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizePriority,
  sanitizeTaskName,
  wouldCreateDependencyCycle,
} from "../sanitize-core";
import { isTaskClosed } from "../task-closed";

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

// ---------------------------------------------------------------------------
// Grounding: judge every parsed VALUE against the live task list. Each item
// is either kept (sanitized) or skipped with a reason the preview lists.
// ---------------------------------------------------------------------------

export type WbsSkipReason =
  | "unknownTask" | "closedTask" | "jiraTask" | "outOfScope" | "badPieces" | "overCap"
  | "emptyName" | "badDate" | "badEstimate" | "hasEstimate" | "duplicateRef"
  | "selfLink" | "duplicateLink" | "unresolvedRef" | "cycle" | "staleTask";

export interface SkippedWbsItem {
  item: RawWbsItem;
  reason: WbsSkipReason;
}

export interface GroundedWbsItem {
  /** Stable within one proposal: `i<index in the parsed items>`. */
  key: string;
  /** The sanitized copy. */
  item: RawWbsItem;
  /** The existing rows it touches, BY REFERENCE, as seen at grounding — the
   *  apply-time re-ground compares identity to detect a stale row. */
  baseRows: readonly Task[];
  /** Keys of the items whose untick disables this one (a ref's newTask, a
   *  piece ≥ 2's split). Piece 1 is the original row and needs nothing. */
  requires: readonly string[];
}

export interface WbsScope {
  taskIds: ReadonlySet<number>;
}

export interface GroundedWbsProposal {
  items: GroundedWbsItem[];
  skipped: SkippedWbsItem[];
  truncated: boolean;
}

type SplitItem = Extract<RawWbsItem, { kind: "split" }>;
type RegroupItem = Extract<RawWbsItem, { kind: "regroup" }>;
type NewTaskItem = Extract<RawWbsItem, { kind: "newTask" }>;
type EstimateItem = Extract<RawWbsItem, { kind: "estimate" }>;
type LinkItem = Extract<RawWbsItem, { kind: "link" }>;
type Verdict = GroundedWbsItem | WbsSkipReason;

interface GroundState {
  live: ReadonlyMap<number, Task>;
  scope: WbsScope;
  /** The post-proposal dependency graph: live tasks, kept new tasks and
   *  pieces ≥ 2 under provisional negative ids, and every kept link. Rows are
   *  replaced on write, never mutated, so the live objects stay untouched. */
  graph: Map<number, Task>;
  nextProvisionalId: number;
  /** A task id or ref is CLAIMED by the first item that names it (after R1),
   *  kept or not — a later duplicate would leave links ambiguous. */
  splitClaims: Set<number>;
  regroupClaims: Set<number>;
  refClaims: Set<string>;
  /** Kept splits by task id: the node id of each piece (piece 1 = the task). */
  splits: Map<number, { key: string; pieceIds: number[] }>;
  /** Kept new tasks by ref. */
  refs: Map<string, { key: string; id: number }>;
  /** Node ids the proposal already gives an estimate. */
  estimated: Set<number>;
}

interface Endpoint {
  node: number;
  base: Task | null;
  requires: string | null;
}

function provisionalNode(st: GroundState): number {
  const id = st.nextProvisionalId--;
  // Only `dependencies` is read by the cycle check.
  st.graph.set(id, { id, dependencies: [] } as unknown as Task);
  return id;
}

function isValidEstimate(m: number): boolean {
  return Number.isInteger(m) && m >= 1 && m <= MAX_WBS_ESTIMATE_MINUTES;
}

function optDescription(d: string | undefined): { description?: string } {
  return d === undefined ? {} : { description: sanitizeAiRichText(d) };
}

/** R1: an existing task an item names must exist, be open, be non-Jira and be
 *  in scope — in that precedence. */
function checkLiveTask(id: number, st: GroundState): Task | WbsSkipReason {
  const t = st.live.get(id);
  if (!t) return "unknownTask";
  if (isTaskClosed(t)) return "closedTask";
  if (t.jiraKey) return "jiraTask";
  if (!st.scope.taskIds.has(id)) return "outOfScope";
  return t;
}

function normalizeTarget(t: WbsTarget): WbsTarget {
  return t.kind === "ref" ? { kind: "ref", ref: oneLine(t.ref) } : t;
}

function resolveTarget(target: WbsTarget, st: GroundState): Endpoint | WbsSkipReason {
  if (target.kind === "ref") {
    const nt = st.refs.get(oneLine(target.ref));
    return nt ? { node: nt.id, base: null, requires: nt.key } : "unresolvedRef";
  }
  const live = checkLiveTask(target.kind === "task" ? target.id : target.taskId, st);
  if (typeof live === "string") return live;
  if (target.kind === "task") return { node: live.id, base: live, requires: null };
  const split = st.splits.get(live.id);
  if (!split || target.piece < 1 || target.piece > split.pieceIds.length) return "unresolvedRef";
  return { node: split.pieceIds[target.piece - 1], base: live, requires: target.piece === 1 ? null : split.key };
}

function groundSplit(item: SplitItem, key: string, st: GroundState): Verdict {
  const live = checkLiveTask(item.taskId, st);
  if (typeof live === "string") return live;
  if (st.splitClaims.has(live.id)) return "duplicateRef";
  st.splitClaims.add(live.id);
  if (item.pieces.length < 2 || item.pieces.length > MAX_SPLIT_PIECES) return "badPieces";
  const pieces = item.pieces.map((p) => ({
    taskName: sanitizeTaskName(p.taskName),
    ...optDescription(p.description),
    ...(p.estimateMinutes !== undefined ? { estimateMinutes: p.estimateMinutes } : {}),
  }));
  if (pieces.some((p) => p.taskName === "")) return "emptyName";
  if (pieces.some((p) => p.estimateMinutes !== undefined && !isValidEstimate(p.estimateMinutes))) return "badEstimate";
  const pieceIds = [live.id, ...pieces.slice(1).map(() => provisionalNode(st))];
  pieces.forEach((p, i) => {
    if (p.estimateMinutes !== undefined) st.estimated.add(pieceIds[i]);
  });
  st.splits.set(live.id, { key, pieceIds });
  return { key, item: { kind: "split", taskId: live.id, pieces, why: oneLine(item.why) }, baseRows: [live], requires: [] };
}

function groundRegroup(item: RegroupItem, key: string, st: GroundState): Verdict {
  const live = checkLiveTask(item.taskId, st);
  if (typeof live === "string") return live;
  if (st.regroupClaims.has(live.id)) return "duplicateRef";
  st.regroupClaims.add(live.id);
  const group = sanitizeGroup(item.group);
  if (group === "") return "emptyName";
  return { key, item: { kind: "regroup", taskId: live.id, group, why: oneLine(item.why) }, baseRows: [live], requires: [] };
}

function groundNewTask(item: NewTaskItem, key: string, st: GroundState): Verdict {
  const ref = oneLine(item.ref);
  if (ref === "") return "emptyName";
  if (st.refClaims.has(ref)) return "duplicateRef";
  st.refClaims.add(ref);
  const taskName = sanitizeTaskName(item.taskName);
  if (taskName === "") return "emptyName";
  const dueDate = sanitizeIsoDate(item.dueDate);
  if (dueDate === "") return "badDate";
  const { estimateMinutes } = item;
  if (estimateMinutes !== undefined && !isValidEstimate(estimateMinutes)) return "badEstimate";
  const id = provisionalNode(st);
  if (estimateMinutes !== undefined) st.estimated.add(id);
  st.refs.set(ref, { key, id });
  const clean: NewTaskItem = {
    kind: "newTask",
    ref,
    taskName,
    dueDate,
    ...(item.group !== undefined ? { group: sanitizeGroup(item.group) } : {}),
    ...optDescription(item.description),
    ...(item.assignee !== undefined ? { assignee: sanitizeAssignee(item.assignee) } : {}),
    ...(estimateMinutes !== undefined ? { estimateMinutes } : {}),
    why: oneLine(item.why),
  };
  return { key, item: clean, baseRows: [], requires: [] };
}

function groundEstimate(item: EstimateItem, key: string, st: GroundState): Verdict {
  const ep = resolveTarget(item.target, st);
  if (typeof ep === "string") return ep;
  if (!isValidEstimate(item.estimateMinutes)) return "badEstimate";
  const liveHasEstimate = ep.base !== null && ep.node === ep.base.id && ep.base.originalEstimateMinutes != null;
  if (liveHasEstimate || st.estimated.has(ep.node)) return "hasEstimate";
  st.estimated.add(ep.node);
  return {
    key,
    item: { kind: "estimate", target: normalizeTarget(item.target), estimateMinutes: item.estimateMinutes, why: oneLine(item.why) },
    baseRows: ep.base ? [ep.base] : [],
    requires: ep.requires ? [ep.requires] : [],
  };
}

function groundLink(item: LinkItem, key: string, st: GroundState): Verdict {
  const from = resolveTarget(item.from, st);
  if (typeof from === "string") return from;
  const to = resolveTarget(item.to, st);
  if (typeof to === "string") return to;
  if (from.node === to.node) return "selfLink";
  const toNode = st.graph.get(to.node) as Task; // every resolved node is in the graph
  const deps = toNode.dependencies ?? [];
  if (deps.some((d) => d.taskId === from.node)) return "duplicateLink";
  if (wouldCreateDependencyCycle(to.node, from.node, st.graph)) return "cycle";
  st.graph.set(to.node, { ...toNode, dependencies: [...deps, { taskId: from.node, type: "FS" }] });
  return {
    key,
    item: { kind: "link", from: normalizeTarget(item.from), to: normalizeTarget(item.to), why: oneLine(item.why) },
    baseRows: [...new Set([from.base, to.base].filter((t): t is Task => t !== null))],
    requires: [...new Set([from.requires, to.requires].filter((k): k is string => k !== null))],
  };
}

/** Ground a parsed proposal against the live tasks. Definitions (split,
 *  regroup, newTask) are judged first, in proposal order, so an estimate or
 *  link may cite a ref or piece defined later; estimates and links follow,
 *  in proposal order, each link added to the post-proposal graph only once
 *  it passes. Output keeps proposal order. Pure: the live rows are never
 *  written. Items past MAX_WBS_ITEMS were already cut by the parser, which
 *  reports them through `truncated`. */
export function groundWbsProposal(
  raw: ParsedWbsProposal,
  liveTasks: readonly Task[],
  scope: WbsScope,
): GroundedWbsProposal {
  const live = new Map(liveTasks.map((t) => [t.id, t] as const));
  const st: GroundState = {
    live,
    scope,
    graph: new Map(live),
    nextProvisionalId: -1,
    splitClaims: new Set(),
    regroupClaims: new Set(),
    refClaims: new Set(),
    splits: new Map(),
    refs: new Map(),
    estimated: new Set(),
  };
  const verdicts = new Map<number, Verdict>();
  raw.items.forEach((item, i) => {
    const key = `i${i}`;
    if (item.kind === "split") verdicts.set(i, groundSplit(item, key, st));
    else if (item.kind === "regroup") verdicts.set(i, groundRegroup(item, key, st));
    else if (item.kind === "newTask") verdicts.set(i, groundNewTask(item, key, st));
  });
  raw.items.forEach((item, i) => {
    const key = `i${i}`;
    if (item.kind === "estimate") verdicts.set(i, groundEstimate(item, key, st));
    else if (item.kind === "link") verdicts.set(i, groundLink(item, key, st));
  });
  const items: GroundedWbsItem[] = [];
  const skipped: SkippedWbsItem[] = [];
  raw.items.forEach((item, i) => {
    const v = verdicts.get(i) as Verdict;
    if (typeof v === "string") skipped.push({ item, reason: v });
    else items.push(v);
  });
  return { items, skipped, truncated: raw.truncated };
}

// ---------------------------------------------------------------------------
// Apply: write the ticked items that are still valid onto a new task list.
// Pure and deterministic — the caller runs it inside a `setTasks(prev => …)`
// updater and again on a ref snapshot, and both must agree.
// ---------------------------------------------------------------------------

export interface WbsApplyResult {
  nextTasks: Task[];
  created: Task[];
  /** Existing rows as they were, in the order they were first edited. */
  editedBefore: Task[];
  /** The same rows after, in the same order. */
  editedAfter: Task[];
  /** Items actually written. */
  applied: number;
  /** Ticked items dropped at apply time because a row they touch changed or
   *  re-grounding no longer keeps them. Items dropped only because an item
   *  they require fell away are not counted. */
  skippedStale: number;
}

/** Rows the items create: one per newTask plus every split piece after the
 *  first. The caller mints this many ids before calling `applyWbsProposal`. */
export function countNewRows(ticked: readonly GroundedWbsItem[]): number {
  let n = 0;
  for (const g of ticked) {
    if (g.item.kind === "newTask") n += 1;
    else if (g.item.kind === "split") n += g.item.pieces.length - 1;
  }
  return n;
}

/** Drop every item whose `requires` names a key that is not in the list,
 *  repeated until nothing more falls. */
function closeOverRequires(items: readonly GroundedWbsItem[]): GroundedWbsItem[] {
  let cur = [...items];
  for (;;) {
    const keys = new Set(cur.map((g) => g.key));
    const next = cur.filter((g) => g.requires.every((k) => keys.has(k)));
    if (next.length === cur.length) return next;
    cur = next;
  }
}

/** The ticked items still valid against `prevTasks`, and how many went stale.
 *  An item is stale when a row it touches is no longer the identical object
 *  (edited or removed); one that requires such an item is dropped uncounted.
 *  The survivors are then grounded again, which also catches a
 *  change of scope; the re-ground key `i<j>` names `active[j]`. A dropped item
 *  whose own requirements all survived went stale itself; one whose
 *  requirement fell is removed, uncounted, by the next closure. Each round
 *  shrinks the list, so the loop ends. */
function selectStillValid(
  prevTasks: readonly Task[],
  ticked: readonly GroundedWbsItem[],
  scope: WbsScope,
): { valid: GroundedWbsItem[]; stale: number } {
  const live = new Map(prevTasks.map((t) => [t.id, t] as const));
  const required = closeOverRequires(ticked);
  const rowChanged = new Set(
    required.filter((g) => g.baseRows.some((b) => live.get(b.id) !== b)).map((g) => g.key),
  );
  // An item that requires a changed item is a casualty, even when it touches
  // the same changed row (a link to a split piece lists the split's row).
  let stale = required.filter((g) => rowChanged.has(g.key) && !g.requires.some((k) => rowChanged.has(k))).length;
  let active = closeOverRequires(required.filter((g) => !rowChanged.has(g.key)));
  for (;;) {
    const re = groundWbsProposal({ items: active.map((g) => g.item), truncated: false }, prevTasks, scope);
    const reKept = new Set(re.items.map((g) => g.key));
    const kept = active.filter((_, j) => reKept.has(`i${j}`));
    if (kept.length === active.length) return { valid: active, stale };
    const keptKeys = new Set(kept.map((g) => g.key));
    stale += active.filter((g, j) => !reKept.has(`i${j}`) && g.requires.every((k) => keptKeys.has(k))).length;
    active = closeOverRequires(kept);
  }
}

interface ApplyState {
  today: string;
  prevById: ReadonlyMap<number, Task>;
  /** Working copies of existing rows; insertion order = first edit. */
  edited: Map<number, Task>;
  /** New rows; insertion order = proposal order. */
  created: Map<number, Task>;
  /** Kept splits by task id: the row id of each piece (piece 1 = the task). */
  pieces: Map<number, number[]>;
  /** Kept new tasks by ref. */
  refs: Map<string, number>;
  takeId: () => number;
}

function readRow(st: ApplyState, id: number): Task {
  return (st.created.get(id) ?? st.edited.get(id) ?? st.prevById.get(id)) as Task; // every resolved id exists
}

/** Replace a row with a patched copy; an existing row is stamped `today`. */
function writeRow(st: ApplyState, id: number, patch: Partial<Task>): void {
  const row = readRow(st, id);
  if (st.created.has(id)) st.created.set(id, { ...row, ...patch });
  else st.edited.set(id, { ...row, ...patch, lastUpdateDate: st.today });
}

function rowId(st: ApplyState, t: WbsTarget): number {
  if (t.kind === "ref") return st.refs.get(t.ref) as number;
  if (t.kind === "task") return t.id;
  return (st.pieces.get(t.taskId) as number[])[t.piece - 1];
}

interface NewRowFields {
  taskName: string;
  description: string;
  estimateMinutes?: number;
  dueDate: string;
  assignee: string;
  assigneeEmail: string;
  group: string;
  labels: string[];
  priority: Task["priority"];
  resourceId?: number;
}

/** The row shape `createTask` (use-chat-dispatcher.ts) writes, so a created
 *  row is indistinguishable from a chat-created one. */
function newRow(id: number, today: string, f: NewRowFields): Task {
  return {
    id,
    taskName: f.taskName,
    assignee: f.assignee,
    assigneeEmail: f.assigneeEmail,
    dueDate: f.dueDate,
    lastUpdateDate: today,
    createdDate: today,
    priority: f.priority,
    status: DEFAULT_TASK_STATUS,
    blockers: "",
    description: f.description,
    inquiriesSent: 0,
    group: f.group,
    labels: f.labels,
    ...(f.resourceId !== undefined ? { resourceId: f.resourceId } : {}),
    ...(f.estimateMinutes !== undefined ? { originalEstimateMinutes: f.estimateMinutes } : {}),
  };
}

/** Piece 1 rewrites the original row's name, and its description and estimate
 *  when given. Pieces 2+ are new rows inheriting the row's people, group,
 *  labels, priority and due date, and no dependencies (grounding's cycle
 *  check assumed none). */
function applySplit(item: SplitItem, st: ApplyState): void {
  const orig = readRow(st, item.taskId);
  const [first, ...rest] = item.pieces;
  const ids = [item.taskId, ...rest.map(() => st.takeId())];
  st.pieces.set(item.taskId, ids);
  rest.forEach((p, i) => {
    st.created.set(
      ids[i + 1],
      newRow(ids[i + 1], st.today, {
        taskName: p.taskName,
        description: p.description ?? "",
        estimateMinutes: p.estimateMinutes,
        dueDate: orig.dueDate,
        assignee: orig.assignee,
        assigneeEmail: orig.assigneeEmail,
        group: orig.group ?? "",
        labels: [...(orig.labels ?? [])],
        priority: orig.priority,
        resourceId: orig.resourceId,
      }),
    );
  });
  writeRow(st, item.taskId, {
    taskName: first.taskName,
    ...(first.description !== undefined ? { description: first.description } : {}),
    ...(first.estimateMinutes !== undefined ? { originalEstimateMinutes: first.estimateMinutes } : {}),
  });
}

function applyNewTask(item: NewTaskItem, st: ApplyState): void {
  const id = st.takeId();
  st.refs.set(item.ref, id);
  st.created.set(
    id,
    newRow(id, st.today, {
      taskName: item.taskName,
      description: item.description ?? "",
      estimateMinutes: item.estimateMinutes,
      dueDate: item.dueDate,
      assignee: item.assignee ?? "",
      assigneeEmail: "",
      group: item.group ?? "",
      labels: [],
      priority: sanitizePriority(undefined),
    }),
  );
}

function applyLink(item: LinkItem, st: ApplyState): void {
  const to = rowId(st, item.to);
  const deps = readRow(st, to).dependencies ?? [];
  writeRow(st, to, { dependencies: [...deps, { taskId: rowId(st, item.from), type: "FS" }] });
}

/** Apply the ticked grounded items to `prevTasks`. Each item is checked again
 *  first (see `selectStillValid`). Definitions (split, regroup, newTask) are
 *  written in proposal order, consuming `newIds` in that order; estimates and
 *  links follow, in proposal order. Throws when `newIds` is too short or names
 *  an existing id (a caller error). Never removes a row, never mutates an
 *  input. */
export function applyWbsProposal(
  prevTasks: readonly Task[],
  ticked: readonly GroundedWbsItem[],
  newIds: readonly number[],
  today: string,
  scope: WbsScope,
): WbsApplyResult {
  const { valid, stale } = selectStillValid(prevTasks, ticked, scope);
  const prevById = new Map(prevTasks.map((t) => [t.id, t] as const));
  const need = countNewRows(valid);
  if (newIds.length < need) throw new Error(`applyWbsProposal: ${need} new ids needed, ${newIds.length} given`);
  if (newIds.slice(0, need).some((id) => prevById.has(id))) throw new Error("applyWbsProposal: a new id is already taken");
  let cursor = 0;
  const st: ApplyState = {
    today,
    prevById,
    edited: new Map(),
    created: new Map(),
    pieces: new Map(),
    refs: new Map(),
    takeId: () => newIds[cursor++],
  };
  for (const { item } of valid) {
    if (item.kind === "split") applySplit(item, st);
    else if (item.kind === "regroup") writeRow(st, item.taskId, { group: item.group });
    else if (item.kind === "newTask") applyNewTask(item, st);
  }
  for (const { item } of valid) {
    if (item.kind === "estimate") writeRow(st, rowId(st, item.target), { originalEstimateMinutes: item.estimateMinutes });
    else if (item.kind === "link") applyLink(item, st);
  }
  const editedIds = [...st.edited.keys()];
  const created = [...st.created.values()];
  return {
    nextTasks: [...prevTasks.map((t) => st.edited.get(t.id) ?? t), ...created],
    created,
    editedBefore: editedIds.map((id) => prevById.get(id) as Task),
    editedAfter: editedIds.map((id) => st.edited.get(id) as Task),
    applied: valid.length,
    skippedStale: stale,
  };
}
