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
  /** The type as the model wrote it — echoed back even when invalid. Every
   *  push site supplies this (coercing non-strings via `String()`), so it is
   *  required, not optional. */
  type: string;
  reason: DepRejectionReason;
}

export interface DependencyWriteResult {
  applied: TaskDependency[];
  /** Ordered pass-by-pass (pass-1 reasons in raw input order, then cap
   *  overflow, then cycle rejections) — NOT the original raw-array order. */
  rejected: DepRejection[];
}

function isDependencyType(v: unknown): v is DependencyType {
  return typeof v === "string" && (DEPENDENCY_TYPES as readonly string[]).includes(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface ClassifyResult {
  /** Pre-cap candidates — everything `sanitizeDependencies` would also keep,
   *  short of the 20-link cap. */
  candidates: TaskDependency[];
  rejected: DepRejection[];
}

/**
 * Pass 1: classify each raw entry against `sanitizeDependencies`' own
 * precedence (shape → bad-type → self → unknown-id → duplicate), attaching a
 * reason to every rejection — the sanitizer itself returns no reason info.
 * An entry with no classifiable shape (not a plain object, or a `taskId`
 * that isn't a finite number) is dropped silently: it can't be reported as a
 * `DepRejection` (its `taskId` requires a real number), and the sanitizer
 * would drop it too.
 */
function classifyDependencyEntries(
  ownId: number,
  raw: unknown[],
  knownTaskIds: ReadonlySet<number>,
): ClassifyResult {
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
  return { candidates, rejected };
}

interface CycleCheckResult {
  applied: TaskDependency[];
  rejected: DepRejection[];
}

/**
 * Pass 3: cycle-check the sanitized survivors against the plain task graph
 * via `wouldCreateDependencyCycle`. `sanitizeDependencies` deliberately does
 * not cycle-check (that's documented as the form layer's job at insert
 * time), so without this pass an AI write would be the one path in the app
 * able to create one.
 *
 * (A map that "grows" with each accepted link was tried and dropped: the
 * walk returns as soon as it reaches `ownTaskId`, before it ever reads that
 * node's own `.dependencies`, and every link in one call is a predecessor of
 * that same single `ownId` — no other task's list changes — so whether an
 * earlier link was accepted can never affect a later walk.)
 */
function checkDependencyCycles(
  ownId: number,
  sanitized: readonly TaskDependency[],
  tasks: readonly Task[],
): CycleCheckResult {
  const applied: TaskDependency[] = [];
  const rejected: DepRejection[] = [];
  const taskById = new Map<number, Task>(tasks.map((t) => [t.id, t]));

  for (const dep of sanitized) {
    if (wouldCreateDependencyCycle(ownId, dep.taskId, taskById)) {
      rejected.push({ taskId: dep.taskId, type: dep.type, reason: "cycle" });
      continue;
    }
    applied.push(dep);
  }
  return { applied, rejected };
}

/**
 * Resolve an AI-proposed dependency write for task `ownId`.
 *
 * `raw` is untrusted model output. A non-array `raw` (missing field, `null`,
 * a stray string, …) means "clear all links" — both `applied` and `rejected`
 * come back empty.
 *
 * Three passes:
 *  1. `classifyDependencyEntries` labels every entry the sanitizer would
 *     also drop (shape/bad-type/self/unknown-id/duplicate), keeping only the
 *     pre-cap candidates.
 *  2. The real `sanitizeDependencies` is the single source of truth for the
 *     20-link cap; whatever candidate it drops that survived pass 1 was
 *     dropped purely for the cap.
 *  3. `checkDependencyCycles` cycle-checks the survivors against the plain
 *     task graph.
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
  const { candidates, rejected } = classifyDependencyEntries(ownId, raw, knownTaskIds);

  const sanitized = sanitizeDependencies(candidates, knownTaskIds, ownId);
  const sanitizedKeys = new Set(sanitized.map((d) => `${d.taskId}:${d.type}`));
  for (const candidate of candidates) {
    if (!sanitizedKeys.has(`${candidate.taskId}:${candidate.type}`)) {
      rejected.push({ taskId: candidate.taskId, type: candidate.type, reason: "cap" });
    }
  }

  const cycles = checkDependencyCycles(ownId, sanitized, tasks);
  return { applied: cycles.applied, rejected: [...rejected, ...cycles.rejected] };
}
