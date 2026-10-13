// src/app/budget-import/unread-cells.ts — what a Claude reply left out (§500).
// Pure: no i18n, no React, no DOM.
//
// A reply that stops at the output budget is refused outright; one that simply
// skips rows (common on long lists) used to look complete. This lists the
// number cells and rows the reply did not cite, as information for the preview
// — the hand route's counterpart is `IgnoredColumn`.

import { columnLetters, isTotalLabel, type DecimalStyle } from "./forecast-rows";
import type { ValidationResult } from "./forecast-validate";
import { isPeriodShapedIn } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";
import { columnFacts, columnNaming, nearestPeriodRowAbove, sheetNumber, sourcePosition } from "./source-evidence";

/** A sheet row no row cites although it holds hours, with the text that names
 *  its person when there is one. `row` is 1-based. */
export type UnreadRow = { row: number; person?: string };

/** `cells`: "<sheet>!<ref>" of uncited number cells on rows the reply DID
 *  read, in sheet order. `rows`: rows the reply did not cite at all. */
export type UnreadCells = { cells: string[]; rows: UnreadRow[] };

type Position = { rowIdx: number; colIdx: number };

const sourceOf = (raw: unknown): string | undefined => {
  const source = typeof raw === "object" && raw !== null ? (raw as { source?: unknown }).source : undefined;
  return typeof source === "string" ? source : undefined;
};

type Citation = { source: string; person: string };

/** Every source the reply cited, accepted or rejected, and the accepted ones
 *  with the person each was accepted for. */
function citations(result: ValidationResult): { all: string[]; accepted: Citation[] } {
  const each = (person: string, sources: readonly string[]): Citation[] => sources.map((source) => ({ source, person }));
  const accepted = [
    ...result.ok.flatMap((r) => (r.source === undefined ? [] : each(r.person, [r.source]))),
    ...result.duplicates.flatMap((d) => each(d.person, d.sources)),
    ...result.subPeriods.flatMap((d) => each(d.person, d.sources)),
    ...result.collisions.flatMap((c) => each(c.person, c.sources)),
  ];
  const rejected = result.rejected.flatMap((r) => {
    const source = sourceOf(r.row);
    return source === undefined ? [] : [source];
  });
  return { all: [...accepted.map((c) => c.source), ...rejected], accepted };
}

/** The column the accepted rows name their people in — the most common one
 *  (`columnNaming` on each cited row), the leftmost on a tie — else undefined. */
function personColumn(sheet: SheetGrid, accepted: readonly Citation[]): number | undefined {
  const counts = new Map<number, number>();
  for (const { source, person } of accepted) {
    const at = sourcePosition(source, sheet.name);
    const col = at === null ? null : columnNaming(sheet.rows[at.rowIdx] ?? [], at.colIdx, person);
    if (col !== null) counts.set(col, (counts.get(col) ?? 0) + 1);
  }
  let best: number | undefined;
  for (const [col, n] of counts) {
    if (best === undefined || n > (counts.get(best) ?? 0) || (n === counts.get(best) && col < best)) best = col;
  }
  return best;
}

/** The row of each cited column's header: the nearest non-blank, non-number
 *  cell above the column's topmost cited cell (-1 when there is none). A long
 *  sheet's hours columns are the columns the reply cited. */
function citedColumnHeaders(sheet: SheetGrid, cited: readonly Position[], isNumber: (col: number, cell: string) => boolean): Map<number, number> {
  const top = new Map<number, number>();
  for (const p of cited) top.set(p.colIdx, Math.min(top.get(p.colIdx) ?? Infinity, p.rowIdx));
  const headers = new Map<number, number>();
  for (const [col, first] of top) {
    let header = -1;
    for (let r = first - 1; r >= 0 && header < 0; r--) {
      const cell = (sheet.rows[r]?.[col] ?? "").trim();
      if (cell !== "" && !isNumber(col, cell)) header = r;
    }
    headers.set(col, header);
  }
  return headers;
}

/**
 * What a validated Claude reply did not read. Never a period-shaped cell (a
 * workbook's date cells are serials, and a complete reply once listed every
 * one of them). `cells`: number cells on a row an ACCEPTED row cites, under a
 * period header, that no row cites. `rows`: rows no row cites at all that hold
 * a number cell under a period header (a wide sheet) or in a column the reply
 * cited as hours, below that column's header (a long sheet) — a person the
 * reply skipped ENTIRELY included. Total rows (`isTotalLabel`) are left out.
 * A row's person is its cell in the column the accepted rows name their people
 * in (`personColumn`), else its first text cell — a `Rolle | Name` sheet once
 * named a skipped person by their role. Information, not a blocker.
 */
export function findUnreadCells(sheet: SheetGrid, result: ValidationResult): UnreadCells {
  const { all, accepted } = citations(result);
  const positions = (sources: readonly string[]): Position[] =>
    sources.flatMap((s) => {
      const at = sourcePosition(s, sheet.name);
      return at === null ? [] : [at];
    });
  const citedAt = positions(all);
  const cited = new Set(citedAt.map((p) => `${p.rowIdx}:${p.colIdx}`));
  const citedRows = new Set(citedAt.map((p) => p.rowIdx));
  const acceptedRows = new Set(positions(accepted.map((c) => c.source)).map((p) => p.rowIdx));
  const personCol = personColumn(sheet, accepted);

  const styleOf = (col: number): DecimalStyle => columnFacts(sheet).style(col);
  const isPeriodShaped = (cell: string): boolean => isPeriodShapedIn(cell, sheet.numbers);
  const isNumber = (col: number, cell: string): boolean => sheetNumber(sheet, col, cell, styleOf(col)) !== null && !isPeriodShaped(cell);
  const hoursHeaders = citedColumnHeaders(sheet, citedAt, isNumber);
  const holdsHours = (rowIdx: number, col: number, cell: string): boolean =>
    isNumber(col, cell)
    && (nearestPeriodRowAbove(sheet, rowIdx, col, personCol) !== null || rowIdx > (hoursHeaders.get(col) ?? Infinity));

  const cells: string[] = [];
  const rows: UnreadRow[] = [];
  sheet.rows.forEach((row, rowIdx) => {
    if (acceptedRows.has(rowIdx)) {
      row.forEach((cell, col) => {
        const isUnread = !cited.has(`${rowIdx}:${col}`) && isNumber(col, cell) && nearestPeriodRowAbove(sheet, rowIdx, col, personCol) !== null;
        if (isUnread) cells.push(`${sheet.name}!${columnLetters(col)}${rowIdx + 1}`);
      });
      return;
    }
    if (citedRows.has(rowIdx) || row.some(isTotalLabel)) return;
    if (!row.some((cell, col) => holdsHours(rowIdx, col, cell))) return;
    const isText = (cell: string, col: number): boolean => cell.trim() !== "" && !isNumber(col, cell) && !isPeriodShaped(cell);
    const named = personCol === undefined ? "" : (row[personCol] ?? "");
    const person = (isText(named, personCol ?? -1) ? named : row.find(isText))?.trim();
    rows.push(person === undefined ? { row: rowIdx + 1 } : { row: rowIdx + 1, person });
  });
  return { cells, rows };
}
