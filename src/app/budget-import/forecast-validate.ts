// src/app/budget-import/forecast-validate.ts — the gate every forecast row
// passes (§500), whichever route produced it. On the Claude-read route this is
// the safety boundary against invented values: a row only gets through when
// its shape is right, its numbers are plausible and, when a source is
// required, the cell it cites really holds that number, on the row of that
// person and under (or beside) that period (`source-evidence.ts`). Pure: no
// i18n, no React, no DOM.

import type { ForecastCollision, ForecastRow } from "./forecast-types";
import { classifyPeriodCell, resolvePeriod } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";
import { checkSource, citedCell, columnNaming, sourceKey, sourcePosition, type SourceRejection } from "./source-evidence";

/** Hours in the longest month (31 * 24): no single cell can hold more. */
export const MAX_IMPORT_HOURS_PER_CELL = 744;

const HOURS_DECIMALS_FACTOR = 100;

export type { SourceRejection };

export type RejectedRow =
  | { row: ForecastRow | unknown; reason: "shape" | "hours" | "period" | "person" }
  | { row: ForecastRow | unknown; reason: "source"; detail: SourceRejection };

/** A person and period that several input rows contributed to. `sources` lists
 *  the contributing rows' own `source` references in input order (rows without
 *  one add nothing). */
export type DuplicateRow = { person: string; period: string; count: number; sources: string[] };

export type ValidationResult = {
  ok: ForecastRow[];
  rejected: RejectedRow[];
  duplicates: DuplicateRow[];
  collisions: ForecastCollision[];
};

type Checked =
  | { ok: true; row: ForecastRow }
  | { ok: false; reason: "shape" | "hours" | "period" | "person" }
  | { ok: false; reason: "source"; detail: SourceRejection };
/** `defaultYear`: the year a period label without one ("Jan", "KW03") is read
 *  in — the row's own `period` and the sheet cells that back it alike. */
type Options = { sheet: SheetGrid; requireSource: boolean; defaultYear?: number };
type Merged = { row: ForecastRow; count: number; sources: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The row without its email; everything else kept. */
function withoutEmail(row: ForecastRow): ForecastRow {
  const out: ForecastRow = { person: row.person, period: row.period, hours: row.hours };
  if (row.rate !== undefined) out.rate = row.rate;
  if (row.source !== undefined) out.source = row.source;
  return out;
}

/** The cited row holds this email in a cell other than the cited one. */
function isEmailOnCitedRow(row: ForecastRow, sheet: SheetGrid): boolean {
  const cited = citedCell(row.source, sheet);
  return cited !== null && row.email !== undefined && columnNaming(sheet.rows[cited.rowIdx], cited.colIdx, row.email) !== null;
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
  // A claim must read as a period on its own (a year-less one only with a
  // default year); on the Claude route the sheet then says which year it is.
  const claim = typeof period === "string" ? classifyPeriodCell(period) : null;
  const canonicalPeriod = claim === null ? null : resolvePeriod(claim, opts.defaultYear);
  if (claim === null || canonicalPeriod === null) return { ok: false, reason: "period" };
  if (!isValidHours(hours)) return { ok: false, reason: "hours" };
  const isRateBad = rate !== undefined && !(typeof rate === "number" && Number.isFinite(rate) && rate >= 0);
  if (isRateBad || (email !== undefined && typeof email !== "string")) return { ok: false, reason: "shape" };

  const row: ForecastRow = { person: person.trim(), period: canonicalPeriod, hours: round2(hours) };
  if (typeof email === "string") row.email = email;
  if (typeof rate === "number") row.rate = rate;
  if (typeof source === "string") row.source = source;
  if (!opts.requireSource) return { ok: true, row };
  const evidence = checkSource({ person: row.person, hours, source: row.source }, claim, opts.sheet, opts.defaultYear);
  if ("problem" in evidence) return { ok: false, reason: "source", detail: evidence.problem };
  const sourced: ForecastRow = { ...row, period: evidence.period.period };
  // An email the cited row does not show is the model's, not the sheet's, and
  // matching by email first would route the hours to whoever owns it.
  const isEmailBacked = sourced.email === undefined || isEmailOnCitedRow(sourced, opts.sheet);
  return { ok: true, row: isEmailBacked ? sourced : withoutEmail(sourced) };
}

/** Two of the sources cite cells of the same sheet row. */
function sharesSheetRow(sources: readonly string[], sheetName: string): boolean {
  const rows = sources.map((s) => sourcePosition(s, sheetName)?.rowIdx).filter((r): r is number => r !== undefined);
  return new Set(rows).size < rows.length;
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
 * holding that number on the person's row under or beside the period; the PERSON
 * must be on that row, and an email the row does not hold is dropped from the
 * accepted row). A rejected `source` names its cause in `detail`. A source
 * cell backs ONE row: a later row citing it again is rejected `source`, since
 * two rows cannot both be what one cell holds. Only then are rows for the same
 * person (case-insensitive, trimmed) and period summed, so a sum may exceed
 * 744; the summed row carries no `source`, and `duplicates` lists the sources
 * that contributed. ★★ Rows whose sources share ONE sheet row are never summed:
 * they are `collisions`, left out of `ok`, and block the import — summing them
 * once put a weekly sheet's five Monday columns into one month (final review).
 */
export function validateForecastRows(input: unknown, opts: Options): ValidationResult {
  if (!Array.isArray(input)) return { ok: [], rejected: [{ row: input, reason: "shape" }], duplicates: [], collisions: [] };

  const rejected: RejectedRow[] = [];
  const usedSources = new Set<string>();
  const merged = new Map<string, Merged>();
  for (const raw of input as unknown[]) {
    const checked = checkRow(raw, opts);
    const key = checked.ok && checked.row.source !== undefined ? sourceKey(checked.row.source, opts.sheet.name) : null;
    if (!checked.ok) {
      rejected.push(checked.reason === "source"
        ? { row: raw, reason: "source", detail: checked.detail }
        : { row: raw, reason: checked.reason });
      continue;
    }
    if (key !== null && usedSources.has(key)) {
      rejected.push({ row: raw, reason: "source", detail: "cell-reused" });
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
  const isCollision = (e: Merged): boolean => e.count > 1 && sharesSheetRow(e.sources, opts.sheet.name);
  const kept = entries.filter((e) => !isCollision(e));
  return {
    ok: kept.map((e) => (e.count > 1 ? withoutSource(e.row) : e.row)),
    rejected,
    duplicates: kept
      .filter((e) => e.count > 1)
      .map((e) => ({ person: e.row.person, period: e.row.period, count: e.count, sources: e.sources })),
    collisions: entries.filter(isCollision).map((e) => ({ person: e.row.person, period: e.row.period, sources: e.sources })),
  };
}
