// src/app/budget-import/layout-detect.ts — guesses where the forecast sits in a
// sheet grid (§500). Pure: no i18n, no React, no DOM. The result is only a
// first guess for the mapping step; the user can change every column.
//
// WIDE: one column per period ("Jan 2026", "KW03 2026"), one row per person.
// LONG: one row per person and period, with a period column and an hours
// column. A wide header with at least MIN_WIDE_PERIODS period cells is taken
// first; a two-period wide sheet is only believed when no long reading fits,
// because a long sheet's start/end date columns look the same.

import { cellAt, detectDecimalStyle, ID_HEADER, isBlank, isTotalLabel, parseNumberCell, parsePeriodLabel } from "./forecast-rows";
import type { ColumnMapping } from "./forecast-types";
import { assignRunPeriods, classifyPeriodCell, isPeriodShapedIn, isYearColumn, isYearHeader, parseYearCell, usableYear } from "./period-assign";
import type { NumberOrigin } from "./sheet-grid";

export type LayoutDetection = {
  kind: "wide" | "long" | "unknown";
  mapping: ColumnMapping | null;
};

const MAX_HEADER_SCAN_ROWS = 10;
const MIN_WIDE_PERIODS = 3;
const MIN_WIDE_PERIODS_FALLBACK = 2;
/** Share of a column's non-blank cells that must parse for it to count. */
const COLUMN_SHARE = 0.8;
/** Share of a column's non-blank cells that must be text for a person column. */
const TEXT_SHARE = 0.5;

/** A long sheet's period column by its header: ranked first (`periodRank`). */
const PERIOD_HEADER_RE = /month|monat|period|periode|zeitraum|week|woche|kw/i;
/** A date column's header: ranked below `PERIOD_HEADER_RE`, above none. */
const DATE_HEADER_RE = /date|datum/i;
const HOURS_HEADER_RE = /hour|stunden|std|hrs|aufwand|effort/i;
const RATE_HEADER_RE = /\brates?\b|satz|€\/h|eur\/h/i;
const EMAIL_HEADER_RE = /e-?mail/i;
const PERSON_HEADER_RE = /^(name|mitarbeiter(in)?|person|ressource|resource|employee|member|mitglied)$/i;
const SERIAL_RE = /^\d{5}(\.\d+)?$/;

const UNKNOWN: LayoutDetection = { kind: "unknown", mapping: null };

type Rows = readonly string[][];

/** How the grid's cells are read: `numbers` is `SheetGrid.numbers`, `year` the
 *  year a period label without one is read in (see `parsePeriodLabel`). */
type Ctx = { numbers: NumberOrigin; year?: number };

const isTotalRow = (row: readonly string[]): boolean => row.some(isTotalLabel);

/** The data rows under a header, total rows left out. */
function dataRowsBelow(rows: Rows, headerRow: number): Rows {
  return rows.slice(headerRow + 1).filter((row) => !isTotalRow(row));
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

function detectWide(rows: Rows, minPeriods: number, ctx: Ctx): ColumnMapping | null {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
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
    if (mapping !== null) return mapping;
  }
  return null;
}

/** Rank weights of `periodRank`, most significant first. */
const RANK_NO_PERIOD_HEADER = 8;
const RANK_DATE_CELLS = 4;
const RANK_NO_DATE_HEADER = 2;
const RANK_SERIAL_CELLS = 1;

/**
 * Lower is better, each test outranking every one after it: a period header
 * (`Month`, `Zeitraum`, `KW` …); cells that are period LABELS (`Jan 2026`,
 * `2026-01`, `KW03`) over full dates; a `Date` / `Datum` header; a real date
 * over a bare serial. Ties keep the leftmost column. ★★ `Start date` once
 * ranked with `Month`, and the leftmost won: every row's hours were summed into
 * the start month (final review I2).
 */
function periodRank(header: string, cells: readonly string[]): number {
  const isDateCell = (c: string): boolean => {
    const p = classifyPeriodCell(c);
    return p?.kind === "month" && p.date !== undefined;
  };
  return (PERIOD_HEADER_RE.test(header) ? 0 : RANK_NO_PERIOD_HEADER)
    + (cells.some(isDateCell) ? RANK_DATE_CELLS : 0)
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

function findPeriodColumn(
  header: readonly string[],
  data: Rows,
  width: number,
  ctx: Ctx,
  yearCol: number | undefined,
): { col: number; share: number } | undefined {
  // With a year column, a year-less "Jan" is a period: the row supplies its year.
  const isPeriod = (c: string): boolean =>
    parsePeriodLabel(c, ctx.year) !== null || (yearCol !== undefined && classifyPeriodCell(c) !== null);
  let best: { col: number; share: number; rank: number } | undefined;
  for (let col = 0; col < width; col++) {
    const label = cellAt(header, col);
    const cells = columnCells(data, col);
    const share = shareOf(cells, isPeriod);
    if (col === yearCol || isBlank(label) || parsePeriodLabel(label, ctx.year) !== null || share < COLUMN_SHARE) continue;
    const rank = periodRank(label, cells);
    if (best === undefined || rank < best.rank) best = { col, share, rank };
  }
  return best && { col: best.col, share: best.share };
}

/** Numeric columns with a header, not the period or year column, not an ID
 *  (`ID_HEADER`: `ID`, `Nr`, `PersNr` …) or year column (`isYearColumn`).
 *  ★★ `ID | Name | Month | Effort` once imported the employee IDs as hours, and
 *  `Nr | … | Aufwand` the row numbers (final review I3). A period-shaped cell (a
 *  workbook's serial date) counts as no number here, so with the rightmost
 *  pick (`longFromHeader`) a trailing `Erfasst` date column is not the hours. */
function numericColumns(header: readonly string[], data: Rows, width: number, skip: ReadonlySet<number>, ctx: Ctx): number[] {
  const out: number[] = [];
  for (let col = 0; col < width; col++) {
    const label = cellAt(header, col);
    const cells = columnCells(data, col);
    const isExcluded = skip.has(col) || isBlank(label) || ID_HEADER.test(label.trim()) || isYearColumn(label, cells);
    const style = detectDecimalStyle(cells, ctx.numbers);
    const figureShare = shareOf(cells, (c) => !isPeriodShapedIn(c, ctx.numbers) && parseNumberCell(c, style, ctx.numbers) !== null);
    if (!isExcluded && cells.length > 0 && figureShare >= COLUMN_SHARE) out.push(col);
  }
  return out;
}

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

/** A long reading of one candidate header row, with how well its columns fit. */
type ScoredMapping = { mapping: ColumnMapping; score: number };

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

  const numeric = numericColumns(header, data, width, skip, ctx);
  const rateCols = numeric.filter((col) => RATE_HEADER_RE.test(cellAt(header, col)));
  // ★★ A column headed by a period ("Jan", "Jan 2026", "KW03") is never a long
  // sheet's hours: `Name | Start | Jan 2026 | Feb 2026` once read long, the
  // Start date as the period and January's column as the hours, so Ann's
  // January landed in her start month (final review I4). Such a sheet falls
  // through to two-period wide.
  const hoursCols = numeric.filter((col) => !rateCols.includes(col) && classifyPeriodCell(cellAt(header, col)) === null);
  // A named hours column, else the RIGHTMOST number column: a code or team
  // number sits left of the figures more often than right of them.
  const hours = hoursCols.find((col) => HOURS_HEADER_RE.test(cellAt(header, col))) ?? hoursCols[hoursCols.length - 1];
  if (hours === undefined || isDataRowShaped(header, period, hours, ctx)) return null;
  const rate = rateCols[0];

  const used = new Set([...skip, hours, ...(rate === undefined ? [] : [rate])]);
  const email = findEmailColumn(header, data, used);
  const candidates = Array.from({ length: width }, (_, col) => col).filter((col) => !used.has(col));
  const person = pickPerson(candidates, header, data, email, ctx);
  if (person === null) return null;
  return {
    mapping: withOptionals({ layout: "long", headerRow, person, period, hours }, { email, rate, yearCol }),
    score: found.share + numberShare(columnCells(data, hours), ctx),
  };
}

/**
 * Every header row in the scan window is scored (period share plus hours
 * share); the best wins and a tie goes to the LATER row, so a title row whose
 * columns happen to fit loses to the real header under it.
 */
function detectLong(rows: Rows, ctx: Ctx): ColumnMapping | null {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  let best: ScoredMapping | null = null;
  for (let headerRow = 0; headerRow < scanned; headerRow++) {
    const candidate = longFromHeader(rows, headerRow, ctx);
    if (candidate !== null && (best === null || candidate.score >= best.score)) best = candidate;
  }
  return best?.mapping ?? null;
}

type Pass = { kind: "wide" | "long"; run: () => ColumnMapping | null };

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
 * carries `defaultYear` as `year`, the year the mapping step shows.
 */
export function detectLayout(
  rows: readonly string[][],
  opts: { numbers?: NumberOrigin; defaultYear?: number } = {},
): LayoutDetection {
  const numbers = opts.numbers ?? "text";
  const year = usableYear(opts.defaultYear);
  for (const pass of detectionPasses(rows, numbers, year)) {
    const mapping = pass.run();
    if (mapping === null) continue;
    return { kind: pass.kind, mapping: opts.defaultYear === undefined ? mapping : { ...mapping, year: opts.defaultYear } };
  }
  return UNKNOWN;
}
