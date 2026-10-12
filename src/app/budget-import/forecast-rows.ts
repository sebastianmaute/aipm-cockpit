// src/app/budget-import/forecast-rows.ts — turns a raw sheet grid into
// forecast rows (§500). Pure: no i18n, no React, no DOM.
//
// Cells arrive as the strings the file holds. What a cell MEANS is decided
// here: a period header ("Mär 2026", "KW03 2026", an Excel serial), a number
// ("1.234,5" is 1234.5 in a German export, not 1.2345) or a total label.

import { isoWeekParts } from "../resource-capacity";
import { excelSerialToIso, type NumberOrigin } from "./sheet-grid";
import type { ColumnMapping, DropReason, ForecastRow } from "./forecast-types";

export type DecimalStyle = "dot" | "comma";

const MIN_EXCEL_SERIAL_PERIOD = 20000;
const MAX_EXCEL_SERIAL_PERIOD = 80000;
const DEC_28_MONTH_INDEX = 11;
const DEC_28_DAY = 28; // always inside the last ISO week of its year
const MAX_HOUR = 23;
const MAX_MINUTE_OR_SECOND = 59;
const TWO_DIGIT_YEAR_BASE = 2000;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, januar: 1, january: 1,
  feb: 2, februar: 2, february: 2,
  mar: 3, mär: 3, märz: 3, maerz: 3, march: 3,
  apr: 4, april: 4,
  may: 5, mai: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, okt: 10, october: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, dez: 12, december: 12, dezember: 12,
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

function monthKey(year: number, month: number): string | null {
  return month >= 1 && month <= 12 ? `${year}-${pad2(month)}` : null;
}

/** Month key of a real calendar date (UTC round trip), else null. */
function dateMonthKey(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  const isReal = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return isReal ? monthKey(year, month) : null;
}

/** ISO weeks in a year (52 or 53). */
function isoWeeksInYear(year: number): number {
  return isoWeekParts(new Date(Date.UTC(year, DEC_28_MONTH_INDEX, DEC_28_DAY))).week;
}

function weekKey(year: number, week: number): string | null {
  return week >= 1 && week <= isoWeeksInYear(year) ? `${year}-W${pad2(week)}` : null;
}

function serialKey(cell: string): string | null {
  const serial = Number(cell);
  if (serial < MIN_EXCEL_SERIAL_PERIOD || serial > MAX_EXCEL_SERIAL_PERIOD) return null;
  const iso = excelSerialToIso(serial);
  return iso === null ? null : iso.slice(0, 7);
}

/**
 * A period header as a canonical key: month "YYYY-MM" or week "YYYY-Www".
 * Case-insensitive, trimmed; null for anything unrecognised. Two-digit years
 * mean 20YY.
 */
export function parsePeriodLabel(cell: string): string | null {
  const s = cell.trim().toLowerCase();
  if (s === "") return null;

  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return monthKey(Number(m[1]), Number(m[2]));

  // ISO date, optionally with a time ("2026-01-15 00:00:00", "...T09:30:00.000Z").
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?z?)?$/.exec(s);
  if (m) {
    const isTimeValid = Number(m[4] ?? 0) <= MAX_HOUR
      && Number(m[5] ?? 0) <= MAX_MINUTE_OR_SECOND
      && Number(m[6] ?? 0) <= MAX_MINUTE_OR_SECOND;
    return isTimeValid ? dateMonthKey(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }

  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return dateMonthKey(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) return monthKey(Number(m[2]), Number(m[1]));

  m = /^(\d{4})-(?:kw|w)(\d{1,2})$/.exec(s);
  if (m) return weekKey(Number(m[1]), Number(m[2]));

  m = /^(?:kw|w)\s*(\d{1,2})[\s/-]+(\d{4})$/.exec(s);
  if (m) return weekKey(Number(m[2]), Number(m[1]));

  m = /^([a-zäöü]+)\.?[\s-]*(\d{4}|\d{2})$/.exec(s);
  if (m) {
    const month = MONTHS[m[1]];
    if (month === undefined) return null;
    const year = m[2].length === 2 ? TWO_DIGIT_YEAR_BASE + Number(m[2]) : Number(m[2]);
    return monthKey(year, month);
  }

  if (/^\d{5}(\.\d+)?$/.test(s)) return serialKey(s);
  return null;
}

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

const TOTAL_WORDS = ["total", "totals", "sum", "summe", "gesamt", "σ"] as const;

/** A "Total" / "Summe" / "Gesamt" / "Σ" label, bare or followed by a space or
 *  colon ("Total hours", "Gesamt: 2026"). Not "Summer" or "Totally". */
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

/** Wide layout: the period of every column whose header is a period. */
function wideColumns(header: readonly string[], mapping: ColumnMapping): Array<{ col: number; period: string }> {
  const out: Array<{ col: number; period: string }> = [];
  for (const col of mapping.periodCols ?? []) {
    const label = cellAt(header, col);
    if (isTotalLabel(label)) continue;
    const period = parsePeriodLabel(label);
    if (period !== null) out.push({ col, period });
  }
  return out;
}

/**
 * The forecast rows of one sheet. A blank hours cell yields no row, a `0`
 * does. Rows whose person is a total label, or blank, are dropped (a row
 * with nothing in any mapped cell is skipped without a drop). `dropped.row`
 * is the 1-based sheet row. Hours are returned as read, unrounded. `numbers` is
 * the grid's `SheetGrid.numbers`: a workbook's stored numbers read with a dot.
 */
export function gridToForecastRows(
  rows: readonly string[][],
  mapping: ColumnMapping,
  sheetName: string,
  numbers: NumberOrigin = "text",
): { rows: ForecastRow[]; dropped: DropReason[] } {
  const out: ForecastRow[] = [];
  const dropped: DropReason[] = [];
  const header = rows[mapping.headerRow] ?? [];
  const wide = mapping.layout === "wide";
  const columns = wide ? wideColumns(header, mapping) : [];
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
    const cells = wide
      ? columns
      : [{ col: mapping.hours ?? -1, period: parsePeriodLabel(cellAt(row, mapping.period)) }];
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
  return { rows: out, dropped };
}
