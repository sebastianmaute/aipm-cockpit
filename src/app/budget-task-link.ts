// Pure, i18n-free, clock-free helpers for the TASK side of the budget↔task link.
// The link itself lives on the BUCKET (`BudgetBucket.taskIds`), so every
// task-side control writes `budgets`, never `tasks`.
import type { BudgetBucket } from "./types";

/**
 * The bucket a task is linked to, or null. The task-side controls keep a task in
 * at most one bucket, but a workspace edited through the bucket modal (or
 * imported) can still hold duplicates — resolve those deterministically by array
 * order rather than throwing or picking arbitrarily.
 */
export function bucketIdForTask(
  buckets: readonly BudgetBucket[],
  taskId: number,
): number | null {
  for (const b of buckets) {
    if ((b.taskIds ?? []).includes(taskId)) return b.id;
  }
  return null;
}

/**
 * Move `taskIds` into `target` (null = unlink only), removing them from every
 * other bucket.
 *
 * ★ Returns the INPUT ARRAY BY REFERENCE when nothing changed. That no-op guard
 * is what stops "save an untouched editor" or "assign to the bucket it is
 * already in" from pushing an undo entry and an autosave write — `commitBuckets`
 * detects a no-op by reference. An unknown `target` id is likewise a no-op: it
 * must never degrade into a silent unlink. Only buckets whose `taskIds` actually
 * changed get a new object identity and a fresh `localModifiedAt`.
 */
export function moveTasksToBucket(
  buckets: readonly BudgetBucket[],
  taskIds: readonly number[],
  target: number | null,
  stamp: string,
): readonly BudgetBucket[] {
  const moving = new Set(taskIds);
  if (moving.size === 0) return buckets;
  if (target !== null && !buckets.some((b) => b.id === target)) return buckets;

  let changed = false;
  const next = buckets.map((b) => {
    const current = b.taskIds ?? [];
    let nextIds: number[];
    if (b.id === target) {
      // Keep the target's own order and append only what is missing, so
      // re-assigning a task that is already here is a true no-op.
      const present = new Set(current);
      const toAdd = [...moving].filter((id) => !present.has(id));
      if (toAdd.length === 0) return b;
      nextIds = [...current, ...toAdd];
    } else {
      nextIds = current.filter((id) => !moving.has(id));
      if (nextIds.length === current.length) return b;
    }
    changed = true;
    return { ...b, taskIds: nextIds, localModifiedAt: stamp };
  });
  return changed ? next : buckets;
}
