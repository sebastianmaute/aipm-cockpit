// src/app/budget-import/hand-reading.ts — what the hand route reads in a sheet
// (§500), for the Claude route's check: ONE source of truth for the cells the
// hand route reads (rr7 I1, controller ruling). Pure: no i18n, no React, no DOM.

import { gridToForecastRows } from "./forecast-rows";
import { detectLayout } from "./layout-detect";
import type { AssignedPeriod } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";

/** The periods the hand route reads: per cell read into a row (`"row:col"`,
 *  0-based), and on a long sheet per sheet row too, since every cell of such a
 *  row is in that row's period. */
export type HandReading = {
  layout: "wide" | "long";
  cells: ReadonlyMap<string, AssignedPeriod>;
  rows: ReadonlyMap<number, AssignedPeriod>;
};

const READINGS = new WeakMap<SheetGrid, Map<string, HandReading | null>>();

/** The hand route's period for a cell, or undefined when it does not read it
 *  (nor, on a long sheet, its row). */
export function handPeriodAt(hand: HandReading | null, rowIdx: number, colIdx: number): AssignedPeriod | undefined {
  if (hand === null) return undefined;
  return hand.cells.get(`${rowIdx}:${colIdx}`) ?? (hand.layout === "long" ? hand.rows.get(rowIdx) : undefined);
}

/**
 * What the hand route reads in `sheet` with `defaultYear`, exactly as the
 * dialog does (`detectLayout`, then `gridToForecastRows`) — or null when its
 * detection is unknown or ambiguous, where it reads nothing it is sure of.
 * Computed once per grid and default year: grids are never mutated.
 */
export function handReadingOf(sheet: SheetGrid, defaultYear: number | undefined): HandReading | null {
  const yearKey = defaultYear === undefined ? "" : String(defaultYear);
  const known = READINGS.get(sheet)?.get(yearKey);
  if (known !== undefined) return known;
  const reading = computeHandReading(sheet, defaultYear);
  const perYear = READINGS.get(sheet) ?? new Map<string, HandReading | null>();
  perYear.set(yearKey, reading);
  READINGS.set(sheet, perYear);
  return reading;
}

function computeHandReading(sheet: SheetGrid, defaultYear: number | undefined): HandReading | null {
  const detected = detectLayout(sheet.rows, { numbers: sheet.numbers, defaultYear });
  if (detected.mapping === null || detected.ambiguous.length > 0) return null;
  const layout = detected.mapping.layout;
  const cells = new Map<string, AssignedPeriod>();
  const rows = new Map<number, AssignedPeriod>();
  gridToForecastRows(sheet.rows, detected.mapping, sheet.name, sheet.numbers, (rowIdx, col, period) => {
    cells.set(`${rowIdx}:${col}`, period);
    if (layout === "long") rows.set(rowIdx, period);
  });
  return { layout, cells, rows };
}
