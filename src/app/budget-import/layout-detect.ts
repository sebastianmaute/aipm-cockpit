// src/app/budget-import/layout-detect.ts — guesses where the forecast sits in a
// sheet grid (§500). Pure: no i18n, no React, no DOM. The result is only a
// first guess for the mapping step; the user can change every column.
//
// WIDE: one column per period ("Jan 2026", "KW03 2026"), one row per person.
// LONG: one row per person and period, with a period column and an hours
// column. A wide header with at least MIN_WIDE_PERIODS period cells is taken
// first; a two-period wide sheet is only believed when no long reading fits,
// because a long sheet's start/end date columns look the same.

import { cellAt, detectDecimalStyle, ID_HEADER, isBlank, isTotalLabel, parseNumberCell, parsePeriodLabel, repeatedHeaderRows } from "./forecast-rows";
import type { ColumnAmbiguity, ColumnMapping } from "./forecast-types";
import { assignRunPeriods, classifyPeriodCell, isPeriodShapedIn, isYearColumn, isYearHeader, parseYearCell, usableYear } from "./period-assign";
import { HOURS_HEADER_RE, isPeriodWordHeader, PERSON_HEADER_RE } from "./header-words";
import type { NumberOrigin } from "./sheet-grid";

/** `ambiguous` lists the fields more than one column could be: a long
 *  sheet's (`longFromHeader`), or a wide sheet's period when its data rows
 *  hold a period column of their own (`wideAmbiguity`), and the header row
 *  when more than one row reads as one (`headerAmbiguity`); empty when the
 *  choice is clear, and always for none. */
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

function wideAmbiguity(rows: Rows, mapping: ColumnMapping, ctx: Ctx): ColumnAmbiguity[] {
  const own = [...new Set([...rowPeriodColumns(rows, mapping, ctx), ...rowYearColumns(rows, mapping)])];
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

/** The header question with every repeated header row among its candidates
 *  (round 5): a stacked block asks whatever its size, a one-row block too. */
function withRepeatedHeaders(ambiguous: ColumnAmbiguity[], mapping: ColumnMapping, repeated: readonly number[]): ColumnAmbiguity[] {
  if (repeated.length === 0) return ambiguous;
  const asked = ambiguous.find((a) => a.field === "header")?.candidates ?? [];
  const candidates = [...new Set([...asked, mapping.headerRow, ...repeated])].sort((a, b) => a - b);
  return [...ambiguous.filter((a) => a.field !== "header"), { field: "header", candidates }];
}

function detectWide(rows: Rows, minPeriods: number, ctx: Ctx): Detected | null {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  let first: ColumnMapping | null = null;
  const headerRows: number[] = [];
  for (let headerRow = 0; headerRow < scanned; headerRow++) {
    const header = rows[headerRow];
    // The header is read as a RUN: year rollover, dates a week apart as weeks.
    const run = assignRunPeriods(header, { defaultYear: ctx.year, numbers: ctx.numbers });
    const periodCols: number[] = [];
    for (let col = 0; col < header.length; col++) {
      if (!isTotalLabel(header[col]) && run[col] !== null) periodCols.push(col);
    }
    if (periodCols.length < minPeriods) continue;
    const mapping = wideFromHeader(rows, headerRow, periodCols, ctx);
    if (mapping === null) continue;
    first ??= mapping;
    headerRows.push(headerRow);
  }
  return first === null ? null : { mapping: first, ambiguous: [...wideAmbiguity(rows, first, ctx), ...headerAmbiguity(headerRows)] };
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
type PeriodPick = { col: number; share: number; candidates: number[] };

function findPeriodColumn(
  header: readonly string[],
  data: Rows,
  width: number,
  ctx: Ctx,
  yearCol: number | undefined,
): PeriodPick | undefined {
  // With a year column, a year-less "Jan" is a period: the row supplies its year.
  const isPeriod = (c: string): boolean =>
    parsePeriodLabel(c, ctx.year) !== null || (yearCol !== undefined && classifyPeriodCell(c) !== null);
  let best: { col: number; share: number; rank: number } | undefined;
  const candidates: number[] = [];
  for (let col = 0; col < width; col++) {
    const label = cellAt(header, col);
    const cells = columnCells(data, col);
    const share = shareOf(cells, isPeriod);
    if (col === yearCol || isBlank(label) || parsePeriodLabel(label, ctx.year) !== null || share === 0) continue;
    // ★★ ONE period makes a candidate (round 7 I-B): an `offen` in `Monat` once
    // pushed it under the share, and every row was read in `Erfasst am`'s month.
    candidates.push(col);
    // The PRESELECTION (and whether the row is a header at all) keeps the share.
    if (share < COLUMN_SHARE) continue;
    const rank = periodRank(label, cells);
    if (best === undefined || rank < best.rank) best = { col, share, rank };
  }
  return best && { col: best.col, share: best.share, candidates };
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
function ambiguityOf(header: readonly string[], periodCols: readonly number[], hoursCols: readonly number[], period: number): ColumnAmbiguity[] {
  const named = periodCols.filter((col) => isPeriodWordHeader(cellAt(header, col)));
  const out: ColumnAmbiguity[] = [];
  // One period-word column settles it only when the preselection is that column
  // (round 7 I-B: the share can now preselect another one).
  const settled = named.length === 1 && named[0] === period;
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
  // The PRESELECTION only, which the user confirms whenever there is a choice
  // (`ambiguityOf`): the leftmost column with an hours word, else the LEFTMOST
  // number column. ★★ A rightmost pick (final review I3) imported `Ist`,
  // `Actual`, `Summe` or `Betrag` in place of `Plan` or `Forecast` (rr6 N1).
  const hours = strongHours.find((col) => HOURS_HEADER_RE.test(cellAt(header, col))) ?? strongHours[0];
  if (hours === undefined || isDataRowShaped(header, period, hours, ctx)) return null;
  const rate = rateCols.find((col) => strong.includes(col));

  const used = new Set([...skip, hours, ...(rate === undefined ? [] : [rate])]);
  const email = findEmailColumn(header, data, used);
  const candidates = Array.from({ length: width }, (_, col) => col).filter((col) => !used.has(col));
  const person = pickPerson(candidates, header, data, email, ctx);
  if (person === null) return null;
  return {
    mapping: withOptionals({ layout: "long", headerRow, person, period, hours }, { email, rate, yearCol }),
    ambiguous: ambiguityOf(header, found.candidates.filter((col) => col !== person && col !== email), hoursCols.filter((col) => col !== person && col !== email), period),
    score: found.share + numberShare(columnCells(data, hours), ctx),
  };
}

/**
 * Every header row in the scan window is scored (period share plus hours
 * share); the best wins and a tie goes to the LATER row, so a title row whose
 * columns happen to fit loses to the real header under it.
 */
function detectLong(rows: Rows, ctx: Ctx): Detected | null {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  let best: ScoredMapping | null = null;
  const headerRows: number[] = [];
  for (let headerRow = 0; headerRow < scanned; headerRow++) {
    const candidate = longFromHeader(rows, headerRow, ctx);
    if (candidate === null) continue;
    headerRows.push(headerRow);
    if (best === null || candidate.score >= best.score) best = candidate;
  }
  return best === null ? null : { mapping: best.mapping, ambiguous: [...best.ambiguous, ...headerAmbiguity(headerRows)] };
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
 * period when its rows hold a period column of their own (`wideAmbiguity`).
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
    const ambiguous = withRepeatedHeaders(found.ambiguous, mapping, repeatedHeaderRows(rows, mapping, numbers));
    return { kind: pass.kind, mapping: opts.defaultYear === undefined ? mapping : { ...mapping, year: opts.defaultYear }, ambiguous };
  }
  return UNKNOWN;
}
