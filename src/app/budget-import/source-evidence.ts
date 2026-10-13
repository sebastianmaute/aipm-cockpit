// src/app/budget-import/source-evidence.ts — what a cited sheet cell proves
// (§500): the Claude route's rows each cite the cell their hours came from, and
// this module reads that cell, its row and the header above it. Used by
// `validateForecastRows` (the boundary) and `findUnreadCells` (what the reply
// left out). Pure: no i18n, no React, no DOM.

import { periodKeyForDate } from "../resource-capacity";
import { detectDecimalStyle, parseNumberCell, type DecimalStyle } from "./forecast-rows";
import { handPeriodAt, type HandReading } from "./hand-reading";
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
 *  above (or, with no period header above, beside) the cell, two period
 *  sources for the cell disagree or the claim names another period than the
 *  hand route reads (`period-conflict`, `periodNearCell`), the sheet's columns
 *  are ambiguous and not confirmed (`columns-unconfirmed`, every claim of the
 *  sheet), or an earlier row already used the cell. */
export type SourceRejection =
  | "bad-ref" | "value-mismatch" | "person-not-on-row" | "period-not-near" | "period-conflict" | "columns-unconfirmed" | "cell-reused";

/** What a `period-conflict` names, as canonical keys: the period the hand
 *  route reads the cited cell in (`sheet`) — alone when the claim names
 *  another, with `header` when the column header above the cell names
 *  another; or a period cell on the cited row (`row`) against that header; or
 *  two period cells on the cited row that disagree (`rows`). */
export type PeriodConflict = { sheet: string } | { sheet: string; header: string } | { row: string; header: string } | { rows: [string, string] };

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

/** A period cell on the cited row: its column and what it says. */
type RowPeriod = { col: number; text: string; cell: PeriodCell };

/**
 * R: EVERY period cell on the cited row (period-shaped in the sheet's number
 * origin: a CSV's five-digit number is no date), the cited cell and the PERSON
 * cell skipped by position. ★★★ No cell is exempt (fix 8, the owner's "fail
 * closed"): an exemption for a column the header row labels (`Name | Start |
 * Jan 2026`) once fired on a key/value title row (`Erstellt von | Max |
 * 01.03.2026`) and vouched for a wrong month (rr7 I1, rr8 OOS-1).
 */
export function rowPeriodCells(sheet: SheetGrid, at: { rowIdx: number; colIdx: number; personCol?: number }): RowPeriod[] {
  const cells = sheet.rows[at.rowIdx] ?? [];
  const out: RowPeriod[] = [];
  cells.forEach((text, col) => {
    if (col === at.colIdx || col === at.personCol || !isPeriodShapedIn(text, sheet.numbers)) return;
    const cell = classifyPeriodCell(text);
    if (cell !== null) out.push({ col, text, cell });
  });
  return out;
}

/** The ISO day of the date header a cell sits under (the nearest period header
 *  above it, `nearestPeriodRowAbove`, when its cell is a date — an Excel serial only in a workbook), else
 *  null: what tells a sub-period column ("05.01.2026") from a period label.
 *  ★★ Null too when the hand route does not read the cell (`hasHand` false)
 *  and its row holds a period cell of its own (`rowPeriodCells`): such a row
 *  is a long row, whose cells share its one period. A month title's two dates
 *  over a long sheet's `Plan | Ist` once summed the two to 75 as sub-periods
 *  (final review I1, rr8 OOS-1). Where the hand route reads the cell, it has
 *  chosen the row's period column, so the row is not consulted. `personCol` is
 *  the cited row's person column. */
export function headerDateOf(sheet: SheetGrid, at: { rowIdx: number; colIdx: number; personCol?: number }, hasHand: boolean): string | null {
  const r = nearestPeriodRowAbove(sheet, at.rowIdx, at.colIdx);
  if (r !== null && !hasHand && rowPeriodCells(sheet, at).length > 0) return null;
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

/** U: the period the nearest period header above the cell (`nearestPeriodRowAbove`)
 *  gives its column, read as part of ITS row's run (`assignRunDetailed`) — so a
 *  stacked 2027 block, or a year-less "Jan" after "Dez", reads as that header
 *  says. Undefined with no header above; null when the header reads no period
 *  in the real default year (a year-less header with none). */
function headerPeriodOf(sheet: SheetGrid, at: { rowIdx: number; colIdx: number }, defaultYear: number | undefined): AssignedPeriod | null | undefined {
  const headerRow = nearestPeriodRowAbove(sheet, at.rowIdx, at.colIdx);
  if (headerRow === null) return undefined;
  return assignRunDetailed(sheet.rows[headerRow], { defaultYear, numbers: sheet.numbers })[at.colIdx] ?? null;
}

/**
 * The period the cited cell is in, when EVERY period source for it agrees and
 * the claim names it (fix 8, the owner's "fail closed" of 2026-10-13: eight
 * rounds of evidence rules each let a new wrong-hours case through). The
 * sources:
 * - H, `hand`: the hand route's reading of the cell (`handPeriodAt`);
 * - U: the nearest period header above the cell (`headerPeriodOf`);
 * - R: every period cell on the cited row (`rowPeriodCells`), ONLY without H —
 *   with H, the hand route has already chosen the row's period column. A
 *   year-less row cell takes a year cell on the same row before `defaultYear`.
 * Two sources that disagree refuse the claim `period-conflict`, naming both,
 * whatever it claims: H against U is a stacked year block the hand route reads
 * as one year (rr8 N1), U against R a title row's dates over a long sheet
 * (final review I1), R against R a `Von | Bis` pair. No source at all, or a
 * claim the agreeing sources do not name, is `period-not-near` — or, with H,
 * `period-conflict` naming H's period. ★★ No source decides alone: H once did
 * (rr7), and wrote a stacked 2027 block into 2026.
 */
export function periodNearCell(
  sheet: SheetGrid,
  at: { rowIdx: number; colIdx: number; personCol: number },
  claim: PeriodCell,
  defaultYear: number | undefined,
  hand?: AssignedPeriod,
): NearCheck {
  const header = headerPeriodOf(sheet, at, defaultYear);
  if (header === null) return { problem: "period-not-near" };
  if (hand !== undefined) {
    if (header !== undefined && header.period !== hand.period) {
      return { problem: "period-conflict", periods: { sheet: hand.period, header: header.period } };
    }
    return claimNames(claim, hand.period) ? { period: hand } : { problem: "period-conflict", periods: { sheet: hand.period } };
  }
  const cells = sheet.rows[at.rowIdx] ?? [];
  const rowYear = rowYearOf(cells, (col) => col === at.colIdx || col === at.personCol);
  // A long sheet's column of dates a week apart is weekly, as the hand route reads it.
  const readCell = (col: number): AssignedPeriod | null =>
    assignCellPeriod(cells[col], { rowYear, defaultYear, weeks: columnFacts(sheet).weekly(col) });
  const row = rowPeriodCells(sheet, at);
  const labelOf = (e: RowPeriod): string => readCell(e.col)?.period ?? e.text.trim();
  const anchor = header ?? row.map((e) => readCell(e.col)).find((p): p is AssignedPeriod => p !== null);
  if (anchor === undefined) return { problem: "period-not-near" };
  const against = row.find((e) => !claimNames(e.cell, anchor.period));
  if (against !== undefined) {
    return {
      problem: "period-conflict",
      periods: header !== undefined ? { row: labelOf(against), header: header.period } : { rows: [anchor.period, labelOf(against)] },
    };
  }
  return claimNames(claim, anchor.period) ? { period: anchor } : { problem: "period-not-near" };
}

export type SourceCheck = { problem: SourceRejection; periods?: PeriodConflict } | { period: AssignedPeriod };

/**
 * What a cited cell proves for a row: it must hold the hours (by the sheet's
 * number rule), ANOTHER cell of its row must name the PERSON, and every period
 * source for the cell must agree on the claimed period (`periodNearCell`, with
 * the hand route's reading `hand` from `handReadingOf`). Returns the period as
 * the SHEET reads it, or why the cell does not back the row. An email never
 * vouches for the person: the model can write any email beside any name.
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
  return periodNearCell(sheet, { ...cited, personCol }, claim, defaultYear, handPeriodAt(hand, cited.rowIdx, cited.colIdx));
}
