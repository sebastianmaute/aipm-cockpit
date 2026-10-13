// src/app/budget-import/forecast-types.ts — the shapes the forecast import
// (§500) passes between its layers. Types only: no i18n, no React.

/** One forecast cell: a person's hours in one period. `period` is a canonical
 *  key — month "YYYY-MM" or week "YYYY-Www" (as `periodKeyForDate` writes it).
 *  `source` is the A1 address of the hours cell, "<sheet>!<ref>". */
export type ForecastRow = {
  person: string;
  email?: string;
  period: string;
  hours: number;
  rate?: number;
  source?: string;
};

/** Where each field sits in a sheet. Column indices are 0-based; `headerRow`
 *  is a 0-based row index. A "wide" sheet has one column per period
 *  (`periodCols`); a "long" sheet has one row per person and period
 *  (`period` + `hours`). `year` is the year a period label without one
 *  ("Jan", "KW03") is read in; absent, such a label is not a period. A long
 *  sheet's `yearCol` holds each row's year: a year-less period cell takes that
 *  row's year before `year`. */
export type ColumnMapping = {
  layout: "wide" | "long";
  headerRow: number;
  person: number;
  email?: number;
  rate?: number;
  periodCols?: number[];
  period?: number;
  hours?: number;
  year?: number;
  yearCol?: number;
};

/** A wide sheet's column right of the first period column that the import did
 *  not read although most data rows hold a number in it: its header is not a
 *  period (an unknown month spelling, a missing year) and not a total. `col` is
 *  0-based; `header` is the header cell as written. */
export type IgnoredColumn = { col: number; header: string };

/** Two or more cells of ONE sheet row that name the same person and period —
 *  `sources` are their "<sheet>!<ref>" references in input order. Never summed:
 *  one row holds one figure per period, so two mean the periods were read
 *  wrong (or the sheet repeats a column), and the import blocks until the
 *  mapping or the sheet is fixed. */
export type ForecastCollision = { person: string; period: string; sources: string[] };

/** A sheet row (or cell) the import left out. `row` is the 1-based sheet row
 *  number, the one the spreadsheet shows. */
export type DropReason = {
  row: number;
  reason: "total" | "blank-person" | "bad-period" | "bad-number";
};
