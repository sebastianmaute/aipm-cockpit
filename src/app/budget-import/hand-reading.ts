// src/app/budget-import/hand-reading.ts — what the hand route reads in a sheet
// (§500), for the Claude route's check: H, one of the period sources that must
// all agree (`periodNearCell`, fix 8). Pure: no i18n, no React, no DOM.

import { gridToForecastRows } from "./forecast-rows";
import type { ColumnMapping } from "./forecast-types";
import { detectLayout } from "./layout-detect";
import type { AssignedPeriod } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";

/** The periods the hand route reads, per cell read into a row (`"row:col"`,
 *  0-based), and the sheet rows those cells sit on (`readRows`). ★★★ Only a
 *  read cell has a period here (fix 8 round 3, fail closed): a long row's
 *  period once covered EVERY cell of that row, so a claim citing its `Ist` or
 *  `Kosten` cell stood in the row's month whatever that cell held. */
export type HandReading = {
  layout: "wide" | "long";
  /** The mapping's person column: a claim's person must sit in it (fix 9 OOS-a). */
  person: number;
  cells: ReadonlyMap<string, AssignedPeriod>;
  readRows: ReadonlySet<number>;
};

/** What the Claude route's check reads a sheet's columns by: the hand route's
 *  reading, `"unconfirmed"` when its detection is ambiguous and nobody has
 *  confirmed the columns (every claim is then refused `columns-unconfirmed`),
 *  or null with no reading (an unknown layout). */
export type HandSource = HandReading | "unconfirmed" | null;

const READINGS = new WeakMap<SheetGrid, Map<string, HandSource>>();

/** The hand route's period for a cell, or undefined when it does not read
 *  that cell. */
export function handPeriodAt(hand: HandReading | null, rowIdx: number, colIdx: number): AssignedPeriod | undefined {
  return hand?.cells.get(`${rowIdx}:${colIdx}`);
}

/** The hand route reads other cells of this row but not this one: a claim
 *  citing it is refused `cell-not-read` (`checkSource`). */
export function isUnreadCellOfReadRow(hand: HandReading | null, rowIdx: number, colIdx: number): boolean {
  return hand !== null && hand.readRows.has(rowIdx) && handPeriodAt(hand, rowIdx, colIdx) === undefined;
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
  const cells = new Map<string, AssignedPeriod>();
  const readRows = new Set<number>();
  gridToForecastRows(sheet.rows, mapping, sheet.name, sheet.numbers, (rowIdx, col, period) => {
    cells.set(`${rowIdx}:${col}`, period);
    readRows.add(rowIdx);
  });
  return { layout: mapping.layout, person: mapping.person, cells, readRows };
}
