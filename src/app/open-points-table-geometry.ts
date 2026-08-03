// src/app/open-points-table-geometry.ts
//
// Pure, i18n-free geometry for the Open Points table. No React, no DOM — jsdom
// reports every rect as 0, so every number here has to be derivable from the
// declared widths alone.
//
// ★ WHY THIS EXISTS AT ALL. The table is `table-layout: fixed` and was sized
//   `width: max-content; min-width: 100%`, so its used width exceeded the sum of
//   the declared <col> widths and the browser spread the leftover across the
//   columns. OBSERVED SYMPTOM (from the reported screenshot): the gutter + `sel`
//   + `status` group rendered ~138px against 100px declared — roughly +12.7px on
//   EACH, which is invisible on a 200px column and about a third again on a 36px
//   one. That is the padding at both edges of the table.
//   ★★ The exact distribution rule is NOT verified here. An equal-per-column
//   split fits the measurement above; a proportional split does not. But that
//   inference is from one screenshot, no gate or test in this repo can check it,
//   and CSS 2.1 §17.5.2.1 only says the excess "should be distributed over the
//   columns". Do not restate it as settled engine behaviour — the FIX holds
//   under either rule, because an auto column absorbs the leftover before any
//   fixed column does. Settle it with a DevTools measurement before relying on
//   the mechanism for anything else.
//
// ★ WHY NOT `width: max-content` (what the table used before). With an auto
//   column present, max-content resolves against that column's longest unwrapped
//   content — the longest task title — so the table would outgrow the viewport
//   and the pane would scroll horizontally at all times. `tableMinWidthPx` gives
//   the same overflow floor deterministically, from numbers we already hold.

// ★ BOTH from the DOM-free leaf. Importing DEFAULT_COL_WIDTHS from
//   `use-column-manager` (which is `"use client"`) put React back into this
//   module's graph and made the "no React" claim above false.
import { ALL_TASK_COLS, DEFAULT_COL_WIDTHS } from "./tasks-section-columns";

/** The leading gutter <col className="w-7"> that matches the per-row hover
 *  Ask-Claude cell. Tailwind `w-7` is 1.75rem = 28px at the default root size. */
export const GUTTER_WIDTH_PX = 28;

/** Floor for the flex column. Below this the task titles stop being readable,
 *  so the table overflows and the pane scrolls instead. */
export const TASK_NAME_MIN_PX = 200;

/** The one column that takes the leftover. */
const FLEX_COL = "taskName";

/** Width for a column id with no `DEFAULT_COL_WIDTHS` entry. Matches the drag
 *  fallback in `use-column-resize.ts`, which uses the same number for the same
 *  reason: an unknown column still has to be SOME width. */
const FALLBACK_COL_WIDTH_PX = 80;

/**
 * The declared width of a non-flex column.
 *
 * ★★ BOTH consumers below must route through this, or they disagree about an
 *    id that is in `ALL_TASK_COLS` but missing from `DEFAULT_COL_WIDTHS`:
 *    `colWidthStyle` would emit no width — making it a SECOND auto column and
 *    destroying the single-flex-column premise this whole module rests on —
 *    while `tableMinWidthPx` counted it as 0 and under-measured the table. Both
 *    failure modes are silent, and invisible in jsdom. Unreachable today (all 18
 *    ids have defaults), reachable the moment someone adds a column id without
 *    one, which is exactly when nobody would be looking for it.
 */
function declaredWidth(col: string): number {
  return DEFAULT_COL_WIDTHS[col] ?? FALLBACK_COL_WIDTH_PX;
}

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
 *
 * ★★ CONSEQUENCE, and it is a real one: dragging `taskName` leaves NO auto
 *    column, so the table's leftover goes back to being spread across every
 *    column and the edge padding this module exists to remove RETURNS — until
 *    the user hits "reset columns". Accepted for now because the alternative
 *    (honour the drag as a floor but keep the column auto) makes the grip stop
 *    tracking the pointer past that floor, which reads as broken. If this is
 *    ever revisited, that is the trade to weigh. Documented in AGENTS.md.
 */
export function colWidthStyle(
  col: string,
  sizedWidths: Readonly<Partial<Record<string, number>>>,
): number | undefined {
  const sized = sizedWidths[col];
  if (sized !== undefined) return sized;
  if (col === FLEX_COL) return undefined;
  return declaredWidth(col);
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
    return sum + (sized ?? declaredWidth(col));
  }, GUTTER_WIDTH_PX);
}
