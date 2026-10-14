// src/app/budget-import/claude-mapping.ts — Claude's column mapping (§500,
// `propose_forecast_mapping`) as the hand route's `ColumnMapping`. Pure: no
// i18n, no React, no DOM.
//
// ★★ Claude sets WHERE the fields are, never a value: the hand reader then
// imports with the mapping, through every question and refusal it has, and the
// user confirms the mapping before anything is applied. This converter only
// checks that the mapping can be used. Anything it cannot use is refused, never
// repaired or guessed: the caller shows an error and keeps the hand route.

import { columnIndexOf } from "./forecast-rows";
import type { ColumnMapping } from "./forecast-types";
import { parseYearCell } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";

/** Why a mapping was refused: not the shape the tool asks for (`shape`); a
 *  column letter that is not one or lies past the sheet's width (`letter`); a
 *  header row that is not a row of the sheet (`header-row`); two fields, or two
 *  period columns, on one column (`duplicate`); a field the layout needs is
 *  absent (`missing`); a wide mapping with no period column (`period-cols`); a
 *  field of the other layout (`other-layout`); a year that is no whole year in
 *  the range a year cell reads (`year`, `parseYearCell`). */
export type ClaudeMappingRefusal =
  | "shape" | "letter" | "header-row" | "duplicate" | "missing" | "period-cols" | "other-layout" | "year";

export type ClaudeMappingResult = { mapping: ColumnMapping } | { refused: ClaudeMappingRefusal };

const LETTERS = /^[A-Z]{1,3}$/;
const LONG_ONLY = ["period", "hours", "yearCol"] as const;
const WIDE_ONLY = ["periodCols"] as const;

class Refused extends Error {
  constructor(readonly reason: ClaudeMappingRefusal) {
    super(reason);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Null and undefined alike: the model may send either for an unused field. */
const isAbsent = (value: unknown): boolean => value === undefined || value === null;

/** An OPTIONAL field the model filled with no value: absent, "" or [] (final
 *  review 2, M3). A required field left empty is still refused. */
const isUnset = (value: unknown): boolean => isAbsent(value) || value === "" || (Array.isArray(value) && value.length === 0);

/** A column letter as a 0-based column inside the sheet's width. */
function columnOf(value: unknown, width: number): number {
  if (typeof value !== "string") throw new Refused("shape");
  if (!LETTERS.test(value)) throw new Refused("letter");
  const col = columnIndexOf(value);
  if (col >= width) throw new Refused("letter");
  return col;
}

function requiredColumn(raw: Record<string, unknown>, field: string, width: number): number {
  if (isAbsent(raw[field])) throw new Refused("missing");
  return columnOf(raw[field], width);
}

function optionalColumn(raw: Record<string, unknown>, field: string, width: number): number | undefined {
  return isUnset(raw[field]) ? undefined : columnOf(raw[field], width);
}

/** The 1-based row number the prompt shows, as a 0-based row of the sheet. */
function headerRowOf(value: unknown, rowCount: number): number {
  if (typeof value !== "number") throw new Refused("shape");
  if (!Number.isInteger(value) || value < 1 || value > rowCount) throw new Refused("header-row");
  return value - 1;
}

function yearOf(value: unknown): number | undefined {
  if (isUnset(value)) return undefined;
  if (typeof value !== "number") throw new Refused("shape");
  if (!Number.isInteger(value) || parseYearCell(String(value)) !== value) throw new Refused("year");
  return value;
}

function periodColsOf(value: unknown, width: number): number[] {
  if (isAbsent(value)) throw new Refused("missing");
  if (!Array.isArray(value)) throw new Refused("shape");
  if (value.length === 0) throw new Refused("period-cols");
  return value.map((letter: unknown) => columnOf(letter, width));
}

function convert(raw: unknown, sheet: SheetGrid): ColumnMapping {
  if (!isRecord(raw) || (raw.layout !== "wide" && raw.layout !== "long")) throw new Refused("shape");
  const layout = raw.layout;
  const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const otherLayout = layout === "wide" ? LONG_ONLY : WIDE_ONLY;
  if (otherLayout.some((field) => !isUnset(raw[field]))) throw new Refused("other-layout");
  const mapping: ColumnMapping = {
    layout,
    headerRow: headerRowOf(raw.headerRow, sheet.rows.length),
    person: requiredColumn(raw, "person", width),
  };
  const email = optionalColumn(raw, "email", width);
  const rate = optionalColumn(raw, "rate", width);
  if (email !== undefined) mapping.email = email;
  if (rate !== undefined) mapping.rate = rate;
  if (layout === "wide") {
    mapping.periodCols = periodColsOf(raw.periodCols, width);
  } else {
    mapping.period = requiredColumn(raw, "period", width);
    mapping.hours = requiredColumn(raw, "hours", width);
    const yearCol = optionalColumn(raw, "yearCol", width);
    if (yearCol !== undefined) mapping.yearCol = yearCol;
  }
  const year = yearOf(raw.year);
  if (year !== undefined) mapping.year = year;
  const used = [mapping.person, mapping.email, mapping.rate, mapping.period, mapping.hours, mapping.yearCol, ...(mapping.periodCols ?? [])]
    .filter((col): col is number => col !== undefined);
  if (new Set(used).size !== used.length) throw new Refused("duplicate");
  return mapping;
}

/**
 * Claude's raw tool input as a `ColumnMapping` over `sheet`: column letters
 * (A, B, … AA) become 0-based columns and the 1-based header row a 0-based
 * row, as `sheetToPromptText` shows them. Every letter must name a column
 * inside the sheet's width and the header row a row of the sheet; the mapped
 * columns must be distinct; the layout's own fields must be present (`person`;
 * wide `periodCols`, non-empty; long `period` and `hours`) and the other
 * layout's absent; `year` a whole year. An optional field (and a field of the
 * other layout) sent as null, "" or [] is absent. Otherwise the reason it was
 * refused.
 */
export function claudeMappingOf(raw: unknown, sheet: SheetGrid): ClaudeMappingResult {
  try {
    return { mapping: convert(raw, sheet) };
  } catch (e) {
    if (e instanceof Refused) return { refused: e.reason };
    throw e;
  }
}
