// §500 fix 8 — the owner's "fail closed" decision of 2026-10-13: a Claude claim
// is accepted only when EVERY period source for the cited cell agrees with it.
// The sources are H (the hand route's reading), U (the nearest period header
// above the cell) and R (the period cells on the cited row, counted only where
// there is no H). Any disagreement is a visible refusal, never a pick, and a
// sheet whose columns are ambiguous is refused until the user confirms them.
// Every test here pins a wrong number that must NOT be written.
import { describe, expect, it } from "vitest";
import { gridToForecastRows, repeatedHeaderRows } from "./forecast-rows";
import { validateForecastRows } from "./forecast-validate";
import { detectLayout } from "./layout-detect";
import type { NumberOrigin, SheetGrid } from "./sheet-grid";
import type { ColumnMapping } from "./forecast-types";

const sheetOf = (rows: string[][], numbers?: NumberOrigin): SheetGrid => ({ name: "S", rows, truncated: false, numbers });
const strictOn = (rows: string[][], numbers?: NumberOrigin, columns?: ColumnMapping) => ({
  sheet: sheetOf(rows, numbers),
  requireSource: true,
  defaultYear: 2026,
  ...(columns === undefined ? {} : { columns }),
});
const claim = (period: string, hours: number, source: string, person = "Ann") => ({ person, period, hours, source });
const detail = (out: ReturnType<typeof validateForecastRows>) =>
  out.rejected.map((r) => (r.reason === "source" ? r.detail : r.reason));
const periodsOf = (out: ReturnType<typeof validateForecastRows>) => out.ok.map((r) => [r.person, r.period, r.hours]);
/** Blank rows that push the real header past detection's ten-row scan: the
 *  detection is then unknown, so there is no H. */
const pad = (n: number): string[][] => Array.from({ length: n }, () => []);

describe("N1: stacked year blocks the hand route reads as one year (rr8 N1, residue 9)", () => {
  const sheets: Record<"csv" | "serials", { rows: string[][]; numbers: NumberOrigin }> = {
    csv: {
      rows: [["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"], ["Bob", "11", "21"], ["Name", "Jan 2027", "Feb 2027"], ["Ann", "30", "40"], ["Bob", "31", "41"]],
      numbers: "text",
    },
    serials: {
      rows: [["Name", "46023", "46054"], ["Ann", "10", "20"], ["Bob", "11", "21"], ["Name", "46388", "46419"], ["Ann", "30", "40"], ["Bob", "31", "41"]],
      numbers: "dot",
    },
  };
  const blockTwo = new Set([30, 31, 40, 41]);
  const neverBlockTwo = (out: ReturnType<typeof validateForecastRows>) => {
    expect(out.ok.filter((r) => blockTwo.has(r.hours))).toEqual([]);
    expect(out.ok.filter((r) => r.period.startsWith("2027"))).toEqual([]);
  };

  // Fix 9 OOS-c: the second header row makes detection ask; with header row 1
  // confirmed, the hand reading still reads block 2 as 2026, so the checks
  // below run with that confirmed mapping.
  const confirmedOn = (rows: string[][], numbers: NumberOrigin) =>
    strictOn(rows, numbers, detectLayout(rows, { numbers, defaultYear: 2026 }).mapping!);

  it.each(["csv", "serials"] as const)("the detection is wide and asks for the header row (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    expect(detectLayout(rows, { numbers, defaultYear: 2026 })).toMatchObject({
      kind: "wide", mapping: { headerRow: 0 }, ambiguous: [{ field: "header", candidates: [0, 3] }],
    });
  });

  it.each(["csv", "serials"] as const)("unconfirmed, every claim of either block is refused columns-unconfirmed (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([claim("Jan 2026", 10, "S!B2"), claim("Jan 2027", 30, "S!B5"), claim("Jan 2026", 30, "S!B5")], strictOn(rows, numbers));
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["columns-unconfirmed", "columns-unconfirmed", "columns-unconfirmed"]);
  });

  // Round 5: header row 1 confirmed, the repeated header row ends the reading,
  // so block 2's cells are not read at all (they were refused period-conflict).
  it.each(["csv", "serials"] as const)("P2a: the right 2027 claims for block 2 are refused, not read (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([claim("Jan 2027", 30, "S!B5"), claim("Feb 2027", 41, "S!C6", "Bob")], confirmedOn(rows, numbers));
    expect(out.ok).toEqual([]);
    expect(out.rejected).toEqual([
      { row: claim("Jan 2027", 30, "S!B5"), reason: "source", detail: "cell-not-read" },
      { row: claim("Feb 2027", 41, "S!C6", "Bob"), reason: "source", detail: "cell-not-read" },
    ]);
  });

  it.each(["csv", "serials"] as const)("P2b: wrong 2026 claims for block 2 are refused; block 1's right claim stands (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([
      claim("Jan 2026", 10, "S!B2"), claim("Jan 2026", 30, "S!B5"), claim("Feb 2026", 41, "S!C6", "Bob"),
    ], confirmedOn(rows, numbers));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 10]]);
    expect(detail(out)).toEqual(["cell-not-read", "cell-not-read"]);
    expect(out.duplicates).toEqual([]);
    neverBlockTwo(out);
  });

  it.each(["csv", "serials"] as const)("P2d: year-less Jan / Feb claims for block 2 are refused, not re-routed into 2026 (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([claim("Jan", 30, "S!B5"), claim("Feb", 41, "S!C6", "Bob")], confirmedOn(rows, numbers));
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["cell-not-read", "cell-not-read"]);
  });

  it.each(["csv", "serials"] as const)("P2f: a fully correct reading writes block 1 and refuses block 2 (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([
      claim("Jan 2026", 10, "S!B2"), claim("Feb 2026", 20, "S!C2"), claim("Jan 2026", 11, "S!B3", "Bob"), claim("Feb 2026", 21, "S!C3", "Bob"),
      claim("Jan 2027", 30, "S!B5"), claim("Feb 2027", 40, "S!C5"), claim("Jan 2027", 31, "S!B6", "Bob"), claim("Feb 2027", 41, "S!C6", "Bob"),
    ], confirmedOn(rows, numbers));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 10], ["Ann", "2026-02", 20], ["Bob", "2026-01", 11], ["Bob", "2026-02", 21]]);
    expect(detail(out)).toEqual(["cell-not-read", "cell-not-read", "cell-not-read", "cell-not-read"]);
    neverBlockTwo(out);
  });

  // Round 6: a second block under another person label (Mitarbeiter) is a
  // repeated header too, so its cells are not read either. It was read on in
  // round 5 and refused period-conflict, naming both periods.
  it("a second block under Mitarbeiter | Jan 2027, confirmed: block 2 is not read", () => {
    const rows = [["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"], ["Bob", "11", "21"], ["Mitarbeiter", "Jan 2027", "Feb 2027"], ["Ann", "30", "40"], ["Bob", "31", "41"]];
    const out = validateForecastRows([claim("Jan 2027", 30, "S!B5")], confirmedOn(rows, "text"));
    expect(out.rejected).toEqual([{ row: claim("Jan 2027", 30, "S!B5"), reason: "source", detail: "cell-not-read" }]);
  });
});

// rr8 OOS-1: title and key/value rows over a long sheet with two number
// columns. The hand route asks there, so the Claude route refuses every claim
// until the user confirms the columns.
describe("OOS-1: an ambiguous sheet is refused until its columns are confirmed", () => {
  const shapes = {
    "Erstellt von | Max | 01.03.2026 over Name | Monat | Plan | Bemerkung | Ist": {
      text: [["Erstellt von", "Max", "01.03.2026", "Stand", "02.03.2026"], ["Name", "Monat", "Plan", "Bemerkung", "Ist"],
        ["Ann", "Jan 2026", "40", "", "35"], ["Bob", "Feb 2026", "30", "", "25"]],
      dot: [["Erstellt von", "Max", "46082", "Stand", "46083"], ["Name", "Monat", "Plan", "Bemerkung", "Ist"],
        ["Ann", "46023", "40", "", "35"], ["Bob", "46054", "30", "", "25"]],
      claims: [claim("Jan 2026", 40, "S!C3"), claim("Feb 2026", 30, "S!C4", "Bob"), claim("Mar 2026", 35, "S!E3")],
    },
    "Projekt Alpha | Forecast | Q1 over Name | Monat | Plan | Ist": {
      text: [["Projekt Alpha", "Forecast", "01.01.2026", "31.03.2026"], ["Name", "Monat", "Plan", "Ist"],
        ["Ann", "01.01.2026", "40", "35"], ["Ann", "01.02.2026", "30", "25"], ["Ann", "01.03.2026", "20", "15"]],
      dot: [["Projekt Alpha", "Forecast", "46023", "46112"], ["Name", "Monat", "Plan", "Ist"],
        ["Ann", "46023", "40", "35"], ["Ann", "46054", "30", "25"], ["Ann", "46082", "20", "15"]],
      claims: [claim("Jan 2026", 40, "S!C3"), claim("Jan 2026", 30, "S!C4"), claim("Jan 2026", 20, "S!C5")],
    },
    "Projekt | Alpha | 01.01. | 31.01. over Name | Datum | Plan | Ist": {
      text: [["Projekt", "Alpha", "01.01.2026", "31.01.2026"], ["Name", "Datum", "Plan", "Ist"], ["Ann", "15.01.2026", "40", "35"]],
      dot: [["Projekt", "Alpha", "46023", "46053"], ["Name", "Datum", "Plan", "Ist"], ["Ann", "46037", "40", "35"]],
      claims: [claim("Jan 2026", 40, "S!C3"), claim("Jan 2026", 35, "S!D3")],
    },
    "Forecast | Ist-Stunden under a key/value title": {
      text: [["Erstellt von", "Max", "01.03.2026", "Stand", "02.03.2026"], ["Name", "Monat", "Forecast", "Bemerkung", "Ist-Stunden"],
        ["Ann", "Jan 2026", "40", "", "35"], ["Bob", "Feb 2026", "30", "", "25"]],
      dot: [["Erstellt von", "Max", "46082", "Stand", "46083"], ["Name", "Monat", "Forecast", "Bemerkung", "Ist-Stunden"],
        ["Ann", "46023", "40", "", "35"], ["Bob", "46054", "30", "", "25"]],
      claims: [claim("Jan 2026", 40, "S!C3"), claim("Feb 2026", 30, "S!C4", "Bob"), claim("Mar 2026", 40, "S!C3")],
    },
  };
  const cases = Object.entries(shapes).flatMap(([label, s]) => (["text", "dot"] as const).map((numbers) => [label, numbers, s[numbers], s.claims] as const));

  it.each(cases)("%s (%s): every claim is refused columns-unconfirmed, nothing is written", (_label, numbers, rows, claims) => {
    expect(detectLayout(rows, { numbers, defaultYear: 2026 }).ambiguous.length).toBeGreaterThan(0);
    const out = validateForecastRows(claims, strictOn(rows, numbers));
    expect(out.ok).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(detail(out)).toEqual(claims.map(() => "columns-unconfirmed"));
  });

  // Confirmed: H is read with the confirmed mapping and checked against U.
  const confirmed = (rows: string[][], numbers: NumberOrigin) => {
    const mapping = detectLayout(rows, { numbers, defaultYear: 2026 }).mapping;
    if (mapping === null) throw new Error("no layout");
    return strictOn(rows, numbers, mapping);
  };

  it.each(["text", "dot"] as const)("Q1 title, confirmed (%s): January's cell stands for January only, nothing sums to 90", (numbers) => {
    const s = shapes["Projekt Alpha | Forecast | Q1 over Name | Monat | Plan | Ist"];
    const opts = confirmed(s[numbers], numbers);
    const allJan = validateForecastRows(s.claims, opts);
    expect(periodsOf(allJan)).toEqual([["Ann", "2026-01", 40]]);
    expect(detail(allJan)).toEqual(["period-conflict", "period-conflict"]);
    // Feb's cell: the hand route reads February, the title's 01.01.2026 above it January.
    expect(validateForecastRows([claim("Feb 2026", 30, "S!C4")], opts).rejected).toEqual([
      { row: claim("Feb 2026", 30, "S!C4"), reason: "source", detail: "period-conflict", periods: { sheet: "2026-02", header: "2026-01" } },
    ]);
  });

  // Round 3: the confirmed columns read Plan, so the Ist cell backs nothing.
  it.each(["text", "dot"] as const)("month title over Datum | Plan | Ist, confirmed (%s): the Ist cell is not read, Plan stands alone, never 75", (numbers) => {
    const s = shapes["Projekt | Alpha | 01.01. | 31.01. over Name | Datum | Plan | Ist"];
    const out = validateForecastRows(s.claims, confirmed(s[numbers], numbers));
    expect(out.rejected).toEqual([{ row: claim("Jan 2026", 35, "S!D3"), reason: "source", detail: "cell-not-read" }]);
    expect(out.subPeriods).toEqual([]);
    expect(out.collisions).toEqual([]);
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 40]]);
  });

  const keyValueClaims = [claim("Jan 2026", 40, "S!C3"), claim("Feb 2026", 30, "S!C4", "Bob"), claim("Mar 2026", 40, "S!C3")];

  it("Erstellt von | Max | 01.03.2026 over Name | Monat | Plan | Bemerkung | Ist, confirmed: the title's March above the hours column disagrees with every row, so no month is written", () => {
    for (const numbers of ["text", "dot"] as const) {
      const s = shapes["Erstellt von | Max | 01.03.2026 over Name | Monat | Plan | Bemerkung | Ist"];
      const out = validateForecastRows(keyValueClaims, confirmed(s[numbers], numbers));
      expect(out.ok).toEqual([]);
      expect(out.rejected.map((r) => (r.reason === "source" ? r.periods : undefined))).toEqual([
        { sheet: "2026-01", header: "2026-03" }, { sheet: "2026-02", header: "2026-03" }, { sheet: "2026-01", header: "2026-03" },
      ]);
    }
  });

  // The hours word preselects Ist-Stunden here, so confirming the default reads
  // that column, and the Forecast cells Claude cites are not read (round 3).
  it("Forecast | Ist-Stunden under a key/value title, confirmed as preselected: the Forecast cells are not read, nothing is written", () => {
    for (const numbers of ["text", "dot"] as const) {
      const s = shapes["Forecast | Ist-Stunden under a key/value title"];
      const out = validateForecastRows(keyValueClaims, confirmed(s[numbers], numbers));
      expect(out.ok).toEqual([]);
      expect(detail(out)).toEqual(["cell-not-read", "cell-not-read", "cell-not-read"]);
    }
  });
});

describe("an unknown layout: no H, so U and every R cell must agree", () => {
  it("one row period cell that disagrees with the claim refuses it; the right claims stand", () => {
    const rows = [...pad(10), ["Name", "Monat", "Stunden"], ["Ann", "Jan 2026", "8"], ["Bob", "Feb 2026", "4"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    expect(detail(validateForecastRows([claim("Feb 2026", 8, "S!C12")], strictOn(rows)))).toEqual(["period-not-near"]);
    const right = validateForecastRows([claim("Jan 2026", 8, "S!C12"), claim("Feb 2026", 4, "S!C13", "Bob")], strictOn(rows));
    expect(periodsOf(right)).toEqual([["Ann", "2026-01", 8], ["Bob", "2026-02", 4]]);
  });

  it("two row period cells that disagree refuse every claim, naming both", () => {
    const rows = [...pad(10), ["Name", "Von", "Bis", "Stunden"], ["Ann", "Jan 2026", "Feb 2026", "8"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    for (const period of ["Jan 2026", "Feb 2026"]) {
      const out = validateForecastRows([claim(period, 8, "S!D12")], strictOn(rows));
      expect(out.ok).toEqual([]);
      expect(out.rejected).toEqual([
        { row: claim(period, 8, "S!D12"), reason: "source", detail: "period-conflict", periods: { rows: ["2026-01", "2026-02"] } },
      ]);
    }
  });

  it("a key/value title's date over the hours column no longer hides the row's month (the exemption is gone)", () => {
    const rows = [...pad(9), ["Erstellt von", "Max", "01.03.2026", "Stand", "02.03.2026"], ["Name", "Monat", "Plan", "Bemerkung", "Ist"],
      ["Ann", "Jan 2026", "40", "", "35"], ["Bob", "Feb 2026", "30", "", "25"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const wrong = validateForecastRows([claim("Mar 2026", 40, "S!C12")], strictOn(rows));
    expect(wrong.ok).toEqual([]);
    expect(wrong.rejected).toEqual([
      { row: claim("Mar 2026", 40, "S!C12"), reason: "source", detail: "period-conflict", periods: { row: "2026-01", header: "2026-03" } },
    ]);
    // The right month is refused too: the two sources disagree.
    expect(detail(validateForecastRows([claim("Jan 2026", 40, "S!C12")], strictOn(rows)))).toEqual(["period-conflict"]);
  });

  it("a Start date beside a period header refuses the claim: no row cell is exempt", () => {
    const rows = [...pad(10), ["Name", "Start", "Jan 2026", "Feb 2026"], ["Ann", "01.02.2026", "10", "20"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    expect(detail(validateForecastRows([claim("Feb 2026", 20, "S!D12")], strictOn(rows)))).toEqual([]);
    expect(detail(validateForecastRows([claim("Jan 2026", 10, "S!C12")], strictOn(rows)))).toEqual(["period-conflict"]);
  });

  // Round 7 OOS-1: the row holds two numbers with the same (no) column header,
  // so neither claim stands; it was a collision before.
  it("two cells of one long row are refused row-ambiguous: no sum", () => {
    const rows = [...pad(10), ["Name", "Monat", "Plan", "Ist"], ["Ann", "Jan 2026", "40", "35"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C12"), claim("Jan 2026", 35, "S!D12")], strictOn(rows));
    expect(out.ok).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(detail(out)).toEqual(["row-ambiguous", "row-ambiguous"]);
  });

  it("a row with its own period cell is no sub-period row: a month title's two dates over Plan | Ist never sum to 75", () => {
    const rows = [...pad(9), ["Projekt", "Alpha", "01.01.2026", "31.01.2026"], ["Name", "Datum", "Plan", "Ist"], ["Ann", "15.01.2026", "40", "35"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C12"), claim("Jan 2026", 35, "S!D12")], strictOn(rows));
    expect(out.rejected).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(out.ok).toEqual([]);
    expect(out.collisions).toEqual([{ person: "Ann", period: "2026-01", sources: ["S!C12", "S!D12"] }]);
  });

  it("sprint-date headers still sum their sub-periods", () => {
    const rows = [...pad(10), ["Name", "05.01.2026", "19.01.2026", "02.02.2026", "16.02.2026"], ["Ann", "40", "40", "40", "40"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const out = validateForecastRows([
      claim("05.01.2026", 40, "S!B12"), claim("19.01.2026", 40, "S!C12"), claim("02.02.2026", 40, "S!D12"), claim("16.02.2026", 40, "S!E12"),
    ], strictOn(rows));
    expect(out.rejected).toEqual([]);
    expect(out.collisions).toEqual([]);
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 80], ["Ann", "2026-02", 80]]);
    expect(out.subPeriods).toHaveLength(2);
  });
});

describe("an edited mapping is the hand reading the claim is checked against", () => {
  // A clear long sheet: the detection takes Monat (a period word) over Start.
  const rows = [["Name", "Start", "Monat", "Stunden"], ["Ann", "01.03.2026", "Jan 2026", "40"], ["Ann", "01.03.2026", "Feb 2026", "30"]];
  const detected = detectLayout(rows, { defaultYear: 2026 });

  it("the detection is clear and reads Monat", () => {
    expect(detected).toMatchObject({ kind: "long", ambiguous: [], mapping: { period: 2, hours: 3 } });
  });

  it("with the period moved to Start, a claim in Monat's month for the hours cell is refused, Start's month accepted", () => {
    const edited = { ...detected.mapping!, period: 1 };
    const wrong = validateForecastRows([claim("Jan 2026", 40, "S!D2")], strictOn(rows, undefined, edited));
    expect(wrong.ok).toEqual([]);
    expect(wrong.rejected).toEqual([
      { row: claim("Jan 2026", 40, "S!D2"), reason: "source", detail: "period-conflict", periods: { sheet: "2026-03" } },
    ]);
    expect(periodsOf(validateForecastRows([claim("Mar 2026", 40, "S!D2")], strictOn(rows, undefined, edited)))).toEqual([["Ann", "2026-03", 40]]);
  });

  it("without the edit, the detection's own reading decides", () => {
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!D2")], strictOn(rows)))).toEqual([["Ann", "2026-01", 40]]);
    expect(detail(validateForecastRows([claim("Mar 2026", 40, "S!D2")], strictOn(rows)))).toEqual(["period-conflict"]);
  });
});

// Fix 8: a row with its own period cell is a long row, whose cells share its
// one period. Two cells of it are never summed as sub-periods, on either route
// and whoever reads the cells: a metadata row the detection takes for a wide
// header once summed Stunden + Ist to 75 (re-found while fixing rr8 OOS-1).
describe("a row with its own period cell is never a sub-period row, on either route", () => {
  const people = ["Ann", "Bob", "Cem", "Dora", "Eve"];
  const metadataRows = [["Erstellt", "", "01.01.2026", "15.01.2026", "20.01.2026"], ["Name", "Monat", "Stunden", "Ist"], ...people.map((p) => [p, "Jan 2026", "40", "35"])];
  const sprintRows = [["Name", "Start", "05.01.2026", "19.01.2026", "02.02.2026", "16.02.2026"], ["Bob", "01.03.2026", "40", "40", "40", "40"]];
  const handRoute = (rows: string[][]) => {
    const mapping = detectLayout(rows, { defaultYear: 2026 }).mapping;
    if (mapping === null) throw new Error("no layout");
    return validateForecastRows(gridToForecastRows(rows, mapping, "S").rows, { sheet: sheetOf(rows), requireSource: false, defaultYear: 2026 });
  };

  /** The Claude route with the sheet's own detected mapping confirmed. */
  const confirmedOn = (rows: string[][]) => {
    const mapping = detectLayout(rows, { defaultYear: 2026 }).mapping;
    if (mapping === null) throw new Error("no layout");
    return strictOn(rows, undefined, mapping);
  };

  // Round 2: such a wide reading now asks (detection), so this gate is what
  // holds once the user has confirmed it.
  it("the detection reads the metadata row as a wide header, and asks", () => {
    expect(detectLayout(metadataRows, { defaultYear: 2026 })).toMatchObject({
      kind: "wide", ambiguous: [{ field: "period", candidates: [1, 2, 3, 4] }], mapping: { headerRow: 0, periodCols: [2, 3, 4] },
    });
  });

  it("Claude route, the wide reading confirmed: Ann's Stunden and Ist cells collide, never 75", () => {
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C3"), claim("Jan 2026", 35, "S!D3")], confirmedOn(metadataRows));
    expect(out.rejected).toEqual([]);
    expect(out.ok).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(out.collisions).toEqual([{ person: "Ann", period: "2026-01", sources: ["S!C3", "S!D3"] }]);
  });

  it("hand route: every person's two cells collide, never 75", () => {
    const out = handRoute(metadataRows);
    expect(out.ok).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(out.collisions.map((c) => c.person)).toEqual(people);
  });

  it("sprint dates beside a Start date collide on both routes, the columns confirmed: refused visibly, not summed", () => {
    const bob = (period: string, source: string) => claim(period, 40, source, "Bob");
    const claude = validateForecastRows([bob("05.01.2026", "S!C2"), bob("19.01.2026", "S!D2"), bob("02.02.2026", "S!E2"), bob("16.02.2026", "S!F2")], confirmedOn(sprintRows));
    expect(claude.rejected).toEqual([]);
    expect(claude.ok).toEqual([]);
    expect(claude.collisions.map((c) => c.period)).toEqual(["2026-01", "2026-02"]);
    const hand = handRoute(sprintRows);
    expect(hand.ok).toEqual([]);
    expect(hand.collisions.map((c) => c.period)).toEqual(["2026-01", "2026-02"]);
  });
});

// Round 2 (controller ruling on concern 1): a wide detection whose data rows
// carry their own period column asks. The metadata row over Monat | Stunden |
// Ist, read as a wide header, once let Claude's Ist-only claims through in the
// metadata row's month: Bob's and Dora's February rows as January = 35.
describe("a wide reading whose rows hold their own period column waits for the columns (round 2)", () => {
  const people = ["Ann", "Bob", "Cem", "Dora", "Eve"];
  const rows = [["Erstellt", "", "01.01.2026", "15.01.2026", "20.01.2026"], ["Name", "Monat", "Stunden", "Ist"],
    ...people.map((p, i) => [p, i % 2 === 1 ? "Feb 2026" : "Jan 2026", "40", "35"])];

  it("refuses Claude's Ist-only claims columns-unconfirmed: no January = 35", () => {
    const ist = people.map((p, i) => claim("Jan 2026", 35, `S!D${i + 3}`, p));
    const out = validateForecastRows(ist, strictOn(rows));
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(people.map(() => "columns-unconfirmed"));
  });

  it("refuses Claude's Stunden + Ist claims columns-unconfirmed: no 75", () => {
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C3"), claim("Jan 2026", 35, "S!D3")], strictOn(rows));
    expect(out.ok).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(detail(out)).toEqual(["columns-unconfirmed", "columns-unconfirmed"]);
  });
});

// Round 3 (controller ruling, fail closed): where there is a hand reading, a
// claim must cite a cell that reading itself reads. Any other cell of a read
// row is refused `cell-not-read`, whatever it holds: the metadata probe's Ist
// cell read as January = 35, and a `Kosten` 40 that happens to equal the
// Stunden 40 (rr8 deviation verdict 1, now flipped).
describe("a claim must cite a cell the hand reading reads (round 3)", () => {
  const notRead = (claimRow: ReturnType<typeof claim>) => ({ row: claimRow, reason: "source", detail: "cell-not-read" });

  it("the metadata probe mapped long and confirmed: Ann's Ist cell is refused, her Stunden cell accepted", () => {
    const people = ["Ann", "Bob", "Cem", "Dora", "Eve"];
    const rows = [["Erstellt", "", "01.01.2026", "15.01.2026", "20.01.2026"], ["Name", "Monat", "Stunden", "Ist"],
      ...people.map((p, i) => [p, i % 2 === 1 ? "Feb 2026" : "Jan 2026", "40", "35"])];
    const long: ColumnMapping = { layout: "long", headerRow: 1, person: 0, period: 1, hours: 2, year: 2026 };
    const ist = claim("Jan 2026", 35, "S!D3");
    expect(validateForecastRows([ist], strictOn(rows, undefined, long)).rejected).toEqual([notRead(ist)]);
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!C3")], strictOn(rows, undefined, long)))).toEqual([["Ann", "2026-01", 40]]);
  });

  it("a Kosten 40 that equals the Stunden 40 is refused once the columns are confirmed (Stunden the hours)", () => {
    const rows = [["Name", "Monat", "Stunden", "Kosten"], ["Ann", "Jan 2026", "40", "40"], ["Bob", "Feb 2026", "20", "1600"]];
    const mapping = detectLayout(rows, { defaultYear: 2026 }).mapping!;
    expect(mapping).toMatchObject({ layout: "long", hours: 2 });
    const kosten = claim("Jan 2026", 40, "S!D2");
    expect(validateForecastRows([kosten], strictOn(rows, undefined, mapping)).rejected).toEqual([notRead(kosten)]);
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!C2")], strictOn(rows, undefined, mapping)))).toEqual([["Ann", "2026-01", 40]]);
  });

  it("an ID that equals the hours on a clear long sheet is refused: ID | Name | Monat | Aufwand", () => {
    const rows = [["ID", "Name", "Monat", "Aufwand"], ["40", "Ann", "Jan 2026", "40"], ["14", "Bob", "Feb 2026", "20"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([]);
    const id = claim("Jan 2026", 40, "S!A2");
    expect(validateForecastRows([id], strictOn(rows)).rejected).toEqual([notRead(id)]);
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!D2")], strictOn(rows)))).toEqual([["Ann", "2026-01", 40]]);
  });

  it("on a wide sheet, a number outside the period columns of a read row is refused too", () => {
    const rows = [["Name", "Kosten", "Jan 2026", "Feb 2026"], ["Ann", "40", "40", "50"], ["Bob", "30", "30", "20"]];
    expect(detectLayout(rows, { defaultYear: 2026 })).toMatchObject({ kind: "wide", ambiguous: [] });
    const kosten = claim("Jan 2026", 40, "S!B2");
    expect(validateForecastRows([kosten], strictOn(rows)).rejected).toEqual([notRead(kosten)]);
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!C2")], strictOn(rows)))).toEqual([["Ann", "2026-01", 40]]);
  });
});

// Fix 9 I-1 (rr9): the round-2 question held only while every Monat cell was
// a period; one placeholder let Claude write Bob's and Dora's February Ist
// cells into January.
describe("one placeholder in the row-period column does not switch the question off (fix 9 I-1)", () => {
  const rowsWith = (placeholder: string, numbers: "text" | "dot") => {
    const [jan, feb, d1, d2, d3] = numbers === "dot" ? ["46023", "46054", "46023", "46037", "46042"] : ["Jan 2026", "Feb 2026", "01.01.2026", "15.01.2026", "20.01.2026"];
    return [["Erstellt", "", d1, d2, d3], ["Name", "Monat", "Stunden", "Ist"],
      ["Ann", jan, "40", "35"], ["Bob", feb, "40", "35"], ["Cid", placeholder, "40", "35"], ["Dora", feb, "40", "35"], ["Eve", jan, "40", "35"]];
  };
  const people = ["Ann", "Bob", "Cid", "Dora", "Eve"];

  it.each(["-", "n/a", "offen", "Q1 2026"].flatMap((p) => (["text", "dot"] as const).map((n) => [p, n] as const)))(
    "%s (%s): every Ist and Stunden claim is refused columns-unconfirmed, no January total takes the February rows", (placeholder, numbers) => {
      const rows = rowsWith(placeholder, numbers);
      const ist = people.map((p, i) => claim("Jan 2026", 35, `S!D${i + 3}`, p));
      const stunden = people.map((p, i) => claim("Jan 2026", 40, `S!C${i + 3}`, p));
      for (const claims of [ist, stunden]) {
        const out = validateForecastRows(claims, strictOn(rows, numbers));
        expect(out.ok.filter((r) => r.period === "2026-01")).toEqual([]);
        expect(detail(out)).toEqual(people.map(() => "columns-unconfirmed"));
      }
    },
  );
});

// Fix 9 OOS-a (rr9 p7): a person named in ANY other cell of the cited row
// vouched for the claim, so a deputy or manager column routed someone else's
// hours to them. The person must sit in the person column: the hand reading's
// where there is one, else the column most claims name their person in.
describe("the claimed person must sit in the person column (fix 9 OOS-a)", () => {
  const notOnRow = (c: ReturnType<typeof claim>) => ({ row: c, reason: "source", detail: "person-not-on-row" });

  it("Name | Vertretung | Monat | Stunden: Bob, the deputy, is refused; Ann is accepted", () => {
    const rows = [["Name", "Vertretung", "Monat", "Stunden"], ["Ann", "Bob", "Jan 2026", "40"]];
    expect(detectLayout(rows, { defaultYear: 2026 })).toMatchObject({ kind: "long", ambiguous: [], mapping: { person: 0 } });
    const bob = claim("Jan 2026", 40, "S!D2", "Bob");
    expect(validateForecastRows([bob], strictOn(rows)).rejected).toEqual([notOnRow(bob)]);
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!D2")], strictOn(rows)))).toEqual([["Ann", "2026-01", 40]]);
  });

  it("wide Name | Manager | Jan 2026 | Feb 2026: the manager's claims are refused, the people's accepted", () => {
    const rows = [["Name", "Manager", "Jan 2026", "Feb 2026"], ["Ann", "Bob", "10", "20"], ["Cid", "Bob", "11", "21"]];
    expect(detectLayout(rows, { defaultYear: 2026 })).toMatchObject({ kind: "wide", ambiguous: [], mapping: { person: 0 } });
    const bobs = [claim("Jan 2026", 10, "S!C2", "Bob"), claim("Jan 2026", 11, "S!C3", "Bob")];
    const out = validateForecastRows(bobs, strictOn(rows));
    expect(out.ok).toEqual([]);
    expect(out.rejected).toEqual(bobs.map(notOnRow));
    const people = validateForecastRows([claim("Jan 2026", 10, "S!C2"), claim("Jan 2026", 11, "S!C3", "Cid")], strictOn(rows));
    expect(periodsOf(people)).toEqual([["Ann", "2026-01", 10], ["Cid", "2026-01", 11]]);
  });

  it("an unknown long layout: the row's leftmost text cell is the person, so the deputy Bob is refused", () => {
    const rows = [...pad(10), ["Name", "Vertretung", "Monat", "Stunden"],
      ["Ann", "Bob", "Jan 2026", "40"], ["Cid", "Dan", "Feb 2026", "20"], ["Eve", "Bob", "Mar 2026", "30"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const bob = claim("Mar 2026", 30, "S!D14", "Bob");
    const out = validateForecastRows([claim("Jan 2026", 40, "S!D12"), claim("Feb 2026", 20, "S!D13", "Cid"), bob], strictOn(rows));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 40], ["Cid", "2026-02", 20]]);
    expect(out.rejected).toEqual([notOnRow(bob)]);
  });

  it("an unknown wide layout: the manager's claim is refused", () => {
    const rows = [...pad(10), ["Name", "Manager", "Jan 2026", "Feb 2026"], ["Ann", "Bob", "10", "20"], ["Cid", "Bob", "11", "21"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const bob = claim("Feb 2026", 20, "S!D12", "Bob");
    const out = validateForecastRows([claim("Jan 2026", 10, "S!C12"), claim("Jan 2026", 11, "S!C13", "Cid"), bob], strictOn(rows));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 10], ["Cid", "2026-01", 11]]);
    expect(out.rejected).toEqual([notOnRow(bob)]);
  });

  it("the leftmost text cell decides on every row: the deputy Dan is refused", () => {
    const rows = [...pad(10), ["Name", "Vertretung", "Monat", "Stunden"], ["Ann", "Bob", "Jan 2026", "40"], ["Cid", "Dan", "Feb 2026", "20"]];
    const dan = claim("Feb 2026", 20, "S!D13", "Dan");
    const out = validateForecastRows([claim("Jan 2026", 40, "S!D12"), dan], strictOn(rows));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 40]]);
    expect(out.rejected).toEqual([notOnRow(dan)]);
  });
});

// Fix 9 OOS-b: the same sheet on the Claude route waits for the columns.
describe("a year column beside year-less wide headers waits for the columns (fix 9 OOS-b)", () => {
  it("Name | Jahr | Jan | Feb never reads 2026-01 = 10 without a confirmation", () => {
    const rows = [["Name", "Jahr", "Jan", "Feb"], ["Ann", "2027", "10", "20"]];
    for (const period of ["Jan 2026", "Jan", "Jan 2027"]) {
      const out = validateForecastRows([claim(period, 10, "S!C2")], strictOn(rows));
      expect(out.ok).toEqual([]);
      expect(detail(out)).toEqual(["columns-unconfirmed"]);
    }
  });
});

// Fix 9 OOS-c: stacked long blocks wait for the columns on the Claude route.
describe("stacked long blocks wait for the header row (fix 9 OOS-c)", () => {
  it.each(["text", "dot"] as const)("Name | Monat | Forecast over Name | Monat | Ist (%s): every claim is refused columns-unconfirmed", (numbers) => {
    const [jan, feb] = numbers === "dot" ? ["46023", "46054"] : ["Jan 2026", "Feb 2026"];
    const rows = [["Name", "Monat", "Forecast"], ["Ann", jan, "40"], ["Bob", feb, "30"], ["Name", "Monat", "Ist"], ["Ann", jan, "35"], ["Bob", feb, "25"]];
    const out = validateForecastRows([claim("Jan 2026", 35, "S!C5"), claim("Feb 2026", 25, "S!C6", "Bob"), claim("Jan 2026", 40, "S!C2")], strictOn(rows, numbers));
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["columns-unconfirmed", "columns-unconfirmed", "columns-unconfirmed"]);
  });
});

// Round 5 ruling 1: a REPEATED HEADER row (the header's person label in the
// person column, no number in the hours or period columns) ends the hand
// reading, and detection asks which header row is meant whatever the block
// sizes. Header row 1 then reads the Forecast block only and the later one the
// Ist block only; Claude's cells of the other block are not read.
describe("a repeated header row ends the reading (round 5)", () => {
  const longBlocks = (perBlock: 1 | 2, numbers: "text" | "dot") => {
    const [jan, feb] = numbers === "dot" ? ["46023", "46054"] : ["Jan 2026", "Feb 2026"];
    const block = (hours: [string, string]) => (perBlock === 1 ? [["Ann", jan, hours[0]]] : [["Ann", jan, hours[0]], ["Bob", feb, hours[1]]]);
    return [["Name", "Monat", "Forecast"], ...block(["40", "30"]), ["Name", "Monat", "Ist"], ...block(["35", "25"])];
  };
  const wideBlocks = (numbers: "text" | "dot") => numbers === "dot"
    ? [["Name", "46023", "46054"], ["Ann", "10", "20"], ["Bob", "11", "21"], ["Name", "46388", "46419"], ["Ann", "30", "40"], ["Bob", "31", "41"]]
    : [["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"], ["Bob", "11", "21"], ["Name", "Jan 2027", "Feb 2027"], ["Ann", "30", "40"], ["Bob", "31", "41"]];
  const handRoute = (rows: string[][], numbers: "text" | "dot", headerRow: number) => {
    const mapping = { ...detectLayout(rows, { numbers, defaultYear: 2026 }).mapping!, headerRow };
    const read = gridToForecastRows(rows, mapping, "S", numbers);
    return { mapping, read, validated: validateForecastRows(read.rows, { sheet: sheetOf(rows, numbers), requireSource: false, defaultYear: 2026 }) };
  };
  const cases = ([1, 2] as const).flatMap((n) => (["text", "dot"] as const).map((numbers) => [n, numbers] as const));

  it.each(cases)("stacked long blocks of %i row(s) (%s) ask for the header row", (n, numbers) => {
    const rows = longBlocks(n, numbers);
    expect(detectLayout(rows, { numbers, defaultYear: 2026 }).ambiguous).toContainEqual({ field: "header", candidates: [0, n + 1] });
  });

  it.each(cases)("header row 1 confirmed (%i row(s), %s): the Forecast block only, no Ist hours and no sum", (n, numbers) => {
    const { read, validated } = handRoute(longBlocks(n, numbers), numbers, 0);
    expect(read.rows.map((r) => [r.person, r.period, r.hours])).toEqual(n === 1 ? [["Ann", "2026-01", 40]] : [["Ann", "2026-01", 40], ["Bob", "2026-02", 30]]);
    expect(validated.duplicates).toEqual([]);
    expect(read.rowsBelowRepeatedHeader).toBe(n);
  });

  it.each(cases)("the later header row confirmed (%i row(s), %s): the Ist block only", (n, numbers) => {
    const { read } = handRoute(longBlocks(n, numbers), numbers, n + 1);
    expect(read.rows.map((r) => r.hours)).toEqual(n === 1 ? [35] : [35, 25]);
  });

  it.each(cases)("Claude, header row 1 confirmed (%i row(s), %s): the Ist cells are not read, the Forecast cells stand", (n, numbers) => {
    const rows = longBlocks(n, numbers);
    const { mapping } = handRoute(rows, numbers, 0);
    const ist = claim("Jan 2026", 35, `S!C${n + 3}`);
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C2"), ist], strictOn(rows, numbers, mapping));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 40]]);
    expect(out.rejected).toEqual([{ row: ist, reason: "source", detail: "cell-not-read" }]);
  });

  it.each(cases)("Claude, the later header row confirmed (%i row(s), %s): the Forecast cells above it are not read", (n, numbers) => {
    const rows = longBlocks(n, numbers);
    const { mapping } = handRoute(rows, numbers, n + 1);
    const forecast = claim("Jan 2026", 40, "S!C2");
    const out = validateForecastRows([forecast, claim("Jan 2026", 35, `S!C${n + 3}`)], strictOn(rows, numbers, mapping));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 35]]);
    expect(out.rejected).toEqual([{ row: forecast, reason: "source", detail: "cell-not-read" }]);
  });

  it.each(["text", "dot"] as const)("stacked wide year blocks (%s), header row 1: block 2 is never read into 2026, on either route", (numbers) => {
    const rows = wideBlocks(numbers);
    const { mapping, read, validated } = handRoute(rows, numbers, 0);
    expect(read.rows.map((r) => [r.person, r.period, r.hours])).toEqual([["Ann", "2026-01", 10], ["Ann", "2026-02", 20], ["Bob", "2026-01", 11], ["Bob", "2026-02", 21]]);
    expect(validated.duplicates).toEqual([]);
    const out = validateForecastRows([claim("Jan 2026", 30, "S!B5"), claim("Jan 2027", 30, "S!B5")], strictOn(rows, numbers, mapping));
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["cell-not-read", "cell-not-read"]);
  });

  it("a sheet with one header row stays clear, and a person named like the header label is no repeated header when the row holds hours", () => {
    expect(detectLayout([["Name", "Monat", "Stunden"], ["Ann", "Jan 2026", "40"], ["Bob", "Feb 2026", "30"]], { defaultYear: 2026 }).ambiguous).toEqual([]);
    const rows = [["Name", "Monat", "Stunden"], ["Ann", "Jan 2026", "40"], ["Name", "Feb 2026", "30"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([]);
    expect(gridToForecastRows(rows, detectLayout(rows, { defaultYear: 2026 }).mapping!, "S").rows).toHaveLength(2);
  });
});

// Round 5 ruling 3: without a hand reading there is no vote; the claimed
// person must be the cited row's LEFTMOST non-blank text cell (period-shaped
// and email cells skipped). A single deputy claim once won the vote alone.
describe("without a hand reading, the person is the row's leftmost text cell (round 5)", () => {
  const rows = [...pad(10), ["Name", "Vertretung", "Monat", "Stunden"], ["Ann", "Bob", "Jan 2026", "40"]];

  it("a single deputy claim on an unknown layout is refused", () => {
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const bob = claim("Jan 2026", 40, "S!D12", "Bob");
    expect(validateForecastRows([bob], strictOn(rows)).rejected).toEqual([{ row: bob, reason: "source", detail: "person-not-on-row" }]);
  });

  it("Name | Vertretung accepts Ann", () => {
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!D12")], strictOn(rows)))).toEqual([["Ann", "2026-01", 40]]);
  });

  it("skips period-shaped and email cells: Mai | ann@x.de | Ann | 40 is Ann's row", () => {
    const own = [...pad(10), ["Monat", "E-Mail", "Name", "Stunden"], ["Mai 2026", "ann@x.de", "Ann", "40"]];
    expect(periodsOf(validateForecastRows([claim("Mai 2026", 40, "S!D12")], strictOn(own)))).toEqual([["Ann", "2026-05", 40]]);
  });

  it("the cost: Rolle | Name with no hand reading refuses the person", () => {
    const rolle = [...pad(10), ["Rolle", "Name", "Monat", "Stunden"], ["Dev", "Ann", "Jan 2026", "40"]];
    const ann = claim("Jan 2026", 40, "S!D12");
    expect(validateForecastRows([ann], strictOn(rolle)).rejected).toEqual([{ row: ann, reason: "source", detail: "person-not-on-row" }]);
  });
});

// Round 6: a repeated header row need not repeat the header's person label.
// A row below the header that holds no number in the hours or period columns
// is one when (a) it repeats the person label, (b) its person cell is a person
// header word, (c) on a wide sheet at least two of its period cells are period
// labels, or (d) on a long sheet its hours cell is an hours word or its period
// cell a period word. Placeholder rows never are.
describe("a repeated header row under another label ends the reading too (round 6)", () => {
  type Numbers = "text" | "dot";
  const wide = (numbers: Numbers, label: string) => numbers === "dot"
    ? [["Name", "46023", "46054"], ["Ann", "10", "20"], ["Bob", "11", "21"], [label, "46388", "46419"], ["Ann", "30", "40"], ["Bob", "31", "41"]]
    : [["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"], ["Bob", "11", "21"], [label, "Jan 2027", "Feb 2027"], ["Ann", "30", "40"], ["Bob", "31", "41"]];
  const long = (numbers: Numbers, perBlock: 1 | 2, second: string[]) => {
    const [jan, feb] = numbers === "dot" ? ["46023", "46054"] : ["Jan 2026", "Feb 2026"];
    const block = (h: [string, string]) => (perBlock === 1 ? [["Ann", jan, h[0]]] : [["Ann", jan, h[0]], ["Bob", feb, h[1]]]);
    return [["Name", "Monat", "Forecast"], ...block(["40", "30"]), second, ...block(["35", "25"])];
  };
  const confirmedRow1 = (rows: string[][], numbers: Numbers) =>
    ({ ...detectLayout(rows, { numbers, defaultYear: 2026 }).mapping!, headerRow: 0 });
  const handRead = (rows: string[][], numbers: Numbers) => {
    const read = gridToForecastRows(rows, confirmedRow1(rows, numbers), "S", numbers);
    return { read, validated: validateForecastRows(read.rows, { sheet: sheetOf(rows, numbers), requireSource: false, defaultYear: 2026 }) };
  };
  const both = ["text", "dot"] as const;

  it.each(both)("wide, Mitarbeiter under Name (%s): asks; with row 1 confirmed block 2 is neither read nor summed, and Claude's block-2 cells are refused", (numbers) => {
    const rows = wide(numbers, "Mitarbeiter");
    expect(detectLayout(rows, { numbers, defaultYear: 2026 }).ambiguous).toContainEqual({ field: "header", candidates: [0, 3] });
    const { read, validated } = handRead(rows, numbers);
    expect(read.rows.map((r) => r.hours)).toEqual([10, 20, 11, 21]);
    expect(validated.duplicates).toEqual([]);
    const out = validateForecastRows([claim("Jan 2027", 30, "S!B5"), claim("Jan 2026", 30, "S!B5")], strictOn(rows, numbers, confirmedRow1(rows, numbers)));
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["cell-not-read", "cell-not-read"]);
  });

  it.each(([1, 2] as const).flatMap((n) => both.map((numbers) => [n, numbers] as const)))(
    "long, Mitarbeiter under Name, %i row(s) per block (%s): asks; with row 1 confirmed the Ist block is neither read nor summed, and refused on the Claude route", (n, numbers) => {
      const rows = long(numbers, n, ["Mitarbeiter", "Monat", "Ist"]);
      const asked = detectLayout(rows, { numbers, defaultYear: 2026 }).ambiguous.find((a) => a.field === "header");
      expect(asked?.candidates).toEqual(expect.arrayContaining([0, n + 1]));
      const { read, validated } = handRead(rows, numbers);
      expect(read.rows.map((r) => r.hours)).toEqual(n === 1 ? [40] : [40, 30]);
      expect(validated.duplicates).toEqual([]);
      const ist = claim("Jan 2026", 35, `S!C${n + 3}`);
      expect(validateForecastRows([ist], strictOn(rows, numbers, confirmedRow1(rows, numbers))).rejected).toEqual([{ row: ist, reason: "source", detail: "cell-not-read" }]);
    },
  );

  it.each(both)("(c) a second wide header under an unrelated label with month labels (%s) is a repeated header", (numbers) => {
    const rows = wide(numbers, "Team B");
    expect(repeatedHeaderRows(rows, confirmedRow1(rows, numbers), numbers)).toEqual([3]);
    expect(handRead(rows, numbers).read.rows.map((r) => r.hours)).toEqual([10, 20, 11, 21]);
  });

  it.each([
    ["Std in the hours column", ["Team B", "", "Std"]],
    ["Stunden in the hours column", ["Team B", "", "Stunden"]],
    ["a period word in the period column", ["Team B", "Monat", ""]],
  ])("(d) a second long header with %s is a repeated header", (_label, second) => {
    const rows = long("text", 2, second);
    expect(repeatedHeaderRows(rows, confirmedRow1(rows, "text"))).toEqual([3]);
    expect(handRead(rows, "text").read.rows.map((r) => r.hours)).toEqual([40, 30]);
  });

  it("placeholder rows never count: Urlaub, 2 Wochen Urlaub, Elternzeit (3 Monate), -, n/a (wide)", () => {
    const rows = [["Name", "Jan 2026", "Feb 2026", "Mär 2026"], ["Carl", "Urlaub", "Urlaub", "2 Wochen Urlaub"],
      ["Dora", "", "Elternzeit (3 Monate)", ""], ["Eve", "-", "n/a", "-"], ["Bob", "4", "5", "6"]];
    const mapping = { layout: "wide" as const, headerRow: 0, person: 0, periodCols: [1, 2, 3], year: 2026 };
    expect(repeatedHeaderRows(rows, mapping)).toEqual([]);
    expect(gridToForecastRows(rows, mapping, "S").rows.filter((r) => r.person === "Bob").map((r) => r.hours)).toEqual([4, 5, 6]);
  });

  it("placeholder rows never count on a long sheet either: 2 Wochen Urlaub and Elternzeit (3 Monate) in the period column, - and n/a as hours", () => {
    const rows = [["Name", "Monat", "Stunden"], ["Ann", "Jan 2026", "40"], ["Carl", "2 Wochen Urlaub", "-"],
      ["Dora", "Elternzeit (3 Monate)", "n/a"], ["Eve", "Urlaub", "Urlaub"], ["Bob", "Feb 2026", "30"]];
    const mapping = { layout: "long" as const, headerRow: 0, person: 0, period: 1, hours: 2, year: 2026 };
    expect(repeatedHeaderRows(rows, mapping)).toEqual([]);
    expect(gridToForecastRows(rows, mapping, "S").rows.map((r) => [r.person, r.hours])).toEqual([["Ann", 40], ["Bob", 30]]);
  });

  it("a two-row header's second row (Name | Std | Std | Std, right under the months) is no repeated header", () => {
    const rows = [["", "Jan 2026", "Feb 2026", "Mär 2026"], ["Name", "Std", "Std", "Std"], ["Ann", "40", "35", "30"], ["Bob", "4", "5", "6"]];
    const mapping = { layout: "wide" as const, headerRow: 0, person: 0, periodCols: [1, 2, 3], year: 2026 };
    expect(repeatedHeaderRows(rows, mapping)).toEqual([]);
    expect(gridToForecastRows(rows, mapping, "S").rows.map((r) => r.hours)).toEqual([40, 35, 30, 4, 5, 6]);
  });
});

// Round 7 I-A (rr10): with a hand reading, ONLY the cells it reads back a
// claim. A row inside its range that it reads nothing from (a blank or "-"
// forecast, blank months) once fell back to the row's own period cells, so
// Bob's Ist or Budget cell was written as forecast hours.
describe("with a hand reading, only the cells it reads back a claim (round 7 I-A)", () => {
  it("wide: Bob's Budget 120 on a row with blank months is refused cell-not-read once the columns are confirmed", () => {
    const rows = [["Name", "Start", "Jan 2026", "Feb 2026", "Mar 2026", "Budget"],
      ["Ann", "01.01.2026", "10", "20", "30", "60"], ["Bob", "01.02.2026", "", "", "", "120"]];
    const mapping = detectLayout(rows, { defaultYear: 2026 }).mapping!;
    const budget = claim("Feb 2026", 120, "S!F3", "Bob");
    expect(validateForecastRows([budget], strictOn(rows, undefined, mapping)).rejected).toEqual([{ row: budget, reason: "source", detail: "cell-not-read" }]);
  });

  it("long: Bob's Ist 25 beside a blank or '-' forecast is refused cell-not-read with Stunden confirmed", () => {
    for (const blank of ["", "-"]) {
      const rows = [["Name", "Monat", "Stunden", "Ist"], ["Ann", "Jan 2026", "40", "35"], ["Bob", "Feb 2026", blank, "25"], ["Cid", "Jan 2026", "30", "28"]];
      const mapping = { layout: "long" as const, headerRow: 0, person: 0, period: 1, hours: 2, year: 2026 };
      const ist = claim("Feb 2026", 25, "S!D3", "Bob");
      expect(validateForecastRows([ist], strictOn(rows, undefined, mapping)).rejected).toEqual([{ row: ist, reason: "source", detail: "cell-not-read" }]);
    }
  });
});

// Round 7 OOS-1 (rr10): on an unknown layout nothing tells Stunden from Ist,
// so a claim is refused when its row holds ANOTHER number cell whose period
// sources match the cited cell's: the same column-header period, or neither
// under a period header. Period-shaped and person cells do not count; distinct
// sprint dates and distinct month columns do not match.
describe("an unknown layout refuses a row with two numbers for one period (round 7 OOS-1)", () => {
  it("padded Name | Monat | Stunden | Ist: the Ist and the Stunden claims are refused row-ambiguous", () => {
    const rows = [...pad(10), ["Name", "Monat", "Stunden", "Ist"], ["Ann", "Jan 2026", "40", "35"], ["Bob", "Feb 2026", "30", "25"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const claims = [claim("Jan 2026", 35, "S!D12"), claim("Feb 2026", 25, "S!D13", "Bob"), claim("Jan 2026", 40, "S!C12")];
    const out = validateForecastRows(claims, strictOn(rows));
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["row-ambiguous", "row-ambiguous", "row-ambiguous"]);
  });

  it("an unknown wide sheet with month columns imports", () => {
    const rows = [...pad(10), ["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"], ["Bob", "11", "21"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const out = validateForecastRows([claim("Jan 2026", 10, "S!B12"), claim("Feb 2026", 20, "S!C12"), claim("Jan 2026", 11, "S!B13", "Bob")], strictOn(rows));
    expect(out.rejected).toEqual([]);
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 10], ["Ann", "2026-02", 20], ["Bob", "2026-01", 11]]);
  });

  it("the cost: an unknown long row with a PersNr number refuses", () => {
    const rows = [...pad(10), ["PersNr", "Name", "Monat", "Stunden"], ["4711", "Ann", "Jan 2026", "40"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    expect(detail(validateForecastRows([claim("Jan 2026", 40, "S!D12")], strictOn(rows)))).toEqual(["row-ambiguous"]);
  });

  it("a hand reading is unaffected: a clear long sheet with a PersNr column imports", () => {
    const rows = [["PersNr", "Name", "Monat", "Stunden"], ["4711", "Ann", "Jan 2026", "40"], ["4712", "Bob", "Feb 2026", "30"]];
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!D2")], strictOn(rows)))).toEqual([["Ann", "2026-01", 40]]);
  });
});
