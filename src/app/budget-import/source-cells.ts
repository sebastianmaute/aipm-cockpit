// src/app/budget-import/source-cells.ts — where a read row's hours cell sits
// in its sheet (§500): the facts `validateForecastRows` needs to tell a
// sub-period sum from a same-row collision. Each `ForecastRow.source` names the
// cell its hours were read from, "<sheet>!<A1>". Pure: no i18n, no React, no DOM.

import { columnIndexOf } from "./forecast-rows";
import { classifyPeriodCell, headerProbeRun, isPeriodShapedIn, type AssignedPeriod, type PeriodCell } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";

const CELL_REF = /^([A-Z]{1,3})([1-9]\d*)$/;

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

/** The 0-based row and column a `source` names in this sheet (inside the grid
 *  or not), else null. */
export function sourcePosition(source: string, sheetName: string): { rowIdx: number; colIdx: number } | null {
  const cellPart = cellPartOf(source, sheetName);
  const match = cellPart === null ? null : CELL_REF.exec(cellPart);
  return match === null ? null : { rowIdx: Number(match[2]) - 1, colIdx: columnIndexOf(match[1]) };
}

/** The column of the first cell of the row, other than the cited one, that names
 *  `text` (trimmed, case-insensitive) — preferring a cell that is not a period,
 *  so a period cell spelled like the person ("Mai") is not taken for them. */
export function columnNaming(rowCells: readonly string[], citedCol: number, text: string): number | null {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return null;
  const cols = rowCells.flatMap((cell, col) => (col !== citedCol && cell.trim().toLowerCase() === wanted ? [col] : []));
  return cols.find((col) => classifyPeriodCell(rowCells[col]) === null) ?? cols[0] ?? null;
}

/** Per grid and column, the nearest period header row above each row (-1 for
 *  none): grids are never mutated, so it is computed once per column. */
const HEADERS_ABOVE = new WeakMap<SheetGrid, Map<number, readonly number[]>>();

/** Per row of `col`, the nearest row above it that is a period header for `col`
 *  (-1 for none), in one pass down the column. */
function headersAbove(sheet: SheetGrid, col: number): readonly number[] {
  const perSheet = HEADERS_ABOVE.get(sheet) ?? new Map<number, readonly number[]>();
  HEADERS_ABOVE.set(sheet, perSheet);
  const known = perSheet.get(col);
  if (known !== undefined) return known;
  const runs = new Map<number, ReadonlyArray<AssignedPeriod | null>>();
  const runOf = (row: number) => {
    if (!runs.has(row)) runs.set(row, headerProbeRun(sheet.rows[row] ?? [], sheet.numbers ?? "text"));
    return runs.get(row) ?? [];
  };
  const out: number[] = [];
  let last = -1;
  for (let r = 0; r < sheet.rows.length; r++) {
    out.push(last);
    if (classifyPeriodCell(sheet.rows[r]?.[col] ?? "") !== null && (runOf(r)[col] ?? null) !== null) last = r;
  }
  perSheet.set(col, out);
  return out;
}

/** The nearest row above `rowIdx` that is a PERIOD HEADER for `col`, else null:
 *  a row whose run (`headerProbeRun`) gives `col` a period. ★★ Text in the
 *  grid never bounds the search — a placeholder (`-`, `Urlaub`), a unit row
 *  (`Std`) or a `Plan | Ist` sub-header between the header and the cell. */
function nearestPeriodRowAbove(sheet: SheetGrid, rowIdx: number, col: number): number | null {
  const above = headersAbove(sheet, col)[rowIdx];
  return above === undefined || above < 0 ? null : above;
}

/** A period cell on a row: its column and what it says. */
type RowPeriod = { col: number; text: string; cell: PeriodCell };

/** EVERY period cell on the row (period-shaped in the sheet's number origin: a
 *  CSV's five-digit number is no date), the cell itself and the PERSON cell
 *  skipped by position. */
function rowPeriodCells(sheet: SheetGrid, at: { rowIdx: number; colIdx: number; personCol?: number }): RowPeriod[] {
  const cells = sheet.rows[at.rowIdx] ?? [];
  const out: RowPeriod[] = [];
  cells.forEach((text, col) => {
    if (col === at.colIdx || col === at.personCol || !isPeriodShapedIn(text, sheet.numbers)) return;
    const cell = classifyPeriodCell(text);
    if (cell !== null) out.push({ col, text, cell });
  });
  return out;
}

/** The ISO day of the date header a cell sits under (the nearest period header
 *  above it, `nearestPeriodRowAbove`, when its cell is a date — an Excel serial
 *  only in a workbook), else null: what tells a sub-period column
 *  ("05.01.2026") from a period label. ★★★ Null too when the row holds a period
 *  cell of its own (`rowPeriodCells`): such a row is a long row, whose cells
 *  share its one period. A metadata row's dates over a long sheet's `Stunden |
 *  Ist` once summed the two to 75 as sub-periods (final review I1, rr8 OOS-1).
 *  Sprint dates beside a `Start` date collide too: refused visibly, never
 *  summed wrong. `personCol` is the row's person column. */
export function headerDateOf(sheet: SheetGrid, at: { rowIdx: number; colIdx: number; personCol?: number }): string | null {
  const r = nearestPeriodRowAbove(sheet, at.rowIdx, at.colIdx);
  if (r !== null && rowPeriodCells(sheet, at).length > 0) return null;
  const c = r === null ? null : classifyPeriodCell(sheet.rows[r]?.[at.colIdx] ?? "");
  if (c === null || c.kind !== "month" || c.date === undefined) return null;
  return sheet.numbers === "dot" || c.serial !== true ? c.date : null;
}
