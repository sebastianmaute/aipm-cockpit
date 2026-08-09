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
  /** Genuine REFUSALS: target gone, would close a cycle, or at the link cap.
   *  The user asked for something that did not happen — worth reporting. */
  skipped: number;
  /** Links the target ALREADY had. Deliberately NOT `skipped`: the end state is
   *  exactly what the user asked for, so nothing failed. This is routine rather
   *  than exceptional — `successorLinks` is never seeded from stored data, so on
   *  edit-open the successor group is empty even for a task that already has
   *  successors and the picker offers them right back. Counting these as
   *  refusals told the user "1 successor link(s) were not applied" about a link
   *  that was, in fact, present. Call sites stay SILENT on this count. */
  alreadyPresent: number;
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
  let alreadyPresent = 0;
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
    // `before` is the RAW stored array — an undo has to restore exactly what
    // was there, dangling entries included.
    const before = staged?.before ?? [...(target.dependencies ?? [])];
    // `current` is the SANITIZED baseline. Comparing a raw baseline against a
    // sanitized result conflates "the sanitizer refused my link" with "it
    // dropped a stale entry while accepting my link" — for a target carrying
    // one dangling reference those lengths match, and the write was silently
    // discarded.
    const current =
      staged?.after ?? sanitizeDependencies(target.dependencies ?? [], knownIds, target.id);
    // ★ Checked BEFORE the sanitizer, because a duplicate and a cap-refusal are
    // indistinguishable afterwards — both leave the array the same length. The
    // two mean opposite things to the user (one succeeded already, one did not
    // happen), so they cannot share a counter.
    if (current.some((d) => d.taskId === ownId && d.type === link.type)) {
      alreadyPresent += 1;
      continue;
    }
    // The real sanitizer owns the 20-link cap, the dangling-ref check and
    // de-duplication. With duplicates already handled above, a non-growing
    // array now means a genuine refusal.
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

  return { edits, skipped, alreadyPresent };
}
