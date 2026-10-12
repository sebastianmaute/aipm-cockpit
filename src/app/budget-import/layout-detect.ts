// src/app/budget-import/layout-detect.ts — guesses where the forecast sits in a
// sheet grid (§500). Pure: no i18n, no React, no DOM. The result is only a
// first guess for the mapping step; the user can change every column.
//
// WIDE: one column per period ("Jan 2026", "KW03 2026"), one row per person.
// LONG: one row per person and period, with a period column and an hours
// column. A wide header with at least MIN_WIDE_PERIODS period cells is taken
// first; a two-period wide sheet is only believed when no long reading fits,
// because a long sheet's start/end date columns look the same.

import { detectDecimalStyle, isTotalLabel, parseNumberCell, parsePeriodLabel } from "./forecast-rows";
import type { ColumnMapping } from "./forecast-types";

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

const PERIOD_HEADER_RE = /month|monat|period|periode|date|datum|week|woche|kw/i;
const HOURS_HEADER_RE = /hour|stunden|std|hrs/i;
const RATE_HEADER_RE = /\brates?\b|satz|€\/h|eur\/h/i;
const EMAIL_HEADER_RE = /e-?mail/i;
const SERIAL_RE = /^\d{5}(\.\d+)?$/;

const UNKNOWN: LayoutDetection = { kind: "unknown", mapping: null };

type Rows = readonly string[][];

const cellAt = (row: readonly string[] | undefined, col: number): string => row?.[col] ?? "";
const isBlank = (s: string): boolean => s.trim() === "";
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

const periodShare = (cells: readonly string[]): number =>
  shareOf(cells, (c) => parsePeriodLabel(c) !== null);

function numberShare(cells: readonly string[]): number {
  const style = detectDecimalStyle(cells);
  return shareOf(cells, (c) => parseNumberCell(c, style) !== null);
}

/** True when the cells are numbers (or nothing at all) in at least COLUMN_SHARE. */
function isNumericOrEmpty(cells: readonly string[]): boolean {
  return cells.length === 0 || numberShare(cells) >= COLUMN_SHARE;
}

function isMostlyText(cells: readonly string[]): boolean {
  const style = detectDecimalStyle(cells);
  return cells.length > 0 && shareOf(cells, (c) => parseNumberCell(c, style) === null) >= TEXT_SHARE;
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
 * The person column among `candidates`: the first mostly-text column, else
 * the e-mail column when that is all there is to identify a person by.
 */
function pickPerson(
  candidates: readonly number[],
  data: Rows,
  email: number | undefined,
): number | null {
  const text = candidates.find((col) => col !== email && isMostlyText(columnCells(data, col)));
  if (text !== undefined) return text;
  const emailIsText = email !== undefined && candidates.includes(email) && isMostlyText(columnCells(data, email));
  return emailIsText ? email : null;
}

function withOptionals(base: ColumnMapping, extras: Partial<ColumnMapping>): ColumnMapping {
  const out: ColumnMapping = { ...base };
  if (extras.email !== undefined) out.email = extras.email;
  if (extras.rate !== undefined) out.rate = extras.rate;
  return out;
}

function wideFromHeader(rows: Rows, headerRow: number, periodCols: readonly number[]): ColumnMapping | null {
  const header = rows[headerRow] ?? [];
  const data = dataRowsBelow(rows, headerRow);
  const periodSet = new Set(periodCols);
  // A real wide header has numbers (or nothing) under it; a long sheet's data
  // row with several date cells has dates under it.
  if (!isNumericOrEmpty(periodCols.flatMap((col) => columnCells(data, col)))) return null;
  const email = findEmailColumn(header, data, periodSet);
  const rate = firstHeaderMatch(header, RATE_HEADER_RE, new Set([...periodCols, ...(email === undefined ? [] : [email])]));
  const leftOfPeriods = Array.from({ length: periodCols[0] }, (_, col) => col).filter((col) => col !== rate);
  const person = pickPerson(leftOfPeriods, data, email);
  if (person === null) return null;
  return withOptionals(
    { layout: "wide", headerRow, person, periodCols: [...periodCols] },
    { email, rate },
  );
}

function detectWide(rows: Rows, minPeriods: number): ColumnMapping | null {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  for (let headerRow = 0; headerRow < scanned; headerRow++) {
    const header = rows[headerRow];
    const periodCols: number[] = [];
    for (let col = 0; col < header.length; col++) {
      if (!isTotalLabel(header[col]) && parsePeriodLabel(header[col]) !== null) periodCols.push(col);
    }
    if (periodCols.length < minPeriods) continue;
    const mapping = wideFromHeader(rows, headerRow, periodCols);
    if (mapping !== null) return mapping;
  }
  return null;
}

/** Lower is better: a period-looking header, then a real date over a bare serial. */
function periodRank(header: string, cells: readonly string[]): number {
  if (PERIOD_HEADER_RE.test(header)) return 0;
  return cells.every((c) => SERIAL_RE.test(c)) ? 2 : 1;
}

function findPeriodColumn(
  header: readonly string[],
  data: Rows,
  width: number,
): { col: number; share: number } | undefined {
  let best: { col: number; share: number; rank: number } | undefined;
  for (let col = 0; col < width; col++) {
    const label = cellAt(header, col);
    const cells = columnCells(data, col);
    const share = periodShare(cells);
    if (isBlank(label) || parsePeriodLabel(label) !== null || share < COLUMN_SHARE) continue;
    const rank = periodRank(label, cells);
    if (best === undefined || rank < best.rank) best = { col, share, rank };
  }
  return best && { col: best.col, share: best.share };
}

/** Numeric columns with a header, not the period column, not rate-like. */
function numericColumns(header: readonly string[], data: Rows, width: number, period: number): number[] {
  const out: number[] = [];
  for (let col = 0; col < width; col++) {
    const label = cellAt(header, col);
    const cells = columnCells(data, col);
    const isCandidate = col !== period && !isBlank(label) && cells.length > 0 && numberShare(cells) >= COLUMN_SHARE;
    if (isCandidate) out.push(col);
  }
  return out;
}

/**
 * A header is a row of labels. A row whose own hours cell is a number, or whose
 * own period cell is a period, is a data row — typically the one with an
 * unparseable period cell, which would otherwise score a perfect 2.0 as a
 * "header" and silently drop every row above it.
 */
function isDataRowShaped(header: readonly string[], period: number, hours: number): boolean {
  const hoursCell = cellAt(header, hours);
  const isNumber = parseNumberCell(hoursCell, "dot") !== null || parseNumberCell(hoursCell, "comma") !== null;
  return isNumber || parsePeriodLabel(cellAt(header, period)) !== null;
}

/** A long reading of one candidate header row, with how well its columns fit. */
type ScoredMapping = { mapping: ColumnMapping; score: number };

function longFromHeader(rows: Rows, headerRow: number): ScoredMapping | null {
  const header = rows[headerRow] ?? [];
  const data = dataRowsBelow(rows, headerRow);
  const width = Math.max(header.length, rowWidth(data));
  const found = findPeriodColumn(header, data, width);
  if (found === undefined) return null;
  const period = found.col;

  const numeric = numericColumns(header, data, width, period);
  const rateCols = numeric.filter((col) => RATE_HEADER_RE.test(cellAt(header, col)));
  const hoursCols = numeric.filter((col) => !rateCols.includes(col));
  const hours = hoursCols.find((col) => HOURS_HEADER_RE.test(cellAt(header, col))) ?? hoursCols[0];
  if (hours === undefined || isDataRowShaped(header, period, hours)) return null;
  const rate = rateCols[0];

  const used = new Set([period, hours, ...(rate === undefined ? [] : [rate])]);
  const email = findEmailColumn(header, data, used);
  const candidates = Array.from({ length: width }, (_, col) => col).filter((col) => !used.has(col));
  const person = pickPerson(candidates, data, email);
  if (person === null) return null;
  return {
    mapping: withOptionals({ layout: "long", headerRow, person, period, hours }, { email, rate }),
    score: found.share + numberShare(columnCells(data, hours)),
  };
}

/**
 * Every header row in the scan window is scored (period share plus hours
 * share); the best wins and a tie goes to the LATER row, so a title row whose
 * columns happen to fit loses to the real header under it.
 */
function detectLong(rows: Rows): ColumnMapping | null {
  const scanned = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  let best: ScoredMapping | null = null;
  for (let headerRow = 0; headerRow < scanned; headerRow++) {
    const candidate = longFromHeader(rows, headerRow);
    if (candidate !== null && (best === null || candidate.score >= best.score)) best = candidate;
  }
  return best?.mapping ?? null;
}

/**
 * Guess the layout of a sheet grid and where its columns are. Scans the first
 * 10 rows for the header. Ragged and empty rows are fine (a missing cell is
 * blank). `unknown` when neither a wide nor a long reading fits.
 */
export function detectLayout(rows: readonly string[][]): LayoutDetection {
  const wide = detectWide(rows, MIN_WIDE_PERIODS);
  if (wide !== null) return { kind: "wide", mapping: wide };
  const long = detectLong(rows);
  if (long !== null) return { kind: "long", mapping: long };
  const narrowWide = detectWide(rows, MIN_WIDE_PERIODS_FALLBACK);
  if (narrowWide !== null) return { kind: "wide", mapping: narrowWide };
  return UNKNOWN;
}
