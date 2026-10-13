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

/** A field that more than one column (or, for `header`, more than one row)
 *  could be: `candidates` are 0-based columns, or 0-based ROWS for `header`,
 *  in order. The mapping detection returns still picks one (`detectLayout`),
 *  but the dialog asks the user to confirm it before anything is applied (fix
 *  7: the owner's "ask, don't guess"; `header`: fix 9 OOS-c). `rows` (round 9
 *  I-W, `differingRows`): one person's rows differ in the `candidates` text
 *  columns, `samples` quoting their values; confirming accepts the sum. */
export type ColumnAmbiguity =
  | { field: "hours" | "period" | "header"; candidates: number[] }
  | { field: "rows"; candidates: number[]; samples: string[] };

/** A column, at any position and in either layout, that the import did not read
 *  although most data rows hold a number in it: not a mapped field, and its
 *  header is no total (`isTotalHeader`). `col` is 0-based; `header` is the header
 *  cell as written. Its header is no period it reads (an unknown month
 *  spelling, a missing year), unless `isPeriodHeader`: the header reads as a
 *  period, but the mapping leaves the column out (final review 2, M1: one block
 *  of a `Plan | Ist` sheet). */
export type IgnoredColumn = { col: number; header: string; isPeriodHeader?: true };

/** Two or more cells of ONE sheet row that name the same person and period —
 *  `sources` are their "<sheet>!<ref>" references in input order. Never summed:
 *  one row holds one figure per period, so two mean the periods were read
 *  wrong (or the sheet repeats a column), and the import blocks until the
 *  mapping or the sheet is fixed. */
export type ForecastCollision = { person: string; period: string; sources: string[] };

/** The default year headers without one were read in, when any imported period
 *  took its year from it; `rolled` when such a run moved on into a later year. */
export type AssumedYear = { year: number; rolled: boolean };

/** A sheet row (or cell) the import left out. `row` is the 1-based sheet row
 *  number, the one the spreadsheet shows. */
export type DropReason = {
  row: number;
  reason: "total" | "blank-person" | "bad-period" | "bad-number";
};
