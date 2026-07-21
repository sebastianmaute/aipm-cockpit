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

/** Sentinel for "no filter" — the value of every filter <select>'s first option. */
export const FILTER_ALL = "All";

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

/** Keep `value` only while some live task still carries it, else fall back to All. */
function resolve(value: string, options: readonly string[], caseInsensitive = false): string {
  if (value === FILTER_ALL) return FILTER_ALL;
  const matches = caseInsensitive
    ? options.some((o) => o.toLowerCase() === value.toLowerCase())
    : options.includes(value);
  return matches ? value : FILTER_ALL;
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
