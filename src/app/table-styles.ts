/**
 * Shared header styling for every primary data table (the `table.png`
 * treatment): a sticky Dark-Blue header row with white, normal-case labels.
 * Single source of truth — change the table header look here.
 *
 * Palette note: Dark Blue (#004159) header + White (#FFFFFF) text are both
 * permitted AIPM brand colors; button/sort hovers inside the header use the
 * Green accent (see the SortResizeTh / per-table header buttons).
 *
 * The `aipm-cockpit-thead` marker drives the rounded-header treatment in globals.css:
 * the Dark-Blue fill lives on the `<th>` cells (not the `<thead>`) and the
 * first/last header cells get rounded top corners, so the header bar reads as
 * an enclosed pill with rounded corners on BOTH ends — regardless of how the
 * table is inset in its card. The fill is moved to `th` (via CSS) because a
 * rounded `<th>` can only clip a fill it actually paints.
 */
export const TABLE_HEAD_CLASS =
  "aipm-cockpit-thead sticky top-0 z-10 text-xs text-[var(--table-head-fg)]";

/**
 * Row separator for a body `<tr>` in any table carrying `TABLE_HEAD_CLASS`
 * (open-followups §68).
 *
 * ★★★ THE RULE MUST SIT ON THE CELLS, AND PUTTING IT ON THE `<tr>` IS THE
 * DEFECT THIS EXISTS TO PREVENT. The `aipm-cockpit-thead` marker puts its table
 * into the SEPARATED borders model (`globals.css`,
 * `table:has(> .aipm-cockpit-thead) { border-collapse: separate }`), and CSS 2.2
 * §17.6.1 says that model ignores borders set on rows, row groups, columns and
 * column groups. So `<tr className="border-b border-line">` is dead markup — it
 * paints nothing AND adds nothing to the row box (measured in Chrome: a row is
 * 30px at both 1px and 2px, while the same border on a `<td>` paints and grows
 * the box to 32px).
 *
 * ★★ IT READS AS WORKING, which is why eight of these shipped across six files.
 * Tailwind's own preflight sets `border-collapse: collapse` on every `<table>`,
 * under which a `<tr>` border WOULD paint; it is the `globals.css` override that
 * breaks it, and only for tables carrying the marker.
 *
 * ★ An explicit `border-collapse` Tailwind utility on the table does NOT opt back
 * into the collapsed model — the `globals.css` rule is UNLAYERED and therefore
 * beats a layered utility whatever the specificity.
 *
 * ★★ ONE IDIOM ON PURPOSE. The eight original sites were split between
 * `border-t` (which also draws a line directly under the header pill) and
 * `border-b last:border-0` (which does not), and one `border-b` carried no
 * last-row exemption at all, so it would have closed the table with a rule no
 * sibling had. That split was drift, not intent; it was settled deliberately on
 * the bottom-border form — no line under the header, none after the last row.
 *
 * ★ NOTHING CAN TEST THIS. jsdom has no layout, so no unit test can see a
 * painted border either way; the tests that exist pin the CLASS placement, and
 * the appearance itself is eye-verified. `BucketTotalRow` reaches the same place
 * by a different route (a `cellClass` prop threaded to each of its cells)
 * because it composes its cells from components rather than writing `<td>`s.
 */
export const ROW_RULE_CLASS =
  "[&>td]:border-b [&>td]:border-line last:[&>td]:border-b-0";
