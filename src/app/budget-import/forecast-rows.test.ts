import { describe, expect, it } from "vitest";
import {
  detectDecimalStyle,
  gridToForecastRows,
  isTotalLabel,
  parseNumberCell,
  parsePeriodLabel,
} from "./forecast-rows";
import type { ColumnMapping } from "./forecast-types";

describe("parsePeriodLabel", () => {
  const accepted: Array<[string, string]> = [
    ["2026-01", "2026-01"],
    ["2026-1", "2026-01"],
    ["  2026-12  ", "2026-12"],
    ["Jan 2026", "2026-01"],
    ["JAN 2026", "2026-01"],
    ["January 2026", "2026-01"],
    ["Jan-26", "2026-01"],
    ["Dec-26", "2026-12"],
    ["Jan. 2026", "2026-01"],
    ["Feb.2026", "2026-02"],
    ["Januar 2026", "2026-01"],
    ["Mär 2026", "2026-03"],
    ["März 2026", "2026-03"],
    ["Maerz 2026", "2026-03"],
    ["Mai 2026", "2026-05"],
    ["May 2026", "2026-05"],
    ["Okt 2026", "2026-10"],
    ["Oktober 2026", "2026-10"],
    ["Dez 2026", "2026-12"],
    ["Dezember 2026", "2026-12"],
    ["Sept 2026", "2026-09"],
    ["01/2026", "2026-01"],
    ["1/2026", "2026-01"],
    ["1.2026", "2026-01"],
    ["12.2026", "2026-12"],
    ["2026-01-15", "2026-01"],
    ["2026-1-5", "2026-01"],
    ["45658", "2025-01"],
    ["45658.0", "2025-01"],
    ["2026-W03", "2026-W03"],
    ["2026-w3", "2026-W03"],
    ["W03 2026", "2026-W03"],
    ["KW03 2026", "2026-W03"],
    ["kw 3 2026", "2026-W03"],
    ["KW53 2020", "2020-W53"],
    ["2020-W53", "2020-W53"],
    ["KW53 2026", "2026-W53"],
    ["2026-W53", "2026-W53"],
    ["KW53/2026", "2026-W53"],
    ["2026-KW53", "2026-W53"],
    ["KW03/2026", "2026-W03"],
    ["kw3/2026", "2026-W03"],
    ["2026-KW03", "2026-W03"],
    ["2026-kw3", "2026-W03"],
    ["01.01.2026", "2026-01"],
    ["15.3.2026", "2026-03"],
    ["29.02.2028", "2028-02"],
    ["2026-01-15 00:00:00", "2026-01"],
    ["2026-01-15 09:30", "2026-01"],
    ["2026-01-15T00:00:00", "2026-01"],
    ["2026-01-15T00:00:00.000Z", "2026-01"],
    ["2026-02-28", "2026-02"],
    ["Mrz 2026", "2026-03"],
    ["Mrz 26", "2026-03"],
    ["Mrz. 2026", "2026-03"],
    ["Jän 2026", "2026-01"],
    ["Jänner 2026", "2026-01"],
    ["2026/01", "2026-01"],
    ["2026/1", "2026-01"],
  ];
  it.each(accepted)("parses %j as %s", (cell, expected) => {
    expect(parsePeriodLabel(cell)).toBe(expected);
  });

  const rejected = [
    "Q1 2026",
    "Total",
    "",
    "   ",
    "13/2026",
    "0/2026",
    "2026-13",
    "2026-00",
    "2026-01-32",
    "2026-02-31",
    "2026-02-29",
    "31.02.2026",
    "00.01.2026",
    "2026-02-31 00:00:00",
    "2026-01-15T25:00:00",
    "KW53 2025",
    "2025-W53",
    "KW53/2025",
    "2025-KW53",
    "2021-W53",
    "2026-KW54",
    "2026-W00",
    "2026-W54",
    "KW54 2026",
    "Foo 2026",
    "Jan",
    "2026",
    "19999",
    "80001",
    "60",
  ];
  it.each(rejected)("rejects %j", (cell) => {
    expect(parsePeriodLabel(cell)).toBeNull();
  });
});

describe("parsePeriodLabel — a default year for headers without one", () => {
  const accepted: Array<[string, string]> = [
    ["Jan", "2026-01"],
    ["Jan.", "2026-01"],
    ["JANUAR", "2026-01"],
    ["Mrz", "2026-03"],
    ["Mär", "2026-03"],
    ["Jän", "2026-01"],
    ["Dez.", "2026-12"],
    ["KW03", "2026-W03"],
    ["KW 3", "2026-W03"],
    ["W03", "2026-W03"],
    ["kw53", "2026-W53"],
    // A label that names its year keeps it.
    ["Jan 2025", "2025-01"],
    ["KW03 2027", "2027-W03"],
  ];
  it.each(accepted)("parses %j with 2026 as %s", (cell, expected) => {
    expect(parsePeriodLabel(cell, 2026)).toBe(expected);
  });

  it.each(["01", "1", "3", "Foo", "Q1", "KW54", "W00", "", "Total"])("still rejects %j", (cell) => {
    expect(parsePeriodLabel(cell, 2026)).toBeNull();
  });

  it("checks a week against the default year's week count", () => {
    expect(parsePeriodLabel("KW53", 2025)).toBeNull();
    expect(parsePeriodLabel("KW53", 2026)).toBe("2026-W53");
  });

  it("reads nothing year-less without a year, or with one that is not a year", () => {
    for (const year of [undefined, Number.NaN, 2026.5, 26, 10000]) {
      expect(parsePeriodLabel("Jan", year)).toBeNull();
      expect(parsePeriodLabel("KW03", year)).toBeNull();
    }
  });
});

describe("detectDecimalStyle", () => {
  it("is comma when a cell has dot thousands and a comma decimal", () => {
    expect(detectDecimalStyle(["12", "1.234,5"])).toBe("comma");
  });
  it("is comma for a plain comma decimal", () => {
    expect(detectDecimalStyle(["12,5"])).toBe("comma");
  });
  it("is comma for dot thousands without a decimal part", () => {
    expect(detectDecimalStyle(["1.234.567"])).toBe("comma");
  });
  it("is dot for dot decimals, integers and blanks", () => {
    expect(detectDecimalStyle(["12.5", "1,234.5", "7", ""])).toBe("dot");
  });
  it("ignores a unit suffix and a minus sign", () => {
    expect(detectDecimalStyle(["-1.234,5 h"])).toBe("comma");
  });
  it("keeps a column dot when a cell is a leading-zero decimal like 0.125", () => {
    expect(detectDecimalStyle(["0.125", "8"])).toBe("dot");
    expect(detectDecimalStyle(["0.500"])).toBe("dot");
    expect(detectDecimalStyle(["0.125.000"])).toBe("dot");
  });
  it("still reads 1.250 and 12.500 as dot-grouped thousands", () => {
    expect(detectDecimalStyle(["1.250"])).toBe("comma");
    expect(detectDecimalStyle(["12.500,5"])).toBe("comma");
  });
  it("is dot for an empty list", () => {
    expect(detectDecimalStyle([])).toBe("dot");
  });
  it("does not let a workbook's stored numbers vote", () => {
    expect(detectDecimalStyle(["2.625", "40"], "dot")).toBe("dot");
    expect(detectDecimalStyle(["2.625", "40"])).toBe("comma");
    expect(detectDecimalStyle(["2.625", "7,5"], "dot")).toBe("comma");
  });
});

describe("parseNumberCell", () => {
  it("reads German style", () => {
    expect(parseNumberCell("1.234,5", "comma")).toBe(1234.5);
    expect(parseNumberCell("12,5", "comma")).toBe(12.5);
  });
  it("reads English style", () => {
    expect(parseNumberCell("1,234.5", "dot")).toBe(1234.5);
    expect(parseNumberCell("12.5", "dot")).toBe(12.5);
  });
  it("strips spaces and a trailing unit", () => {
    expect(parseNumberCell("12 h", "dot")).toBe(12);
    expect(parseNumberCell("12H", "dot")).toBe(12);
    expect(parseNumberCell("1 234,5 €", "comma")).toBe(1234.5);
    expect(parseNumberCell("95$", "dot")).toBe(95);
    expect(parseNumberCell("95 £", "dot")).toBe(95);
    expect(parseNumberCell("95₹", "dot")).toBe(95);
  });
  it("keeps zero and negatives", () => {
    expect(parseNumberCell("0", "dot")).toBe(0);
    expect(parseNumberCell("-3,5", "comma")).toBe(-3.5);
  });
  it("in comma style reads a dot only as a thousands mark in groups of three", () => {
    expect(parseNumberCell("2.5", "comma")).toBeNull();
    expect(parseNumberCell("0.125", "comma")).toBeNull();
    expect(parseNumberCell("12.34,5", "comma")).toBeNull();
    expect(parseNumberCell("01.234", "comma")).toBeNull();
    expect(parseNumberCell("1.234", "comma")).toBe(1234);
    expect(parseNumberCell("1.234.567,5", "comma")).toBe(1234567.5);
    expect(parseNumberCell("+12,5 h", "comma")).toBe(12.5);
  });

  // §500 fix wave 2 (RR minor 1): a leading-comma decimal reads again.
  it("in comma style reads a leading-comma decimal", () => {
    expect(parseNumberCell(",5", "comma")).toBe(0.5);
    expect(parseNumberCell("-,25", "comma")).toBe(-0.25);
    expect(parseNumberCell("2.5", "comma")).toBeNull();
    expect(parseNumberCell("0.125", "comma")).toBeNull();
  });
  it("reads a workbook's stored number with a dot whatever the column's style", () => {
    expect(parseNumberCell("2.625", "comma", "dot")).toBe(2.625);
    expect(parseNumberCell(" -7.5 ", "comma", "dot")).toBe(-7.5);
    expect(parseNumberCell("2.625", "comma", "text")).toBe(2625);
    // A text cell in a workbook keeps the column's rule.
    expect(parseNumberCell("7,5", "comma", "dot")).toBe(7.5);
    expect(parseNumberCell("1.234,5", "comma", "dot")).toBe(1234.5);
  });
  it("returns null for blank and non-numeric text", () => {
    expect(parseNumberCell("", "dot")).toBeNull();
    expect(parseNumberCell("   ", "dot")).toBeNull();
    expect(parseNumberCell("abc", "dot")).toBeNull();
    expect(parseNumberCell("h", "dot")).toBeNull();
    expect(parseNumberCell("1e999", "dot")).toBeNull();
    expect(parseNumberCell("0x10", "dot")).toBeNull();
    expect(parseNumberCell("1.2.3", "dot")).toBeNull();
  });
});

describe("isTotalLabel", () => {
  it.each([
    "Total",
    "TOTAL",
    " totals ",
    "Sum",
    "Summe",
    "Gesamt",
    "Σ",
    "Total hours",
    "Gesamt: 2026",
    "Summe:",
    "total:x",
    "Subtotal",
    "Subtotal Q1",
    "Zwischensumme",
    "Gesamtsumme",
    "Grand total",
    "GRAND TOTAL: 2026",
  ])("accepts %j", (label) => {
    expect(isTotalLabel(label)).toBe(true);
  });
  it.each(["", "Ann", "Totally", "Summer", "Gesamtprojekt", "Sumo wrestler x", "Jan 2026", "Grand", "Subtotaler"])(
    "rejects %j",
    (label) => {
      expect(isTotalLabel(label)).toBe(false);
    },
  );
});

describe("gridToForecastRows — wide", () => {
  const wide: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2, 3] };

  it("reads a German export: 1.234,5 is 1234.5, zero is a row, blank is none, Gesamt row + column are dropped", () => {
    const grid = [
      ["Name", "Jan 2026", "Feb 2026", "Gesamt"],
      ["Ann", "1.234,5", "0", ""],
      ["Gesamt", "1.234,5", "0", ""],
    ];
    const out = gridToForecastRows(grid, wide, "S");
    expect(out.rows).toEqual([
      { person: "Ann", period: "2026-01", hours: 1234.5, source: "S!B2" },
      { person: "Ann", period: "2026-02", hours: 0, source: "S!C2" },
    ]);
    expect(out.dropped).toEqual([{ row: 3, reason: "total" }]);
  });

  it("treats a trailing Total column as no period even when it holds numbers", () => {
    const grid = [
      ["Name", "Jan 2026", "Total"],
      ["Ann", "10", "10"],
    ];
    const out = gridToForecastRows(grid, { ...wide, periodCols: [1, 2] }, "S");
    expect(out.rows.map((r) => r.period)).toEqual(["2026-01"]);
  });

  it("decides the decimal style once over all period columns", () => {
    const grid = [
      ["Name", "Jan 2026", "Feb 2026"],
      ["Ann", "12", "1.234,5"],
      ["Bob", "1,5", "3"],
    ];
    const out = gridToForecastRows(grid, { ...wide, periodCols: [1, 2] }, "S");
    expect(out.rows.map((r) => r.hours)).toEqual([12, 1234.5, 1.5, 3]);
  });

  // The test above cannot tell a column decision from a per-cell one: every
  // cell in it reads the same either way. Only a cell whose own look disagrees
  // with its column can — here a dot decimal in a German column, which the
  // column rule refuses: a German column reads a dot only as a thousands mark
  // in groups of three (the spec's "decided once per column, never per cell"),
  // so a per-cell reading would keep Bob's 2.5 and the column reading drops it.
  it("reads a cell by its column's style even when the cell alone would read otherwise", () => {
    const grid = [
      ["Name", "Jan 2026"],
      ["Ann", "1.234,5"],
      ["Bob", "2.5"],
    ];
    const out = gridToForecastRows(grid, { ...wide, periodCols: [1] }, "S");
    expect(out.rows.map((r) => r.hours)).toEqual([1234.5]);
    expect(out.dropped).toEqual([{ row: 3, reason: "bad-number" }]);
  });

  it("does not let a total row flip the decimal style", () => {
    const grid = [
      ["Name", "Jan 2026"],
      ["Ann", "1.5"],
      ["Total", "1,234"],
    ];
    const out = gridToForecastRows(grid, { ...wide, periodCols: [1] }, "S");
    expect(out.rows).toEqual([{ person: "Ann", period: "2026-01", hours: 1.5, source: "S!B2" }]);
  });

  it("drops a row with no person and reports a non-number cell", () => {
    const grid = [
      ["Name", "Jan 2026", "Feb 2026"],
      ["", "5", ""],
      ["Ann", "abc", "4"],
    ];
    const out = gridToForecastRows(grid, { ...wide, periodCols: [1, 2] }, "S");
    expect(out.rows).toEqual([{ person: "Ann", period: "2026-02", hours: 4, source: "S!C3" }]);
    expect(out.dropped).toEqual([
      { row: 2, reason: "blank-person" },
      { row: 3, reason: "bad-number" },
    ]);
  });

  it("tolerates ragged and empty rows and skips fully blank mapped rows silently", () => {
    const grid = [["Name", "Jan 2026", "Feb 2026"], [], ["Ann", "7"], ["", "", ""]];
    const out = gridToForecastRows(grid, { ...wide, periodCols: [1, 2] }, "S");
    expect(out.rows).toEqual([{ person: "Ann", period: "2026-01", hours: 7, source: "S!B3" }]);
    expect(out.dropped).toEqual([]);
  });

  it("ignores rows above the header and maps email and rate", () => {
    const grid = [
      ["Forecast 2026"],
      ["Name", "Mail", "Rate", "Jan 2026"],
      ["Ann", " ann@x.io ", "95,50 €", "8"],
      ["Bob", "", "", "9"],
    ];
    const mapping: ColumnMapping = {
      layout: "wide",
      headerRow: 1,
      person: 0,
      email: 1,
      rate: 2,
      periodCols: [3],
    };
    const out = gridToForecastRows(grid, mapping, "Plan");
    expect(out.rows).toEqual([
      { person: "Ann", email: "ann@x.io", period: "2026-01", hours: 8, rate: 95.5, source: "Plan!D3" },
      { person: "Bob", period: "2026-01", hours: 9, source: "Plan!D4" },
    ]);
  });

  it("builds A1 refs past column Z", () => {
    const header = ["Name", ...Array.from({ length: 26 }, () => "x"), "Jan 2026"];
    const data = ["Ann", ...Array.from({ length: 26 }, () => ""), "3"];
    const out = gridToForecastRows([header, data], { ...wide, periodCols: [27] }, "S");
    expect(out.rows[0].source).toBe("S!AB2");
  });

  // Round 3 (M2): a LONE date or serial header cell is no period; a run of them is.
  it("maps a run of Excel-serial headers to their months", () => {
    const grid = [
      ["Name", "45658", "45689"],
      ["Ann", "2", "3"],
    ];
    const out = gridToForecastRows(grid, { ...wide, periodCols: [1, 2] }, "S");
    expect(out.rows.map((r) => r.period)).toEqual(["2025-01", "2025-02"]);
  });
});

// Reviewer probe (§500 final review): Excel stores every number cell with a
// dot, so a workbook's "2.625" must not flip its column to German and turn
// 7.5 into 75. A CSV carries no such guarantee and keeps the column rule.
describe("gridToForecastRows — a workbook's stored numbers", () => {
  const wide: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2, 3] };
  const grid = [
    ["Name", "Jan 2026", "Feb 2026", "Mar 2026"],
    ["Ann", "7.5", "2.625", "40"],
    ["Bob", "37.5", "12", "8"],
  ];

  it("reads every stored number with a dot in an xlsx grid", () => {
    const out = gridToForecastRows(grid, wide, "S", "dot");
    expect(out.rows.map((r) => r.hours)).toEqual([7.5, 2.625, 40, 37.5, 12, 8]);
    expect(out.dropped).toEqual([]);
  });

  it("keeps a text cell from flipping the stored numbers of an xlsx grid", () => {
    const withText = [["Name", "Jan 2026"], ["Ann", "7,5"], ["Bob", "37.5"]];
    const out = gridToForecastRows(withText, { ...wide, periodCols: [1] }, "S", "dot");
    expect(out.rows.map((r) => r.hours)).toEqual([7.5, 37.5]);
  });

  it("keeps the per-column rule for the same cells in a CSV grid", () => {
    const out = gridToForecastRows(grid, wide, "S");
    expect(out.rows.map((r) => r.hours)).toEqual([2625, 40, 12, 8]);
    expect(out.dropped).toEqual([
      { row: 2, reason: "bad-number" },
      { row: 3, reason: "bad-number" },
    ]);
  });

  it("reads a workbook rate the same way", () => {
    const rated = [["Name", "Rate", "Jan 2026"], ["Ann", "95.5", "8"], ["Bob", "1.250", "9"]];
    const mapping: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, rate: 1, periodCols: [2] };
    expect(gridToForecastRows(rated, mapping, "S", "dot").rows.map((r) => r.rate)).toEqual([95.5, 1.25]);
  });
});

describe("gridToForecastRows — year-less headers", () => {
  it("reads month names under the mapping's year", () => {
    const grid = [["Name", "Jan", "Feb", "Mär"], ["Ann", "1", "2", "3"]];
    const mapping: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2, 3], year: 2026 };
    const out = gridToForecastRows(grid, mapping, "S");
    expect(out.rows.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(gridToForecastRows(grid, { ...mapping, year: undefined }, "S").rows).toEqual([]);
  });

  it("reads a long sheet's year-less period cells under the mapping's year", () => {
    const grid = [["Name", "Month", "Hours"], ["Ann", "Mrz", "4"]];
    const mapping: ColumnMapping = { layout: "long", headerRow: 0, person: 0, period: 1, hours: 2, year: 2026 };
    expect(gridToForecastRows(grid, mapping, "S").rows.map((r) => r.period)).toEqual(["2026-03"]);
  });
});

// Reviewer probe (§500 final review): a month header the reader does not know
// ("Mrz" before it was added) dropped that month's hours without a word.
describe("gridToForecastRows — columns left out", () => {
  const wide: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, periodCols: [1, 3] };

  it("reports a non-period header between period columns that holds numbers", () => {
    const grid = [["Name", "Jan 2026", "Foo", "Feb 2026"], ["Ann", "1", "2", "3"], ["Bob", "4", "5", "6"]];
    expect(gridToForecastRows(grid, wide, "S").ignoredColumns).toEqual([{ col: 2, header: "Foo" }]);
  });

  it("reports one after the last period column, and a blank header", () => {
    const grid = [["Name", "Jan 2026", "", "Feb 2026", "Later"], ["Ann", "1", "2", "3", "4"]];
    expect(gridToForecastRows(grid, wide, "S").ignoredColumns).toEqual([
      { col: 2, header: "" },
      { col: 4, header: "Later" },
    ]);
  });

  it("does not report text, a mostly-empty column, totals or mapped columns", () => {
    const grid = [
      ["Name", "Rate", "Jan 2026", "Notes", "Feb 2026", "Total", "Odd"],
      ["Ann", "95", "1", "late", "3", "4", "7"],
      ["Bob", "90", "1", "", "3", "4", ""],
      ["Cy", "90", "1", "", "3", "4", ""],
    ];
    const mapping: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, rate: 1, periodCols: [2, 4] };
    expect(gridToForecastRows(grid, mapping, "S").ignoredColumns).toEqual([]);
  });

  // §500 fix wave 2 (RR minor 2, CR minor 10): every unread number column is
  // reported, at any position and in either layout.
  it("reports a number column left of every period column, such as a broken first month header", () => {
    const grid = [["Name", "Januar 26x", "Feb 2026", "Mar 2026"], ["Ann", "1", "2", "3"]];
    const mapping: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, periodCols: [2, 3] };
    expect(gridToForecastRows(grid, mapping, "S").ignoredColumns).toEqual([{ col: 1, header: "Januar 26x" }]);
  });

  it("reports an unmapped number column of a long sheet, never a mapped one", () => {
    const grid = [["Name", "Jahr", "Month", "Hours", "Extra"], ["Ann", "2027", "Jan", "4", "9"]];
    const mapping: ColumnMapping = { layout: "long", headerRow: 0, person: 0, yearCol: 1, period: 2, hours: 3 };
    expect(gridToForecastRows(grid, mapping, "S").ignoredColumns).toEqual([{ col: 4, header: "Extra" }]);
  });

  it("does not report quarter, half-year and fiscal-year totals", () => {
    const headers = ["Q1", "Q2 2026", "H1", "H2/26", "FY", "FY26", "GJ 2026", "Summe", "Gesamt", "Total"];
    const grid = [["Name", "Jan 2026", ...headers], ["Ann", "1", ...headers.map(() => "5")]];
    const mapping: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, periodCols: [1] };
    expect(gridToForecastRows(grid, mapping, "S").ignoredColumns).toEqual([]);
  });
});

describe("gridToForecastRows — leading-zero decimals", () => {
  const wide: ColumnMapping = { layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2] };

  it("does not inflate a dot-style column holding 0.125 by 1000x", () => {
    const grid = [
      ["Name", "Jan 2026", "Feb 2026"],
      ["Ann", "0.125", "8"],
    ];
    const out = gridToForecastRows(grid, wide, "S");
    expect(out.rows.map((r) => r.hours)).toEqual([0.125, 8]);
  });
  it("reads a lone 0.500 as 0.5 hours", () => {
    const grid = [["Name", "Jan 2026"], ["Ann", "0.500"]];
    const out = gridToForecastRows(grid, { ...wide, periodCols: [1] }, "S");
    expect(out.rows.map((r) => r.hours)).toEqual([0.5]);
  });
});

describe("gridToForecastRows — long", () => {
  const long: ColumnMapping = {
    layout: "long",
    headerRow: 0,
    person: 0,
    email: 1,
    rate: 2,
    period: 3,
    hours: 4,
  };

  it("maps every field of a long grid", () => {
    const grid = [
      ["Name", "Email", "Rate", "Month", "Hours"],
      ["Ann", "ann@x.io", "95", "2026-01", "10"],
      ["Ann", "ann@x.io", "95", "Feb 2026", "0"],
      ["Bob", "", "", "KW03 2026", "4.5"],
    ];
    const out = gridToForecastRows(grid, long, "S");
    expect(out.rows).toEqual([
      { person: "Ann", email: "ann@x.io", rate: 95, period: "2026-01", hours: 10, source: "S!E2" },
      { person: "Ann", email: "ann@x.io", rate: 95, period: "2026-02", hours: 0, source: "S!E3" },
      { person: "Bob", period: "2026-W03", hours: 4.5, source: "S!E4" },
    ]);
    expect(out.dropped).toEqual([]);
  });

  it("drops total rows, blank persons, bad periods and bad numbers; a blank hours cell is no row", () => {
    const grid = [
      ["Name", "Email", "Rate", "Month", "Hours"],
      ["Summe", "", "", "", "20"],
      ["", "", "", "2026-01", "5"],
      ["Ann", "", "", "Q1 2026", "5"],
      ["Ann", "", "", "2026-01", "lots"],
      ["Ann", "", "", "2026-02", ""],
      ["Ann", "", "", "2026-03", "1.234,5"],
    ];
    const out = gridToForecastRows(grid, long, "S");
    expect(out.rows).toEqual([{ person: "Ann", period: "2026-03", hours: 1234.5, source: "S!E7" }]);
    expect(out.dropped).toEqual([
      { row: 2, reason: "total" },
      { row: 3, reason: "blank-person" },
      { row: 4, reason: "bad-period" },
      { row: 5, reason: "bad-number" },
    ]);
  });

  it("works without email and rate columns and with ragged rows", () => {
    const grid = [["Name", "Month", "Hours"], ["Ann", "2026-01"], ["Ann", "2026-02", "3"]];
    const out = gridToForecastRows(grid, { layout: "long", headerRow: 0, person: 0, period: 1, hours: 2 }, "S");
    expect(out.rows).toEqual([{ person: "Ann", period: "2026-02", hours: 3, source: "S!C3" }]);
  });
});

// §500 fix wave 2 (CR I2): a long sheet whose year sits in its own column.
describe("gridToForecastRows — a long sheet's year column", () => {
  const mapping: ColumnMapping = { layout: "long", headerRow: 0, person: 0, yearCol: 1, period: 2, hours: 3, year: 2026 };

  it("combines a year-less period with that row's year, whatever the default year", () => {
    const grid = [["Name", "Jahr", "Monat", "Stunden"], ["Ann", "2027", "Jan", "8"], ["Ann", "2028", "KW03", "4"]];
    expect(gridToForecastRows(grid, mapping, "S").rows.map((r) => r.period)).toEqual(["2027-01", "2028-W03"]);
  });

  it("keeps a period's own year, and falls back to the default year on a blank year cell", () => {
    const grid = [["Name", "Jahr", "Monat", "Stunden"], ["Ann", "2027", "Feb 2028", "8"], ["Ann", "", "Mär", "4"]];
    expect(gridToForecastRows(grid, mapping, "S").rows.map((r) => r.period)).toEqual(["2028-02", "2026-03"]);
  });
});

// §500 fix wave 2 (CR I2): the preview says which year it assumed.
describe("gridToForecastRows — the year it assumed", () => {
  const wide = (header: string[]): ColumnMapping => ({
    layout: "wide", headerRow: 0, person: 0, periodCols: header.map((_, i) => i).slice(1), year: 2026,
  });

  it("reports the default year when a read period took its year from it", () => {
    const grid = [["Name", "Jan", "Feb"], ["Ann", "1", "2"]];
    expect(gridToForecastRows(grid, wide(grid[0]), "S").assumedYear).toEqual({ year: 2026, rolled: false });
  });

  it("says so when the run rolled into the next year", () => {
    const grid = [["Name", "Dez", "Jan"], ["Ann", "1", "2"]];
    expect(gridToForecastRows(grid, wide(grid[0]), "S").assumedYear).toEqual({ year: 2026, rolled: true });
  });

  it("reports nothing when every period names its year, or a year column supplies it", () => {
    const labelled = [["Name", "Jan 2026", "Feb"], ["Ann", "1", "2"]];
    expect(gridToForecastRows(labelled, wide(labelled[0]), "S").assumedYear).toBeUndefined();
    const long = [["Name", "Jahr", "Monat", "Stunden"], ["Ann", "2027", "Jan", "8"]];
    const mapping: ColumnMapping = { layout: "long", headerRow: 0, person: 0, yearCol: 1, period: 2, hours: 3, year: 2026 };
    expect(gridToForecastRows(long, mapping, "S").assumedYear).toBeUndefined();
  });

  it("reports nothing for a year-less period whose cell is blank", () => {
    const grid = [["Name", "Jan 2026", "Feb 2026", "Mär"], ["Ann", "1", "2", ""]];
    expect(gridToForecastRows(grid, wide(grid[0]), "S").assumedYear).toBeUndefined();
  });
});

// Round 3 (rr2 Minor 5): neither an employee-number column nor a year column is
// "hours left out".
describe("gridToForecastRows — columns that are never hours", () => {
  it("does not report an ID column: PersNr | Name | Jan 2026 …", () => {
    const grid = [["PersNr", "Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["1001", "Ann", "1", "2", "3"], ["1002", "Bob", "4", "5", "6"]];
    const mapping: ColumnMapping = { layout: "wide", headerRow: 0, person: 1, periodCols: [2, 3, 4] };
    expect(gridToForecastRows(grid, mapping, "S").ignoredColumns).toEqual([]);
    for (const header of ["Personalnummer", "Pers.-Nr.", "MA-Nr", "ID", "Nr", "No", "Employee ID"]) {
      const g = [[header, ...grid[0].slice(1)], ...grid.slice(1)];
      expect(gridToForecastRows(g, mapping, "S").ignoredColumns).toEqual([]);
    }
  });

  it("does not report a long sheet's year column when the periods name their own year", () => {
    const grid = [["Name", "Jahr", "Monat", "Stunden"], ["Ann", "2026", "Jan 2026", "8"]];
    const mapping: ColumnMapping = { layout: "long", headerRow: 0, person: 0, period: 2, hours: 3 };
    expect(gridToForecastRows(grid, mapping, "S").ignoredColumns).toEqual([]);
    const unnamed = [["Name", "Basis", "Monat", "Stunden"], ["Ann", "2026", "Jan 2026", "8"]];
    expect(gridToForecastRows(unnamed, mapping, "S").ignoredColumns).toEqual([]);
  });
});
