// src/app/budget-import/sheet-grid.ts — a spreadsheet file as raw string grids,
// the input of the forecast import (§500). Pure: no i18n, no React, no DOM.
//
// Cells stay STRINGS exactly as the file holds them ("1.234,5", "Jan.",
// "45658"): deciding what a cell means (a number, a date, a period header) is
// the next layer's job, because the locale of the file is only known there.

import { extractXlsxGrid, MAX_XLSX_SHEET_CELLS } from "../xlsx-extract";
import { readZipEntries } from "../unzip";

/** How a grid's number cells were written. "dot": an xlsx/xlsm workbook, whose
 * number cells Excel stores with a dot whatever the user's locale ("2.625" is
 * 2.625, never 2625). "text": a CSV, where a cell is whatever the exporting
 * locale typed, so its column's decimal style must be guessed. */
export type NumberOrigin = "dot" | "text";

/** `numbers` absent reads as "text" (a grid built by hand, as in a test). */
export type SheetGrid = { name: string; rows: string[][]; truncated: boolean; numbers?: NumberOrigin };

const BOM = "\uFEFF";

/** Count `target` in `line`, skipping everything inside double quotes. */
function countUnquoted(line: string, target: string): number {
  let inQuotes = false;
  let count = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === target) count += 1;
  }
  return count;
}

/** `;` when the first non-blank line holds more unquoted `;` than `,` (the
 *  German Excel export), else `,`. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== "") ?? "";
  return countUnquoted(firstLine, ";") > countUnquoted(firstLine, ",") ? ";" : ",";
}

/**
 * RFC 4180 reader: quoted cells may hold the delimiter, a doubled `""` for a
 * quote and line breaks; CRLF, LF and a lone CR each end a row. A leading BOM
 * is dropped and the trailing empty row (the file's final newline) is not
 * returned. The delimiter is detected, see `detectDelimiter`. Unbounded: a
 * file is read whole (`readDelimited` takes a cell cap).
 */
export function parseDelimited(text: string): string[][] {
  return readDelimited(text).rows;
}

/**
 * `parseDelimited` with a cell cap: reading stops before the row whose cells
 * would take the total past `maxCells`, and `truncated` says so — the same
 * bound a workbook sheet has (`MAX_XLSX_SHEET_CELLS`), so a huge CSV is not
 * held as millions of strings and walked by every detection pass.
 */
export function readDelimited(text: string, maxCells = Infinity): { rows: string[][]; truncated: boolean } {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowStarted = false;
  let cells = 0;
  let truncated = false;

  const endField = (): void => {
    row.push(field);
    field = "";
    if (cells + row.length > maxCells) truncated = true;
  };
  const endRow = (): void => {
    endField();
    if (truncated) return;
    rows.push(row);
    cells += row.length;
    row = [];
    rowStarted = false;
  };

  for (let i = 0; i < src.length && !truncated; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else inQuotes = false;
      continue;
    }
    rowStarted = true;
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (src[i + 1] === "\n") i += 1;
      endRow();
    } else field += ch;
  }
  if (!truncated && (rowStarted || field !== "" || row.length > 0)) endRow();
  // A file ending in a blank line leaves one [""] row behind.
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return { rows, truncated };
}

/** 1900-03-01 is serial 61; serial 60 is Excel's phantom 1900-02-29. */
const SERIAL_AFTER_PHANTOM_LEAP_DAY = 61;
const SERIAL_PHANTOM_LEAP_DAY = 60;
/** 9999-12-31, the last date a serial can name. */
const MAX_EXCEL_SERIAL = 2_958_465;
const MS_PER_DAY = 86_400_000;
/** Day 0 of the 1900 system once the phantom leap day is behind us. */
const EPOCH_AFTER_PHANTOM = Date.UTC(1899, 11, 30);
/** Day 0 for serials before it: no phantom day to absorb, so one day later. */
const EPOCH_BEFORE_PHANTOM = Date.UTC(1899, 11, 31);

/**
 * An Excel serial date as `YYYY-MM-DD`, in the 1900 date system INCLUDING its
 * Lotus leap-year bug: serial 60 (a day that never existed) is null, and
 * serials from 61 on count from 1899-12-30. The time-of-day fraction is
 * ignored. Null for anything below 1, non-finite, or past 9999-12-31.
 */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const day = Math.floor(serial);
  if (day < 1 || day > MAX_EXCEL_SERIAL || day === SERIAL_PHANTOM_LEAP_DAY) return null;
  const epoch = day >= SERIAL_AFTER_PHANTOM_LEAP_DAY ? EPOCH_AFTER_PHANTOM : EPOCH_BEFORE_PHANTOM;
  return new Date(epoch + day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** UTF-8 when the bytes are valid UTF-8, else windows-1252 (a German Excel
 *  "CSV" export is cp1252, and decoding it as UTF-8 would mangle the umlauts
 *  of the very `Mär` headers the import reads). */
function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/**
 * The sheets of a spreadsheet file as raw string grids: `.xlsx`/`.xlsm`, one
 * grid per sheet; `.csv`, a single grid named after the file. Anything else
 * (including legacy `.xls`) throws `Error("unsupported")`. A damaged workbook
 * rejects with whatever `readZipEntries` throws.
 */
export async function readSheetFile(name: string, bytes: Uint8Array): Promise<SheetGrid[]> {
  const ext = extensionOf(name);
  if (ext === "xlsx" || ext === "xlsm") {
    return extractXlsxGrid(await readZipEntries(bytes)).map((grid) => ({ ...grid, numbers: "dot" as const }));
  }
  if (ext === "csv") {
    const base = name.slice(0, name.length - ext.length - 1);
    const { rows, truncated } = readDelimited(decodeCsvBytes(bytes), MAX_XLSX_SHEET_CELLS);
    return [{ name: base, rows, truncated, numbers: "text" }];
  }
  throw new Error("unsupported");
}
