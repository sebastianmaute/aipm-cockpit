import { rowsEqual, rowsEqualExcept } from "./undo-stack";

/**
 * Pure undo/redo of ROWS A WRITE CREATED (§796) — React-free, i18n-free.
 *
 * Undoing an AI work breakdown removes the tasks it created, but only the ones
 * nobody has touched since: a created row that was edited, or that another row
 * now points at, is KEPT (deleting it would destroy later work). A created image
 * whose id is absent from `prev` was already deleted by someone — it counts as
 * neither removed nor kept.
 */

export interface CreatedRowsUndo<T extends { id: number }> {
  /** `prev` without the removed rows, kept rows' refs to removed ids dropped. */
  result: T[];
  /** The created images actually removed (live row === image). */
  removed: T[];
  /** Created ids kept (changed or referenced). */
  keptIds: number[];
  /** Kept rows as they were BEFORE their refs were dropped (only those `dropRefs` changed). */
  keptBefore: T[];
  /** The same rows as the undo left them (refs dropped), in `keptBefore`'s order. */
  keptAfter: T[];
}

export interface CreatedRowsRedo<T extends { id: number }> {
  result: T[];
  remap: Map<number, number>;
  reinserted: number;
}

/** Deep compare of a live row against its created image. Ignores ONLY
 *  `localModifiedAt` — deliberately NOT the write-through keys (a note added
 *  since the create is a real change that must keep the row). */
export function rowChangedSince<T>(live: T, image: T): boolean {
  return !rowsEqualExcept(live, image, ["localModifiedAt"]);
}

/** With `allowed`, a row whose id is not in it is KEPT even when it would otherwise be removed: the write side
 *  of `captureCreatedPart` passes the ids its arming peek approved, so it never removes more than that. */
export function undoCreatedRows<T extends { id: number }>(
  prev: readonly T[],
  created: readonly T[],
  isReferenced: (prev: readonly T[], id: number) => boolean,
  dropRefs: (row: T, removed: ReadonlySet<number>) => T,
  allowed?: ReadonlySet<number>,
): CreatedRowsUndo<T> {
  const liveById = new Map(prev.map((r) => [r.id, r] as const));
  const removed: T[] = [];
  const keptIds: number[] = [];
  for (const image of created) {
    const live = liveById.get(image.id);
    if (live === undefined) continue;
    const notAllowed = allowed !== undefined && !allowed.has(image.id);
    if (notAllowed || rowChangedSince(live, image) || isReferenced(prev, image.id)) keptIds.push(image.id);
    else removed.push(image);
  }
  const removedIds: ReadonlySet<number> = new Set(removed.map((r) => r.id));
  const keptBefore: T[] = [];
  const keptAfter: T[] = [];
  const result: T[] = [];
  for (const row of prev) {
    if (removedIds.has(row.id)) continue;
    const next = dropRefs(row, removedIds);
    if (!rowsEqual(next, row)) {
      keptBefore.push(row);
      keptAfter.push(next);
    }
    result.push(next);
  }
  return { result, removed, keptIds, keptBefore, keptAfter };
}

export function redoCreatedRows<T extends { id: number }>(
  prev: readonly T[],
  removed: readonly T[],
  keptBefore: readonly T[],
  keptAfter: readonly T[],
  remapRefs: (row: T, remap: ReadonlyMap<number, number>) => T,
): CreatedRowsRedo<T> {
  const used = new Set(prev.map((r) => r.id));
  // Claim every free original id first, so only a genuinely taken id is re-minted.
  for (const row of removed) if (!used.has(row.id)) used.add(row.id);
  const taken = new Set(prev.map((r) => r.id));
  // A loop, not `Math.max(...used)`: spreading every id as an argument throws past ~100k rows.
  let maxId = 0;
  for (const id of used) if (id > maxId) maxId = id;
  const remap = new Map<number, number>();
  const minted: T[] = [];
  for (const row of removed) {
    if (!taken.has(row.id)) {
      minted.push(row);
      continue;
    }
    maxId += 1;
    remap.set(row.id, maxId);
    minted.push({ ...row, id: maxId });
  }
  const afterById = new Map(keptAfter.map((r) => [r.id, r] as const));
  const liveById = new Map(prev.map((r) => [r.id, r] as const));
  const restoreById = new Map<number, T>();
  for (const before of keptBefore) {
    const live = liveById.get(before.id);
    const after = afterById.get(before.id);
    if (live === undefined || after === undefined || rowChangedSince(live, after)) continue;
    restoreById.set(before.id, remapRefs(before, remap));
  }
  const result = [
    ...prev.map((r) => restoreById.get(r.id) ?? r),
    ...minted.map((r) => remapRefs(r, remap)),
  ];
  return { result, remap, reinserted: minted.length };
}
