// src/app/task-dependency-write.ts — pure resolver behind the AI
// `set_task_dependencies` chat tool. Composes the two existing dependency
// guards (sanitizeDependencies + wouldCreateDependencyCycle) instead of
// reimplementing either, and classifies every refused link with a reason so
// the assistant can report back what it could not link. No React, no I/O.
import { sanitizeDependencies, wouldCreateDependencyCycle } from "./sanitize";
import { DEPENDENCY_TYPES, type DependencyType, type Task, type TaskDependency } from "./types";

export type DepRejectionReason =
  | "unknown-id"
  | "self"
  | "cycle"
  | "duplicate"
  | "cap"
  | "bad-type";

export interface DepRejection {
  taskId: number;
  /** The type as the model wrote it — echoed back even when invalid. */
  type?: string;
  reason: DepRejectionReason;
}

export interface DependencyWriteResult {
  applied: TaskDependency[];
  rejected: DepRejection[];
}

function isDependencyType(v: unknown): v is DependencyType {
  return typeof v === "string" && (DEPENDENCY_TYPES as readonly string[]).includes(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Resolve an AI-proposed dependency write for task `ownId`.
 *
 * `raw` is untrusted model output. A non-array `raw` (missing field, `null`,
 * a stray string, …) means "clear all links" — both `applied` and `rejected`
 * come back empty.
 *
 * Two passes over the surviving candidates:
 *  1. Classify each entry against `sanitizeDependencies`' own precedence
 *     (shape → bad-type → self → unknown-id → duplicate) so every rejection
 *     the sanitizer would also produce is labeled with why, and only the
 *     entries the sanitizer would keep (pre-cap) go forward.
 *  2. Hand those candidates to the real `sanitizeDependencies` — it stays the
 *     single source of truth for the 20-link cap; whatever it drops that
 *     survived pass 1 was dropped purely for the cap.
 * Cycle-checking then walks the sanitized survivors IN ORDER against a
 * working map that grows with each accepted link (the own task's
 * `dependencies` array in that map IS the `applied` array being built), so a
 * set of links that is acyclic one-at-a-time but cyclic together is caught.
 *
 * Mutates nothing passed in.
 */
export function resolveDependencyWrite(
  ownId: number,
  raw: unknown,
  tasks: readonly Task[],
): DependencyWriteResult {
  if (!Array.isArray(raw)) return { applied: [], rejected: [] };

  const knownTaskIds = new Set(tasks.map((t) => t.id));

  // Pass 1: classify against the sanitizer's own precedence, keeping only
  // the pre-cap candidates it would also keep.
  const rejected: DepRejection[] = [];
  const candidates: TaskDependency[] = [];
  const seenKeys = new Set<string>();
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const tidRaw = item.taskId;
    if (typeof tidRaw !== "number" || !Number.isFinite(tidRaw)) continue;
    const taskId = tidRaw;

    const typeRaw = item.type;
    if (!isDependencyType(typeRaw)) {
      rejected.push({
        taskId,
        type: typeof typeRaw === "string" ? typeRaw : String(typeRaw),
        reason: "bad-type",
      });
      continue;
    }
    const type = typeRaw;

    if (taskId === ownId) {
      rejected.push({ taskId, type, reason: "self" });
      continue;
    }
    if (!knownTaskIds.has(taskId)) {
      rejected.push({ taskId, type, reason: "unknown-id" });
      continue;
    }
    const key = `${taskId}:${type}`;
    if (seenKeys.has(key)) {
      rejected.push({ taskId, type, reason: "duplicate" });
      continue;
    }
    seenKeys.add(key);
    candidates.push({ taskId, type });
  }

  // Pass 2: sanitizeDependencies is the source of truth for the cap (it
  // re-confirms shape/self/unknown-id/dedupe too, but those were already
  // filtered out above, so the only thing it can still drop here is the
  // 20-link overflow).
  const sanitized = sanitizeDependencies(candidates, knownTaskIds, ownId);
  const sanitizedKeys = new Set(sanitized.map((d) => `${d.taskId}:${d.type}`));
  for (const candidate of candidates) {
    if (!sanitizedKeys.has(`${candidate.taskId}:${candidate.type}`)) {
      rejected.push({ taskId: candidate.taskId, type: candidate.type, reason: "cap" });
    }
  }

  // Pass 3: cycle-check the sanitized survivors in order, against a working
  // map whose entry for `ownId` carries the `applied` array itself — so each
  // walk sees every link accepted so far, not just the original graph.
  const applied: TaskDependency[] = [];
  const ownTask = tasks.find((t) => t.id === ownId);
  const workingOwnTask: Task = { ...(ownTask ?? ({ id: ownId } as Task)), dependencies: applied };
  const taskById = new Map<number, Task>(tasks.map((t) => [t.id, t]));
  taskById.set(ownId, workingOwnTask);

  for (const dep of sanitized) {
    if (wouldCreateDependencyCycle(ownId, dep.taskId, taskById)) {
      rejected.push({ taskId: dep.taskId, type: dep.type, reason: "cycle" });
      continue;
    }
    applied.push(dep);
  }

  return { applied, rejected };
}
