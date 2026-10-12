// src/app/budget-import/forecast-validate.ts — the gate every forecast row
// passes (§500), whichever route produced it. On the Claude-read route this is
// the safety boundary against invented values: a row only gets through when
// its shape is right, its numbers are plausible and, when a source is
// required, the cell it cites really holds that number, on the row of that
// person and under (or beside) that period. Pure: no i18n, no React, no DOM.

import { parseNumberCell, parsePeriodLabel } from "./forecast-rows";
import type { ForecastRow } from "./forecast-types";
import type { SheetGrid } from "./sheet-grid";

/** Hours in the longest month (31 * 24): no single cell can hold more. */
export const MAX_IMPORT_HOURS_PER_CELL = 744;

/** How far a cited cell may sit from the stated hours (rounding in the file). */
const SOURCE_HOURS_TOLERANCE = 0.005;
const LETTERS_IN_ALPHABET = 26;
const CHAR_CODE_A = 65;
const HOURS_DECIMALS_FACTOR = 100;

export type RejectedRow = {
  row: ForecastRow | unknown;
  reason: "shape" | "hours" | "period" | "person" | "source";
};

/** A person and period that several input rows contributed to. `sources` lists
 *  the contributing rows' own `source` references in input order (rows without
 *  one add nothing). */
export type DuplicateRow = { person: string; period: string; count: number; sources: string[] };

type Rejection = RejectedRow["reason"];
type Checked = { ok: true; row: ForecastRow } | { ok: false; reason: Rejection };
type Options = { sheet: SheetGrid; requireSource: boolean };
type Merged = { row: ForecastRow; count: number; sources: string[] };

const CELL_REF = /^([A-Z]{1,3})([1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
function sourceKey(source: string, sheetName: string): string {
  const cellPart = cellPartOf(source, sheetName);
  return cellPart === null ? source : `${sheetName}!${cellPart.toUpperCase()}`;
}

function cellMatchesHours(cell: string, hours: number): boolean {
  return (["dot", "comma"] as const).some((style) => {
    const value = parseNumberCell(cell, style);
    return value !== null && Math.abs(value - hours) <= SOURCE_HOURS_TOLERANCE;
  });
}

function isPersonOnRow(rowCells: readonly string[], citedCol: number, row: ForecastRow): boolean {
  const wanted = [row.person, row.email].filter((v): v is string => v !== undefined && v.trim() !== "");
  const names = wanted.map((v) => v.trim().toLowerCase());
  return rowCells.some((cell, col) => col !== citedCol && names.includes(cell.trim().toLowerCase()));
}

/** The period sits in the cited cell's row (long layout) or in its column above
 *  it (wide layout header). */
function isPeriodNearCell(sheet: SheetGrid, rowIdx: number, colIdx: number, period: string): boolean {
  const isInRow = sheet.rows[rowIdx].some((cell, col) => col !== colIdx && parsePeriodLabel(cell) === period);
  if (isInRow) return true;
  return sheet.rows.slice(0, rowIdx).some((above) => {
    const cell = above[colIdx];
    return cell !== undefined && parsePeriodLabel(cell) === period;
  });
}

/** True when `row.source` names a cell of `sheet` that holds the row's hours,
 *  on a row that names the person, under or beside the row's period. */
function isSourceGenuine(row: ForecastRow, sheet: SheetGrid): boolean {
  if (row.source === undefined) return false;
  const cellPart = cellPartOf(row.source, sheet.name);
  const match = cellPart === null ? null : CELL_REF.exec(cellPart);
  if (match === null) return false;
  const rowIdx = Number(match[2]) - 1;
  const colIdx = columnIndex(match[1]);
  const cell = sheet.rows[rowIdx]?.[colIdx];
  if (cell === undefined || !cellMatchesHours(cell, row.hours)) return false;
  return isPersonOnRow(sheet.rows[rowIdx], colIdx, row) && isPeriodNearCell(sheet, rowIdx, colIdx, row.period);
}

function isValidHours(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_IMPORT_HOURS_PER_CELL;
}

/** Two decimals, with -0 read as 0 (`+ 0` turns -0 into 0). */
function round2(value: number): number {
  return Math.round(value * HOURS_DECIMALS_FACTOR) / HOURS_DECIMALS_FACTOR + 0;
}

function checkRow(raw: unknown, opts: Options): Checked {
  if (!isRecord(raw)) return { ok: false, reason: "shape" };
  const { person, period, hours, rate, email, source } = raw;
  if (typeof person !== "string" || person.trim() === "") return { ok: false, reason: "person" };
  const canonicalPeriod = typeof period === "string" ? parsePeriodLabel(period) : null;
  if (canonicalPeriod === null) return { ok: false, reason: "period" };
  if (!isValidHours(hours)) return { ok: false, reason: "hours" };
  const isRateBad = rate !== undefined && !(typeof rate === "number" && Number.isFinite(rate) && rate >= 0);
  if (isRateBad || (email !== undefined && typeof email !== "string")) return { ok: false, reason: "shape" };

  const row: ForecastRow = { person: person.trim(), period: canonicalPeriod, hours: round2(hours) };
  if (typeof email === "string") row.email = email;
  if (typeof rate === "number") row.rate = rate;
  if (typeof source === "string") row.source = source;
  if (opts.requireSource && !isSourceGenuine({ ...row, hours }, opts.sheet)) return { ok: false, reason: "source" };
  return { ok: true, row };
}

/** A summed row: the first row's person, email and rate, but NO `source` — the
 *  cited cells each hold only part of the sum. */
function withoutSource(row: ForecastRow): ForecastRow {
  const summed: ForecastRow = { person: row.person, period: row.period, hours: row.hours };
  if (row.email !== undefined) summed.email = row.email;
  if (row.rate !== undefined) summed.rate = row.rate;
  return summed;
}

/**
 * Checks forecast rows from either import route. Each row is judged on its own
 * first (hours within 0..744 and rounded to two decimals, canonical period,
 * non-blank person and — on the Claude route — a `source` that cites a cell
 * holding that number on the person's row under or beside the period). A source
 * cell backs ONE row: a later row citing it again is rejected `source`, since
 * two rows cannot both be what one cell holds. Only then are rows for the same
 * person (case-insensitive, trimmed) and period summed, so a sum may exceed
 * 744; the summed row carries no `source`, and `duplicates` lists the sources
 * that contributed.
 */
export function validateForecastRows(
  input: unknown,
  opts: Options,
): { ok: ForecastRow[]; rejected: RejectedRow[]; duplicates: DuplicateRow[] } {
  if (!Array.isArray(input)) return { ok: [], rejected: [{ row: input, reason: "shape" }], duplicates: [] };

  const rejected: RejectedRow[] = [];
  const usedSources = new Set<string>();
  const merged = new Map<string, Merged>();
  for (const raw of input as unknown[]) {
    const checked = checkRow(raw, opts);
    const key = checked.ok && checked.row.source !== undefined ? sourceKey(checked.row.source, opts.sheet.name) : null;
    if (!checked.ok || (key !== null && usedSources.has(key))) {
      rejected.push({ row: raw, reason: checked.ok ? "source" : checked.reason });
      continue;
    }
    if (key !== null) usedSources.add(key);
    const { row } = checked;
    const rowSources = row.source === undefined ? [] : [row.source];
    const mergeKey = `${row.person.toLowerCase()}\u0000${row.period}`;
    const seen = merged.get(mergeKey);
    merged.set(
      mergeKey,
      seen === undefined
        ? { row, count: 1, sources: rowSources }
        : {
            row: { ...seen.row, hours: round2(seen.row.hours + row.hours) },
            count: seen.count + 1,
            sources: [...seen.sources, ...rowSources],
          },
    );
  }

  const entries = [...merged.values()];
  return {
    ok: entries.map((e) => (e.count > 1 ? withoutSource(e.row) : e.row)),
    rejected,
    duplicates: entries
      .filter((e) => e.count > 1)
      .map((e) => ({ person: e.row.person, period: e.row.period, count: e.count, sources: e.sources })),
  };
}
