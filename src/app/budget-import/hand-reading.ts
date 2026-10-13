// src/app/budget-import/hand-reading.ts — what the hand route reads in a sheet
// (§500), for the Claude route's check: H, one of the period sources that must
// all agree (`periodNearCell`, fix 8). Pure: no i18n, no React, no DOM.

import { gridToForecastRows } from "./forecast-rows";
import type { ColumnMapping } from "./forecast-types";
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

/** What the Claude route's check reads a sheet's columns by: the hand route's
 *  reading, `"unconfirmed"` when its detection is ambiguous and nobody has
 *  confirmed the columns (every claim is then refused `columns-unconfirmed`),
 *  or null with no reading (an unknown layout). */
export type HandSource = HandReading | "unconfirmed" | null;

const READINGS = new WeakMap<SheetGrid, Map<string, HandSource>>();

/** The hand route's period for a cell, or undefined when it does not read it
 *  (nor, on a long sheet, its row). */
export function handPeriodAt(hand: HandReading | null, rowIdx: number, colIdx: number): AssignedPeriod | undefined {
  if (hand === null) return undefined;
  return hand.cells.get(`${rowIdx}:${colIdx}`) ?? (hand.layout === "long" ? hand.rows.get(rowIdx) : undefined);
}

/**
 * What the hand route reads in `sheet`, exactly as the dialog does
 * (`gridToForecastRows`): with `mapping` when the user edited or confirmed the
 * columns (fix 8: the hook passes its own), else with the sheet's detection in
 * `defaultYear` (`detectLayout`) — `"unconfirmed"` when that is ambiguous, null
 * when it is unknown. Computed once per grid and mapping (or default year):
 * grids are never mutated.
 */
export function handReadingOf(sheet: SheetGrid, defaultYear: number | undefined, mapping?: ColumnMapping): HandSource {
  const key = mapping === undefined ? `detect:${defaultYear ?? ""}` : `mapping:${JSON.stringify(mapping)}`;
  const perSheet = READINGS.get(sheet) ?? new Map<string, HandSource>();
  if (perSheet.has(key)) return perSheet.get(key) ?? null;
  const reading = computeHandReading(sheet, defaultYear, mapping);
  perSheet.set(key, reading);
  READINGS.set(sheet, perSheet);
  return reading;
}

function computeHandReading(sheet: SheetGrid, defaultYear: number | undefined, mapping: ColumnMapping | undefined): HandSource {
  if (mapping !== undefined) return readWith(sheet, mapping);
  const detected = detectLayout(sheet.rows, { numbers: sheet.numbers, defaultYear });
  if (detected.mapping === null) return null;
  return detected.ambiguous.length > 0 ? "unconfirmed" : readWith(sheet, detected.mapping);
}

function readWith(sheet: SheetGrid, mapping: ColumnMapping): HandReading {
  const layout = mapping.layout;
  const cells = new Map<string, AssignedPeriod>();
  const rows = new Map<number, AssignedPeriod>();
  gridToForecastRows(sheet.rows, mapping, sheet.name, sheet.numbers, (rowIdx, col, period) => {
    cells.set(`${rowIdx}:${col}`, period);
    if (layout === "long") rows.set(rowIdx, period);
  });
  return { layout, cells, rows };
}
