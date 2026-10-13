// src/app/budget-import/forecast-validate.ts — the gate every forecast row
// passes (§500), whichever route produced it. On the Claude-read route this is
// the safety boundary against invented values: a row only gets through when
// its shape is right, its numbers are plausible and, when a source is
// required, the cell it cites really holds that number, on the row of that
// person and under (or beside) that period (`source-evidence.ts`). Pure: no
// i18n, no React, no DOM.

import type { AssumedYear, ColumnMapping, ForecastCollision, ForecastRow } from "./forecast-types";
import { assumedYearOf, classifyPeriodCell, resolvePeriod, type AssignedPeriod } from "./period-assign";
import { handPeriodAt, handReadingOf, type HandReading, type HandSource } from "./hand-reading";
import type { SheetGrid } from "./sheet-grid";
import { checkSource, citedCell, columnNaming, headerDateOf, sourceKey, sourcePosition, type PeriodConflict, type SourceRejection } from "./source-evidence";

/** Hours in the longest month (31 * 24): no single cell can hold more. */
export const MAX_IMPORT_HOURS_PER_CELL = 744;

const HOURS_DECIMALS_FACTOR = 100;

export type { PeriodConflict, SourceRejection };

/** A row left out, and why. A `period-conflict` carries its two `periods`. */
export type RejectedRow =
  | { row: ForecastRow | unknown; reason: "shape" | "hours" | "period" | "person" }
  | { row: ForecastRow | unknown; reason: "source"; detail: SourceRejection; periods?: PeriodConflict };

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
  /** Set when an accepted row's period took its year from `defaultYear`. */
  assumedYear?: AssumedYear;
};

type Checked =
  | { ok: true; row: ForecastRow; assumed: boolean }
  | { ok: false; reason: "shape" | "hours" | "period" | "person" }
  | { ok: false; reason: "source"; detail: SourceRejection; periods?: PeriodConflict };
/** `defaultYear`: the year a period label without one ("Jan", "KW03") is read
 *  in — the row's own `period` and the sheet cells that back it alike.
 *  `columns` (the Claude route only, fix 8): the hand route's mapping the user
 *  edited or confirmed, which the hand reading H is then read with;
 *  `"unconfirmed"` while the sheet's ambiguous columns wait for the user, which
 *  refuses every claim `columns-unconfirmed`; absent, the sheet's own detection
 *  decides (`handReadingOf`: ambiguous is unconfirmed, unknown has no H). */
type Options = { sheet: SheetGrid; requireSource: boolean; defaultYear?: number; columns?: ColumnMapping | "unconfirmed" };
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

function checkRow(raw: unknown, opts: Options, hand: HandSource): Checked {
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
  if (!opts.requireSource) return { ok: true, row, assumed: claim.year === undefined };
  // Ambiguous columns the user has not confirmed: no cell of the sheet is read (fix 8).
  if (hand === "unconfirmed") return { ok: false, reason: "source", detail: "columns-unconfirmed" };
  const evidence = checkSource({ person: row.person, hours, source: row.source }, claim, opts.sheet, opts.defaultYear, hand);
  if ("problem" in evidence) {
    return evidence.periods === undefined
      ? { ok: false, reason: "source", detail: evidence.problem }
      : { ok: false, reason: "source", detail: evidence.problem, periods: evidence.periods };
  }
  const sourced: ForecastRow = { ...row, period: evidence.period.period };
  // An email the cited row does not show is the model's, not the sheet's, and
  // matching by email first would route the hours to whoever owns it.
  const isEmailBacked = sourced.email === undefined || isEmailOnCitedRow(sourced, opts.sheet);
  return { ok: true, row: isEmailBacked ? sourced : withoutEmail(sourced), assumed: evidence.period.assumed };
}

/** How a person × period group sits in the sheet. Cells of ONE row that share
 *  the period are a `collision` (never summed) unless every one sits under a
 *  DISTINCT date header — date columns finer than the period (`subPeriod`),
 *  summed as before the collision rule. `rows`: the distinct sheet rows (a
 *  row without a usable source counts as one of its own). A cell on a row the
 *  hand route reads as a LONG row has no date header: its period is the row's
 *  (`hand`), so two such cells collide; so do two cells whose row holds a
 *  period cell of its own (`headerDateOf`). */
function rowShape(e: Merged, sheet: SheetGrid, hand: HandReading | null): { collision: boolean; subPeriod: boolean; rows: number } {
  const byRow = new Map<number, Array<string | null>>();
  let unplaced = e.count - e.sources.length;
  for (const source of e.sources) {
    const at = sourcePosition(source, sheet.name);
    if (at === null) {
      unplaced += 1;
      continue;
    }
    const personCol = columnNaming(sheet.rows[at.rowIdx] ?? [], at.colIdx, e.row.person) ?? undefined;
    const onLongRow = hand?.layout === "long" && handPeriodAt(hand, at.rowIdx, at.colIdx) !== undefined;
    const date = onLongRow ? null : headerDateOf(sheet, { ...at, personCol });
    byRow.set(at.rowIdx, [...(byRow.get(at.rowIdx) ?? []), date]);
  }
  const shared = [...byRow.values()].filter((dates) => dates.length > 1);
  const isSubPeriods = (dates: Array<string | null>): boolean =>
    dates.every((d) => d !== null) && new Set(dates).size === dates.length;
  const collision = shared.some((dates) => !isSubPeriods(dates));
  return { collision, subPeriod: !collision && shared.length > 0, rows: byRow.size + unplaced };
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
 * holding that number on the person's row, in a period EVERY source for the
 * cell agrees on — the hand reading, the nearest period header above, the
 * row's own period cells (`checkSource`, fix 8); a sheet whose columns are
 * ambiguous and not confirmed (`columns`) refuses every claim; the
 * PERSON must be on that row, an email the row does not hold is dropped, and
 * the accepted period is the one the SHEET reads there). A rejected `source`
 * names its cause in `detail`. `assumedYear` is set when an accepted row's
 * period took its year from `defaultYear`. A source
 * cell backs ONE row: a later row citing it again is rejected `source`, since
 * two rows cannot both be what one cell holds. Only then are rows for the same
 * person (case-insensitive, trimmed) and period summed, so a sum may exceed
 * 744; the summed row carries no `source`, and `duplicates` lists the sources
 * that contributed. ★★ Rows whose sources share ONE sheet row are never summed:
 * they are `collisions`, left out of `ok`, and block the import — summing them
 * once put a weekly sheet's five Monday columns into one month (final review).
 */
export function validateForecastRows(input: unknown, opts: Options): ValidationResult {
  if (!Array.isArray(input)) {
    return { ok: [], rejected: [{ row: input, reason: "shape" }], duplicates: [], collisions: [], subPeriods: [] };
  }

  // The Claude route only: the hand route's reading of the sheet, once.
  const hand: HandSource = !opts.requireSource ? null
    : opts.columns === "unconfirmed" ? "unconfirmed"
    : handReadingOf(opts.sheet, opts.defaultYear, opts.columns);
  const rejected: RejectedRow[] = [];
  const usedSources = new Set<string>();
  const merged = new Map<string, Merged>();
  const read: AssignedPeriod[] = [];
  for (const raw of input as unknown[]) {
    const checked = checkRow(raw, opts, hand);
    const key = checked.ok && checked.row.source !== undefined ? sourceKey(checked.row.source, opts.sheet.name) : null;
    if (!checked.ok) {
      rejected.push(rejectionOf(raw, checked));
      continue;
    }
    if (key !== null && usedSources.has(key)) {
      rejected.push({ row: raw, reason: "source", detail: "cell-reused" });
      continue;
    }
    if (key !== null) usedSources.add(key);
    mergeRow(merged, checked.row);
    read.push({ period: checked.row.period, assumed: checked.assumed });
  }

  const entries = [...merged.values()];
  const reading = hand === "unconfirmed" ? null : hand;
  const shaped = entries.map((e) => ({ e, shape: e.count > 1 ? rowShape(e, opts.sheet, reading) : null }));
  const kept = shaped.filter(({ shape }) => shape?.collision !== true);
  const asDuplicate = ({ e }: { e: Merged }): DuplicateRow => ({ person: e.row.person, period: e.row.period, count: e.count, sources: e.sources });
  const result: ValidationResult = {
    ok: kept.map(({ e }) => (e.count > 1 ? withoutSource(e.row) : e.row)),
    rejected,
    duplicates: kept.filter(({ shape }) => (shape?.rows ?? 0) > 1).map(asDuplicate),
    collisions: shaped
      .filter(({ shape }) => shape?.collision === true)
      .map(({ e }) => ({ person: e.row.person, period: e.row.period, sources: e.sources })),
    subPeriods: kept.filter(({ shape }) => shape?.subPeriod === true).map(asDuplicate),
  };
  const assumedYear = assumedYearOf(read, opts.defaultYear);
  return assumedYear === undefined ? result : { ...result, assumedYear };
}

/** The rejected-row entry for a row that failed its check. */
function rejectionOf(raw: unknown, checked: Extract<Checked, { ok: false }>): RejectedRow {
  if (checked.reason !== "source") return { row: raw, reason: checked.reason };
  return checked.periods === undefined
    ? { row: raw, reason: "source", detail: checked.detail }
    : { row: raw, reason: "source", detail: checked.detail, periods: checked.periods };
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
