// Pure i18n-free helper for the edit-modal chip pickers (linked tasks / linked
// RAID / caused-by). Every picker filtered its option list the same way:
// drop already-selected ids, then match a query against the id (bare or `#`-prefixed) OR a text field
// (`*` accepted as a wildcard — see `wildcard-match.ts`), then cap the list.
// Single-sourced here so the four useMemo blocks in change-edit-modal /
// raid-edit-modal can't drift.

import { wildcardMatcher } from "./wildcard-match";

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
  // A leading `#` is stripped for the ID comparison ONLY — users write "#42".
  // The text matcher below still sees the raw query, so a `#` inside a name
  // keeps matching by name. A bare "#" strips to "", which no stringified
  // numeric id ever equals, so it safely falls through to the text matcher
  // instead of becoming an everything-matches empty query.
  const idQuery = q.startsWith("#") ? q.slice(1) : q;
  // Built once per call — a matcher per item would recompile the RegExp for
  // every row on every keystroke.
  const matches = wildcardMatcher(q);
  return items
    .filter((item) => !excludeIds.has(getId(item)))
    .filter((item) => (extraFilter ? extraFilter(item) : true))
    .filter((item) => {
      if (!q) return true;
      if (String(getId(item)) === idQuery) return true;
      return matches(getText(item));
    })
    .slice(0, limit);
}
