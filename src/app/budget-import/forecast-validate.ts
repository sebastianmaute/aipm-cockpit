// src/app/budget-import/forecast-validate.ts — the gate every forecast row
// passes (§500), whichever route produced it. On the Claude-read route this is
// the safety boundary against invented values: a row only gets through when
// its shape is right, its numbers are plausible and, when a source is
// required, the cell it cites really holds that number. Pure: no i18n, no
// React, no DOM.

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

export type DuplicateRow = { person: string; period: string; count: number };

type Rejection = RejectedRow["reason"];
type Checked = { ok: true; row: ForecastRow } | { ok: false; reason: Rejection };

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
 *  the quotes is doubled), or null when the sheet is not `sheetName`. The name
 *  is compared literally, never built into a pattern: names may hold `(`, `+`. */
function cellPartOf(source: string, sheetName: string): string | null {
  const bare = `${sheetName}!`;
  if (source.startsWith(bare)) return source.slice(bare.length);
  const quoted = `'${sheetName.replace(/'/g, "''")}'!`;
  if (source.startsWith(quoted)) return source.slice(quoted.length);
  return null;
}

function sourceMatchesHours(source: unknown, hours: number, sheet: SheetGrid): boolean {
  if (typeof source !== "string") return false;
  const cellPart = cellPartOf(source, sheet.name);
  const match = cellPart === null ? null : CELL_REF.exec(cellPart);
  if (match === null) return false;
  const cell = sheet.rows[Number(match[2]) - 1]?.[columnIndex(match[1])];
  if (cell === undefined) return false;
  return (["dot", "comma"] as const).some((style) => {
    const value = parseNumberCell(cell, style);
    return value !== null && Math.abs(value - hours) <= SOURCE_HOURS_TOLERANCE;
  });
}

function isValidHours(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_IMPORT_HOURS_PER_CELL;
}

function checkRow(raw: unknown, opts: { sheet: SheetGrid; requireSource: boolean }): Checked {
  if (!isRecord(raw)) return { ok: false, reason: "shape" };
  const { person, period, hours, rate, email, source } = raw;
  if (typeof person !== "string" || person.trim() === "") return { ok: false, reason: "person" };
  const canonicalPeriod = typeof period === "string" ? parsePeriodLabel(period) : null;
  if (canonicalPeriod === null) return { ok: false, reason: "period" };
  if (!isValidHours(hours)) return { ok: false, reason: "hours" };
  const isRateBad = rate !== undefined && !(typeof rate === "number" && Number.isFinite(rate) && rate >= 0);
  if (isRateBad || (email !== undefined && typeof email !== "string")) return { ok: false, reason: "shape" };
  if (opts.requireSource && !sourceMatchesHours(source, hours, opts.sheet)) return { ok: false, reason: "source" };

  const row: ForecastRow = { person: person.trim(), period: canonicalPeriod, hours };
  if (typeof email === "string") row.email = email;
  if (typeof rate === "number") row.rate = rate;
  if (typeof source === "string") row.source = source;
  return { ok: true, row };
}

/** Two decimals, so summing 0.1 + 0.2 reads 0.3 rather than 0.30000000000000004. */
function round2(value: number): number {
  return Math.round(value * HOURS_DECIMALS_FACTOR) / HOURS_DECIMALS_FACTOR;
}

/**
 * Checks forecast rows from either import route. Each row is judged on its own
 * first (hours within 0..744, canonical period, non-blank person, and — on the
 * Claude route — a `source` that cites a cell holding that number); only then
 * are rows for the same person (case-insensitive, trimmed) and period summed,
 * so a sum may exceed 744. The summed row keeps the first row's person,
 * email, rate and source, and the sum is listed in `duplicates`.
 */
export function validateForecastRows(
  input: unknown,
  opts: { sheet: SheetGrid; requireSource: boolean },
): { ok: ForecastRow[]; rejected: RejectedRow[]; duplicates: DuplicateRow[] } {
  if (!Array.isArray(input)) return { ok: [], rejected: [{ row: input, reason: "shape" }], duplicates: [] };

  const rejected: RejectedRow[] = [];
  const merged = new Map<string, { row: ForecastRow; count: number }>();
  for (const raw of input as unknown[]) {
    const checked = checkRow(raw, opts);
    if (!checked.ok) {
      rejected.push({ row: raw, reason: checked.reason });
      continue;
    }
    const key = `${checked.row.person.toLowerCase()}\u0000${checked.row.period}`;
    const seen = merged.get(key);
    if (seen === undefined) merged.set(key, { row: checked.row, count: 1 });
    else merged.set(key, { row: { ...seen.row, hours: round2(seen.row.hours + checked.row.hours) }, count: seen.count + 1 });
  }

  const entries = [...merged.values()];
  return {
    ok: entries.map((e) => e.row),
    rejected,
    duplicates: entries
      .filter((e) => e.count > 1)
      .map((e) => ({ person: e.row.person, period: e.row.period, count: e.count })),
  };
}
