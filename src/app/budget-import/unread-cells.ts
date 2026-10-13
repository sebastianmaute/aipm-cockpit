// src/app/budget-import/unread-cells.ts — what a Claude reply left out (§500).
// Pure: no i18n, no React, no DOM.
//
// A reply that stops at the output budget is refused outright; one that simply
// skips rows (common on long lists) used to look complete. This lists the
// number cells the reply did not cite, as information for the preview — the
// hand route's counterpart is `IgnoredColumn`.

import { columnLetters, type DecimalStyle } from "./forecast-rows";
import type { ValidationResult } from "./forecast-validate";
import { classifyPeriodCell } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";
import { columnStyle, nearestPeriodRowAbove, sheetNumber, sourcePosition } from "./source-evidence";

/** `cells`: "<sheet>!<ref>" of uncited number cells under a period header, in
 *  sheet order. `rows`: 1-based sheet rows (long layout) that name an accepted
 *  person and hold a period, yet no row cites any cell of. */
export type UnreadCells = { cells: string[]; rows: number[] };

const sourceOf = (raw: unknown): string | undefined => {
  const source = typeof raw === "object" && raw !== null ? (raw as { source?: unknown }).source : undefined;
  return typeof source === "string" ? source : undefined;
};

/** Every source the reply cited, accepted or rejected, and the accepted ones. */
function citations(result: ValidationResult): { all: string[]; accepted: string[]; people: Set<string> } {
  const accepted = [
    ...result.ok.flatMap((r) => (r.source === undefined ? [] : [r.source])),
    ...result.duplicates.flatMap((d) => d.sources),
    ...result.subPeriods.flatMap((d) => d.sources),
    ...result.collisions.flatMap((c) => c.sources),
  ];
  const rejected = result.rejected.flatMap((r) => {
    const source = sourceOf(r.row);
    return source === undefined ? [] : [source];
  });
  const people = new Set(
    [...result.ok, ...result.duplicates, ...result.subPeriods, ...result.collisions].map((r) => r.person.trim().toLowerCase()),
  );
  return { all: [...accepted, ...rejected], accepted, people };
}

/**
 * The cells a validated Claude reply did not read: (a) number cells (by the
 * sheet's number rule) on any row an ACCEPTED row cites, in a column with a
 * period header above (`nearestPeriodRowAbove`), that no row cites, accepted
 * or rejected; (b) rows no row cites at all that name an accepted person and
 * hold a period cell (a long sheet's skipped rows). Information, not a blocker.
 */
export function findUnreadCells(sheet: SheetGrid, result: ValidationResult): UnreadCells {
  const { all, accepted, people } = citations(result);
  const positions = (sources: readonly string[]) =>
    sources.flatMap((s) => {
      const at = sourcePosition(s, sheet.name);
      return at === null ? [] : [at];
    });
  const cited = new Set(positions(all).map((p) => `${p.rowIdx}:${p.colIdx}`));
  const citedRows = new Set(positions(all).map((p) => p.rowIdx));
  const acceptedRows = [...new Set(positions(accepted).map((p) => p.rowIdx))].sort((a, b) => a - b);

  const styles = new Map<number, DecimalStyle>();
  const styleOf = (col: number): DecimalStyle => {
    const known = styles.get(col);
    if (known !== undefined) return known;
    const style = columnStyle(sheet, col);
    styles.set(col, style);
    return style;
  };
  const cells: string[] = [];
  for (const rowIdx of acceptedRows) {
    (sheet.rows[rowIdx] ?? []).forEach((cell, col) => {
      const isUnread = !cited.has(`${rowIdx}:${col}`)
        && sheetNumber(sheet, col, cell, styleOf(col)) !== null
        && nearestPeriodRowAbove(sheet, rowIdx, col) !== null;
      if (isUnread) cells.push(`${sheet.name}!${columnLetters(col)}${rowIdx + 1}`);
    });
  }

  const rows = sheet.rows.flatMap((row, rowIdx) => {
    if (citedRows.has(rowIdx)) return [];
    const personCol = row.findIndex((cell) => people.has(cell.trim().toLowerCase()));
    const hasPeriod = personCol >= 0 && row.some((cell, col) => col !== personCol && classifyPeriodCell(cell) !== null);
    return hasPeriod ? [rowIdx + 1] : [];
  });
  return { cells, rows };
}
