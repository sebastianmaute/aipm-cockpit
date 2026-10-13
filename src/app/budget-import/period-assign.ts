// src/app/budget-import/period-assign.ts — how a sheet cell becomes a period
// (§500). Pure: no i18n, no React, no DOM.
//
// ★★ ONE place decides this, for the hand route (`gridToForecastRows`),
// detection (`detectLayout`) and the Claude route's near-cell check
// (`validateForecastRows`), so the three can never disagree about which
// period a cell is. A single cell is read by `parsePeriodLabel`; a WIDE
// header row is read as a RUN by `assignRunPeriods`, because a year-less
// "Jan" that follows "Dez" is next year's January, and a row of Monday dates
// a week apart is a row of weeks, not of months.

import { isoWeekParts, periodKeyForDate } from "../resource-capacity";
import { excelSerialToIso, type NumberOrigin } from "./sheet-grid";

const MIN_EXCEL_SERIAL_PERIOD = 20000;
const MAX_EXCEL_SERIAL_PERIOD = 80000;
const DEC_28_MONTH_INDEX = 11;
const DEC_28_DAY = 28; // always inside the last ISO week of its year
const MAX_HOUR = 23;
const MAX_MINUTE_OR_SECOND = 59;
const TWO_DIGIT_YEAR_BASE = 2000;
const MIN_DEFAULT_YEAR = 1000;
const MAX_DEFAULT_YEAR = 9999;
const MAX_WEEK = 53;
const MONTHS_PER_YEAR = 12;
const WEEKS_PER_YEAR = 52;
const HALF_YEAR = 0.5;
/** Float slack for "exactly half a year" (Jul → Jan, KW27 → KW01). */
const POSITION_EPSILON = 1e-9;
const MIN_YEAR_CELL = 2000;
const MAX_YEAR_CELL = 2100;
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, januar: 1, january: 1, jän: 1, jänner: 1,
  feb: 2, februar: 2, february: 2,
  mar: 3, mär: 3, märz: 3, maerz: 3, mrz: 3, march: 3,
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

/** What a period-shaped cell says, before any year is filled in. `year` is
 *  absent for a label that names none ("Jan", "KW03"). `date` is the ISO day
 *  of a cell that is a full date (an ISO or dotted date, or an Excel serial —
 *  `serial` marks the last). */
export type PeriodCell =
  | { kind: "month"; index: number; year?: number; date?: string; serial?: true }
  | { kind: "week"; index: number; year?: number };

/** A period a cell was read as, and whether its year came from the default
 *  year (directly or by rolling over from it) rather than from the sheet. */
export type AssignedPeriod = { period: string; assumed: boolean };

const pad2 = (n: number): string => String(n).padStart(2, "0");

function monthKey(year: number, month: number): string | null {
  return month >= 1 && month <= 12 ? `${year}-${pad2(month)}` : null;
}

/** ISO weeks in a year (52 or 53). */
function isoWeeksInYear(year: number): number {
  return isoWeekParts(new Date(Date.UTC(year, DEC_28_MONTH_INDEX, DEC_28_DAY))).week;
}

function weekKey(year: number, week: number): string | null {
  return week >= 1 && week <= isoWeeksInYear(year) ? `${year}-W${pad2(week)}` : null;
}

/** A usable default year, else undefined (absent, fractional, not four digits). */
export function usableYear(year: number | undefined): number | undefined {
  const isYear = year !== undefined && Number.isInteger(year) && year >= MIN_DEFAULT_YEAR && year <= MAX_DEFAULT_YEAR;
  return isYear ? year : undefined;
}

/** A real calendar date as a month cell carrying its ISO day, else null. */
function dateCell(year: number, month: number, day: number): PeriodCell | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  const isReal = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return isReal ? { kind: "month", index: month, year, date: `${year}-${pad2(month)}-${pad2(day)}` } : null;
}

function monthCell(year: number, month: number): PeriodCell | null {
  return month >= 1 && month <= 12 ? { kind: "month", index: month, year } : null;
}

function weekCell(year: number, week: number): PeriodCell | null {
  return weekKey(year, week) === null ? null : { kind: "week", index: week, year };
}

function serialCell(s: string): PeriodCell | null {
  const serial = Number(s);
  if (serial < MIN_EXCEL_SERIAL_PERIOD || serial > MAX_EXCEL_SERIAL_PERIOD) return null;
  const iso = excelSerialToIso(serial);
  if (iso === null) return null;
  return { kind: "month", index: Number(iso.slice(5, 7)), year: Number(iso.slice(0, 4)), date: iso, serial: true };
}

/** A month name ("Jan", "Mrz.", "Januar") or week ("KW03", "KW 3", "W03") that
 *  names no year. Bare numbers are never read this way. */
function yearlessCell(s: string): PeriodCell | null {
  let m = /^([a-zäöü]+)\.?$/.exec(s);
  if (m) {
    const month = MONTHS[m[1]];
    return month === undefined ? null : { kind: "month", index: month };
  }
  m = /^(?:kw|w)\s*(\d{1,2})$/.exec(s);
  if (!m) return null;
  const week = Number(m[1]);
  return week >= 1 && week <= MAX_WEEK ? { kind: "week", index: week } : null;
}

function isoDateCell(m: RegExpExecArray): PeriodCell | null {
  const isTimeValid = Number(m[4] ?? 0) <= MAX_HOUR
    && Number(m[5] ?? 0) <= MAX_MINUTE_OR_SECOND
    && Number(m[6] ?? 0) <= MAX_MINUTE_OR_SECOND;
  return isTimeValid ? dateCell(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/**
 * What a cell says as a period, with no year filled in: null for anything that
 * is not period-shaped. Case-insensitive, trimmed. Two-digit years mean 20YY.
 */
export function classifyPeriodCell(cell: string): PeriodCell | null {
  const s = cell.trim().toLowerCase();
  if (s === "") return null;

  let m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m) return monthCell(Number(m[1]), Number(m[2]));

  // ISO date, optionally with a time ("2026-01-15 00:00:00", "...T09:30:00.000Z").
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?z?)?$/.exec(s);
  if (m) return isoDateCell(m);

  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return dateCell(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) return monthCell(Number(m[2]), Number(m[1]));

  m = /^(\d{4})-(?:kw|w)(\d{1,2})$/.exec(s);
  if (m) return weekCell(Number(m[1]), Number(m[2]));

  m = /^(?:kw|w)\s*(\d{1,2})[\s/-]+(\d{4})$/.exec(s);
  if (m) return weekCell(Number(m[2]), Number(m[1]));

  m = /^([a-zäöü]+)\.?[\s-]*(\d{4}|\d{2})$/.exec(s);
  // "KW03" matches this shape too; it is a year-less week, read below.
  const month = m === null ? undefined : MONTHS[m[1]];
  if (m && month !== undefined) {
    return monthCell(m[2].length === 2 ? TWO_DIGIT_YEAR_BASE + Number(m[2]) : Number(m[2]), month);
  }

  if (/^\d{5}(\.\d+)?$/.test(s)) return serialCell(s);
  return yearlessCell(s);
}

/** A classified cell as a canonical key, in its own year or else `year`. */
export function resolvePeriod(cell: PeriodCell, year: number | undefined): string | null {
  const y = cell.year ?? usableYear(year);
  if (y === undefined) return null;
  return cell.kind === "month" ? monthKey(y, cell.index) : weekKey(y, cell.index);
}

/**
 * A period header as a canonical key: month "YYYY-MM" or week "YYYY-Www".
 * Case-insensitive, trimmed; null for anything unrecognised. With
 * `defaultYear`, a month name or week with no year of its own ("Jan", "KW03")
 * is read in that year; without it, such a label is null. A date is its
 * month. ONE cell on its own — a header row is read by `assignRunPeriods`.
 */
export function parsePeriodLabel(cell: string, defaultYear?: number): string | null {
  const c = classifyPeriodCell(cell);
  return c === null ? null : resolvePeriod(c, defaultYear);
}

/** A year column's header: "Jahr", "Year", "FY", "GJ", "Geschäftsjahr" …. */
export function isYearHeader(cell: string): boolean {
  return /^(jahr|year|yr|gj|fy|geschäftsjahr|fiscal year)$/i.test(cell.trim());
}

/** A year column: headed as one, or holding only four-digit years. */
export function isYearColumn(header: string, cells: readonly string[]): boolean {
  const filled = cells.filter((c) => c.trim() !== "");
  return isYearHeader(header) || (filled.length > 0 && filled.every((c) => parseYearCell(c) !== undefined));
}

/** A cell holding a plausible year (2000–2100, four digits), else undefined:
 *  a long sheet's year column ("Jahr", "FY"). */
export function parseYearCell(cell: string): number | undefined {
  const s = cell.trim();
  if (!/^\d{4}$/.test(s)) return undefined;
  const year = Number(s);
  return year >= MIN_YEAR_CELL && year <= MAX_YEAR_CELL ? year : undefined;
}

/**
 * ONE cell of a long sheet (a period column, never a run): a period that names
 * its year keeps it; a year-less one takes the row's `rowYear` cell when that
 * holds a year (`parseYearCell`), else `defaultYear` — and only then is it
 * `assumed`. With `weeks` (its column is weekly: `isWeekSpacedColumn`), a date
 * is its ISO week.
 */
export function assignCellPeriod(
  cell: string,
  opts: { rowYear?: string; defaultYear?: number; weeks?: boolean } = {},
): AssignedPeriod | null {
  const c = classifyPeriodCell(cell);
  if (c === null) return null;
  if (opts.weeks === true && c.kind === "month" && c.date !== undefined) {
    return { period: periodKeyForDate(c.date, "week"), assumed: false };
  }
  const rowYear = c.year === undefined && opts.rowYear !== undefined ? parseYearCell(opts.rowYear) : undefined;
  const period = resolvePeriod(c, rowYear ?? opts.defaultYear);
  return period === null ? null : { period, assumed: c.year === undefined && rowYear === undefined };
}

/** A run's cells are dates a whole number of weeks apart, the closest exactly
 *  one week: a weekly forecast headed by Monday dates. Excel serials count as
 *  dates only in a workbook (`numbers` "dot"). */
function isWeekSpacedDates(cells: ReadonlyArray<PeriodCell | null>, numbers: NumberOrigin): boolean {
  const days = dateDays(cells, numbers);
  return days !== null && isWeekSpacing(days);
}

/** The day numbers of the period cells, in order, when every one is a date
 *  (an Excel serial only in a workbook); null when any is not. */
function dateDays(cells: ReadonlyArray<PeriodCell | null>, numbers: NumberOrigin): number[] | null {
  const days: number[] = [];
  for (const c of cells) {
    if (c === null) continue;
    const isDate = c.kind === "month" && c.date !== undefined && (numbers === "dot" || c.serial !== true);
    if (!isDate) return null;
    days.push(Date.parse(`${c.date}T00:00:00Z`) / MS_PER_DAY);
  }
  return days;
}

/** Consecutive gaps all positive whole weeks, the smallest exactly one week. */
function isWeekSpacing(days: readonly number[]): boolean {
  if (days.length < 2) return false;
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  return gaps.every((g) => g > 0 && g % DAYS_PER_WEEK === 0) && Math.min(...gaps) === DAYS_PER_WEEK;
}

/**
 * A LONG sheet's period column is weekly: its period cells are all dates, and
 * their DISTINCT values, sorted, are a whole number of weeks apart with the
 * closest exactly seven days — the wide run's rule (`isWeekSpacing`) applied
 * to a column, whose rows repeat and need not be in order. Non-period cells
 * (the header, blanks) are ignored. First-of-month dates stay months.
 */
export function isWeekSpacedColumn(cells: readonly string[], numbers: NumberOrigin = "text"): boolean {
  const days = dateDays(cells.map(classifyPeriodCell), numbers);
  return days !== null && isWeekSpacing([...new Set(days)].sort((a, b) => a - b));
}

/**
 * A WIDE header row's period cells, read left to right as a RUN (§500):
 * - A cell that names its year (`Dez 2026`, `KW50 2026`, `2026-12`, a date of
 *   a date run) sets the running year. A year-less month or week takes the
 *   running year, which starts at `defaultYear`, and moves it on by one at the
 *   turn of a year — a step BACK of at least half a year (6 months, 26 weeks)
 *   against the previous period cell, months and weeks compared by their place
 *   in the year: `Dez 2026 | Jan` is January 2027, a year-less `Jul … Jun` runs
 *   into the next year, `KW52 | KW01` too, while `Dez | Nov | Okt` stays in one
 *   year. Week 53 is checked against the year the week lands in.
 * - Year-less cells BEFORE the first labelled one count BACK from it by the
 *   same rule, never from `defaultYear`: `Nov | Dez | Jan 2027` is Nov and Dez
 *   2026, `KW52 | Jan 2027` is 2026-W52. Only a run with no labelled cell at
 *   all reads in `defaultYear`.
 * - A header's ONE date or serial cell is no period (`withoutLoneDate`).
 * - A run of dates a whole number of weeks apart, the closest exactly seven
 *   days, reads each date as its ISO week; any other dates read as their month.
 * Non-period cells are null and do not break the run. A LONG sheet's rows are
 * never read this way: they repeat Jan…Dec per person.
 */
export function assignRunDetailed(
  cells: readonly string[],
  opts: { defaultYear?: number; numbers?: NumberOrigin } = {},
): Array<AssignedPeriod | null> {
  const classes = withoutLoneDate(cells.map(classifyPeriodCell));
  if (isWeekSpacedDates(classes, opts.numbers ?? "text")) {
    return classes.map((c) =>
      c?.kind === "month" && c.date !== undefined ? { period: periodKeyForDate(c.date, "week"), assumed: false } : null);
  }
  const out = readForwards(classes, usableYear(opts.defaultYear));
  const first = classes.findIndex((c) => c?.year !== undefined);
  if (first > 0) countBack(classes, out, first);
  return out;
}

/** A header's ONE date (or serial) cell is no period: it neither joins nor
 *  anchors a year-less run — a `31.12.2025` or a project number `40100` once
 *  moved a whole `Jan | Feb | Mär` into 2025 or 2009. Two or more dates are a
 *  date run and read as such. */
function withoutLoneDate(classes: Array<PeriodCell | null>): Array<PeriodCell | null> {
  const isDate = (c: PeriodCell | null): boolean => c?.kind === "month" && c.date !== undefined;
  return classes.filter(isDate).length === 1 ? classes.map((c) => (isDate(c) ? null : c)) : classes;
}

/** A period's place in its year, 0 (January, week 1) to 1, so months and weeks
 *  compare with each other. */
function positionInYear(c: PeriodCell): number {
  return c.kind === "month" ? (c.index - 1) / MONTHS_PER_YEAR : (c.index - 1) / WEEKS_PER_YEAR;
}

/** A step back of at least half a year (6 months, 26 weeks) is the turn of a
 *  year; a smaller one is a sheet listed backwards (`Dez | Nov | Okt`). */
const isTurnOfYear = (from: PeriodCell, to: PeriodCell): boolean => positionInYear(from) - positionInYear(to) >= HALF_YEAR - POSITION_EPSILON;

/** The cells before the run's first labelled cell, read backwards from it: a
 *  cell at least half a year LATER in the year than the cell to its right lies
 *  in the year before (`Dez | Jan 2027` → Dez 2026, `KW52 | Jan 2027` → 2026-W52).
 *  Overwrites `out`. */
function countBack(classes: ReadonlyArray<PeriodCell | null>, out: Array<AssignedPeriod | null>, first: number): void {
  const label = classes[first];
  if (label?.year === undefined) return;
  let year = label.year;
  let next: PeriodCell = label;
  for (let i = first - 1; i >= 0; i--) {
    const c = classes[i];
    if (c === null) continue;
    if (isTurnOfYear(c, next)) year -= 1;
    next = c;
    const period = resolvePeriod(c, year);
    out[i] = period === null ? null : { period, assumed: false };
  }
}

/** The run read left to right: a labelled cell sets the running year, a
 *  year-less one takes it and rolls it on at the turn of a year (a step back
 *  of half a year or more: `isTurnOfYear`). */
function readForwards(classes: ReadonlyArray<PeriodCell | null>, defaultYear: number | undefined): Array<AssignedPeriod | null> {
  let year = defaultYear;
  let assumed = year !== undefined;
  let previous: PeriodCell | undefined;
  return classes.map((c) => {
    if (c === null) return null;
    if (c.year !== undefined) {
      year = c.year;
      assumed = false;
    } else if (year === undefined) {
      return null;
    } else if (previous !== undefined && isTurnOfYear(previous, c)) {
      year += 1;
    }
    previous = c;
    const period = resolvePeriod(c, year);
    return period === null ? null : { period, assumed: c.year === undefined && assumed };
  });
}

/** The default year the given periods assumed, if any did: `rolled` when one
 *  of them landed past it (a run that moved on into the next year). */
export function assumedYearOf(
  periods: ReadonlyArray<AssignedPeriod>,
  defaultYear: number | undefined,
): { year: number; rolled: boolean } | undefined {
  const year = usableYear(defaultYear);
  const assumed = periods.filter((p) => p.assumed);
  if (year === undefined || assumed.length === 0) return undefined;
  return { year, rolled: assumed.some((p) => Number(p.period.slice(0, 4)) !== year) };
}

/** `assignRunDetailed`'s periods alone. */
export function assignRunPeriods(
  cells: readonly string[],
  opts: { defaultYear?: number; numbers?: NumberOrigin } = {},
): Array<string | null> {
  return assignRunDetailed(cells, opts).map((p) => p?.period ?? null);
}
