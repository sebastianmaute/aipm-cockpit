/**
 * Pure list-reorder arithmetic shared by every drag-to-reorder surface.
 *
 * NO React, NO DOM, NO i18n — this file must stay importable from a bare node
 * process so it can be property-tested and reused without a jsdom environment.
 *
 * ★★ THE SPLICE SEMANTICS ARE LOAD-BEARING AND WERE NOT UNIFORM BEFORE THIS
 * EXISTED. The dragged id is removed FIRST and then inserted at the index the
 * target held BEFORE that removal, so the dragged item takes the target's slot:
 * dropping on a LATER item lands after it, dropping on an EARLIER item lands
 * before it. `roles-editor.tsx` used to compute the insert index on the ALREADY
 * FILTERED array, which always lands before the target; that behaviour was
 * dropped in favour of this one when it adopted this module.
 */

/** Reorder `ids` by moving `dragId` into `targetId`'s slot. Returns the SAME
 *  array reference on a no-op, so callers can skip a commit cheaply. */
export function reorderIds<Id>(ids: readonly Id[], dragId: Id, targetId: Id): Id[] | readonly Id[] {
  if (dragId === targetId) return ids;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}

/**
 * Which edge of `targetId` a drop will land on, or null when the pair is not a
 * valid drop.
 *
 * ★★ DERIVED FROM THE SPLICE, never chosen for looks. Because `reorderIds`
 * removes the dragged id BEFORE inserting at the target's original index, every
 * index above the target shifts down by one: dropping on a LATER item lands
 * after it, dropping on an EARLIER item lands before it. Marking one fixed edge
 * would be correct in one direction and a lie in the other.
 */
export function dropEdgeFor<Id>(
  ids: readonly Id[],
  dragId: Id,
  targetId: Id,
): "before" | "after" | null {
  if (dragId === targetId) return null;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  return from < to ? "after" : "before";
}
