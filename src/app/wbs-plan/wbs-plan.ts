// src/app/wbs-plan/wbs-plan.ts
//
// Pure, i18n-free contract for AI work-breakdown optimisation ("optimize_wbs").
// Claude proposes WBS changes (split / regroup / new task / estimate / link)
// via one forced tool call. Its output is UNTRUSTED: `parseWbsProposal` only
// shape-validates it, and `groundWbsProposal` judges every id, ref, piece and
// value against the live workspace. No React, no fetch, no i18n, no side effects.
import { DEFAULT_TASK_STATUS, type Absence, type Milestone, type ProjectMeta, type Resource, type Task } from "../types";
import { htmlPlainProjection, oneLine } from "../rich-text-plain";
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
import { isoAddDays } from "../due-dates";
import { AWAY_WINDOW_DAYS, NO_HOLIDAYS, buildAwaySummary, taskClashes, type AbsenceClash, type AbsenceCtx } from "../absence-clash";

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
  /** §773 — who is away, so the model schedules a new task's due date around it. */
  absences: readonly Absence[];
  resources: readonly Resource[];
  /** The fallback window start when the project has no dates (today..today+28). */
  today: string;
}

/** From today (or the project start, if later) to the project end; today..today+28 when the project has
 *  no end date or has already ended. */
function awayWindow(project: ProjectMeta | undefined, today: string): { from: string; to: string } {
  const from = project?.startDate && project.startDate > today ? project.startDate : today;
  if (project?.endDate && project.endDate >= from) return { from, to: project.endDate };
  return { from: today, to: isoAddDays(today, AWAY_WINDOW_DAYS) };
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
  const { tasks, scopeIds, milestones, project, absences, resources, today } = args;
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
  lines.push(...buildAwaySummary({ absences, resources, ...awayWindow(project, today) }));
  return lines.join("\n");
}

/** Stable, cacheable system prompt. */
export function buildWbsSystemPrompt(): string {
  return [
    "You are a senior project manager optimising a project's work breakdown structure (WBS).",
    "You may propose exactly four operations: split a task into smaller pieces, regroup a task into another group, add a new task, and set an estimate or add a finish-to-start link between tasks.",
    "This tool never deletes or cancels a task and never overwrites an existing estimate, except that a split's piece 1 rewrites the original row: its name, and its description and estimate when you give them (omit them to keep the original's). It only proposes additions and fixes to what is missing or unclear; the user reviews every item before anything changes.",
    "Use ONLY the task ids listed in the digest. Reference a task you are adding in the same proposal by its `ref`, and a piece of a split by `taskId` plus a 1-based `piece` (piece 1 is the original row).",
    "Focus on tasks marked [in scope]; use the rest only as context.",
    "Schedule a new task's due date outside its assignee's absences listed under AWAY.",
    "Estimates are in minutes. A link `from` → `to` means `from` must finish before `to` starts.",
    `Return at most ${MAX_WBS_ITEMS} items, at most ${MAX_SPLIT_PIECES} pieces per split. For a broad request, prioritise the most valuable changes rather than enumerating every task.`,
    "The digest may be truncated — a trailing '…(N more tasks omitted)' line means your view is partial.",
    "If nothing worthwhile can be proposed, return an empty `items` array rather than guessing.",
    "Call the propose_wbs_changes tool exactly once. Keep every `why` to one short line.",
    // ★ The response has a fixed output budget (wbs-plan-call.ts): descriptions
    // are the only unbounded text, and an over-long answer fails as a whole.
    "Keep any description to one short sentence, and omit descriptions entirely when you propose many items: the answer has a fixed size budget, and one that runs over is lost as a whole.",
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
  | "unknownTask" | "closedTask" | "jiraTask" | "outOfScope" | "badPieces"
  | "emptyName" | "emptyGroup" | "emptyRef" | "badDate" | "badEstimate" | "hasEstimate"
  | "duplicateRef" | "duplicateTarget" | "sameGroup"
  | "selfLink" | "duplicateLink" | "unresolvedRef" | "ambiguousPiece" | "cycle";

export type { WbsOpenRefusal } from "./wbs-open-refusal";

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
   *  piece ≥ 2's split). Piece 1 is the original row and needs nothing: it is
   *  stored as `{kind:"task"}`, so it survives the split being unticked. */
  requires: readonly string[];
  /** §773 — a newTask only (never a split piece): its due date lands on an absence of its assignee. */
  clashes?: readonly AbsenceClash[];
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
  /** A ref is CLAIMED by the first newTask that names it (after a non-blank
   *  check), kept or not — a later duplicate would leave links ambiguous. A
   *  task id is claimed for a split or regroup only by the first one KEPT, so
   *  a valid second split after a malformed first one is still kept. */
  splitClaims: Set<number>;
  /** Every split item seen per task id, kept or not. A piece target names a
   *  task and a piece number, never a split, so once a task has two split
   *  items "piece 2" could mean either one's piece: every target on a piece
   *  2..MAX_SPLIT_PIECES of that task is refused (`ambiguousPiece`) instead
   *  of being bound to the split that was kept. A piece outside that range
   *  is `unresolvedRef`, as for any task (R7). */
  splitItems: Map<number, number>;
  /** Group spellings, see `canonicalGroup`. Kept new groups are added as they
   *  are grounded, so "Testing" and "testing" in one proposal become one. */
  groups: GroupIndex;
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

function groupKey(g: string): string {
  return g.trim().toLowerCase();
}

interface GroupIndex {
  /** Stored spelling by trimmed spelling. */
  exact: Map<string, string>;
  /** Stored spelling by trimmed, lower-cased spelling — the rule
   *  `useWbsPlan().open` scopes a group by. */
  byKey: Map<string, string>;
}

/** First spelling wins, in task order, so the result is deterministic. */
function existingGroups(tasks: readonly Task[]): GroupIndex {
  const idx: GroupIndex = { exact: new Map(), byKey: new Map() };
  for (const t of tasks) {
    const g = t.group ?? "";
    if (g.trim() === "") continue;
    if (!idx.exact.has(g.trim())) idx.exact.set(g.trim(), g);
    if (!idx.byKey.has(groupKey(g))) idx.byKey.set(groupKey(g), g);
  }
  return idx;
}

/** A sanitized proposed group, spelled as the group it means. An exact
 *  (trimmed) match keeps that group, even when another spelling of it exists:
 *  the Open Points filter treats "Design" and "DESIGN" as two groups. Only
 *  without one does the case-insensitive match apply, preferring `own` (the
 *  task's current group, for a regroup), so a proposed "design" writes the
 *  project's "Design" instead of a near-duplicate group. */
function canonicalGroup(group: string, st: GroundState, own = ""): string {
  if (group === "") return "";
  const exact = st.groups.exact.get(group);
  if (exact !== undefined) return exact;
  if (own.trim() !== "" && groupKey(own) === groupKey(group)) return own;
  return st.groups.byKey.get(groupKey(group)) ?? group;
}

/** Record a kept group that no existing spelling matched. */
function rememberGroup(group: string, st: GroundState): void {
  if (group === "" || st.groups.byKey.has(groupKey(group))) return;
  st.groups.exact.set(group, group);
  st.groups.byKey.set(groupKey(group), group);
}

function isValidEstimate(m: number): boolean {
  return Number.isInteger(m) && m >= 1 && m <= MAX_WBS_ESTIMATE_MINUTES;
}

/** A description that is blank, or sanitizes to blank, counts as ABSENT: on a
 *  split's piece 1 an empty string would otherwise wipe the original row's
 *  description, and the preview would show no replacement. */
function optDescription(d: string | undefined): { description?: string } {
  if (d === undefined) return {};
  const clean = sanitizeAiRichText(d);
  return htmlPlainProjection(clean).trim() === "" ? {} : { description: clean };
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

/** Piece 1 IS the original row, so it is stored as that task: an item on it
 *  must not depend on the split being kept (or ticked). */
function normalizeTarget(t: WbsTarget): WbsTarget {
  if (t.kind === "ref") return { kind: "ref", ref: oneLine(t.ref) };
  if (t.kind === "piece" && t.piece === 1) return { kind: "task", id: t.taskId };
  return t;
}

function resolveTarget(target: WbsTarget, st: GroundState): Endpoint | WbsSkipReason {
  if (target.kind === "ref") {
    const nt = st.refs.get(oneLine(target.ref));
    return nt ? { node: nt.id, base: null, requires: nt.key } : "unresolvedRef";
  }
  const live = checkLiveTask(target.kind === "task" ? target.id : target.taskId, st);
  if (typeof live === "string") return live;
  // Piece 1 is the original row whether or not a split of it is kept.
  if (target.kind === "task" || target.piece === 1) return { node: live.id, base: live, requires: null };
  // R7: a piece no split could have is unresolved, ambiguous or not.
  if (target.piece < 1 || target.piece > MAX_SPLIT_PIECES) return "unresolvedRef";
  if ((st.splitItems.get(live.id) ?? 0) > 1) return "ambiguousPiece";
  const split = st.splits.get(live.id);
  if (!split || target.piece > split.pieceIds.length) return "unresolvedRef";
  return { node: split.pieceIds[target.piece - 1], base: live, requires: split.key };
}

function groundSplit(item: SplitItem, key: string, st: GroundState): Verdict {
  st.splitItems.set(item.taskId, (st.splitItems.get(item.taskId) ?? 0) + 1);
  const live = checkLiveTask(item.taskId, st);
  if (typeof live === "string") return live;
  if (st.splitClaims.has(live.id)) return "duplicateTarget";
  if (item.pieces.length < 2 || item.pieces.length > MAX_SPLIT_PIECES) return "badPieces";
  const pieces = item.pieces.map((p) => ({
    taskName: sanitizeTaskName(p.taskName),
    ...optDescription(p.description),
    ...(p.estimateMinutes !== undefined ? { estimateMinutes: p.estimateMinutes } : {}),
  }));
  if (pieces.some((p) => p.taskName === "")) return "emptyName";
  if (pieces.some((p) => p.estimateMinutes !== undefined && !isValidEstimate(p.estimateMinutes))) return "badEstimate";
  st.splitClaims.add(live.id);
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
  if (st.regroupClaims.has(live.id)) return "duplicateTarget";
  const own = live.group ?? "";
  const group = canonicalGroup(sanitizeGroup(item.group), st, own);
  if (group === "") return "emptyGroup";
  // A move to the group the task is already in changes nothing, so it is not
  // offered (it would stamp lastUpdateDate and count as applied). After
  // `canonicalGroup`, "DESIGN" → "design" resolves to the task's own group and
  // is refused, while "DESIGN" → "Design" names another existing group and is
  // a real move.
  if (group.trim() === own.trim()) return "sameGroup";
  st.regroupClaims.add(live.id);
  rememberGroup(group, st);
  return { key, item: { kind: "regroup", taskId: live.id, group, why: oneLine(item.why) }, baseRows: [live], requires: [] };
}

// ★ Matching on the typed assignee name (no resourceId) is deliberate: a WBS new task is stored unlinked
// (R14), so the preview judges exactly what will be written. The cost, consistent with R14: an unlinked person
// matches `Absence.assignee` text only, so an absence recorded WITH a resourceId whose assignee text went stale
// after the person was renamed is not seen here, and that clash is missed.
function groundNewTask(item: NewTaskItem, key: string, st: GroundState, absence: AbsenceCtx): Verdict {
  const ref = oneLine(item.ref);
  if (ref === "") return "emptyRef";
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
    ...(item.group !== undefined ? { group: canonicalGroup(sanitizeGroup(item.group), st) } : {}),
    ...optDescription(item.description),
    ...(item.assignee !== undefined ? { assignee: sanitizeAssignee(item.assignee) } : {}),
    ...(estimateMinutes !== undefined ? { estimateMinutes } : {}),
    why: oneLine(item.why),
  };
  if (clean.group !== undefined) rememberGroup(clean.group, st);
  const clashes = taskClashes({ assignee: clean.assignee ?? "", dueDate: clean.dueDate }, absence);
  return { key, item: clean, baseRows: [], requires: [], ...(clashes.length > 0 ? { clashes } : {}) };
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
  absence: AbsenceCtx = { absences: [], resources: [], holidaySet: NO_HOLIDAYS },
): GroundedWbsProposal {
  const live = new Map(liveTasks.map((t) => [t.id, t] as const));
  const st: GroundState = {
    live,
    scope,
    graph: new Map(live),
    nextProvisionalId: -1,
    splitClaims: new Set(),
    splitItems: new Map(),
    groups: existingGroups(liveTasks),
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
    else if (item.kind === "newTask") verdicts.set(i, groundNewTask(item, key, st, absence));
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

/** The row fields `createTask` (use-chat-dispatcher.ts) writes, except
 *  `resourceId` for a new task: chat links it through `linkPersonForWrite`
 *  (§375), this does not (R14). A split piece copies the original's. */
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
 *  check assumed none). Regroups are written first, so a regroup of the same
 *  task gives every piece the new group whichever order the two came in. */
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
 *  first (see `selectStillValid`). Regroups are written first; then splits and
 *  new tasks in proposal order, consuming `newIds` in that order; estimates and
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
    if (item.kind === "regroup") writeRow(st, item.taskId, { group: item.group });
  }
  for (const { item } of valid) {
    if (item.kind === "split") applySplit(item, st);
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
