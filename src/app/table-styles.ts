/**
 * Shared header styling for every primary data table (the `table.png`
 * treatment): a sticky Dark-Blue header row with white, uppercase, tracked
 * labels. Single source of truth — change the table header look here.
 *
 * Palette note: Dark Blue (#004159) header + White (#FFFFFF) text are both
 * permitted AIPM brand colors; button/sort hovers inside the header use the
 * Green accent (see SortableTh / per-table header buttons).
 *
 * The `aipm-cockpit-thead` marker drives the rounded-header treatment in globals.css:
 * the Dark-Blue fill lives on the `<th>` cells (not the `<thead>`) and the
 * first/last header cells get rounded top corners, so the header bar reads as
 * an enclosed pill with rounded corners on BOTH ends — regardless of how the
 * table is inset in its card. The fill is moved to `th` (via CSS) because a
 * rounded `<th>` can only clip a fill it actually paints.
 */
export const TABLE_HEAD_CLASS =
  "aipm-cockpit-thead sticky top-0 z-10 text-xs uppercase tracking-wide text-[var(--table-head-fg)]";
