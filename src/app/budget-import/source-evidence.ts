// src/app/budget-import/source-evidence.ts — what a cited sheet cell proves
// (§500): the Claude route's rows each cite the cell their hours came from, and
// this module reads that cell, its row and the header above it. Used by
// `validateForecastRows` (the boundary) and `findUnreadCells` (what the reply
// left out). Pure: no i18n, no React, no DOM.

import { periodKeyForDate } from "../resource-capacity";
import { detectDecimalStyle, isBlank, parseNumberCell, type DecimalStyle } from "./forecast-rows";
import { handPeriodAt, type HandReading } from "./hand-reading";
import { isPeriodWordHeader } from "./layout-detect";
import {
  assignCellPeriod,
  isWeekSpacedColumn,
  assignRunDetailed,
  classifyPeriodCell,
  headerProbeRun,
  isPeriodShapedIn,
  parseYearCell,
  resolvePeriod,
  type AssignedPeriod,
  type PeriodCell,
} from "./period-assign";
import type { SheetGrid } from "./sheet-grid";

/** Why a row's `source` does not back it: no cell of this sheet is named
 *  (missing, malformed, another sheet, outside the grid), the cell does not hold
 *  the hours, the person is not on the cell's row, the period is not the one
 *  above (or, with no period header above, beside) the cell, the header above
 *  the cell and a period cell on its row name different periods
 *  (`period-conflict`, `periodNearCell`), or an earlier row already used the
 *  cell. */
export type SourceRejection = "bad-ref" | "value-mismatch" | "person-not-on-row" | "period-not-near" | "period-conflict" | "cell-reused";

/** What a `period-conflict` names, as canonical keys: the period the hand
 *  route reads the cited cell in (`sheet`), or what a period cell on the cited
 *  row says and what the column header above the cell says. */
export type PeriodConflict = { sheet: string } | { row: string; header: string };

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

/** Per-column facts of one sheet, each computed once: `style` (`columnStyle`),
 *  `weekly` (`isWeekSpacedColumn`) and `headerAbove` (per row, the nearest
 *  period header row above it in the column, -1 for none:
 *  `nearestPeriodRowAbove`). Recomputing them per claim made the Claude-route
 *  check take a second at the 4000-cell cap (re-review). Grids are never
 *  mutated, so the facts are kept per grid object. */
export type ColumnFacts = {
  style: (col: number) => DecimalStyle;
  weekly: (col: number) => boolean;
  headerAbove: (col: number) => readonly number[];
};

const FACTS = new WeakMap<SheetGrid, ColumnFacts>();

export function columnFacts(sheet: SheetGrid): ColumnFacts {
  const known = FACTS.get(sheet);
  if (known !== undefined) return known;
  const memo = <T>(compute: (col: number) => T): ((col: number) => T) => {
    const cache = new Map<number, T>();
    return (col) => {
      if (!cache.has(col)) cache.set(col, compute(col));
      return cache.get(col) as T;
    };
  };
  const runOf = memo((row) => headerProbeRun(sheet.rows[row] ?? [], sheet.numbers ?? "text"));
  const facts: ColumnFacts = {
    style: memo((col) => columnStyle(sheet, col)),
    weekly: memo((col) => isWeekSpacedColumn(sheet.rows.map((r) => r[col] ?? ""), sheet.numbers)),
    headerAbove: memo((col) => headersAbove(sheet, col, runOf)),
  };
  FACTS.set(sheet, facts);
  return facts;
}

/** A column's decimal style, decided over all of its cells. */
export function columnStyle(sheet: SheetGrid, col: number): DecimalStyle {
  return detectDecimalStyle(sheet.rows.map((row) => row[col] ?? ""), sheet.numbers);
}

/** A cell as a number by the sheet's own rule: a workbook's stored numbers with
 *  a dot, every other cell in its column's detected style. Never "either style":
 *  a CSV's `7,5` once backed a claimed 75 that way. */
export function sheetNumber(sheet: SheetGrid, col: number, cell: string, style = columnFacts(sheet).style(col)): number | null {
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

/** The nearest row above `rowIdx` that is a PERIOD HEADER for `col`, else null:
 *  a row whose run (`assignRunDetailed`) gives `col` a period. ★★ Text in the
 *  grid never bounds the search — a placeholder (`-`, `Urlaub`), a unit row
 *  (`Std`) or a `Plan | Ist` sub-header between the header and the cell once
 *  rejected every valid claim beneath it (re-review 3). A period-shaped cell
 *  whose row gives it no period (a title row's lone date: `withoutLoneDate`; a
 *  two-date range such as `Zeitraum | 01.01.2026 | 31.12.2026`:
 *  `withoutDateRange`) is passed over, so a long sheet with a dated title row
 *  still falls back to the row search. A year-less header counts whatever the default year
 *  (`headerProbeRun`); `periodNearCell` reads the period itself with the real
 *  one. */
export function nearestPeriodRowAbove(sheet: SheetGrid, rowIdx: number, col: number): number | null {
  const above = columnFacts(sheet).headerAbove(col)[rowIdx];
  return above === undefined || above < 0 ? null : above;
}

/** Per row of `col`, the nearest row above it that is a period header for `col`
 *  (-1 for none), in one pass down the column. */
function headersAbove(sheet: SheetGrid, col: number, runOf: (row: number) => ReadonlyArray<AssignedPeriod | null>): number[] {
  const out: number[] = [];
  let last = -1;
  for (let r = 0; r < sheet.rows.length; r++) {
    out.push(last);
    if (classifyPeriodCell(sheet.rows[r]?.[col] ?? "") !== null && (runOf(r)[col] ?? null) !== null) last = r;
  }
  return out;
}

/** A cell that is blank or a number in the sheet's number origin; a
 *  period-shaped cell (a workbook's serial date) is not a number. */
function isBlankOrNumber(cell: string, sheet: SheetGrid): boolean {
  if (isBlank(cell)) return true;
  if (isPeriodShapedIn(cell, sheet.numbers)) return false;
  return parseNumberCell(cell, "dot", sheet.numbers) !== null || parseNumberCell(cell, "comma", sheet.numbers) !== null;
}

/** A period cell on the cited row: its column and what it says. */
type RowPeriod = { col: number; text: string; cell: PeriodCell };

/**
 * The period cells on the cited row (period-shaped in the sheet's number
 * origin: a CSV's five-digit number is no date) that are EVIDENCE against the
 * column header in `headerRow` — all of them, except a cell whose column that
 * header row labels as something else AND whose row holds only numbers or
 * blanks under the header's periods. That exception is a real wide header
 * describing its own row (`Name | Start | Jan 2026 | Feb 2026`): the Start date
 * vouches for nothing there (CR probe), as before. A title or metadata row of
 * dates over a long sheet has a period, a period word (`Zeitraum`), a blank
 * or a label above the row's own period column, and `Monat` or `Rolle` cells
 * under its dates. The cited cell and the PERSON cell are skipped by position.
 */
function rowEvidence(sheet: SheetGrid, at: { rowIdx: number; colIdx: number; personCol?: number }, headerRow: number): RowPeriod[] {
  const cells = sheet.rows[at.rowIdx] ?? [];
  const header = sheet.rows[headerRow] ?? [];
  const periodCols = headerProbeRun(header, sheet.numbers ?? "text").flatMap((p, col) => (p === null ? [] : [col]));
  const headsNumbers = periodCols.every((col) => isBlankOrNumber(cells[col] ?? "", sheet));
  const labels = (col: number): boolean => {
    const label = (header[col] ?? "").trim();
    return label !== "" && classifyPeriodCell(label) === null && !isPeriodWordHeader(label);
  };
  const out: RowPeriod[] = [];
  cells.forEach((text, col) => {
    if (col === at.colIdx || col === at.personCol || !isPeriodShapedIn(text, sheet.numbers)) return;
    const cell = classifyPeriodCell(text);
    if (cell !== null && !(headsNumbers && labels(col))) out.push({ col, text, cell });
  });
  return out;
}

/** The ISO day of the date header a cell sits under (the nearest period header
 *  above it, `nearestPeriodRowAbove`, when its cell is a date — an Excel serial only in a workbook), else
 *  null: what tells a sub-period column ("05.01.2026") from a period label.
 *  ★ Null too when the row has a period cell of its own that the header does
 *  not label away (`rowEvidence`): a metadata row's three January dates over a
 *  long sheet's `Stunden | Ist` once summed the two to 75 as sub-periods
 *  (final review I1). `personCol` is the cited row's person column. */
export function headerDateOf(sheet: SheetGrid, at: { rowIdx: number; colIdx: number; personCol?: number }): string | null {
  const r = nearestPeriodRowAbove(sheet, at.rowIdx, at.colIdx);
  if (r !== null && rowEvidence(sheet, at, r).length > 0) return null;
  const c = r === null ? null : classifyPeriodCell(sheet.rows[r]?.[at.colIdx] ?? "");
  if (c === null || c.kind !== "month" || c.date === undefined) return null;
  return sheet.numbers === "dot" || c.serial !== true ? c.date : null;
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

/** What the cited cell's position says about a claim's period. */
export type NearCheck =
  | { period: AssignedPeriod }
  | { problem: "period-not-near" }
  | { problem: "period-conflict"; periods: PeriodConflict };

/** The row's year cell (`parseYearCell`), skipping the cited and person cells. */
function rowYearOf(cells: readonly string[], skip: (col: number) => boolean): string | undefined {
  return cells.find((cell, col) => !skip(col) && parseYearCell(cell) !== undefined);
}

/**
 * The period the cited cell sits under, when the claim names it. ★★ If the
 * cited column holds a period header above the cell (`nearestPeriodRowAbove`),
 * the NEAREST one decides, read as part of ITS row's run (`assignRunDetailed`)
 * — so a stacked 2027 block, or a year-less "Jan" after "Dez", reads as that
 * header says. ★★ Unless a period cell on the cited row is evidence against it
 * (`rowEvidence`) and names a DIFFERENT period: then the claim is refused
 * `period-conflict`, whatever it says (fix 7). A title row's quarter range
 * `Zeitraum | 01.01.2026 | 31.03.2026` once headed the hours column of the
 * long sheet below it, rejecting the right months and vouching for a wrong one
 * (final review I1); a header-row stop that fixed it misfired on two-row
 * headers and placeholder rows (rr6 N2). A refusal is visible, and the hand
 * route (Detect columns) reads such a sheet by its rows. A date on the row in
 * the header's own period is consistent (sprint dates). Only when the column
 * above holds no period header (a long sheet) is the row searched, skipping
 * the cited cell and the PERSON cell by position; there a year-less period
 * cell takes a year cell on the same row before `defaultYear`.
 */
export function periodNearCell(
  sheet: SheetGrid,
  at: { rowIdx: number; colIdx: number; personCol: number },
  claim: PeriodCell,
  defaultYear: number | undefined,
): NearCheck {
  const cells = sheet.rows[at.rowIdx] ?? [];
  const skip = (col: number): boolean => col === at.colIdx || col === at.personCol;
  const rowYear = rowYearOf(cells, skip);
  // A long sheet's column of dates a week apart is weekly, as the hand route reads it.
  const readCell = (col: number): AssignedPeriod | null =>
    assignCellPeriod(cells[col], { rowYear, defaultYear, weeks: columnFacts(sheet).weekly(col) });
  const headerRow = nearestPeriodRowAbove(sheet, at.rowIdx, at.colIdx);
  if (headerRow !== null) {
    const assigned = assignRunDetailed(sheet.rows[headerRow], { defaultYear, numbers: sheet.numbers })[at.colIdx];
    if (!assigned) return { problem: "period-not-near" };
    const against = rowEvidence(sheet, at, headerRow).find((e) => !claimNames(e.cell, assigned.period));
    if (against !== undefined) {
      return { problem: "period-conflict", periods: { row: readCell(against.col)?.period ?? against.text.trim(), header: assigned.period } };
    }
    return claimNames(claim, assigned.period) ? { period: assigned } : { problem: "period-not-near" };
  }
  for (let col = 0; col < cells.length; col++) {
    if (skip(col)) continue;
    const assigned = readCell(col);
    if (assigned && claimNames(claim, assigned.period)) return { period: assigned };
  }
  return { problem: "period-not-near" };
}

export type SourceCheck = { problem: SourceRejection; periods?: PeriodConflict } | { period: AssignedPeriod };

/**
 * What a cited cell proves for a row: it must hold the hours (by the sheet's
 * number rule), ANOTHER cell of its row must name the PERSON, and the claimed
 * period must be the one the cell sits under. ★★ Where the hand route reads
 * the cell (`hand`: `handReadingOf`, a clear detection — or, on a long sheet,
 * the cell's row), that reading IS the period: a claim naming another is
 * `period-conflict` (rr7 I1: a key/value title row `Erstellt von | Max |
 * 01.03.2026` let a wrong month through `rowEvidence`'s exemption). Only
 * elsewhere does `periodNearCell` decide. Returns the
 * period as the SHEET reads it, or why the cell does not back the row. An
 * email never vouches for the person: the model can write any email beside any
 * name.
 */
export function checkSource(
  row: { person: string; hours: number; source?: string },
  claim: PeriodCell,
  sheet: SheetGrid,
  defaultYear: number | undefined,
  hand: HandReading | null = null,
): SourceCheck {
  const cited = citedCell(row.source, sheet);
  if (cited === null) return { problem: "bad-ref" };
  const value = sheetNumber(sheet, cited.colIdx, cited.cell);
  if (value === null || Math.abs(value - row.hours) > SOURCE_HOURS_TOLERANCE) return { problem: "value-mismatch" };
  const personCol = columnNaming(sheet.rows[cited.rowIdx], cited.colIdx, row.person);
  if (personCol === null) return { problem: "person-not-on-row" };
  const handPeriod = handPeriodAt(hand, cited.rowIdx, cited.colIdx);
  if (handPeriod !== undefined) {
    return claimNames(claim, handPeriod.period) ? { period: handPeriod } : { problem: "period-conflict", periods: { sheet: handPeriod.period } };
  }
  return periodNearCell(sheet, { ...cited, personCol }, claim, defaultYear);
}
