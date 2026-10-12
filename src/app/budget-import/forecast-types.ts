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
 *  (`period` + `hours`). */
export type ColumnMapping = {
  layout: "wide" | "long";
  headerRow: number;
  person: number;
  email?: number;
  rate?: number;
  periodCols?: number[];
  period?: number;
  hours?: number;
};

/** A sheet row (or cell) the import left out. `row` is the 1-based sheet row
 *  number, the one the spreadsheet shows. */
export type DropReason = {
  row: number;
  reason: "total" | "blank-person" | "bad-period" | "bad-number";
};
