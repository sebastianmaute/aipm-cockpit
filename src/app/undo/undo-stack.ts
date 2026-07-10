// src/app/undo/undo-stack.ts
// Pure, i18n-free, clock-free engine for the local undo stack. One primitive
// (applyUndoRestore) reverses delete / bulk-edit / clear-all by upserting
// captured before-images by id — so undo touches only the rows the op touched
// and survives edits made to OTHER rows between the op and the undo.
import type { ActivityKind } from "../activity-log";

/** Whether a captured row was REMOVED by the op (delete/clear) or EDITED in place
 *  (bulk-edit / a dependency-stripped dependent). The op disambiguates restore:
 *  an edit-image reverts the same row by id; a delete-image re-inserts, and if
 *  its id was reused by a live row since, re-mints rather than clobbering it. */
export type UndoOp = "delete" | "edit";

/** A captured pre-op snapshot of one row plus its position and op. */
export type BeforeImage<T> = { index: number; item: T; op: UndoOp };

/** Display data for one undoable op (toast text, top-bar badge, React key). */
export interface UndoMeta {
  id: number;
  kind: ActivityKind;
  count: number;
  timestamp: string;
}

/** One stack entry: display meta + the impure restore thunk (closes over the setter). */
export interface UndoEntry {
  meta: UndoMeta;
  restore: () => void;
}

/**
 * Restore before-images into `current`, op-aware so undo never clobbers a live
 * row whose id was reused after a delete (ids are minted `max+1`, so deleting
 * the highest row frees its id for the next create):
 *
 * - **edit** image: the row still has that id (edits don't change id) → revert
 *   it in place. If it's ABSENT (edited then deleted since) → skip; do not
 *   resurrect it (that's the delete's undo job, not this edit's).
 * - **delete** image: ABSENT → re-insert at its original index (clamped). If a
 *   DIFFERENT live row now holds that id (reuse) → re-insert the deleted row
 *   under a FRESH id (max+1) so the live row is untouched and the deleted data
 *   is still recovered.
 *
 * Delete-images are applied in ascending original-index order so sequential
 * splices land correctly regardless of caller order. Pure.
 */
export function applyUndoRestore<T extends { id: number }>(
  current: readonly T[],
  before: readonly BeforeImage<T>[],
): T[] {
  const present = new Set(current.map((r) => r.id));
  // Fresh-id source covers current ids AND every captured id, so a re-mint can
  // never collide with a to-be-reinserted delete-image.
  let maxId = current.reduce((m, r) => Math.max(m, r.id), 0);
  for (const b of before) maxId = Math.max(maxId, b.item.id);

  const out = current.slice();

  // An id claimed by a delete-image is owned by the delete branch below — never
  // let an edit-image for the same id revert (would overwrite a live reused-id
  // row). Only reachable if a caller passes an id in BOTH lists (e.g. a
  // self-dependent row), which upstream guards prevent — defensive here so the
  // engine is correct regardless of caller.
  const deleteIds = new Set(before.filter((b) => b.op === "delete").map((b) => b.item.id));

  // Edits first (in place), then deletes ordered by index so the splices compose.
  for (const { item, op } of before) {
    if (op !== "edit" || deleteIds.has(item.id)) continue;
    if (present.has(item.id)) {
      out[out.findIndex((r) => r.id === item.id)] = item;
    }
    // absent edit-image → skip (row deleted since; not this op's to restore)
  }
  const deletes = before
    .filter((b) => b.op === "delete")
    .slice()
    .sort((a, b) => a.index - b.index);
  for (const { index, item } of deletes) {
    if (!present.has(item.id)) {
      out.splice(Math.min(index, out.length), 0, item);
      present.add(item.id);
    } else {
      // id reused by a live row → recover the deleted row under a fresh id.
      maxId += 1;
      out.splice(Math.min(index, out.length), 0, { ...item, id: maxId });
      present.add(maxId);
    }
  }
  return out;
}

/**
 * Build the before-images for ONE array from the rows an op removed and/or
 * edited, resolving each row's original index against the pre-op array. Shared
 * by the single-array `capture` and the multi-array `capturePart` (composite)
 * paths so both produce identical image shapes. Pure.
 */
export function buildBeforeImages<T extends { id: number }>(
  removed: readonly T[],
  edited: readonly T[],
  fromArray: readonly T[],
): BeforeImage<T>[] {
  const at = (item: T) => Math.max(0, fromArray.findIndex((r) => r.id === item.id));
  return [
    ...removed.map((item) => ({ index: at(item), item, op: "delete" as const })),
    ...edited.map((item) => ({ index: at(item), item, op: "edit" as const })),
  ];
}

/** Push an entry on top (end); evict the oldest (front) past `cap`. Pure. */
export function pushUndo(
  stack: readonly UndoEntry[],
  entry: UndoEntry,
  cap: number,
): UndoEntry[] {
  const next = [...stack, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Remove and return the top entry (end) plus the remaining stack, or null. Pure. */
export function popUndo(
  stack: readonly UndoEntry[],
): { entry: UndoEntry; rest: UndoEntry[] } | null {
  if (stack.length === 0) return null;
  return { entry: stack[stack.length - 1], rest: stack.slice(0, -1) };
}

/** Return the stack without the entry whose meta.id === id. Pure. */
export function dropEntry(
  stack: readonly UndoEntry[],
  id: number,
): UndoEntry[] {
  return stack.filter((e) => e.meta.id !== id);
}
