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
  /** Human-readable, already-translated summary of the op (e.g. `Edit task "X"`,
   *  `Delete 3 tasks`). Built at CAPTURE time so the undone/redone toast and the
   *  caret preview can say WHAT will be reverted, not just a depth count. */
  label: string;
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
  return applyUndoRestoreWithRemap(current, before).result;
}

/**
 * Same as `applyUndoRestore` but also returns the id `remap` it performed: for
 * every delete-image whose original id was reused by a live row (so the row was
 * recovered under a FRESH id), `remap[originalId] = mintedId`. Redo needs this
 * so it removes the id the row ACTUALLY holds post-restore, not the stale
 * original (which now belongs to the unrelated live row). Pure.
 */
export function applyUndoRestoreWithRemap<T extends { id: number }>(
  current: readonly T[],
  before: readonly BeforeImage<T>[],
): { result: T[]; remap: Map<number, number> } {
  const present = new Set(current.map((r) => r.id));
  // Fresh-id source covers current ids AND every captured id, so a re-mint can
  // never collide with a to-be-reinserted delete-image.
  let maxId = current.reduce((m, r) => Math.max(m, r.id), 0);
  for (const b of before) maxId = Math.max(maxId, b.item.id);

  const out = current.slice();
  const remap = new Map<number, number>();

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
      // id reused by a live row → recover the deleted row under a fresh id, and
      // record the remap so redo removes THIS row (not the live reused-id one).
      maxId += 1;
      out.splice(Math.min(index, out.length), 0, { ...item, id: maxId });
      present.add(maxId);
      remap.set(item.id, maxId);
    }
  }
  return { result: out, remap };
}

/**
 * Re-apply the destructive op (REDO) — the exact inverse of `applyUndoRestore`,
 * driven by FORWARD images (the post-op / after values, built by
 * `buildForwardImages` at undo time):
 *
 * - **edit** image: replace the row with that id by `item` (the AFTER value).
 *   ABSENT (row deleted since) → skip.
 * - **delete** image: REMOVE the row with that id from `current` (only the id is
 *   used). ABSENT → skip.
 *
 * Edits are applied first, then removals, mirroring the restore ordering so a
 * redo that both edits and removes composes correctly. Id-based and pure.
 */
/** Structural deep-equality for plain rows (primitives, arrays, plain objects) —
 *  used to confirm a row's IDENTITY before redo removes it. Pure. */
function rowsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => rowsEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function applyUndoForward<T extends { id: number }>(
  current: readonly T[],
  forward: readonly BeforeImage<T>[],
): T[] {
  let out = current.slice();
  // Map each delete-image's id → the RECOVERED row it represents.
  const deletes = new Map<number, T>();
  for (const f of forward) if (f.op === "delete") deletes.set(f.item.id, f.item);
  for (const { item, op } of forward) {
    if (op !== "edit" || deletes.has(item.id)) continue; // delete-image owns this id
    const idx = out.findIndex((r) => r.id === item.id);
    if (idx !== -1) out[idx] = item; // absent edit → skip
  }
  if (deletes.size > 0) {
    // ★★ Remove a row ONLY if the live row at that id still MATCHES the recovered
    // row. A capture-bypassing mutation (e.g. the AI delete tools) that deleted
    // the recovered row and freed its id — without clearing the redo stack — could
    // leave an unrelated NEW row reusing that id; without this identity guard, redo
    // would destroy that live row (data loss). Mismatched id → skip.
    out = out.filter((r) => {
      const recovered = deletes.get(r.id);
      return recovered === undefined || !rowsEqual(r, recovered);
    });
  }
  return out;
}

/**
 * Build the FORWARD (redo) images from the before-images plus the array as it
 * existed AT UNDO TIME (`afterArray` = the post-op state, i.e. the value the
 * setter held just before undo restored it). Pure.
 *
 * - **edit** before-image (id X): forward carries the AFTER value —
 *   `afterArray.find(id === X)`. If the row was deleted since the undo-capture,
 *   fall back to the before-image's own item (best available).
 * - **delete** before-image (id X): forward removes the row on redo — but by the
 *   id the restored row ACTUALLY holds. If undo re-minted it (id X was reused by
 *   a live row), `remap` maps X → the minted id, so redo removes the recovered
 *   row and NEVER the unrelated live row that now owns X.
 */
export function buildForwardImages<T extends { id: number }>(
  before: readonly BeforeImage<T>[],
  afterArray: readonly T[],
  remap?: ReadonlyMap<number, number>,
): BeforeImage<T>[] {
  return before.map((b) => {
    if (b.op === "edit") {
      const after = afterArray.find((r) => r.id === b.item.id);
      return { index: b.index, item: after ?? b.item, op: "edit" as const };
    }
    const mintedId = remap?.get(b.item.id);
    const item = mintedId === undefined ? b.item : { ...b.item, id: mintedId };
    return { index: b.index, item, op: "delete" as const };
  });
}

/**
 * Remap ONE foreign-key field across a set of before-images through a PRIMARY
 * delete's id-remap, for a composite undo. When the primary fragment re-minted a
 * recovered row under a fresh id (its original id was reused by a live row), a
 * sibling cascade fragment that references it must follow the re-mint rather than
 * restore the STALE original id — which now belongs to an unrelated live row.
 *
 * Works for BOTH image ops: an edit-image whose restored FK value points at the
 * primary (role/discipline/grade cascade re-setting an FK), and a delete-image
 * that carries the FK (resource delete re-inserting absences/shifts). Rows whose
 * `field` value isn't a remapped number (null/undefined/unchanged) pass through
 * untouched. An empty remap is a no-op (returns a shallow copy). Pure.
 */
export function remapImageField<T extends { id: number }>(
  before: readonly BeforeImage<T>[],
  field: keyof T & string,
  remap: ReadonlyMap<number, number>,
): BeforeImage<T>[] {
  if (remap.size === 0) return before.slice();
  return before.map((b) => {
    const value = b.item[field];
    if (typeof value !== "number") return b;
    const mapped = remap.get(value);
    if (mapped === undefined || mapped === value) return b;
    return { ...b, item: { ...b.item, [field]: mapped } as T };
  });
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

/** Push an entry on top (end); evict the oldest (front) past `cap`. Generic
 *  over the entry shape (any `{ meta }`) so the undo AND redo stacks share it. Pure. */
export function pushUndo<E extends { meta: UndoMeta }>(
  stack: readonly E[],
  entry: E,
  cap: number,
): E[] {
  const next = [...stack, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Remove and return the top entry (end) plus the remaining stack, or null. Pure. */
export function popUndo<E extends { meta: UndoMeta }>(
  stack: readonly E[],
): { entry: E; rest: E[] } | null {
  if (stack.length === 0) return null;
  return { entry: stack[stack.length - 1], rest: stack.slice(0, -1) };
}

/** Return the stack without the entry whose meta.id === id. Pure. */
export function dropEntry<E extends { meta: UndoMeta }>(
  stack: readonly E[],
  id: number,
): E[] {
  return stack.filter((e) => e.meta.id !== id);
}

/** Take every entry from the one with `meta.id === id` up to the TOP, returned
 *  NEWEST-FIRST (the execution order for a through-undo), plus the untouched
 *  remainder below it. Null when the id is absent — mirrors `popUndo`'s
 *  null-on-empty contract. Generic over the entry shape so the undo AND redo
 *  stacks share it. Pure. */
export function takeThrough<E extends { meta: UndoMeta }>(
  stack: readonly E[],
  id: number,
): { entries: E[]; rest: E[] } | null {
  const idx = stack.findIndex((e) => e.meta.id === id);
  if (idx === -1) return null;
  return { entries: stack.slice(idx).reverse(), rest: stack.slice(0, idx) };
}

/** Push N entries in array order and apply the cap ONCE. `pushUndo` caps per
 *  call, which is correct but re-slices N times; the through-path also needs a
 *  single fold so the commit is one setState. Pure. */
export function pushUndoMany<E extends { meta: UndoMeta }>(
  stack: readonly E[],
  entries: readonly E[],
  cap: number,
): E[] {
  const next = [...stack, ...entries];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
