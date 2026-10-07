// Pure reconciliation of the Open Points list filters against the values that
// actually exist on the live tasks.
//
// The assignee/group/label filters hold a free string picked from a dropdown
// whose options are DERIVED from the task list. Editing the last task carrying a
// value (reassign, re-group, re-label) removes its option while the filter state
// keeps pointing at it. The filter still hides every row, but the <select> can
// no longer name it — with no matching option the control falls back to its
// first one and reads "All", so the table looks unfiltered and empty at once,
// with nothing to click to recover.
//
// Resolving the effective value here gives the row filtering and the <select>
// ONE source, so they cannot drift apart. The raw filter state is deliberately
// left untouched: it lives in a parent provider (neither an effect nor a
// render-phase setState can reach it from the pane), and leaving it alone makes
// the fallback self-healing — undo the reassign and the filter comes back.
//
// i18n-free and dependency-free so it is unit-testable without rendering.

/**
 * Sentinel for "no filter" — the value of every filter <select>'s first option.
 *
 * ★ It starts with a space ON PURPOSE (§676). The group and label option lists
 * are built from TRIMMED values (`uniqueGroups`, `labelOptions`), so neither
 * can offer a value equal to it; the assignee list takes names as stored, so
 * only an assignee saved with a leading space and this exact text could. The old
 * sentinel "All" could, and a group named "All" then filtered nothing. Not NUL
 * or another control character: the toolbar is server-rendered, and the HTML
 * parser rewrites U+0000 inside an attribute, which would split the option's
 * value between server and client.
 */
export const FILTER_ALL = " (all)";

/**
 * The sentinel saved views stored before §676. Read it back as `FILTER_ALL`:
 * it meant "no filter" then, whether or not some group was literally "All".
 */
export const LEGACY_FILTER_ALL = "All";

/** A stored assignee/group/label filter value, with the pre-§676 sentinel upgraded. */
export function upgradeStoredFilter(value: string): string {
  return value === LEGACY_FILTER_ALL ? FILTER_ALL : value;
}

/**
 * The group <select> renders a permanent "No group" option, so the empty string
 * is always a selectable group filter — unlike a blank assignee, which is only
 * offered while `uniqueAssignees` still contains one (an unassigned task).
 * Resolving it away would make "No group" impossible to select.
 */
export const GROUP_NONE = "";

export interface TaskFilterValues {
  assignee: string;
  group: string;
  label: string;
}

export interface TaskFilterOptions {
  assignees: readonly string[];
  groups: readonly string[];
  labels: readonly string[];
}

/**
 * Keep `value` only while some live task still carries it, else fall back to
 * All. A case-insensitive match resolves to the OPTION's spelling, so the
 * <select> finds its option even when the stored value is cased differently
 * (§675); the row filter compares case-insensitively, so the rows are the same.
 */
function resolve(value: string, options: readonly string[], caseInsensitive = false): string {
  if (value === FILTER_ALL) return FILTER_ALL;
  const match = caseInsensitive
    ? options.find((o) => o.toLowerCase() === value.toLowerCase())
    : options.find((o) => o === value);
  return match ?? FILTER_ALL;
}

/**
 * The label filter's options: one per label whatever its case (§675). The
 * label filter compares case-insensitively, so "API" on one task and "api" on
 * another filter identically; offered as two options they would also sound
 * alike to a screen reader. Each option takes the spelling the most tasks
 * carry, a tie going to the one that sorts first, and the options are sorted.
 */
export function labelOptions(tasks: readonly { labels?: readonly string[] }[]): string[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const t of tasks) {
    const seen = new Set<string>();
    for (const raw of t.labels ?? []) {
      const label = raw.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const key = label.toLowerCase();
      const counts = spellings.get(key) ?? new Map<string, number>();
      counts.set(label, (counts.get(label) ?? 0) + 1);
      spellings.set(key, counts);
    }
  }
  const pick = (counts: Map<string, number>): string =>
    [...counts].sort(([a, n], [b, m]) => m - n || a.localeCompare(b))[0][0];
  return [...spellings.values()].map(pick).sort((a, b) => a.localeCompare(b));
}

/**
 * Map the raw filter values onto the ones that can still match a row.
 *
 * Each comparison mirrors how the row filter itself compares that field:
 * assignee and group are matched exactly, labels case-insensitively. Matching
 * more loosely here than the row filter does would keep a filter that hides
 * every row — the exact state this exists to prevent.
 *
 * ONE seam where the mirror is imperfect: the option lists trim (`uniqueGroups`
 * / `uniqueLabels`) while the row filter compares the untrimmed field, so a task
 * whose group is " G1 " offers the option "G1" that then matches no row. Every
 * write path trims (`sanitizeGroup` via `sanitizeText`; `sanitizeLabel` and the
 * template `nonEmptyStr` trim on their own), so this is only reachable through a
 * hand-edited JSON workspace — neither the JSON nor the IndexedDB load path runs
 * a field sanitizer, so once such a value is imported and autosaved the IDB copy
 * carries it forward across reloads without a further import.
 */
export function resolveEffectiveFilters(
  values: TaskFilterValues,
  options: TaskFilterOptions,
): TaskFilterValues {
  return {
    assignee: resolve(values.assignee, options.assignees),
    group: values.group === GROUP_NONE ? GROUP_NONE : resolve(values.group, options.groups),
    label: resolve(values.label, options.labels, true),
  };
}
