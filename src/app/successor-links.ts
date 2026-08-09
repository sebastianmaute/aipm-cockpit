// src/app/successor-links.ts — pure resolver for the task modal's staged
// successor links. Dependencies are stored as PREDECESSORS on the owning task,
// so linking a successor S is a write to S. This turns the staged list into
// per-target before/after dependency arrays (ready for both the setTasks map
// and the undo capture) plus a count of links that could not be applied.
//
// Composes the two existing guards — sanitizeDependencies (the sole owner of
// the 20-link cap and the dangling-ref check) and wouldCreateDependencyCycle —
// instead of reimplementing either. No React, no I/O, no i18n.
import { sanitizeDependencies, wouldCreateDependencyCycle } from "./sanitize";
import type { Task, TaskDependency } from "./types";

/** One target task's dependency array before and after the successor write. */
export interface SuccessorEdit {
  before: TaskDependency[];
  after: TaskDependency[];
}

export interface SuccessorResolution {
  /** Keyed by TARGET task id. Empty when nothing could be applied. */
  edits: Map<number, SuccessorEdit>;
  /** Links dropped: target gone, cycle, at the link cap, or already present. */
  skipped: number;
}

/**
 * Resolve staged successor links for task `ownId`.
 *
 * A staged link `{ taskId: S, type }` means "S should depend on ownId with this
 * type" — the stored form is a `TaskDependency` on S pointing back at ownId.
 *
 * `tasks` MUST already contain the owning task. On the create path that means
 * calling this AFTER the new id is minted and appended, for two reasons: the
 * new id would otherwise be a dangling reference that `sanitizeDependencies`
 * strips (silently applying nothing), and the cycle walk needs the new task's
 * own predecessors to be visible.
 *
 * Mutates nothing passed in.
 */
export function resolveSuccessorLinks(args: {
  ownId: number;
  links: readonly TaskDependency[];
  tasks: readonly Task[];
}): SuccessorResolution {
  const { ownId, links, tasks } = args;
  const edits = new Map<number, SuccessorEdit>();
  let skipped = 0;
  const taskById = new Map<number, Task>(tasks.map((t) => [t.id, t]));
  const knownIds = new Set(tasks.map((t) => t.id));

  for (const link of links) {
    const target = taskById.get(link.taskId);
    if (!target) {
      skipped += 1;
      continue;
    }
    // ★★★ REVERSED relative to the predecessor form. Adding successor S means S
    // gains a dependency on ownId, so the walk starts at ownId and looks for S
    // — i.e. ownTaskId = S, candidatePredecessorId = ownId. Writing this the
    // predecessor way round compiles, passes any chain-free fixture, and lets
    // the user close a cycle. A self-link (link.taskId === ownId) is caught
    // here too: the guard returns true when its two ids are equal.
    if (wouldCreateDependencyCycle(link.taskId, ownId, taskById)) {
      skipped += 1;
      continue;
    }
    const staged = edits.get(target.id);
    const before = staged?.before ?? target.dependencies ?? [];
    const current = staged?.after ?? target.dependencies ?? [];
    // The real sanitizer owns the 20-link cap, the dangling-ref check and
    // de-duplication. If the array did not grow, one of those refused the link.
    const after = sanitizeDependencies(
      [...current, { taskId: ownId, type: link.type }],
      knownIds,
      target.id,
    );
    if (after.length === current.length) {
      skipped += 1;
      continue;
    }
    edits.set(target.id, { before, after });
  }

  return { edits, skipped };
}
