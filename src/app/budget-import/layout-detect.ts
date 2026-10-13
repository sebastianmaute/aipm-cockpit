// src/app/budget-import/layout-detect.ts — guesses where the forecast sits in a
// sheet grid (§500). Pure: no i18n, no React, no DOM. The result is only a
// first guess for the mapping step; the user can change every column.
//
// WIDE: one column per period ("Jan 2026", "KW03 2026"), one row per person.
// LONG: one row per person and period, with a period column and an hours
// column. A wide header with at least MIN_WIDE_PERIODS period cells is taken
// first; a two-period wide sheet is only believed when no long reading fits,
// because a long sheet's start/end date columns look the same.

import { cellAt, detectDecimalStyle, ID_HEADER, isBlank, isNumberCell, isTotalLabel, parseNumberCell, parsePeriodLabel, repeatedHeaderRows } from "./forecast-rows";
import type { ColumnAmbiguity, ColumnMapping } from "./forecast-types";
import { assignRunPeriods, classifyPeriodCell, isPeriodShapedIn, isYearColumn, isYearHeader, parseYearCell, usableYear } from "./period-assign";
import { HOURS_HEADER_RE, isPeriodWordHeader, PERSON_HEADER_RE } from "./header-words";
import { differingRows } from "./row-differences";
import type { NumberOrigin } from "./sheet-grid";

/** `ambiguous` lists the fields more than one column could be: a long
 *  sheet's (`longFromHeader`), or a wide sheet's period when its data rows
 *  hold a period column of their own (`wideAmbiguity`), the header row when
 *  more than one row reads as one (`headerAmbiguity`), and the `rows` one
 *  person's rows differ in (`differingRows`); empty when the choice is clear,
 *  and always for none. */
export type LayoutDetection = {
  kind: "wide" | "long" | "unknown";
  mapping: ColumnMapping | null;
  ambiguous: ColumnAmbiguity[];
};

const MAX_HEADER_SCAN_ROWS = 10;
/** The data rows under a candidate header that detection reads (`dataRowsBelow`):
 *  every pass scores up to `MAX_HEADER_SCAN_ROWS` candidates, and scoring them
 *  over a whole 250,000-cell sheet took seconds (final review M1). Blank rows
 *  are skipped, not counted (fix 7, rr6 N5). Reading the rows once the columns
 *  are known (`gridToForecastRows`) is never cut. */
export const DETECTION_SAMPLE_ROWS = 200;
const MIN_WIDE_PERIODS = 3;
const MIN_WIDE_PERIODS_FALLBACK = 2;
/** Share of a column's non-blank cells that must parse for it to count. */
const COLUMN_SHARE = 0.8;
/** Share of a column's non-blank cells that must be text for a person column. */
const TEXT_SHARE = 0.5;

/** A date column's header: ranked below a period word, above none. */
const DATE_HEADER_RE = /date|datum/i;
const RATE_HEADER_RE = /\brates?\b|satz|€\/h|eur\/h/i;
const EMAIL_HEADER_RE = /e-?mail/i;
const SERIAL_RE = /^\d{5}(\.\d+)?$/;

export { isPeriodWordHeader };

const UNKNOWN: LayoutDetection = { kind: "unknown", mapping: null, ambiguous: [] };

type Rows = readonly string[][];

/** How the grid's cells are read: `numbers` is `SheetGrid.numbers`, `year` the
 *  year a period label without one is read in (see `parsePeriodLabel`). */
type Ctx = { numbers: NumberOrigin; year?: number };

const isTotalRow = (row: readonly string[]): boolean => row.some(isTotalLabel);

/** Per grid, the indices of its rows that hold data: not blank, not a total. */
const DATA_ROW_INDICES = new WeakMap<Rows, number[]>();

function dataRowIndices(rows: Rows): number[] {
  const known = DATA_ROW_INDICES.get(rows);
  if (known !== undefined) return known;
  const out = rows.flatMap((row, i) => (row.some((c) => !isBlank(c)) && !isTotalRow(row) ? [i] : []));
  DATA_ROW_INDICES.set(rows, out);
  return out;
}

/** The first `DETECTION_SAMPLE_ROWS` data rows under a header: blank and total
 *  rows are left out and do not count. */
function dataRowsBelow(rows: Rows, headerRow: number): Rows {
  const indices = dataRowIndices(rows);
  const first = indices.findIndex((i) => i > headerRow);
  return first < 0 ? [] : indices.slice(first, first + DETECTION_SAMPLE_ROWS).map((i) => rows[i]);
}

/** A column's non-blank, trimmed cells. */
function columnCells(data: Rows, col: number): string[] {
  return data.map((row) => cellAt(row, col).trim()).filter((c) => c !== "");
}

function rowWidth(rows: Rows): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function shareOf(cells: readonly string[], predicate: (cell: string) => boolean): number {
  return cells.length === 0 ? 0 : cells.filter(predicate).length / cells.length;
}

function numberShare(cells: readonly string[], ctx: Ctx): number {
  const style = detectDecimalStyle(cells, ctx.numbers);
  return shareOf(cells, (c) => parseNumberCell(c, style, ctx.numbers) !== null);
}

/** True when the cells are numbers (or nothing at all) in at least COLUMN_SHARE. */
function isNumericOrEmpty(cells: readonly string[], ctx: Ctx): boolean {
  return cells.length === 0 || numberShare(cells, ctx) >= COLUMN_SHARE;
}

function isMostlyText(cells: readonly string[], ctx: Ctx): boolean {
  const style = detectDecimalStyle(cells, ctx.numbers);
  return cells.length > 0 && shareOf(cells, (c) => parseNumberCell(c, style, ctx.numbers) === null) >= TEXT_SHARE;
}

function firstHeaderMatch(header: readonly string[], re: RegExp, skip: ReadonlySet<number>): number | undefined {
  for (let col = 0; col < header.length; col++) {
    if (!skip.has(col) && re.test(header[col] ?? "")) return col;
  }
  return undefined;
}

/** An e-mail column: by header, else by `@` in most of its cells. */
function findEmailColumn(header: readonly string[], data: Rows, skip: ReadonlySet<number>): number | undefined {
  const byHeader = firstHeaderMatch(header, EMAIL_HEADER_RE, skip);
  if (byHeader !== undefined) return byHeader;
  const width = Math.max(header.length, rowWidth(data));
  for (let col = 0; col < width; col++) {
    if (skip.has(col)) continue;
    const cells = columnCells(data, col);
    if (cells.length > 0 && shareOf(cells, (c) => c.includes("@")) >= TEXT_SHARE) return col;
  }
  return undefined;
}

/**
 * The person column among `candidates`: a mostly-text column headed Name /
 * Mitarbeiter / Person / Resource …, else the first mostly-text column (so
 * `Team | Name | Jan…` takes Name, not Team), else the e-mail column when that
 * is all there is to identify a person by.
 */
function pickPerson(
  candidates: readonly number[],
  header: readonly string[],
  data: Rows,
  email: number | undefined,
  ctx: Ctx,
): number | null {
  const isText = (col: number): boolean => col !== email && isMostlyText(columnCells(data, col), ctx);
  const named = candidates.find((col) => PERSON_HEADER_RE.test(cellAt(header, col).trim()) && isText(col));
  if (named !== undefined) return named;
  const text = candidates.find(isText);
  if (text !== undefined) return text;
  const emailIsText = email !== undefined && candidates.includes(email) && isMostlyText(columnCells(data, email), ctx);
  return emailIsText ? email : null;
}

function withOptionals(base: ColumnMapping, extras: Partial<ColumnMapping>): ColumnMapping {
  const out: ColumnMapping = { ...base };
  if (extras.email !== undefined) out.email = extras.email;
  if (extras.rate !== undefined) out.rate = extras.rate;
  if (extras.yearCol !== undefined) out.yearCol = extras.yearCol;
  return out;
}

function wideFromHeader(rows: Rows, headerRow: number, periodCols: readonly number[], ctx: Ctx): ColumnMapping | null {
  const header = rows[headerRow] ?? [];
  const data = dataRowsBelow(rows, headerRow);
  const periodSet = new Set(periodCols);
  // A real wide header has numbers (or nothing) under it; a long sheet's data
  // row with several date cells has dates under it.
  if (!isNumericOrEmpty(periodCols.flatMap((col) => columnCells(data, col)), ctx)) return null;
  const email = findEmailColumn(header, data, periodSet);
  const rate = firstHeaderMatch(header, RATE_HEADER_RE, new Set([...periodCols, ...(email === undefined ? [] : [email])]));
  const leftOfPeriods = Array.from({ length: periodCols[0] }, (_, col) => col).filter((col) => col !== rate);
  const person = pickPerson(leftOfPeriods, header, data, email, ctx);
  if (person === null) return null;
  return withOptionals(
    { layout: "wide", headerRow, person, periodCols: [...periodCols] },
    { email, rate },
  );
}

/**
 * The columns of a wide reading's data rows that hold a period of their own:
 * not among the header's period columns nor the person column, with ANY data
 * cell period-shaped in the sheet's number origin (a CSV's five-digit number
 * is no date). ★★ Any, not a share (fix 9 I-1): an 80 % share let ONE
 * placeholder in a long sheet's `Monat` column (`offen`, `-`, `n/a`) turn
 * the question off, and Claude's February Ist cells were written as January.
 * The cost: a wide sheet with one date in a notes column asks too.
 */
function rowPeriodColumns(rows: Rows, mapping: ColumnMapping, ctx: Ctx): number[] {
  const data = dataRowsBelow(rows, mapping.headerRow);
  const skip = new Set([...(mapping.periodCols ?? []), mapping.person]);
  const out: number[] = [];
  for (let col = 0; col < rowWidth(data); col++) {
    if (!skip.has(col) && columnCells(data, col).some((c) => isPeriodShapedIn(c, ctx.numbers))) out.push(col);
  }
  return out;
}

/**
 * ★★★ A wide reading whose data rows hold a period column of their own asks
 * for the PERIOD (fix 8, controller ruling): the period may be the header's
 * columns or that column. A metadata row (`Erstellt | 01.01. | 15.01. |
 * 20.01.`) over a long sheet's `Name | Monat | Stunden | Ist` reads as a clear
 * wide header once enough person rows sit under it, and the Claude route then
 * accepted the `Ist` cells in the metadata row's month (Bob's February as
 * January). `Name | Start | Jan 2026 | Feb 2026` asks too, and so does a row
 * year column beside year-less headers (`rowYearColumns`). The candidates are
 * those columns and the header's period columns.
 */
/**
 * The year columns of a wide reading's data rows (`isYearColumn`: `Jahr`,
 * `FY`, or four-digit years), outside the period and person columns, when
 * any of its period headers names no year (`Jan`, `KW03`) — fix 9 OOS-b:
 * `Name | Jahr | Jan | Feb` with Ann's row in 2027 once read 2026-01 = 10 on
 * both routes, the row's year ignored.
 */
function rowYearColumns(rows: Rows, mapping: ColumnMapping): number[] {
  const header = rows[mapping.headerRow] ?? [];
  const periodCols = mapping.periodCols ?? [];
  if (!periodCols.some((col) => classifyPeriodCell(cellAt(header, col))?.year === undefined)) return [];
  const data = dataRowsBelow(rows, mapping.headerRow);
  const skip = new Set([...periodCols, mapping.person]);
  const width = Math.max(header.length, rowWidth(data));
  return Array.from({ length: width }, (_, col) => col)
    .filter((col) => !skip.has(col) && isYearColumn(cellAt(header, col), columnCells(data, col)));
}

/**
 * ★★ The columns a wide mapping LEAVES OUT although their header reads as a
 * period in the header row's run and their data rows hold a number (final
 * review 2, M1): a Claude mapping that picks one block of a `Plan | Ist` sheet
 * (the same month headers twice, a sub-header row below) would otherwise read
 * that block silently. Detection's own mapping takes every such column, so it
 * never asks this; the person, email and rate columns and totals are no
 * candidates.
 */
function leftOutPeriodColumns(rows: Rows, mapping: ColumnMapping, ctx: Ctx): number[] {
  const header = rows[mapping.headerRow] ?? [];
  const data = dataRowsBelow(rows, mapping.headerRow);
  const run = assignRunPeriods(header, { defaultYear: ctx.year, numbers: ctx.numbers });
  const skip = new Set([...(mapping.periodCols ?? []), mapping.person, mapping.email, mapping.rate]);
  return header.flatMap((label, col) => (!skip.has(col) && run[col] !== null && !isTotalLabel(label)
    && columnCells(data, col).some((c) => isNumberCell(c, ctx.numbers)) ? [col] : []));
}

function wideAmbiguity(rows: Rows, mapping: ColumnMapping, ctx: Ctx): ColumnAmbiguity[] {
  const own = [...new Set([...rowPeriodColumns(rows, mapping, ctx), ...rowYearColumns(rows, mapping), ...leftOutPeriodColumns(rows, mapping, ctx)])];
  if (own.length === 0) return [];
  return [{ field: "period", candidates: [...own, ...(mapping.periodCols ?? [])].sort((a, b) => a - b) }];
}

/**
 * ★★ More than one row of the scan range reads as a header for the chosen
 * layout (fix 9 OOS-c): stacked blocks. A long sheet's `Name | Monat |
 * Forecast` over `Name | Monat | Ist` once imported the Ist block, and a wide
 * sheet's second year block summed into the first block's year (residue 9).
 * The preselected row stays; the dialog asks which one it is.
 */
function headerAmbiguity(headerRows: readonly number[]): ColumnAmbiguity[] {
  return headerRows.length > 1 ? [{ field: "header", candidates: [...headerRows] }] : [];
}

/** The index of the header candidate to preselect, from `start`: a candidate
 *  with no data row before the next candidate heads an EMPTY block and is
 *  skipped (round 7 C1: a zero-row first wide block was preselected, and
 *  "These columns are right" read the 2027 data as 2026). */
function skipEmptyBlocks(rows: Rows, headerRows: readonly number[], start: number): number {
  const data = dataRowIndices(rows);
  let at = start;
  while (at + 1 < headerRows.length && !data.some((i) => i > headerRows[at] && i < headerRows[at + 1])) at += 1;
  return at;
}

/** The header question with every repeated header row among its candidates
 *  (round 5): a stacked block asks whatever its size, a one-row block too. */
function withRepeatedHeaders(ambiguous: ColumnAmbiguity[], mapping: ColumnMapping, repeated: readonly number[]): ColumnAmbiguity[] {
  if (repeated.length === 0) return ambiguous;
  const asked = ambiguous.find((a) => a.field === "header")?.candidates ?? [];
  const candidates = [...new Set([...asked, mapping.headerRow, ...repeated])].sort((a, b) => a - b);
  return [...ambiguous.filter((a) => a.field !== "header"), { field: "header", candidates }];
}

/** A wide reading of one candidate header row with `minPeriods` period cells
 *  or more, else null. */
function wideHeaderAt(rows: Rows, headerRow: number, minPeriods: number, ctx: Ctx): ColumnMapping | null {
  const header = rows[headerRow];
  // The header is read as a RUN: year rollover, dates a week apart as weeks.
  const run = assignRunPeriods(header, { defaultYear: ctx.year, numbers: ctx.numbers });
  const periodCols: number[] = [];
  for (let col = 0; col < header.length; col++) {
    if (!isTotalLabel(header[col]) && run[col] !== null) periodCols.push(col);
  }
  return periodCols.length < minPeriods ? null : wideFromHeader(rows, headerRow, periodCols, ctx);
}

function detectWide(rows: Rows, minPeriods: number, ctx: Ctx): Detected | null {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  const found: ColumnMapping[] = [];
  const headerRows: number[] = [];
  for (let headerRow = 0; headerRow < scanned; headerRow++) {
    const mapping = wideHeaderAt(rows, headerRow, minPeriods, ctx);
    if (mapping === null) continue;
    found.push(mapping);
    headerRows.push(headerRow);
  }
  if (found.length === 0) return null;
  const chosen = found[skipEmptyBlocks(rows, headerRows, 0)];
  return { mapping: chosen, ambiguous: [...wideAmbiguity(rows, chosen, ctx), ...headerAmbiguity(headerRows)] };
}

/** Rank weights of `periodRank`, most significant first. */
const RANK_NO_PERIOD_WORD = 4;
const RANK_NO_DATE_HEADER = 2;
const RANK_SERIAL_CELLS = 1;

/**
 * Lower is better, each test outranking every one after it: a period word in
 * the header (`isPeriodWordHeader`: `Month`, `Zeitraum`, `KW` …); a `Date` /
 * `Datum` header; a real date over a bare serial. Ties keep the leftmost
 * column. ★★ `Start date` once ranked with `Month`, and the leftmost won: every
 * row's hours were summed into the start month (final review I2). ★★ A rank of
 * month-LABEL cells over full dates (final review I2 too) summed a `Datum`
 * sheet into its `Eintritt` month (rr6 N3), and was removed: when the header
 * words do not settle it, detection asks (`ambiguous`, fix 7).
 */
function periodRank(header: string, cells: readonly string[]): number {
  return (isPeriodWordHeader(header) ? 0 : RANK_NO_PERIOD_WORD)
    + (DATE_HEADER_RE.test(header) ? 0 : RANK_NO_DATE_HEADER)
    + (cells.length > 0 && cells.every((c) => SERIAL_RE.test(c)) ? RANK_SERIAL_CELLS : 0);
}

/** A long sheet's year column: by header ("Jahr", "FY"), else the first column
 *  whose cells are all four-digit years (2000–2100). */
function findYearColumn(header: readonly string[], data: Rows, width: number): number | undefined {
  const byHeader = header.findIndex((label) => isYearHeader(label ?? ""));
  if (byHeader >= 0) return byHeader;
  for (let col = 0; col < width; col++) {
    const cells = columnCells(data, col);
    if (cells.length > 0 && cells.every((c) => parseYearCell(c) !== undefined)) return col;
  }
  return undefined;
}

/** The period column (best `periodRank`), its period share, and every column
 *  that qualified (`candidates`, left to right). */
type PeriodPick = { col: number; share: number; strong: boolean; candidates: number[] };

function findPeriodColumn(
  header: readonly string[],
  data: Rows,
  width: number,
  ctx: Ctx,
  yearCol: number | undefined,
): PeriodPick | undefined {
  let best: PeriodScan | undefined;
  let strongShare = -1;
  const scanned = scanPeriodColumns(header, data, width, ctx, yearCol);
  for (const scored of scanned) {
    // Whether the row is a header at all (and its score) keeps the share.
    if (scored.share >= COLUMN_SHARE) strongShare = Math.max(strongShare, scored.share);
    // ★★ The PRESELECTION ranks the header word first, then the share, then
    // the leftmost (round 8 m-1): a share-first pick took `Erfasst am` over a
    // `Monat` with one `offen`, and "These columns are right" read every row in March.
    if (best === undefined || scored.rank < best.rank || (scored.rank === best.rank && scored.share > best.share)) best = scored;
  }
  if (best === undefined || strongShare < 0) return undefined;
  return { col: best.col, share: strongShare, strong: best.share >= COLUMN_SHARE, candidates: scanned.map((s) => s.col) };
}

/** A column that could be a long sheet's period: its period share and rank. */
type PeriodScan = { col: number; share: number; rank: number };

/** Every column under `header` that could hold a long sheet's period, left to
 *  right: a labelled column (its label no period itself), not the year column,
 *  with ONE period cell at least. */
function scanPeriodColumns(header: readonly string[], data: Rows, width: number, ctx: Ctx, yearCol: number | undefined): PeriodScan[] {
  // With a year column, a year-less "Jan" is a period: the row supplies its year.
  const isPeriod = (c: string): boolean =>
    parsePeriodLabel(c, ctx.year) !== null || (yearCol !== undefined && classifyPeriodCell(c) !== null);
  const out: PeriodScan[] = [];
  for (let col = 0; col < width; col++) {
    const label = cellAt(header, col);
    const cells = columnCells(data, col);
    const share = shareOf(cells, isPeriod);
    // ★★ ONE period makes a candidate (round 7 I-B): an `offen` in `Monat` once
    // pushed it under the share, and every row was read in `Erfasst am`'s month.
    if (col === yearCol || isBlank(label) || parsePeriodLabel(label, ctx.year) !== null || share === 0) continue;
    out.push({ col, share, rank: periodRank(label, cells) });
  }
  return out;
}

/**
 * The fields of a long reading that more than one column could be (fix 7, the
 * owner's "ask, don't guess" after three rounds of column-guessing rules each
 * imported wrong hours):
 * - the PERIOD, when two or more columns qualify and not exactly one of them
 *   is headed by a period word (`Start date | Month` is clear; `Datum |
 *   Eintritt` and `Datum | Startmonat` ask);
 * - the HOURS, whenever two or more number columns are left after the
 *   exclusions (`numericColumns`: ID and year columns, period-shaped cells as
 *   no number; then rate and period-headed columns). ★★★ No header word settles
 *   it (fix 8): a "named hours column" escape read `Ist`, `Iststunden`,
 *   `Gebuchte Stunden` or `Logged hours` silently, one spelling per round (rr6
 *   N1, rr7, rr8 N2). `Name | Monat | Stunden | Kosten` asks; one number
 *   column (`Name | Monat | Stunden`, `ID | Name | Month | Effort`) does not.
 */
function ambiguityOf(
  header: readonly string[],
  periodCols: readonly number[],
  hoursCols: readonly number[],
  period: { col: number; strong: boolean },
): ColumnAmbiguity[] {
  const named = periodCols.filter((col) => isPeriodWordHeader(cellAt(header, col)));
  const out: ColumnAmbiguity[] = [];
  // One period-word column settles it only when it is the preselection and its
  // periods pass the share (round 7 I-B, round 8): a placeholder in `Monat`
  // still asks, with `Monat` preselected.
  const settled = named.length === 1 && named[0] === period.col && period.strong;
  if (periodCols.length > 1 && !settled) out.push({ field: "period", candidates: [...periodCols] });
  if (hoursCols.length > 1) out.push({ field: "hours", candidates: [...hoursCols] });
  return out;
}

/** Numeric columns with a header, not the period or year column, not an ID
 *  (`ID_HEADER`: `ID`, `Nr`, `PersNr` …) or year column (`isYearColumn`).
 *  ★★ `ID | Name | Month | Effort` once imported the employee IDs as hours, and
 *  `Nr | … | Aufwand` the row numbers (final review I3). A period-shaped cell (a
 *  workbook's serial date) counts as no number here, so a serial `Erfasst`
 *  date column is no hours candidate. */
function numericColumns(header: readonly string[], data: Rows, width: number, skip: ReadonlySet<number>, ctx: Ctx): NumericColumns {
  const any: number[] = [];
  const strong: number[] = [];
  for (let col = 0; col < width; col++) {
    const label = cellAt(header, col);
    const cells = columnCells(data, col);
    const isExcluded = skip.has(col) || isBlank(label) || ID_HEADER.test(label.trim()) || isYearColumn(label, cells);
    const style = detectDecimalStyle(cells, ctx.numbers);
    const figureShare = shareOf(cells, (c) => !isPeriodShapedIn(c, ctx.numbers) && parseNumberCell(c, style, ctx.numbers) !== null);
    if (isExcluded || figureShare === 0) continue;
    any.push(col);
    if (figureShare >= COLUMN_SHARE) strong.push(col);
  }
  return { any, strong };
}

/** A long reading's number columns: `any` holds ONE number at least (the hours
 *  QUESTION, round 7 I-B: two `-` in `Stunden` once left `Ist` the only
 *  candidate, and the actuals were imported), `strong` passes the share (the
 *  PRESELECTION, and whether the row is a header at all). */
type NumericColumns = { any: number[]; strong: number[] };

/**
 * A header is a row of labels. A row whose own hours cell is a number, or whose
 * own period cell is a period, is a data row — typically the one with an
 * unparseable period cell, which would otherwise score a perfect 2.0 as a
 * "header" and silently drop every row above it.
 */
function isDataRowShaped(header: readonly string[], period: number, hours: number, ctx: Ctx): boolean {
  const hoursCell = cellAt(header, hours);
  const isNumber = parseNumberCell(hoursCell, "dot", ctx.numbers) !== null || parseNumberCell(hoursCell, "comma", ctx.numbers) !== null;
  return isNumber || parsePeriodLabel(cellAt(header, period), ctx.year) !== null;
}

/** A layout reading: the mapping and the fields it could not settle. */
type Detected = { mapping: ColumnMapping; ambiguous: ColumnAmbiguity[] };

/** A long reading of one candidate header row, with how well its columns fit. */
type ScoredMapping = Detected & { score: number };

/**
 * The preselected hours column: a header matching `HOURS_HEADER_RE` first,
 * then the higher number share, then the leftmost. ★★ Round 8 took the
 * leftmost alone, and "These columns are right" then imported `Ist`, `Tage`,
 * `FTE`, a numeric `Team` or a notes column holding one number in place of
 * `Stunden` (rr12 I-D). A share-first pick took `Ist` over a `Stunden` with
 * two `-` (rr11 I-B); a rightmost pick `Ist` or `Summe` over `Plan` (rr6 N1).
 * ★ `Forecast | Ist-Stunden` preselects `Ist-Stunden` (register 27); the
 * user sees the choice, because two candidates always ask.
 */
function preselectHours(candidates: readonly number[], header: readonly string[], data: Rows, ctx: Ctx): number | undefined {
  const named = (col: number) => (HOURS_HEADER_RE.test(cellAt(header, col).trim()) ? 1 : 0);
  const share = new Map(candidates.map((col) => [col, numberShare(columnCells(data, col), ctx)]));
  return [...candidates].sort((a, b) => named(b) - named(a) || (share.get(b) ?? 0) - (share.get(a) ?? 0) || a - b)[0];
}

function longFromHeader(rows: Rows, headerRow: number, ctx: Ctx): ScoredMapping | null {
  const header = rows[headerRow] ?? [];
  const data = dataRowsBelow(rows, headerRow);
  const width = Math.max(header.length, rowWidth(data));
  const yearFound = findYearColumn(header, data, width);
  const found = findPeriodColumn(header, data, width, ctx, yearFound);
  if (found === undefined) return null;
  const period = found.col;
  // The year column is mapped only when some period cell needs a year from it.
  const needsYear = columnCells(data, period).some((c) => classifyPeriodCell(c)?.year === undefined);
  const yearCol = needsYear ? yearFound : undefined;
  const skip = new Set([period, ...(yearFound === undefined ? [] : [yearFound])]);

  const { any: numeric, strong } = numericColumns(header, data, width, skip, ctx);
  const rateCols = numeric.filter((col) => RATE_HEADER_RE.test(cellAt(header, col)));
  // ★★ A column headed by a period ("Jan", "Jan 2026", "KW03") is never a long
  // sheet's hours: `Name | Start | Jan 2026 | Feb 2026` once read long, the
  // Start date as the period and January's column as the hours, so Ann's
  // January landed in her start month (final review I4). Such a sheet falls
  // through to two-period wide.
  const hoursCols = numeric.filter((col) => !rateCols.includes(col) && classifyPeriodCell(cellAt(header, col)) === null);
  const strongHours = hoursCols.filter((col) => strong.includes(col));
  // A row is a header only with a share-passing hours column (and that scores it).
  if (strongHours.length === 0) return null;
  const rate = rateCols.find((col) => strong.includes(col));
  // The person is settled before the hours, so a text column holding one
  // number can still be the person (round 8); as an hours candidate it loses
  // the preselection to any hours-word or share-passing column (`preselectHours`).
  const beforeHours = new Set([...skip, ...strongHours, ...(rate === undefined ? [] : [rate])]);
  const email = findEmailColumn(header, data, beforeHours);
  const personCandidates = Array.from({ length: width }, (_, col) => col).filter((col) => !beforeHours.has(col));
  const person = pickPerson(personCandidates, header, data, email, ctx);
  if (person === null) return null;
  // The PRESELECTION only, which the user confirms whenever there is a choice
  // (`ambiguityOf`), the person and email columns excluded.
  const questioned = hoursCols.filter((col) => col !== person && col !== email);
  const hours = preselectHours(questioned, header, data, ctx);
  if (hours === undefined || isDataRowShaped(header, period, hours, ctx)) return null;
  return {
    mapping: withOptionals({ layout: "long", headerRow, person, period, hours }, { email, rate, yearCol }),
    ambiguous: ambiguityOf(header, found.candidates.filter((col) => col !== person && col !== email), questioned, found),
    score: found.share + numberShare(columnCells(data, strongHours[0]), ctx),
  };
}

/**
 * Every header row in the scan window is scored (period share plus hours
 * share); the best wins and a tie goes to the LATER row, so a title row whose
 * columns happen to fit loses to the real header under it.
 */
function detectLong(rows: Rows, ctx: Ctx): Detected | null {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  const found: ScoredMapping[] = [];
  const headerRows: number[] = [];
  let bestAt = -1;
  for (let headerRow = 0; headerRow < scanned; headerRow++) {
    const candidate = longFromHeader(rows, headerRow, ctx);
    if (candidate === null) continue;
    if (bestAt < 0 || candidate.score >= found[bestAt].score) bestAt = found.length;
    found.push(candidate);
    headerRows.push(headerRow);
  }
  if (bestAt < 0) return null;
  const best = found[skipEmptyBlocks(rows, headerRows, bestAt)];
  return { mapping: best.mapping, ambiguous: [...best.ambiguous, ...headerAmbiguity(headerRows)] };
}

type Pass = { kind: "wide" | "long"; run: () => Detected | null };

/** The detection passes in order; the first that finds a layout wins (see
 *  `detectLayout`). Passes with the year are left out when there is none. */
function detectionPasses(rows: Rows, numbers: NumberOrigin, year: number | undefined): Pass[] {
  const bare: Ctx = { numbers };
  const withYear: Ctx = { numbers, year };
  const yearPasses = (passes: Pass[]): Pass[] => (year === undefined ? [] : passes);
  return [
    { kind: "wide", run: () => detectWide(rows, MIN_WIDE_PERIODS, bare) },
    ...yearPasses([{ kind: "wide", run: () => detectWide(rows, MIN_WIDE_PERIODS, withYear) }]),
    { kind: "long", run: () => detectLong(rows, bare) },
    { kind: "wide", run: () => detectWide(rows, MIN_WIDE_PERIODS_FALLBACK, bare) },
    ...yearPasses([
      { kind: "long", run: () => detectLong(rows, withYear) },
      { kind: "wide", run: () => detectWide(rows, MIN_WIDE_PERIODS_FALLBACK, withYear) },
    ]),
  ];
}

/**
 * Guess the layout of a sheet grid and where its columns are. Scans the first
 * 10 rows for the header. Ragged and empty rows are fine (a missing cell is
 * blank). `unknown` when neither a wide nor a long reading fits. `numbers` is
 * the grid's `SheetGrid.numbers` (a workbook's stored numbers read with a dot).
 * ★★ The passes run in a FIXED order and the first that finds a layout wins:
 * (1) wide with 3+ periods, no default year; (2) the same WITH it; (3) long, no
 * year; (4) two-period wide, no year; (5) long, then two-period wide, with the
 * year. With the year it reads month names and weeks without one ("Jan",
 * "KW03") as periods. Long ran with the year before (fix wave 1): a data
 * column of month names ("Start" holding "Mai") became the period column of
 * a correct wide sheet. Every year-less pass ran first (fix wave 2): a
 * year-less WIDE sheet with any date column ("Start", "Eintritt") was then read
 * as long, the hours in the date's month. Wide-with-year before long-without
 * settles both. ★★ Long-without stays AHEAD of two-period wide: a long
 * workbook's data row of two serial dates (`Von | Bis`) reads as a two-period
 * header, and the serials below it count as numbers (`wideFromHeader`), so
 * moving both two-period passes first read such sheets wide (re-review 4).
 * Months beside a date column (`Name | Start | Jan | Feb`, `… | Jan 2026 | Feb
 * 2026`) still reach two-period wide: a long reading never takes a
 * period-headed hours column (`longFromHeader`, final review I4). The mapping
 * carries `defaultYear` as `year`, the year the mapping step shows; `ambiguous`
 * is the long reading's unsettled fields (`ambiguityOf`), or a wide reading's
 * period when its rows hold a period column of their own (`wideAmbiguity`),
 * and, either layout, one person's rows that differ in a text column
 * (`differingRows`, round 9 I-W).
 */
export function detectLayout(
  rows: readonly string[][],
  opts: { numbers?: NumberOrigin; defaultYear?: number } = {},
): LayoutDetection {
  const numbers = opts.numbers ?? "text";
  const year = usableYear(opts.defaultYear);
  for (const pass of detectionPasses(rows, numbers, year)) {
    const found = pass.run();
    if (found === null) continue;
    const { mapping } = found;
    const ambiguous = withMappingQuestions(found.ambiguous, rows, mapping, numbers, year);
    return { kind: pass.kind, mapping: opts.defaultYear === undefined ? mapping : { ...mapping, year: opts.defaultYear }, ambiguous };
  }
  return UNKNOWN;
}

/** `ambiguous` with the questions every reading asks of its mapping: every
 *  repeated header row (`withRepeatedHeaders`) and one person's differing rows
 *  (`differingRows`), read in `year`. */
function withMappingQuestions(
  ambiguous: ColumnAmbiguity[],
  rows: Rows,
  mapping: ColumnMapping,
  numbers: NumberOrigin,
  year: number | undefined,
): ColumnAmbiguity[] {
  const repeated = withRepeatedHeaders(ambiguous, mapping, repeatedHeaderRows(rows, mapping, numbers));
  const differing = differingRows(rows, { ...mapping, year }, numbers);
  return differing === null ? repeated : [...repeated, differing];
}

/** The rows of the scan range that read as a header of `layout`: a long
 *  reading (`longFromHeader`) or a wide one with two period cells at least. */
function headerRowsFor(rows: Rows, layout: ColumnMapping["layout"], ctx: Ctx): number[] {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  const isHeader = (row: number): boolean => (layout === "long"
    ? longFromHeader(rows, row, ctx) !== null
    : wideHeaderAt(rows, row, MIN_WIDE_PERIODS_FALLBACK, ctx) !== null);
  return Array.from({ length: scanned }, (_, row) => row).filter(isHeader);
}

/** `cols` with the column a mapping chose, in order: the question names it
 *  even where detection would not have offered it. */
function withChosen(cols: readonly number[], chosen: number | undefined): number[] {
  return [...new Set(chosen === undefined ? cols : [...cols, chosen])].sort((a, b) => a - b);
}

/** A long mapping's period and hours questions, by `ambiguityOf` over the
 *  columns that could be each — what `longFromHeader` asks of its own
 *  preselection, for the mapping's header row and columns. */
function longQuestions(rows: Rows, mapping: ColumnMapping, ctx: Ctx): ColumnAmbiguity[] {
  const header = rows[mapping.headerRow] ?? [];
  const data = dataRowsBelow(rows, mapping.headerRow);
  const width = Math.max(header.length, rowWidth(data));
  const yearFound = findYearColumn(header, data, width);
  const own = new Set([mapping.person, mapping.email, mapping.rate].filter((c): c is number => c !== undefined));
  const scanned = scanPeriodColumns(header, data, width, ctx, mapping.yearCol ?? yearFound);
  const periodCols = withChosen(scanned.map((s) => s.col).filter((col) => !own.has(col)), mapping.period);
  const skip = new Set([mapping.period, mapping.yearCol, yearFound].filter((c): c is number => c !== undefined));
  const numeric = numericColumns(header, data, width, skip, ctx).any;
  const hoursCols = withChosen(
    numeric.filter((col) => !own.has(col) && !RATE_HEADER_RE.test(cellAt(header, col)) && classifyPeriodCell(cellAt(header, col)) === null),
    mapping.hours,
  );
  const share = scanned.find((s) => s.col === mapping.period)?.share ?? 0;
  const asked = ambiguityOf(header, periodCols, hoursCols, { col: mapping.period ?? -1, strong: share >= COLUMN_SHARE });
  return withLeftOutYear(asked, data, mapping, yearFound);
}

/**
 * ★★ `asked` with the PERIOD question when a long mapping leaves out the
 * sheet's year column (`yearFound`) while its period cells name no year
 * (final review 2, I1): `Name | Jahr | Monat | Stunden` mapped without `Jahr`
 * read every `Jan` in the default year, summing Ann's 2027 into 2026, and
 * nothing asked. The year column joins the candidates. Detection maps such a
 * column itself, so its own mapping never asks this — the long twin of the
 * wide reading's row year column (`rowYearColumns`, fix 9 OOS-b).
 */
function withLeftOutYear(asked: ColumnAmbiguity[], data: Rows, mapping: ColumnMapping, yearFound: number | undefined): ColumnAmbiguity[] {
  if (yearFound === undefined || mapping.yearCol !== undefined || mapping.period === undefined) return asked;
  const isYearLess = columnCells(data, mapping.period).some((c) => classifyPeriodCell(c)?.year === undefined && classifyPeriodCell(c) !== null);
  if (!isYearLess) return asked;
  const before = asked.find((a) => a.field === "period")?.candidates ?? [];
  const candidates = [...new Set([...before, mapping.period, yearFound])].sort((a, b) => a - b);
  return [{ field: "period", candidates }, ...asked.filter((a) => a.field !== "period")];
}

/**
 * ★★ The questions `mapping` raises, whoever chose it (§500: Claude's mapping,
 * or the user's edit of it) — what `detectLayout` asks of its own preselection,
 * evaluated for THIS mapping: a long mapping's period and hours candidates
 * (`longQuestions`), a wide mapping's row period or row year column
 * (`wideAmbiguity`), the header row when another row of the scan range reads
 * as a header of the layout (`headerRowsFor`) or repeats it
 * (`repeatedHeaderRows`), and one person's differing rows (`differingRows`).
 * Year-less labels are read in `mapping.year`. A mapping of Claude's asks
 * these before its rows are applied; detection's mapping asks the same.
 */
export function questionsFor(rows: readonly string[][], mapping: ColumnMapping, opts: { numbers?: NumberOrigin } = {}): ColumnAmbiguity[] {
  const numbers = opts.numbers ?? "text";
  const ctx: Ctx = { numbers, year: usableYear(mapping.year) };
  const own = mapping.layout === "wide" ? wideAmbiguity(rows, mapping, ctx) : longQuestions(rows, mapping, ctx);
  const headerRows = [...new Set([...headerRowsFor(rows, mapping.layout, ctx), mapping.headerRow])].sort((a, b) => a - b);
  return withMappingQuestions([...own, ...headerAmbiguity(headerRows)], rows, mapping, numbers, ctx.year);
}
