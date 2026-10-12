import { describe, expect, it } from "vitest";
import { gridToForecastRows } from "./forecast-rows";
import { detectLayout } from "./layout-detect";

const GERMAN_WIDE = [
  ["Name", "Jan 2026", "Feb 2026", "Gesamt"],
  ["Ann", "1.234,5", "0", ""],
  ["Gesamt", "1.234,5", "0", ""],
];

describe("detectLayout — wide", () => {
  it("maps the German wide grid: Gesamt is no period column", () => {
    const out = detectLayout(GERMAN_WIDE);
    expect(out.kind).toBe("wide");
    expect(out.mapping).toEqual({ layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2] });
  });

  it("agrees with gridToForecastRows end to end", () => {
    const { mapping } = detectLayout(GERMAN_WIDE);
    expect(mapping).not.toBeNull();
    const out = gridToForecastRows(GERMAN_WIDE, mapping!, "S");
    expect(out.rows).toEqual([
      { person: "Ann", period: "2026-01", hours: 1234.5, source: "S!B2" },
      { person: "Ann", period: "2026-02", hours: 0, source: "S!C2" },
    ]);
    expect(out.dropped).toEqual([{ row: 3, reason: "total" }]);
  });

  it("reads a workbook's stored numbers with a dot, so 2.625 does not unseat the hours", () => {
    const grid = [
      ["Name", "Jan 2026", "Feb 2026", "Mar 2026"],
      ["Ann", "7.5", "2.625", "40"],
      ["Bob", "37.5", "12", "8"],
    ];
    expect(detectLayout(grid, { numbers: "dot" }).mapping).toEqual({
      layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2, 3],
    });
    // The same cells from a CSV read German, and two of six are not numbers.
    expect(detectLayout(grid).kind).toBe("unknown");
  });

  it("finds the header below a title row and a blank row", () => {
    const grid = [
      ["Forecast Q1"],
      [],
      ["Name", "Jan 2026", "Feb 2026", "Mar 2026"],
      ["Ann", "10", "20", "30"],
    ];
    const out = detectLayout(grid);
    expect(out.kind).toBe("wide");
    expect(out.mapping).toEqual({ layout: "wide", headerRow: 2, person: 0, periodCols: [1, 2, 3] });
  });

  it("maps email and rate columns left of the periods, person being the text column", () => {
    const grid = [
      ["Email", "Resource", "Rate (EUR/h)", "2026-01", "2026-02", "2026-03", "Total"],
      ["ann@x.de", "Ann", "95", "10", "20", "30", "60"],
      ["bob@x.de", "Bob", "85", "5", "5", "5", "15"],
      ["", "Total", "", "15", "25", "35", "75"],
    ];
    expect(detectLayout(grid).mapping).toEqual({
      layout: "wide",
      headerRow: 0,
      person: 1,
      email: 0,
      rate: 2,
      periodCols: [3, 4, 5],
    });
  });

  it("detects an email column by its data when the header does not say so", () => {
    const grid = [
      ["Who", "Contact", "Jan 2026", "Feb 2026", "Mar 2026"],
      ["Ann", "ann@x.de", "1", "2", "3"],
      ["Bob", "bob@x.de", "1", "2", "3"],
    ];
    expect(detectLayout(grid).mapping).toMatchObject({ person: 0, email: 1, periodCols: [2, 3, 4] });
  });

  it("skips a numeric id column when choosing the person column", () => {
    const grid = [
      ["No.", "Name", "KW01 2026", "KW02 2026", "KW03 2026"],
      ["101", "Ann", "8", "8", "8"],
      ["102", "Bob", "8", "8", "8"],
      ["", "Summe", "16", "16", "16"],
    ];
    expect(detectLayout(grid).mapping).toMatchObject({
      layout: "wide",
      person: 1,
      periodCols: [2, 3, 4],
    });
  });

  it("does not let a total row's numbers or text decide the person column", () => {
    const grid = [
      ["Id", "Name", "Jan 2026", "Feb 2026", "Mar 2026"],
      ["1", "Ann", "1", "1", "1"],
      ["Total", "Total", "1", "1", "1"],
    ];
    expect(detectLayout(grid).mapping?.person).toBe(1);
  });

  it("copes with ragged rows", () => {
    const grid = [["Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["Ann", "1"], [], ["Bob"]];
    expect(detectLayout(grid).mapping).toMatchObject({ person: 0, periodCols: [1, 2, 3] });
  });

  it("is unknown when no column left of the periods is text", () => {
    const grid = [["Jan 2026", "Feb 2026", "Mar 2026"], ["1", "2", "3"]];
    expect(detectLayout(grid)).toEqual({ kind: "unknown", mapping: null });
  });
});

describe("detectLayout — long", () => {
  it("maps email / period / hours / rate", () => {
    const grid = [
      ["Email", "Month", "Hours", "Rate"],
      ["a@x.de", "2026-01", "80", "95"],
      ["a@x.de", "2026-02", "72", "95"],
      ["b@x.de", "2026-01", "40", "85"],
    ];
    const out = detectLayout(grid);
    expect(out.kind).toBe("long");
    expect(out.mapping).toEqual({
      layout: "long",
      headerRow: 0,
      person: 0,
      email: 0,
      period: 1,
      hours: 2,
      rate: 3,
    });
  });

  it("agrees with gridToForecastRows end to end", () => {
    const grid = [
      ["Name", "Monat", "Stunden"],
      ["Ann", "Jan 2026", "1.234,5"],
      ["Ann", "Feb 2026", "80"],
    ];
    const { mapping } = detectLayout(grid);
    expect(mapping).toEqual({ layout: "long", headerRow: 0, person: 0, period: 1, hours: 2 });
    const out = gridToForecastRows(grid, mapping!, "S");
    expect(out.rows.map((r) => [r.person, r.period, r.hours])).toEqual([
      ["Ann", "2026-01", 1234.5],
      ["Ann", "2026-02", 80],
    ]);
  });

  it("prefers the hours-looking header when two numeric columns qualify", () => {
    const grid = [
      ["Name", "Month", "Cost", "Hrs"],
      ["Ann", "2026-01", "7600", "80"],
      ["Ann", "2026-02", "6840", "72"],
    ];
    expect(detectLayout(grid).mapping).toMatchObject({ period: 1, hours: 3 });
  });

  it("takes the first numeric column as hours when no header says so", () => {
    const grid = [
      ["Name", "Month", "A", "B"],
      ["Ann", "2026-01", "80", "95"],
      ["Ann", "2026-02", "72", "95"],
    ];
    expect(detectLayout(grid).mapping).toMatchObject({ period: 1, hours: 2 });
  });

  it("prefers a period-looking header when two columns parse as periods", () => {
    const grid = [
      ["Name", "Start", "Month", "Hours"],
      ["Ann", "2026-01-01", "2026-01", "80"],
      ["Ann", "2026-02-01", "2026-02", "72"],
    ];
    expect(detectLayout(grid).mapping).toMatchObject({ period: 2, hours: 3 });
  });

  it("does not mistake a column of large numbers for the period column", () => {
    const grid = [
      ["Name", "Budget", "Month", "Hours"],
      ["Ann", "25000", "Jan 2026", "80"],
      ["Bob", "30000", "Jan 2026", "72"],
    ];
    expect(detectLayout(grid).mapping).toMatchObject({ period: 2, hours: 3 });
  });

  it("finds the header below a title row and ignores a total row", () => {
    const grid = [
      ["Forecast"],
      ["Name", "Month", "Hours"],
      ["Ann", "2026-01", "80"],
      ["Ann", "2026-02", "72"],
      ["Total", "", "152"],
    ];
    expect(detectLayout(grid).mapping).toMatchObject({ headerRow: 1, person: 0, period: 1, hours: 2 });
  });

  it("tolerates one bad period cell out of ten", () => {
    const body = Array.from({ length: 9 }, (_, i) => ["Ann", `2026-0${i + 1}`, "10"]);
    const grid = [["Name", "Month", "Hours"], ...body, ["Ann", "soon", "10"]];
    expect(detectLayout(grid).kind).toBe("long");
  });

  /** A header, then 8 good rows, with one unparseable period cell put at `badAt` (1-based data row). */
  const withBadPeriod = (badAt: number, bad: string): string[][] => {
    const body = Array.from({ length: 8 }, (_, i) => ["Ann", `2026-0${i + 1}`, "10"]);
    body.splice(badAt - 1, 1, ["Ann", bad, "10"]);
    return [["Name", "Month", "Hours"], ...body];
  };

  it("never takes a data row as the header: a bad period at data row 3 keeps headerRow 0", () => {
    const grid = withBadPeriod(3, "soon");
    const { mapping } = detectLayout(grid);
    expect(mapping).toMatchObject({ layout: "long", headerRow: 0, period: 1, hours: 2 });
    const out = gridToForecastRows(grid, mapping!, "S");
    expect(out.rows).toHaveLength(7);
    expect(out.rows.map((r) => r.period)).not.toContain("2026-03");
    expect(out.dropped).toEqual([{ row: 4, reason: "bad-period" }]);
  });

  it("keeps headerRow 0 for a bad period at data row 1", () => {
    expect(detectLayout(withBadPeriod(1, "TBD")).mapping).toMatchObject({ headerRow: 0 });
  });

  it("keeps headerRow 0 for a bad period at the last data row", () => {
    expect(detectLayout(withBadPeriod(8, "TBD")).mapping).toMatchObject({ headerRow: 0 });
  });
});

describe("detectLayout — date-heavy and titled sheets", () => {
  const DATE_HEAVY = [
    ["Name", "Start", "End", "Month", "Hours"],
    ["Ann", "2026-01-01", "2026-01-28", "2026-01", "80"],
    ["Bob", "2026-01-01", "2026-01-28", "2026-02", "40"],
    ["Cid", "2026-02-01", "2026-02-28", "2026-02", "72"],
  ];

  it("does not take a long sheet's data row with three dates as a wide header", () => {
    const out = detectLayout(DATE_HEAVY);
    expect(out.kind).toBe("long");
    expect(out.mapping).toEqual({
      layout: "long",
      headerRow: 0,
      person: 0,
      period: 3,
      hours: 4,
    });
  });

  it("agrees with gridToForecastRows end to end on the date-heavy long sheet", () => {
    const { mapping } = detectLayout(DATE_HEAVY);
    expect(mapping).not.toBeNull();
    const out = gridToForecastRows(DATE_HEAVY, mapping!, "S");
    expect(out.rows.map((r) => [r.person, r.period, r.hours])).toEqual([
      ["Ann", "2026-01", 80],
      ["Bob", "2026-02", 40],
      ["Cid", "2026-02", 72],
    ]);
    expect(out.dropped).toEqual([]);
  });

  it("still reads a wide sheet whose data cells are numbers or blanks", () => {
    const grid = [
      ["Name", "Jan 2026", "Feb 2026", "Mar 2026"],
      ["Ann", "", "20", ""],
      ["Bob", "1.234,5", "", "3"],
    ];
    expect(detectLayout(grid).mapping).toMatchObject({ layout: "wide", headerRow: 0 });
  });

  it("picks the real header under a full-width title row", () => {
    const grid = [
      ["Project", "Alpha", "Beta"],
      ["Name", "Month", "Hours"],
      ["Ann", "2026-01", "80"],
      ["Ann", "2026-02", "72"],
      ["Bob", "2026-01", "40"],
      ["Bob", "2026-02", "40"],
      ["Cid", "2026-01", "8"],
    ];
    expect(detectLayout(grid).mapping).toEqual({
      layout: "long",
      headerRow: 1,
      person: 0,
      period: 1,
      hours: 2,
    });
  });
});

describe("detectLayout — rate header", () => {
  it("does not take a word that merely contains 'rate' as the rate column", () => {
    const grid = [
      ["Name", "Month", "Generated", "Hours"],
      ["Ann", "2026-01", "3", "80"],
      ["Ann", "2026-02", "4", "72"],
    ];
    const mapping = detectLayout(grid).mapping;
    expect(mapping).toMatchObject({ layout: "long", period: 1, hours: 3 });
    expect(mapping?.rate).toBeUndefined();
  });

  it("still takes Rate and Stundensatz as the rate column", () => {
    const rate = detectLayout([
      ["Name", "Month", "Hours", "Rate"],
      ["Ann", "2026-01", "80", "95"],
    ]);
    expect(rate.mapping?.rate).toBe(3);
    const satz = detectLayout([
      ["Name", "Monat", "Stunden", "Stundensatz"],
      ["Ann", "2026-01", "80", "95"],
    ]);
    expect(satz.mapping).toMatchObject({ hours: 2, rate: 3 });
  });

  it("takes the plural 'Rates' as the rate column", () => {
    const grid = [
      ["Name", "Month", "Hours", "Rates"],
      ["Ann", "2026-01", "80", "95"],
    ];
    expect(detectLayout(grid).mapping?.rate).toBe(3);
  });

  it("does not take 'Corporate' as the rate column of a wide sheet", () => {
    const grid = [
      ["Name", "Corporate", "Jan 2026", "Feb 2026", "Mar 2026"],
      ["Ann", "ACME", "1", "2", "3"],
    ];
    expect(detectLayout(grid).mapping?.rate).toBeUndefined();
  });
});

describe("detectLayout — unknown", () => {
  it("rejects a prose grid", () => {
    const grid = [
      ["Dear team"],
      ["please find the forecast attached", "kind regards"],
      [],
      ["Ann"],
    ];
    expect(detectLayout(grid)).toEqual({ kind: "unknown", mapping: null });
  });

  it("rejects an empty grid and empty rows", () => {
    expect(detectLayout([])).toEqual({ kind: "unknown", mapping: null });
    expect(detectLayout([[], []])).toEqual({ kind: "unknown", mapping: null });
  });

  it("rejects a name list with numbers but no periods", () => {
    const grid = [["Name", "Hours"], ["Ann", "80"], ["Bob", "72"]];
    expect(detectLayout(grid)).toEqual({ kind: "unknown", mapping: null });
  });
});
