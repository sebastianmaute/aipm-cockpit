// src/app/task-dedup/dedup.ts
//
// Pure, i18n-free contract + transforms for the "Deduplicate & unify tasks"
// feature. Claude proposes MERGE GROUPS (one keep task + the duplicate tasks to
// fold into it) via a single forced tool call; the model's output is UNTRUSTED,
// so every id it returns is re-grounded against the live task list before
// anything can be applied. No React, no fetch, no i18n, no side effects.
import { type Task } from "../types";
import { sanitizeTaskName } from "../sanitize";
import { sanitizeNoteHtml } from "../sanitize-html";
import { descriptionText } from "../rich-text-projection";

/** A raw group as parsed from the model tool input (shape-validated only — ids
 *  are NOT yet checked against the live workspace). */
export interface RawMergeGroup {
  keepId: number;
  mergeIds: number[];
  rationale: string;
  unifiedFields?: { taskName?: string; description?: string };
}

export interface MergedRef {
  id: number;
  title: string;
}

/** A group whose ids have all been re-grounded against the live tasks and whose
 *  unified fields are sanitized. Only these ever reach `applyMerges`. */
export interface GroundedMergeGroup {
  keepId: number;
  keepTitle: string;
  merged: MergedRef[];
  rationale: string;
  /** Sanitized unified field overrides for the keep task (empty when none). */
  unified: { taskName?: string; description?: string };
}

/** Bound on how many tasks are described to the model (token budget). */
export const DEDUP_CONTEXT_CAP = 300;
/** Bound on how many merge groups a single run may apply. */
export const MAX_MERGE_GROUPS = 25;
/** Notes truncation in the per-task digest line (keeps the prompt compact). */
const DIGEST_NOTES_MAX = 200;

function firstLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** Compact, token-bounded digest of the task list. Sent as the (volatile) user
 *  message — never in the cached system block. Each line is
 *  `#<id> [<status>] <assignee> due:<date> — <title> :: <notes>`. */
export function buildDedupContext(
  tasks: readonly Pick<
    Task,
    "id" | "taskName" | "status" | "assignee" | "dueDate" | "description"
  >[],
): string {
  const shown = tasks.slice(0, DEDUP_CONTEXT_CAP);
  const lines = shown.map((tk) => {
    const assignee = tk.assignee?.trim() || "unassigned";
    const due = tk.dueDate?.trim() || "-";
    const noteText = descriptionText(tk.description);
    const notes = noteText ? ` :: ${firstLine(noteText, DIGEST_NOTES_MAX)}` : "";
    return `#${tk.id} [${tk.status}] ${assignee} due:${due} — ${firstLine(tk.taskName, 200)}${notes}`;
  });
  if (tasks.length > DEDUP_CONTEXT_CAP) {
    lines.push(`…(${tasks.length - DEDUP_CONTEXT_CAP} more tasks truncated)`);
  }
  return lines.join("\n");
}

/** Stable, cacheable system prompt. */
export function buildDedupSystemPrompt(): string {
  return [
    "You are a senior project manager helping tidy a task list.",
    "You are given a digest of tasks as `#id [status] assignee due:date — title :: notes`.",
    "Identify tasks that are DUPLICATES or clearly OVERLAP (same deliverable described twice, near-identical titles, a task split into redundant copies).",
    "Call the propose_task_merges tool exactly once. For each merge group, pick ONE task to KEEP (`keepId`) and list the OTHER tasks to fold into it (`mergeIds`).",
    "Only reference ids that appear in the digest. A task may appear in at most one group. Do NOT merge tasks that are merely related, sequential, or part of the same epic but distinct work.",
    "If nothing is a clear duplicate, return an empty `groups` array — do not force merges.",
    "Optionally set `unifiedFields.title` / `unifiedFields.description` when the kept task should adopt a clearer combined title or notes; omit them to keep the kept task's own values.",
    "Keep each `rationale` to one short line.",
  ].join(" ");
}

/** Anthropic tool definition. Forced via tool_choice so the model always emits
 *  one structured tool_use block. */
export const PROPOSE_MERGES_TOOL = {
  name: "propose_task_merges",
  description:
    "Propose groups of duplicate/overlapping tasks to merge. Call exactly once; return an empty groups array when there are no clear duplicates.",
  input_schema: {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        description: "Merge groups. Each keeps one task and folds the others into it.",
        items: {
          type: "object",
          properties: {
            keepId: { type: "integer", description: "Id of the task to KEEP (must appear in the digest)." },
            mergeIds: {
              type: "array",
              description: "Ids of the duplicate tasks to fold into keepId (each must appear in the digest).",
              items: { type: "integer" },
            },
            rationale: { type: "string", description: "One short line: why these are duplicates." },
            unifiedFields: {
              type: "object",
              description: "Optional overrides applied to the kept task.",
              properties: {
                title: { type: "string", description: "Clearer combined task title." },
                description: { type: "string", description: "Clearer combined notes/description." },
              },
            },
          },
          required: ["keepId", "mergeIds", "rationale"],
        },
      },
    },
    required: ["groups"],
  },
};

function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
}

/** Parse the untrusted model tool input into raw groups (shape only — ids are
 *  grounded later). Returns null only when the overall shape is unusable (no
 *  `groups` array); individual malformed groups are dropped, not fatal. */
export function parseMergeProposal(input: unknown): RawMergeGroup[] | null {
  if (!input || typeof input !== "object") return null;
  const groups = (input as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return null;
  const out: RawMergeGroup[] = [];
  for (const raw of groups) {
    if (!raw || typeof raw !== "object") continue;
    const g = raw as { keepId?: unknown; mergeIds?: unknown; rationale?: unknown; unifiedFields?: unknown };
    const keepId = toInt(g.keepId);
    if (keepId === null) continue;
    const mergeIds = Array.isArray(g.mergeIds)
      ? g.mergeIds.map(toInt).filter((n): n is number => n !== null)
      : [];
    const rationale = typeof g.rationale === "string" ? g.rationale.trim() : "";
    let unifiedFields: RawMergeGroup["unifiedFields"];
    if (g.unifiedFields && typeof g.unifiedFields === "object") {
      const uf = g.unifiedFields as { title?: unknown; description?: unknown; taskName?: unknown; notes?: unknown };
      const taskName = typeof uf.title === "string" ? uf.title : typeof uf.taskName === "string" ? uf.taskName : undefined;
      const description = typeof uf.description === "string" ? uf.description : typeof uf.notes === "string" ? uf.notes : undefined;
      if (taskName !== undefined || description !== undefined) unifiedFields = { taskName, description };
    }
    out.push({ keepId, mergeIds, rationale, unifiedFields });
  }
  return out;
}

/**
 * Re-ground raw model groups against the LIVE task list. This is the
 * anti-hallucination gate: a hallucinated/removed id can never delete a real
 * task. Rules:
 *   - keepId must be a real task and not already claimed by another group.
 *   - each mergeId must be a real task, distinct from keepId, not already
 *     claimed, deduped within the group.
 *   - a group with zero real mergeIds (< 2 tasks total) is dropped.
 *   - unified fields are sanitized; an empty/blank unified title is ignored.
 *   - at most MAX_MERGE_GROUPS groups are returned.
 */
export function groundMergeGroups(
  raw: readonly RawMergeGroup[],
  tasks: readonly Task[],
): GroundedMergeGroup[] {
  const byId = new Map(tasks.map((tk) => [tk.id, tk]));
  const claimed = new Set<number>();
  const out: GroundedMergeGroup[] = [];
  for (const g of raw) {
    if (out.length >= MAX_MERGE_GROUPS) break;
    const keep = byId.get(g.keepId);
    if (!keep || claimed.has(g.keepId)) continue;
    const merged: MergedRef[] = [];
    const seen = new Set<number>([g.keepId]);
    for (const mid of g.mergeIds) {
      if (seen.has(mid) || claimed.has(mid)) continue;
      const tk = byId.get(mid);
      if (!tk) continue; // hallucinated / removed id → dropped, never applied
      seen.add(mid);
      merged.push({ id: mid, title: tk.taskName });
    }
    if (merged.length === 0) continue; // need keep + at least one real duplicate
    // Only claim ids once the group is known-valid.
    claimed.add(g.keepId);
    for (const m of merged) claimed.add(m.id);
    const unified: GroundedMergeGroup["unified"] = {};
    if (g.unifiedFields?.taskName !== undefined) {
      const clean = sanitizeTaskName(g.unifiedFields.taskName);
      if (clean) unified.taskName = clean;
    }
    if (g.unifiedFields?.description !== undefined) {
      unified.description = sanitizeNoteHtml(g.unifiedFields.description);
    }
    out.push({ keepId: g.keepId, keepTitle: keep.taskName, merged, rationale: g.rationale, unified });
  }
  return out;
}

export interface MergeApplyResult {
  /** The task array after the merge (duplicates removed, keeps patched). */
  nextTasks: Task[];
  /** Original rows REMOVED (folded away) — undo `removed` images. */
  removed: Task[];
  /** Original keep rows whose fields changed — undo `edited` (before) images. */
  editedBefore: Task[];
  /** Count of tasks removed (folded away). */
  removedCount: number;
}

/**
 * Apply grounded merge groups to the task list, purely. Duplicate tasks are
 * removed; each keep task adopts its group's sanitized unified fields (and is
 * re-stamped `localModifiedAt` only when something actually changed). Returns
 * the next array plus the before-images an undo entry needs. Jira-synced keep
 * tasks keep their own fields (unified overrides are skipped) but their
 * duplicates are still removed.
 */
export function applyMerges(
  tasks: readonly Task[],
  groups: readonly GroundedMergeGroup[],
  nowIso: string,
): MergeApplyResult {
  const removedIds = new Set<number>();
  const patchByKeep = new Map<number, { taskName?: string; description?: string }>();
  for (const g of groups) {
    for (const m of g.merged) removedIds.add(m.id);
    patchByKeep.set(g.keepId, g.unified);
  }
  const removed: Task[] = [];
  const editedBefore: Task[] = [];
  const nextTasks: Task[] = [];
  for (const tk of tasks) {
    if (removedIds.has(tk.id)) {
      removed.push(tk);
      continue;
    }
    const patch = patchByKeep.get(tk.id);
    // Jira-synced tasks are read-only: never mutate their fields.
    if (!patch || tk.jiraKey) {
      nextTasks.push(tk);
      continue;
    }
    const nextName = patch.taskName !== undefined ? patch.taskName : tk.taskName;
    const nextDescription = patch.description !== undefined ? patch.description : tk.description;
    if (nextName === tk.taskName && nextDescription === tk.description) {
      nextTasks.push(tk);
      continue;
    }
    editedBefore.push(tk);
    nextTasks.push({ ...tk, taskName: nextName, description: nextDescription, localModifiedAt: nowIso });
  }
  return { nextTasks, removed, editedBefore, removedCount: removed.length };
}
