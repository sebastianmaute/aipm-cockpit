// src/app/budget-import/source-evidence.ts — what a cited sheet cell proves
// (§500): the Claude route's rows each cite the cell their hours came from, and
// this module reads that cell, its row and the header above it. Used by
// `validateForecastRows` (the boundary) and `findUnreadCells` (what the reply
// left out). Pure: no i18n, no React, no DOM.

import { periodKeyForDate } from "../resource-capacity";
import { detectDecimalStyle, parseNumberCell, type DecimalStyle } from "./forecast-rows";
import {
  assignCellPeriod,
  isWeekSpacedColumn,
  assignRunDetailed,
  classifyPeriodCell,
  parseYearCell,
  resolvePeriod,
  type AssignedPeriod,
  type PeriodCell,
} from "./period-assign";
import type { SheetGrid } from "./sheet-grid";

/** Why a row's `source` does not back it: no cell of this sheet is named
 *  (missing, malformed, another sheet, outside the grid), the cell does not hold
 *  the hours, the person is not on the cell's row, the period is not the one
 *  above (or, with no period header above, beside) the cell, or an earlier row
 *  already used the cell. */
export type SourceRejection = "bad-ref" | "value-mismatch" | "person-not-on-row" | "period-not-near" | "cell-reused";

/** How far a cited cell may sit from the stated hours (rounding in the file). */
const SOURCE_HOURS_TOLERANCE = 0.005;
const LETTERS_IN_ALPHABET = 26;
const CHAR_CODE_A = 65;
const CELL_REF = /^([A-Z]{1,3})([1-9]\d*)$/;

/** A1 column letters as a 0-based index: A=0, Z=25, AA=26. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) index = index * LETTERS_IN_ALPHABET + (ch.charCodeAt(0) - CHAR_CODE_A + 1);
  return index - 1;
}

/** The cell part of `<sheet>!<A1>` or `'<sheet>'!<A1>` (an apostrophe inside
 *  the quotes is doubled), or null when the sheet part is not `sheetName` or is
 *  empty. The name is compared literally, never built into a pattern: names may
 *  hold `(`, `+`. */
function cellPartOf(source: string, sheetName: string): string | null {
  if (sheetName === "") return null;
  const bare = `${sheetName}!`;
  if (source.startsWith(bare)) return source.slice(bare.length);
  const quoted = `'${sheetName.replace(/'/g, "''")}'!`;
  if (source.startsWith(quoted)) return source.slice(quoted.length);
  return null;
}

/** One reference per cell: sheet name plus upper-case A1, whichever spelling
 *  (bare or quoted) cited it. A reference this sheet does not own keeps its
 *  text, so it still collides with an identical one. */
export function sourceKey(source: string, sheetName: string): string {
  const cellPart = cellPartOf(source, sheetName);
  return cellPart === null ? source : `${sheetName}!${cellPart.toUpperCase()}`;
}

/** The 0-based row and column a `source` names in this sheet (inside the grid
 *  or not), else null. */
export function sourcePosition(source: string, sheetName: string): { rowIdx: number; colIdx: number } | null {
  const cellPart = cellPartOf(source, sheetName);
  const match = cellPart === null ? null : CELL_REF.exec(cellPart);
  return match === null ? null : { rowIdx: Number(match[2]) - 1, colIdx: columnIndex(match[1]) };
}

/** The cited cell's 0-based row and column when `source` names a cell of
 *  `sheet`, else null. */
export function citedCell(source: string | undefined, sheet: SheetGrid): { rowIdx: number; colIdx: number; cell: string } | null {
  const at = source === undefined ? null : sourcePosition(source, sheet.name);
  const cell = at === null ? undefined : sheet.rows[at.rowIdx]?.[at.colIdx];
  return at === null || cell === undefined ? null : { ...at, cell };
}

/** A column's decimal style, decided over all of its cells. */
export function columnStyle(sheet: SheetGrid, col: number): DecimalStyle {
  return detectDecimalStyle(sheet.rows.map((row) => row[col] ?? ""), sheet.numbers);
}

/** A cell as a number by the sheet's own rule: a workbook's stored numbers with
 *  a dot, every other cell in its column's detected style. Never "either style":
 *  a CSV's `7,5` once backed a claimed 75 that way. */
export function sheetNumber(sheet: SheetGrid, col: number, cell: string, style = columnStyle(sheet, col)): number | null {
  return parseNumberCell(cell, style, sheet.numbers);
}

/** The column of the first cell of the row, other than the cited one, that names
 *  `text` (trimmed, case-insensitive) — preferring a cell that is not a period,
 *  so a period cell spelled like the person ("Mai") is not taken for them. */
export function columnNaming(rowCells: readonly string[], citedCol: number, text: string): number | null {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return null;
  const cols = rowCells.flatMap((cell, col) => (col !== citedCol && cell.trim().toLowerCase() === wanted ? [col] : []));
  return cols.find((col) => classifyPeriodCell(rowCells[col]) === null) ?? cols[0] ?? null;
}

/** The nearest row above `rowIdx` whose cell in `col` is period-shaped, else null. */
export function nearestPeriodRowAbove(sheet: SheetGrid, rowIdx: number, col: number): number | null {
  for (let r = rowIdx - 1; r >= 0; r--) {
    if (classifyPeriodCell(sheet.rows[r]?.[col] ?? "") !== null) return r;
  }
  return null;
}

/** The claimed period names `period`: a labelled claim must equal it (a date by
 *  its own month or ISO week, whichever `period` is); a year-less claim needs
 *  only the same month or week number, its year coming from the sheet. */
function claimNames(claim: PeriodCell, period: string): boolean {
  const isWeek = period.includes("-W");
  if (claim.year === undefined) {
    return claim.kind === (isWeek ? "week" : "month") && Number(period.slice(isWeek ? 6 : 5)) === claim.index;
  }
  if (claim.kind === "month" && claim.date !== undefined && isWeek) return periodKeyForDate(claim.date, "week") === period;
  return resolvePeriod(claim, undefined) === period;
}

/**
 * The period the cited cell sits under, when the claim names it. ★★ If the
 * cited column holds a period cell above the cell, the NEAREST one decides,
 * read as part of ITS header row's run (`assignRunDetailed`) — so a stacked
 * 2027 block, or a year-less "Jan" after "Dez", reads as that header says, and
 * a date elsewhere on the row (a "Start" column) vouches for nothing. Only
 * when the column above holds no period (a long sheet) is the row searched,
 * skipping the cited cell and the PERSON cell by position; there a year-less
 * period cell takes a year cell on the same row before `defaultYear`.
 */
export function periodNearCell(
  sheet: SheetGrid,
  at: { rowIdx: number; colIdx: number; personCol: number },
  claim: PeriodCell,
  defaultYear: number | undefined,
): AssignedPeriod | null {
  const headerRow = nearestPeriodRowAbove(sheet, at.rowIdx, at.colIdx);
  if (headerRow !== null) {
    const assigned = assignRunDetailed(sheet.rows[headerRow], { defaultYear, numbers: sheet.numbers })[at.colIdx];
    return assigned && claimNames(claim, assigned.period) ? assigned : null;
  }
  const cells = sheet.rows[at.rowIdx];
  const skip = (col: number): boolean => col === at.colIdx || col === at.personCol;
  const rowYear = cells.find((cell, col) => !skip(col) && parseYearCell(cell) !== undefined);
  for (let col = 0; col < cells.length; col++) {
    if (skip(col)) continue;
    // A long sheet's column of dates a week apart is weekly, as the hand route reads it.
    const weeks = isWeekSpacedColumn(sheet.rows.map((r) => r[col] ?? ""), sheet.numbers);
    const assigned = assignCellPeriod(cells[col], { rowYear, defaultYear, weeks });
    if (assigned && claimNames(claim, assigned.period)) return assigned;
  }
  return null;
}

export type SourceCheck = { problem: SourceRejection } | { period: AssignedPeriod };

/**
 * What a cited cell proves for a row: it must hold the hours (by the sheet's
 * number rule), ANOTHER cell of its row must name the PERSON, and the claimed
 * period must be the one the cell sits under (`periodNearCell`). Returns the
 * period as the SHEET reads it, or why the cell does not back the row. An
 * email never vouches for the person: the model can write any email beside any
 * name.
 */
export function checkSource(
  row: { person: string; hours: number; source?: string },
  claim: PeriodCell,
  sheet: SheetGrid,
  defaultYear: number | undefined,
): SourceCheck {
  const cited = citedCell(row.source, sheet);
  if (cited === null) return { problem: "bad-ref" };
  const value = sheetNumber(sheet, cited.colIdx, cited.cell);
  if (value === null || Math.abs(value - row.hours) > SOURCE_HOURS_TOLERANCE) return { problem: "value-mismatch" };
  const personCol = columnNaming(sheet.rows[cited.rowIdx], cited.colIdx, row.person);
  if (personCol === null) return { problem: "person-not-on-row" };
  const period = periodNearCell(sheet, { ...cited, personCol }, claim, defaultYear);
  return period === null ? { problem: "period-not-near" } : { period };
}
