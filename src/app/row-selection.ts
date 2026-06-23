// Pure set operations for multi-row selection (shared by the entity panels'
// bulk-edit feature). i18n-free, no React — testable in isolation.

/** Toggle one id in/out of the selection, returning a NEW set (immutable). */
export function toggleInSet(set: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Select-all-visible toggle: if every visible id is already selected, deselect
 *  them all; otherwise add them all. Ids outside `visibleIds` are untouched, so
 *  a filtered "select all" never clobbers selection hidden by the current
 *  filter. Returns a NEW set. Empty `visibleIds` is a no-op (returns a copy). */
export function toggleAllInSet(set: ReadonlySet<number>, visibleIds: readonly number[]): Set<number> {
  const next = new Set(set);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => set.has(id));
  if (allSelected) {
    for (const id of visibleIds) next.delete(id);
  } else {
    for (const id of visibleIds) next.add(id);
  }
  return next;
}

/** True when every visible id is selected (drives the header checkbox state).
 *  False for an empty visible list (nothing to "select all"). */
export function allVisibleSelected(set: ReadonlySet<number>, visibleIds: readonly number[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => set.has(id));
}
