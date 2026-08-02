// src/app/open-points-table-geometry.ts
//
// Pure, i18n-free geometry for the Open Points table. No React, no DOM — jsdom
// reports every rect as 0, so every number here has to be derivable from the
// declared widths alone.
//
// ★ WHY THIS EXISTS AT ALL. The table is `table-layout: fixed`. When its used
//   width exceeds the sum of the declared <col> widths, Blink hands the leftover
//   out EQUALLY to every column — not in proportion to declared width. So a 36px
//   utility column gained the same ~7-13px a 200px content column did, which is
//   invisible on the wide ones and a ~35% inflation on the narrow ones. Making
//   `taskName` the single auto-width column sends all of that leftover to the one
//   column that can use it.
//
// ★ WHY NOT `width: max-content` (what the table used before). With an auto
//   column present, max-content resolves against that column's longest unwrapped
//   content — the longest task title — so the table would outgrow the viewport
//   and the pane would scroll horizontally at all times. `tableMinWidthPx` gives
//   the same overflow floor deterministically, from numbers we already hold.

import { ALL_TASK_COLS } from "./tasks-section-columns";
import { DEFAULT_COL_WIDTHS } from "./use-column-manager";

/** The leading gutter <col className="w-7"> that matches the per-row hover
 *  Ask-Claude cell. Tailwind `w-7` is 1.75rem = 28px at the default root size. */
export const GUTTER_WIDTH_PX = 28;

/** Floor for the flex column. Below this the task titles stop being readable,
 *  so the table overflows and the pane scrolls instead. */
export const TASK_NAME_MIN_PX = 200;

/** The one column that takes the leftover. */
const FLEX_COL = "taskName";

export type TaskColId = (typeof ALL_TASK_COLS)[number];

/** Visible columns, in declaration order. */
export function visibleTaskCols(hiddenCols: ReadonlySet<string>): TaskColId[] {
  return ALL_TASK_COLS.filter((col) => !hiddenCols.has(col));
}

/**
 * The inline `width` a column's <col> should carry, or `undefined` to leave it
 * auto.
 *
 * ★ Only an UN-SIZED flex column goes auto. Once the user has dragged it they
 *   have expressed a width, and silently ignoring it would make the resize grip
 *   look broken on that one column.
 */
export function colWidthStyle(
  col: string,
  sizedWidths: Readonly<Partial<Record<string, number>>>,
): number | undefined {
  const sized = sizedWidths[col];
  if (sized !== undefined) return sized;
  if (col === FLEX_COL) return undefined;
  return DEFAULT_COL_WIDTHS[col];
}

/**
 * Smallest width the table may take: the gutter plus every visible column, with
 * the flex column counted at its floor. Below this the browser would shrink the
 * flex column past readability instead of overflowing.
 */
export function tableMinWidthPx(
  visibleCols: readonly string[],
  sizedWidths: Readonly<Partial<Record<string, number>>>,
): number {
  return visibleCols.reduce((sum, col) => {
    const sized = sizedWidths[col];
    if (col === FLEX_COL) return sum + Math.max(TASK_NAME_MIN_PX, sized ?? 0);
    return sum + (sized ?? DEFAULT_COL_WIDTHS[col] ?? 0);
  }, GUTTER_WIDTH_PX);
}
