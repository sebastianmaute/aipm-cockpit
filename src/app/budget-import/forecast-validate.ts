// src/app/budget-import/forecast-validate.ts — the gate every forecast row
// passes (§500). Both routes read the sheet with the hand route's reader
// (`gridToForecastRows`), Claude only proposing the mapping, so a row here
// always comes from a cell of the sheet; this checks its shape and numbers and
// sums one person's rows per period, but never one sheet row's cells. Pure: no
// i18n, no React, no DOM.

import type { ForecastCollision, ForecastRow } from "./forecast-types";
import { classifyPeriodCell, resolvePeriod } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";
import { columnNaming, headerDateOf, sourcePosition } from "./source-cells";

/** Hours in the longest month (31 * 24): no single cell can hold more. */
export const MAX_IMPORT_HOURS_PER_CELL = 744;

const HOURS_DECIMALS_FACTOR = 100;

/** A row left out, and why. */
export type RejectedRow = { row: ForecastRow | unknown; reason: "shape" | "hours" | "period" | "person" };

/** A person and period that several input rows contributed to. `sources` lists
 *  the contributing rows' own `source` references in input order (rows without
 *  one add nothing). */
export type DuplicateRow = { person: string; period: string; count: number; sources: string[] };

export type ValidationResult = {
  ok: ForecastRow[];
  rejected: RejectedRow[];
  duplicates: DuplicateRow[];
  collisions: ForecastCollision[];
  /** Person × period sums of DATE columns of one sheet row finer than the period
   *  (bi-weekly, semi-monthly): summed, and listed so the preview says so. */
  subPeriods: DuplicateRow[];
};

type Checked = { ok: true; row: ForecastRow } | { ok: false; reason: RejectedRow["reason"] };
type Options = { sheet: SheetGrid };
type Merged = { row: ForecastRow; count: number; sources: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidHours(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_IMPORT_HOURS_PER_CELL;
}

/** Two decimals, with -0 read as 0 (`+ 0` turns -0 into 0). */
function round2(value: number): number {
  return Math.round(value * HOURS_DECIMALS_FACTOR) / HOURS_DECIMALS_FACTOR + 0;
}

function checkRow(raw: unknown): Checked {
  if (!isRecord(raw)) return { ok: false, reason: "shape" };
  const { person, period, hours, rate, email, source } = raw;
  if (typeof person !== "string" || person.trim() === "") return { ok: false, reason: "person" };
  const claim = typeof period === "string" ? classifyPeriodCell(period) : null;
  const canonicalPeriod = claim === null ? null : resolvePeriod(claim, undefined);
  if (canonicalPeriod === null) return { ok: false, reason: "period" };
  if (!isValidHours(hours)) return { ok: false, reason: "hours" };
  const isRateBad = rate !== undefined && !(typeof rate === "number" && Number.isFinite(rate) && rate >= 0);
  if (isRateBad || (email !== undefined && typeof email !== "string")) return { ok: false, reason: "shape" };

  const row: ForecastRow = { person: person.trim(), period: canonicalPeriod, hours: round2(hours) };
  if (typeof email === "string") row.email = email;
  if (typeof rate === "number") row.rate = rate;
  if (typeof source === "string") row.source = source;
  return { ok: true, row };
}

/** How a person × period group sits in the sheet. Cells of ONE row that share
 *  the period are a `collision` (never summed) unless every one sits under a
 *  DISTINCT date header — date columns finer than the period (`subPeriod`),
 *  summed as before the collision rule. `rows`: the distinct sheet rows (a
 *  row without a usable source counts as one of its own). Two cells whose row
 *  holds a period cell of its own collide (`headerDateOf`, round 3). */
function rowShape(e: Merged, sheet: SheetGrid): { collision: boolean; subPeriod: boolean; rows: number } {
  const byRow = new Map<number, Array<string | null>>();
  let unplaced = e.count - e.sources.length;
  for (const source of e.sources) {
    const at = sourcePosition(source, sheet.name);
    if (at === null) {
      unplaced += 1;
      continue;
    }
    const personCol = columnNaming(sheet.rows[at.rowIdx] ?? [], at.colIdx, e.row.person) ?? undefined;
    const date = headerDateOf(sheet, { ...at, personCol });
    byRow.set(at.rowIdx, [...(byRow.get(at.rowIdx) ?? []), date]);
  }
  const shared = [...byRow.values()].filter((dates) => dates.length > 1);
  const isSubPeriods = (dates: Array<string | null>): boolean =>
    dates.every((d) => d !== null) && new Set(dates).size === dates.length;
  const collision = shared.some((dates) => !isSubPeriods(dates));
  return { collision, subPeriod: !collision && shared.length > 0, rows: byRow.size + unplaced };
}

/** A summed row: the first row's person, email and rate, but NO `source` — the
 *  cells each hold only part of the sum. */
function withoutSource(row: ForecastRow): ForecastRow {
  const summed: ForecastRow = { person: row.person, period: row.period, hours: row.hours };
  if (row.email !== undefined) summed.email = row.email;
  if (row.rate !== undefined) summed.rate = row.rate;
  return summed;
}

/**
 * Checks the forecast rows a sheet was read into. Each row is judged on its own
 * first: hours within 0..744 and rounded to two decimals, a canonical period
 * (with its year), a non-blank person. Only then are rows for the same person
 * (case-insensitive, trimmed) and period summed, so a sum may exceed 744; the
 * summed row carries no `source`, and `duplicates` lists the sources that
 * contributed. ★★ Rows whose sources share ONE sheet row are never summed:
 * they are `collisions`, left out of `ok`, and block the import — summing them
 * once put a weekly sheet's five Monday columns into one month (final review).
 */
export function validateForecastRows(input: unknown, opts: Options): ValidationResult {
  if (!Array.isArray(input)) {
    return { ok: [], rejected: [{ row: input, reason: "shape" }], duplicates: [], collisions: [], subPeriods: [] };
  }

  const rejected: RejectedRow[] = [];
  const merged = new Map<string, Merged>();
  for (const raw of input as unknown[]) {
    const checked = checkRow(raw);
    if (!checked.ok) {
      rejected.push({ row: raw, reason: checked.reason });
      continue;
    }
    mergeRow(merged, checked.row);
  }

  const entries = [...merged.values()];
  const shaped = entries.map((e) => ({ e, shape: e.count > 1 ? rowShape(e, opts.sheet) : null }));
  const kept = shaped.filter(({ shape }) => shape?.collision !== true);
  const asDuplicate = ({ e }: { e: Merged }): DuplicateRow => ({ person: e.row.person, period: e.row.period, count: e.count, sources: e.sources });
  return {
    ok: kept.map(({ e }) => (e.count > 1 ? withoutSource(e.row) : e.row)),
    rejected,
    duplicates: kept.filter(({ shape }) => (shape?.rows ?? 0) > 1).map(asDuplicate),
    collisions: shaped
      .filter(({ shape }) => shape?.collision === true)
      .map(({ e }) => ({ person: e.row.person, period: e.row.period, sources: e.sources })),
    subPeriods: kept.filter(({ shape }) => shape?.subPeriod === true).map(asDuplicate),
  };
}

/** Adds an accepted row to the person × period sums. */
function mergeRow(merged: Map<string, Merged>, row: ForecastRow): void {
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
