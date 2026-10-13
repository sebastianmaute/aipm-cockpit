// src/app/budget-import/forecast-rows.ts — turns a raw sheet grid into
// forecast rows (§500). Pure: no i18n, no React, no DOM.
//
// Cells arrive as the strings the file holds. What a cell MEANS is decided
// here: a number ("1.234,5" is 1234.5 in a German export, not 1.2345) or a
// total label. Which PERIOD a cell is comes from `period-assign.ts`, the one
// definition detection and the Claude route read too.

import type { NumberOrigin } from "./sheet-grid";
import { assignCellPeriod, assignRunDetailed, parsePeriodLabel } from "./period-assign";
import type { ColumnMapping, DropReason, ForecastRow, IgnoredColumn } from "./forecast-types";

/** Re-exported: callers that read a single period cell keep one import. */
export { parsePeriodLabel };

export type DecimalStyle = "dot" | "comma";

/** Share of the person rows that must hold a number for an unread column to be reported. */
const IGNORED_COLUMN_SHARE = 0.5;

/** Whitespace removed and one trailing unit or currency mark cut. */
function stripNumberDecoration(cell: string): string {
  return cell.replace(/\s+/g, "").replace(/[h€$£₹]$/i, "");
}

/**
 * "comma" (German: 1.234,5) when any cell is a dot-grouped number or has a
 * comma decimal, else "dot". Decided over a whole hours column, never per
 * cell: "1.234" alone is ambiguous, "1.234,5" two rows down is not.
 */
export function detectDecimalStyle(cells: readonly string[], numbers: NumberOrigin = "text"): DecimalStyle {
  for (const cell of cells) {
    if (isStoredNumber(cell, numbers)) continue;
    const s = stripNumberDecoration(cell).replace(/^-/, "");
    if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d+$/.test(s)) return "comma";
  }
  return "dot";
}

/** A number cell as Excel stores it: digits and at most one dot decimal. */
const STORED_NUMBER = /^[+-]?\d+(\.\d+)?$/;
/** A German number: a dot only as a thousands mark in groups of three. */
const COMMA_NUMBER = /^[+-]?([1-9]\d{0,2}(\.\d{3})+|\d+)(,\d+)?$/;

/** In a workbook (`numbers` "dot"), a plain dot number is a stored number cell,
 *  read with a dot whatever its column's style and never voting on that style. */
function isStoredNumber(cell: string, numbers: NumberOrigin): boolean {
  return numbers === "dot" && STORED_NUMBER.test(cell.trim());
}

/** A cell as a number in the given style; null for blank, non-numeric or
 *  non-finite. In comma style a dot is only a thousands mark in groups of three,
 *  so a stray "2.5" is null (reported), never 25. A workbook's stored number
 *  (`numbers` "dot") is read with a dot whatever `style` says. */
export function parseNumberCell(cell: string, style: DecimalStyle, numbers: NumberOrigin = "text"): number | null {
  if (isStoredNumber(cell, numbers)) return Number(cell.trim());
  const stripped = stripNumberDecoration(cell);
  if (stripped === "") return null;
  if (style === "comma" && !COMMA_NUMBER.test(stripped)) return null;
  const normalised = style === "comma"
    ? stripped.replace(/\./g, "").replace(",", ".")
    : stripped.replace(/,/g, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalised)) return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

const TOTAL_WORDS = [
  "total", "totals", "sum", "summe", "gesamt", "σ",
  "subtotal", "zwischensumme", "gesamtsumme", "grand total",
] as const;

/** A "Total" / "Subtotal" / "Grand total" / "Summe" / "Zwischensumme" /
 *  "Gesamt" / "Gesamtsumme" / "Σ" label, bare or followed by a space or colon
 *  ("Total hours", "Gesamt: 2026"). Not "Summer" or "Totally". */
export function isTotalLabel(cell: string): boolean {
  const s = cell.trim().toLowerCase();
  return TOTAL_WORDS.some((w) => s === w || s.startsWith(`${w} `) || s.startsWith(`${w}:`));
}

/** 0-based column index as spreadsheet letters: 0 = A, 25 = Z, 26 = AA. */
export function columnLetters(col: number): string {
  let n = col + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const cellAt = (row: readonly string[], col: number | undefined): string =>
  col === undefined ? "" : (row[col] ?? "");

const isBlank = (s: string): boolean => s.trim() === "";

type PersonMeta = { person: string; email?: string; rate?: number };

function readMeta(row: readonly string[], mapping: ColumnMapping, rateStyle: DecimalStyle, numbers: NumberOrigin): PersonMeta {
  const meta: PersonMeta = { person: cellAt(row, mapping.person).trim() };
  const email = cellAt(row, mapping.email).trim();
  if (email !== "") meta.email = email;
  const rate = parseNumberCell(cellAt(row, mapping.rate), rateStyle, numbers);
  if (rate !== null) meta.rate = rate;
  return meta;
}

function withMeta(meta: PersonMeta, period: string, hours: number, source: string): ForecastRow {
  const row: ForecastRow = { person: meta.person, period, hours, source };
  if (meta.email !== undefined) row.email = meta.email;
  if (meta.rate !== undefined) row.rate = meta.rate;
  return row;
}

type WideColumn = { col: number; period: string; assumed: boolean };

/** Wide layout: the period of every mapped column whose header is a period,
 *  the header row read as a RUN (`assignRunDetailed`: year rollover, dates a
 *  week apart as weeks). */
function wideColumns(header: readonly string[], mapping: ColumnMapping, numbers: NumberOrigin): WideColumn[] {
  const run = assignRunDetailed(header, { defaultYear: mapping.year, numbers });
  const out: WideColumn[] = [];
  for (const col of mapping.periodCols ?? []) {
    const assigned = run[col];
    if (!isTotalLabel(cellAt(header, col)) && assigned) out.push({ col, ...assigned });
  }
  return out;
}

/** Long layout: a row's one hours cell and its period — a year-less period cell
 *  takes the row's `yearCol` year, else `mapping.year`. A long sheet's rows are
 *  never read as a run: they repeat Jan…Dec per person. */
function longCell(row: readonly string[], mapping: ColumnMapping): { col: number; period: string | null; assumed: boolean } {
  const rowYear = mapping.yearCol === undefined ? undefined : cellAt(row, mapping.yearCol);
  const assigned = assignCellPeriod(cellAt(row, mapping.period), { rowYear, defaultYear: mapping.year });
  return { col: mapping.hours ?? -1, period: assigned?.period ?? null, assumed: assigned?.assumed ?? false };
}

/**
 * The forecast rows of one sheet. A blank hours cell yields no row, a `0`
 * does. Rows whose person is a total label, or blank, are dropped (a row
 * with nothing in any mapped cell is skipped without a drop). `dropped.row`
 * is the 1-based sheet row. Hours are returned as read, unrounded. `numbers` is
 * the grid's `SheetGrid.numbers`: a workbook's stored numbers read with a dot.
 * Period labels without a year are read in `mapping.year`. `ignoredColumns`
 * lists a wide sheet's unread number columns (see `IgnoredColumn`).
 */
export function gridToForecastRows(
  rows: readonly string[][],
  mapping: ColumnMapping,
  sheetName: string,
  numbers: NumberOrigin = "text",
): { rows: ForecastRow[]; dropped: DropReason[]; ignoredColumns: IgnoredColumn[] } {
  const out: ForecastRow[] = [];
  const dropped: DropReason[] = [];
  const header = rows[mapping.headerRow] ?? [];
  const wide = mapping.layout === "wide";
  const columns = wide ? wideColumns(header, mapping, numbers) : [];
  const hoursCols = wide ? columns.map((c) => c.col) : [mapping.hours];
  const mappedCols = [mapping.person, mapping.email, mapping.rate, mapping.period, ...hoursCols];

  // First pass: the data rows that name a person, so a total row's numbers
  // never vote on the decimal style.
  const people: Array<{ index: number; row: readonly string[] }> = [];
  for (let index = mapping.headerRow + 1; index < rows.length; index++) {
    const row = rows[index];
    if (mappedCols.every((c) => isBlank(cellAt(row, c)))) continue;
    const person = cellAt(row, mapping.person);
    if (isTotalLabel(person)) dropped.push({ row: index + 1, reason: "total" });
    else if (isBlank(person)) dropped.push({ row: index + 1, reason: "blank-person" });
    else people.push({ index, row });
  }

  const hoursStyle = detectDecimalStyle(
    people.flatMap(({ row }) => hoursCols.map((c) => cellAt(row, c))),
    numbers,
  );
  const rateStyle = detectDecimalStyle(people.map(({ row }) => cellAt(row, mapping.rate)), numbers);
  const sourceOf = (index: number, col: number): string =>
    `${sheetName}!${columnLetters(col)}${index + 1}`;

  for (const { index, row } of people) {
    const meta = readMeta(row, mapping, rateStyle, numbers);
    const cells = wide ? columns : [longCell(row, mapping)];
    for (const { col, period } of cells) {
      const raw = cellAt(row, col);
      if (isBlank(raw)) continue;
      if (period === null) {
        dropped.push({ row: index + 1, reason: "bad-period" });
        continue;
      }
      const hours = parseNumberCell(raw, hoursStyle, numbers);
      if (hours === null) dropped.push({ row: index + 1, reason: "bad-number" });
      else out.push(withMeta(meta, period, hours, sourceOf(index, col)));
    }
  }

  dropped.sort((a, b) => a.row - b.row);
  const ignoredColumns = wide ? unreadNumberColumns(header, mapping, columns, people, numbers) : [];
  return { rows: out, dropped, ignoredColumns };
}

/** The columns from the first period column on that are not read, not a
 *  mapped field and not a total, yet hold a number in more than half of the
 *  person rows — hours the import would otherwise leave out without a word. */
function unreadNumberColumns(
  header: readonly string[],
  mapping: ColumnMapping,
  read: ReadonlyArray<{ col: number }>,
  people: ReadonlyArray<{ row: readonly string[] }>,
  numbers: NumberOrigin,
): IgnoredColumn[] {
  const periodCols = mapping.periodCols ?? [];
  if (periodCols.length === 0 || people.length === 0) return [];
  const skip = new Set<number | undefined>([mapping.person, mapping.email, mapping.rate, ...read.map((c) => c.col)]);
  const width = people.reduce((max, { row }) => Math.max(max, row.length), header.length);
  const out: IgnoredColumn[] = [];
  for (let col = Math.min(...periodCols); col < width; col++) {
    const label = cellAt(header, col);
    if (skip.has(col) || isTotalLabel(label)) continue;
    const cells = people.map(({ row }) => cellAt(row, col));
    const style = detectDecimalStyle(cells, numbers);
    const numeric = cells.filter((c) => parseNumberCell(c, style, numbers) !== null).length;
    if (numeric > people.length * IGNORED_COLUMN_SHARE) out.push({ col, header: label.trim() });
  }
  return out;
}
