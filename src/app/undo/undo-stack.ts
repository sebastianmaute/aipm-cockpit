// src/app/undo/undo-stack.ts
// Pure, i18n-free, clock-free engine for the local undo stack. One primitive
// (applyUndoRestore) reverses delete / bulk-edit / clear-all by upserting
// captured before-images by id — so undo touches only the rows the op touched
// and survives edits made to OTHER rows between the op and the undo.
import type { ActivityKind } from "../activity-log";

/** A captured pre-op snapshot of one row plus its position in the source array. */
export type BeforeImage<T> = { index: number; item: T };

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
 * Upsert before-images into `current` by id: a still-present row is reverted to
 * its before-image (bulk-edit); an absent row is re-inserted at its original
 * index, clamped to the array end (delete / clear-all). Pure.
 */
export function applyUndoRestore<T extends { id: number }>(
  current: readonly T[],
  before: readonly BeforeImage<T>[],
): T[] {
  const present = new Set(current.map((r) => r.id));
  const out = current.slice();
  for (const { index, item } of before) {
    if (present.has(item.id)) {
      out[out.findIndex((r) => r.id === item.id)] = item;
    } else {
      out.splice(Math.min(index, out.length), 0, item);
      present.add(item.id);
    }
  }
  return out;
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
