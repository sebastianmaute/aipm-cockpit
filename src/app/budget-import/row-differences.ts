// src/app/budget-import/row-differences.ts — one person on several rows that
// differ in another TEXT column (§500, round 9 I-W). Pure: no i18n, no React.

import { cellAt, isBlank, isNumberCell, isTotalLabel, readingEnd } from "./forecast-rows";
import type { ColumnAmbiguity, ColumnMapping } from "./forecast-types";
import { isPeriodShapedIn, parsePeriodLabel } from "./period-assign";
import type { NumberOrigin } from "./sheet-grid";

/** The distinct values the notice quotes, and how long each may be. */
const MAX_SAMPLES = 3;
const MAX_SAMPLE_CHARS = 40;

type RowsAmbiguity = Extract<ColumnAmbiguity, { field: "rows" }>;

/** A cell that is TEXT: not blank, not a number, not a period. */
function isTextCell(cell: string, numbers: NumberOrigin): boolean {
  return !isBlank(cell) && !isNumberCell(cell, numbers) && !isPeriodShapedIn(cell, numbers);
}

const clip = (text: string): string => (text.length > MAX_SAMPLE_CHARS ? `${text.slice(0, MAX_SAMPLE_CHARS - 1)}…` : text);

/** The columns the mapping reads: they never tell two rows apart. */
function mappedColumns(mapping: ColumnMapping): Set<number> {
  const cols = [mapping.person, mapping.email, mapping.rate, mapping.yearCol, mapping.period, mapping.hours, ...(mapping.periodCols ?? [])];
  return new Set(cols.filter((c): c is number => c !== undefined));
}

/** The data rows the hand route reads, grouped by person (and, long, by period). */
function rowsByPerson(rows: readonly string[][], mapping: ColumnMapping, numbers: NumberOrigin): Map<string, (readonly string[])[]> {
  const valueCols = mapping.layout === "wide" ? (mapping.periodCols ?? []) : [mapping.hours];
  const groups = new Map<string, (readonly string[])[]>();
  const end = readingEnd(rows, mapping, numbers);
  for (let index = mapping.headerRow + 1; index < end; index++) {
    const row = rows[index] ?? [];
    const person = cellAt(row, mapping.person).trim();
    if (person === "" || isTotalLabel(person) || !valueCols.some((col) => isNumberCell(cellAt(row, col), numbers))) continue;
    const periodText = mapping.layout === "long" ? cellAt(row, mapping.period).trim() : "";
    const period = mapping.layout === "long" ? (parsePeriodLabel(periodText, mapping.year) ?? periodText) : "";
    const key = `${person.toLowerCase()}\u0000${period}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

/**
 * ★★ Two or more rows of ONE person (and, long, one period) that differ in a
 * TEXT column the mapping does not read (`Art`: Plan and Ist; a task
 * description) are a question, not a sum: `Name | Art | Jan 2026` with a Plan
 * and an Ist row once imported 50 + 43 = 93 on both routes, unasked (rr12
 * I-W). `candidates` are those columns, `samples` the first such group's
 * distinct values. Rows that repeat (no such column) stay the preview's
 * "Combined rows". The cost: a sheet with a task line per row asks too.
 */
export function differingRows(rows: readonly string[][], mapping: ColumnMapping, numbers: NumberOrigin = "text"): RowsAmbiguity | null {
  const mapped = mappedColumns(mapping);
  const candidates = new Set<number>();
  let samples: string[] = [];
  for (const group of rowsByPerson(rows, mapping, numbers).values()) {
    if (group.length < 2) continue;
    const width = group.reduce((max, row) => Math.max(max, row.length), 0);
    for (let col = 0; col < width; col++) {
      if (mapped.has(col)) continue;
      const values = group.map((row) => cellAt(row, col).trim());
      if (new Set(values).size < 2 || !values.some((v) => isTextCell(v, numbers))) continue;
      candidates.add(col);
      if (samples.length === 0) samples = [...new Set(values.filter((v) => v !== ""))].slice(0, MAX_SAMPLES).map(clip);
    }
  }
  return candidates.size === 0 ? null : { field: "rows", candidates: [...candidates].sort((a, b) => a - b), samples };
}
