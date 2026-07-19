// Pure i18n-free helper for the edit-modal chip pickers (linked tasks / linked
// RAID / caused-by). Every picker filtered its option list the same way:
// drop already-selected ids, then match a query against the id OR a text field,
// then cap the list. Single-sourced here so the four useMemo blocks in
// change-edit-modal / raid-edit-modal can't drift.

export interface PickerFilterOptions<T> {
  /** Raw search box text (trimmed + lowercased internally). */
  query: string;
  /** Ids already selected — excluded from the option list. */
  excludeIds: ReadonlySet<number>;
  getId: (item: T) => number;
  getText: (item: T) => string;
  /** Extra predicate applied before the query (e.g. self / cycle exclusion). */
  extraFilter?: (item: T) => boolean;
  /** Max options returned (default 20). */
  limit?: number;
}

export function filterPickerOptions<T>(
  items: readonly T[],
  opts: PickerFilterOptions<T>,
): T[] {
  const { query, excludeIds, getId, getText, extraFilter, limit = 20 } = opts;
  const q = query.trim().toLowerCase();
  return items
    .filter((item) => !excludeIds.has(getId(item)))
    .filter((item) => (extraFilter ? extraFilter(item) : true))
    .filter((item) => {
      if (!q) return true;
      if (String(getId(item)) === q) return true;
      return getText(item).toLowerCase().includes(q);
    })
    .slice(0, limit);
}
