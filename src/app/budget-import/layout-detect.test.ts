import { describe, expect, it } from "vitest";
import { gridToForecastRows } from "./forecast-rows";
import { DETECTION_SAMPLE_ROWS, detectLayout } from "./layout-detect";
import { parseDelimited } from "./sheet-grid";

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

  // Reviewer probe (§500 final review): "Mrz" is how a German Excel abbreviates
  // March, and an unknown month header silently dropped the month.
  it("reads a German CSV whose March is \"Mrz 26\"", () => {
    const grid = parseDelimited("Mitarbeiter;Jan 26;Feb 26;Mrz 26;Apr 26\r\nAnn;1;2;3;4\r\n");
    const { mapping } = detectLayout(grid);
    expect(mapping?.periodCols).toEqual([1, 2, 3, 4]);
    expect(gridToForecastRows(grid, mapping!, "S").rows.map((r) => r.period)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04",
    ]);
  });

  it("reads month headers without a year under a default year, and only then", () => {
    const grid = [["Name", "Jan", "Feb", "Mär"], ["Ann", "10", "20", "30"]];
    const out = detectLayout(grid, { defaultYear: 2026 });
    expect(out.kind).toBe("wide");
    expect(out.mapping).toEqual({ layout: "wide", headerRow: 0, person: 0, periodCols: [1, 2, 3], year: 2026 });
    expect(gridToForecastRows(grid, out.mapping!, "S").rows.map((r) => r.period)).toEqual([
      "2026-01", "2026-02", "2026-03",
    ]);
    expect(detectLayout(grid)).toEqual({ kind: "unknown", mapping: null, ambiguous: [] });
  });

  it("reads a long sheet of year-less months under a default year", () => {
    const grid = [["Name", "Monat", "Stunden"], ["Ann", "Jan", "4"], ["Ann", "Feb", "5"]];
    expect(detectLayout(grid, { defaultYear: 2026 }).mapping).toEqual({
      layout: "long", headerRow: 0, person: 0, period: 1, hours: 2, year: 2026,
    });
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
    expect(detectLayout(grid)).toEqual({ kind: "unknown", mapping: null, ambiguous: [] });
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

  // Fix 8: the hours word only preselects; two number columns always ask.
  it("preselects the hours-looking header when two numeric columns qualify, and asks", () => {
    const grid = [
      ["Name", "Month", "Cost", "Hrs"],
      ["Ann", "2026-01", "7600", "80"],
      ["Ann", "2026-02", "6840", "72"],
    ];
    expect(detectLayout(grid)).toMatchObject({ mapping: { period: 1, hours: 3 }, ambiguous: [{ field: "hours", candidates: [2, 3] }] });
  });

  // Fix 7: the rightmost pick of final review I3 imported the constant,
  // rate-like 95 here. The leftmost is the default again, and the choice is
  // left to the user (`ambiguous`).
  it("takes the first numeric column as hours when no header says so, and asks", () => {
    const grid = [
      ["Name", "Month", "A", "B"],
      ["Ann", "2026-01", "80", "95"],
      ["Ann", "2026-02", "72", "95"],
    ];
    const detected = detectLayout(grid);
    expect(detected.mapping).toMatchObject({ period: 1, hours: 2 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
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
    expect(detectLayout(grid)).toEqual({ kind: "unknown", mapping: null, ambiguous: [] });
  });

  it("rejects an empty grid and empty rows", () => {
    expect(detectLayout([])).toEqual({ kind: "unknown", mapping: null, ambiguous: [] });
    expect(detectLayout([[], []])).toEqual({ kind: "unknown", mapping: null, ambiguous: [] });
  });

  it("rejects a name list with numbers but no periods", () => {
    const grid = [["Name", "Hours"], ["Ann", "80"], ["Bob", "72"]];
    expect(detectLayout(grid)).toEqual({ kind: "unknown", mapping: null, ambiguous: [] });
  });
});

// §500 fix wave 2 (CR minor 7): a column headed Name beats the first text column.
describe("detectLayout — the person column by its header", () => {
  it("takes Name over a Team column left of it in a wide sheet", () => {
    const rows = [["Team", "Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["Dev", "Ann Lee", "1", "2", "3"]];
    expect(detectLayout(rows).mapping).toMatchObject({ layout: "wide", person: 1 });
  });

  it("takes Mitarbeiter over a Team column in a long sheet", () => {
    const rows = [["Team", "Mitarbeiter", "Monat", "Stunden"], ["Dev", "Ann Lee", "Jan 2026", "8"]];
    expect(detectLayout(rows).mapping).toMatchObject({ layout: "long", person: 1 });
  });
});

// §500 fix wave 2 (CR I2): a long sheet whose year sits in its own column.
describe("detectLayout — a year column beside year-less periods", () => {
  it("maps a Jahr column next to a Monat column of month names", () => {
    const rows = [["Name", "Jahr", "Monat", "Stunden"], ["Ann", "2027", "Jan", "8"], ["Ann", "2027", "Feb", "4"]];
    for (const defaultYear of [undefined, 2026]) {
      expect(detectLayout(rows, { defaultYear })).toMatchObject({
        kind: "long",
        mapping: { layout: "long", person: 0, yearCol: 1, period: 2, hours: 3 },
      });
    }
  });

  it("finds a column of four-digit years by its data when no header names it", () => {
    const rows = [["Name", "Basis", "Monat", "Wert"], ["Ann", "2027", "Jan", "8"], ["Bob", "2028", "Feb", "4"]];
    expect(detectLayout(rows).mapping).toMatchObject({ yearCol: 1, period: 2, hours: 3 });
  });

  it("maps no year column when every period cell names its own year", () => {
    const rows = [["Name", "Jahr", "Monat", "Stunden"], ["Ann", "2027", "Jan 2027", "8"]];
    const mapping = detectLayout(rows).mapping;
    expect(mapping).toMatchObject({ layout: "long", period: 2, hours: 3 });
    expect(mapping?.yearCol).toBeUndefined();
  });
});

// Final review M1: detection scored every candidate header over ALL data rows,
// which froze the dialog on a large workbook. It samples the first
// DETECTION_SAMPLE_ROWS rows under each candidate; reading stays complete.
describe("detectLayout — samples the rows under a candidate header (final review M1)", () => {
  const months = ["2026-01", "2026-02", "2026-03"];
  const longRows = (n: number, hours: (i: number) => string = () => "10"): string[][] => [
    ["Name", "Monat", "Stunden"],
    ...Array.from({ length: n }, (_, i) => [`P${i}`, months[i % 3], hours(i)]),
  ];
  const wideRows = (n: number): string[][] => [
    ["Name", "Jan 2026", "Feb 2026", "Mar 2026"],
    ...Array.from({ length: n }, (_, i) => [`P${i}`, "1", "2", "3"]),
  ];

  it("samples 200 rows", () => {
    expect(DETECTION_SAMPLE_ROWS).toBe(200);
  });

  it("detects a wide and a long sheet past the sample as it does a short one, and reads every row", () => {
    const n = DETECTION_SAMPLE_ROWS + 100;
    for (const [short, long] of [[wideRows(2), wideRows(n)], [longRows(2), longRows(n)]]) {
      const detected = detectLayout(long);
      expect(detected).toEqual(detectLayout(short));
      const perRow = detected.mapping?.layout === "wide" ? 3 : 1;
      expect(gridToForecastRows(long, detected.mapping!, "S").rows).toHaveLength(n * perRow);
    }
  });

  it("judges the columns by the sample: text past it does not unseat the hours column", () => {
    // Over all 300 rows the Stunden column is two-thirds numbers, below the
    // 80 % a column needs; over the sample it is all numbers.
    const rows = longRows(DETECTION_SAMPLE_ROWS + 100, (i) => (i < DETECTION_SAMPLE_ROWS ? "10" : "n/a"));
    const detected = detectLayout(rows);
    expect(detected.mapping).toMatchObject({ layout: "long", period: 1, hours: 2 });
    const out = gridToForecastRows(rows, detected.mapping!, "S");
    expect(out.rows).toHaveLength(DETECTION_SAMPLE_ROWS);
    expect(out.dropped).toHaveLength(100);
  });

  // Fix 7 (rr6 N5): blank rows under the header are skipped, not counted, so a
  // sheet whose data starts after 210 blank rows is still sampled.
  it("skips blank rows under the header: 210 blank rows, then the data, detect as without them", () => {
    const blanks = Array.from({ length: 210 }, (_, i) => (i % 2 === 0 ? [] : ["", "", ""]));
    for (const rows of [wideRows(3), longRows(3)]) {
      const padded = [rows[0], ...blanks, ...rows.slice(1)];
      expect(detectLayout(padded)).toEqual(detectLayout(rows));
      expect(detectLayout(padded).kind).not.toBe("unknown");
    }
  });
});

// Fix 7 (owner decision 2026-10-13): when more than one column could be a long
// sheet's hours or period column, detection says so instead of guessing. The
// mapping it returns is the deterministic default; the dialog asks.
describe("detectLayout — ambiguous hours or period columns (fix 7)", () => {
  const months = ["Jan 2026", "Feb 2026", "Mär 2026"];
  /** `Name | Monat | x | y`, Ann and Bob over three months (rr6 N1). */
  const twoFigures = (x: string, y: string, xs: readonly string[], ys: readonly string[]): string[][] => [
    ["Name", "Monat", x, y],
    ...["Ann Lee", "Bob Kay"].flatMap((p) => months.map((m, i) => [p, m, xs[i], ys[i]])),
  ];
  const PLAN = ["40", "35", "30"];

  it.each([
    ["Plan", "Ist", ["35", "30", "25"]],
    ["Soll", "Ist", ["35", "30", "25"]],
    ["Forecast", "Ist", ["35", "30", "25"]],
    ["Forecast", "Actual", ["35", "30", "25"]],
    ["h", "Betrag", ["400", "350", "300"]],
    ["Menge", "Summe", ["100", "101", "102"]],
    ["Menge", "kumuliert", ["40", "80", "120"]],
  ] as const)("%s | %s: both columns are hours candidates, the left one preselected", (x, y, ys) => {
    const detected = detectLayout(twoFigures(x, y, PLAN, ys), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "long", period: 1, hours: 2 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  it("Plan | Ist in a workbook asks too", () => {
    const detected = detectLayout(twoFigures("Plan", "Ist", PLAN, ["35", "30", "25"]), { numbers: "dot", defaultYear: 2026 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  // Fix 8 (owner decision 2026-10-13, rr8 N2): no header word settles the
  // hours. Each round's "named hours column" escape let a new actuals
  // spelling through (`Ist`, then `Iststunden`, `Gebuchte Stunden` …).
  it("asks for Plan | Stunden too, Stunden preselected: one hours word settles nothing", () => {
    const detected = detectLayout(twoFigures("Plan", "Stunden", ["35", "30", "25"], PLAN), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ hours: 3 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  it.each(["Iststunden", "IstStd", "Gebuchte Stunden", "Geleistete Stunden", "Spent hours", "Logged hours"])(
    "Forecast | %s asks (rr8 N2): a second number column is a choice, whatever its header", (actuals) => {
      const detected = detectLayout(twoFigures("Forecast", actuals, PLAN, ["35", "30", "25"]), { defaultYear: 2026 });
      expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    },
  );

  it("asks for Name | Monat | Stunden | Kosten, Stunden preselected", () => {
    const detected = detectLayout(twoFigures("Stunden", "Kosten", PLAN, ["4000", "3500", "3000"]), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ hours: 2 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  it("asks when two candidates are headed by an hours word: Stunden | Std Plan", () => {
    const detected = detectLayout(twoFigures("Stunden", "Std Plan", PLAN, ["35", "30", "25"]), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ hours: 2 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  // The preselection is the leftmost column with an hours word, else the
  // leftmost; the user confirms it either way.
  it.each([
    ["Forecast | Ist-Stunden", "Forecast", "Ist-Stunden", 3],
    ["Forecast | Actuals (h)", "Forecast", "Actuals (h)", 2],
    ["Forecast | Booked hours", "Forecast", "Booked hours", 3],
    ["Stunden | Ist", "Stunden", "Ist", 2],
    ["Stunden | Std Ist", "Stunden", "Std Ist", 2],
    ["Soll-Stunden | Ist-Stunden", "Soll-Stunden", "Ist-Stunden", 2],
    ["Plan-Std | Ist-Std", "Plan-Std", "Ist-Std", 2],
    ["Ist-Stunden | Plan stunden", "Ist-Stunden", "Plan stunden", 2],
  ] as const)("%s asks, the preselection by the hours word", (_label, x, y, hours) => {
    const detected = detectLayout(twoFigures(x, y, PLAN, ["35", "30", "25"]), { defaultYear: 2026 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    expect(detected.mapping).toMatchObject({ hours });
  });

  it("a lone actuals column is still the hours: Name | Monat | Ist-Stunden", () => {
    const detected = detectLayout(twoFigures("Ist-Stunden", "", PLAN, ["", "", ""]), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ hours: 2 });
    expect(detected.ambiguous).toEqual([]);
  });

  it.each([
    ["Name | Monat | Stunden", [["Name", "Monat", "Stunden"], ["Ann", "Jan 2026", "40"], ["Ann", "Feb 2026", "30"]]],
    ["Name | Start date | Month | Hours", [["Name", "Start date", "Month", "Hours"], ["Ann", "01.01.2026", "Jan 2026", "80"], ["Ann", "01.01.2026", "Feb 2026", "60"]]],
    ["ID | Name | Month | Effort", [["ID", "Name", "Month", "Effort"], ["12", "Ann", "Jan 2026", "40"], ["14", "Bob", "Jan 2026", "20"]]],
    ["Nr | Name | Monat | Aufwand", [["Nr", "Name", "Monat", "Aufwand"], ["1", "Ann", "Jan 2026", "40"], ["2", "Bob", "Jan 2026", "20"]]],
    ["Name | Start | Zeitraum | Stunden", [["Name", "Start", "Zeitraum", "Stunden"], ["Ann", "01.01.2026", "01.01.2026", "80"], ["Ann", "01.01.2026", "01.02.2026", "60"]]],
    ["Name | Jahr | Monat | Wert | Basisjahr", [["Name", "Jahr", "Monat", "Wert", "Basisjahr"], ["Ann", "2026", "Jan", "40", "2025"], ["Ann", "2026", "Feb", "30", "2025"]]],
    ["Name | Start | Jan 2026 | Feb 2026 (wide)", [["Name", "Start", "Jan 2026", "Feb 2026"], ["Ann", "01.03.2026", "40", "50"], ["Bob", "01.05.2026", "30", "20"]]],
  ])("%s is clear", (_label, rows) => {
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([]);
  });

  it("asks which date column is the period: Datum | Eintritt, Datum preselected (CSV)", () => {
    const rows = [
      ["Name", "Datum", "Eintritt", "Stunden"],
      ["Ann Lee", "01.01.2026", "03/2026", "40"], ["Ann Lee", "01.02.2026", "03/2026", "35"], ["Ann Lee", "01.03.2026", "03/2026", "30"],
      ["Bob Kay", "01.01.2026", "03/2026", "30"], ["Bob Kay", "01.02.2026", "03/2026", "25"],
    ];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "long", period: 1, hours: 3 });
    expect(detected.ambiguous).toEqual([{ field: "period", candidates: [1, 2] }]);
  });

  it("asks the same with Datum and Eintritt as workbook serials", () => {
    const rows = [
      ["Name", "Datum", "Eintritt", "Stunden"],
      ["Ann Lee", "46023", "46082", "40"], ["Ann Lee", "46054", "46082", "35"], ["Bob Kay", "46023", "46082", "30"],
    ];
    const detected = detectLayout(rows, { numbers: "dot", defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "long", period: 1, hours: 3 });
    expect(detected.ambiguous).toEqual([{ field: "period", candidates: [1, 2] }]);
  });

  it("asks for Datum | Startmonat: a month word inside a longer word is no period word", () => {
    const rows = [
      ["Name", "Datum", "Startmonat", "Stunden"],
      ["Ann Lee", "01.01.2026", "Mär 2026", "40"], ["Ann Lee", "01.02.2026", "Mär 2026", "35"],
    ];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ period: 1 });
    expect(detected.ambiguous).toEqual([{ field: "period", candidates: [1, 2] }]);
  });

  it("is clear when exactly one period candidate is headed by a period word: Start date | Month, both of dates", () => {
    const rows = [["Name", "Start date", "Month", "Hours"], ["Ann", "15.01.2026", "01.01.2026", "80"], ["Ann", "15.01.2026", "01.02.2026", "60"]];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ period: 2 });
    expect(detected.ambiguous).toEqual([]);
  });

  // A2: the rank that put period LABELS above full dates is gone; header
  // words rank, then the leftmost.
  it("ranks by header word, not by label cells: Beginn | Wann asks, the leftmost preselected", () => {
    const rows = [["Name", "Beginn", "Wann", "Stunden"], ["Ann", "01.01.2026", "Jan 2026", "80"], ["Ann", "01.01.2026", "Feb 2026", "60"]];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ period: 1, hours: 3 });
    expect(detected.ambiguous).toEqual([{ field: "period", candidates: [1, 2] }]);
  });

  it("reports both fields when both are ambiguous", () => {
    const rows = [
      ["Name", "Datum", "Eintritt", "Plan", "Ist"],
      ["Ann", "01.01.2026", "03/2026", "40", "35"], ["Ann", "01.02.2026", "03/2026", "35", "30"],
    ];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([
      { field: "period", candidates: [1, 2] },
      { field: "hours", candidates: [3, 4] },
    ]);
  });

  it("reports no ambiguity on a wide sheet", () => {
    expect(detectLayout(GERMAN_WIDE).ambiguous).toEqual([]);
  });
});
