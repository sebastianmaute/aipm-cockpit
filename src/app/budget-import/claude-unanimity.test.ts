// §500 fix 8 — the owner's "fail closed" decision of 2026-10-13: a Claude claim
// is accepted only when EVERY period source for the cited cell agrees with it.
// The sources are H (the hand route's reading), U (the nearest period header
// above the cell) and R (the period cells on the cited row, counted only where
// there is no H). Any disagreement is a visible refusal, never a pick, and a
// sheet whose columns are ambiguous is refused until the user confirms them.
// Every test here pins a wrong number that must NOT be written.
import { describe, expect, it } from "vitest";
import { gridToForecastRows } from "./forecast-rows";
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

  it.each(["csv", "serials"] as const)("the detection is clear and wide (%s): the hand route reads block 2 as 2026", (kind) => {
    const { rows, numbers } = sheets[kind];
    expect(detectLayout(rows, { numbers, defaultYear: 2026 })).toMatchObject({ kind: "wide", ambiguous: [] });
  });

  it.each(["csv", "serials"] as const)("P2a: the right 2027 claims for block 2 are refused, naming both periods (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([claim("Jan 2027", 30, "S!B5"), claim("Feb 2027", 41, "S!C6", "Bob")], strictOn(rows, numbers));
    expect(out.ok).toEqual([]);
    expect(out.rejected).toEqual([
      { row: claim("Jan 2027", 30, "S!B5"), reason: "source", detail: "period-conflict", periods: { sheet: "2026-01", header: "2027-01" } },
      { row: claim("Feb 2027", 41, "S!C6", "Bob"), reason: "source", detail: "period-conflict", periods: { sheet: "2026-02", header: "2027-02" } },
    ]);
  });

  it.each(["csv", "serials"] as const)("P2b: wrong 2026 claims for block 2 are refused; block 1's right claim stands (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([
      claim("Jan 2026", 10, "S!B2"), claim("Jan 2026", 30, "S!B5"), claim("Feb 2026", 41, "S!C6", "Bob"),
    ], strictOn(rows, numbers));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 10]]);
    expect(detail(out)).toEqual(["period-conflict", "period-conflict"]);
    expect(out.duplicates).toEqual([]);
    neverBlockTwo(out);
  });

  it.each(["csv", "serials"] as const)("P2d: year-less Jan / Feb claims for block 2 are refused, not re-routed into 2026 (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([claim("Jan", 30, "S!B5"), claim("Feb", 41, "S!C6", "Bob")], strictOn(rows, numbers));
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["period-conflict", "period-conflict"]);
  });

  it.each(["csv", "serials"] as const)("P2f: a fully correct reading writes block 1 and refuses block 2 (%s)", (kind) => {
    const { rows, numbers } = sheets[kind];
    const out = validateForecastRows([
      claim("Jan 2026", 10, "S!B2"), claim("Feb 2026", 20, "S!C2"), claim("Jan 2026", 11, "S!B3", "Bob"), claim("Feb 2026", 21, "S!C3", "Bob"),
      claim("Jan 2027", 30, "S!B5"), claim("Feb 2027", 40, "S!C5"), claim("Jan 2027", 31, "S!B6", "Bob"), claim("Feb 2027", 41, "S!C6", "Bob"),
    ], strictOn(rows, numbers));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 10], ["Ann", "2026-02", 20], ["Bob", "2026-01", 11], ["Bob", "2026-02", 21]]);
    expect(detail(out)).toEqual(["period-conflict", "period-conflict", "period-conflict", "period-conflict"]);
    neverBlockTwo(out);
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

  it("two cells of one long row collide: no sum without distinct date headers above", () => {
    const rows = [...pad(10), ["Name", "Monat", "Plan", "Ist"], ["Ann", "Jan 2026", "40", "35"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("unknown");
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C12"), claim("Jan 2026", 35, "S!D12")], strictOn(rows));
    expect(out.ok).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(out.collisions).toEqual([{ person: "Ann", period: "2026-01", sources: ["S!C12", "S!D12"] }]);
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

  it("an unknown long layout: the column most claims name their person in decides, so the deputy Bob is refused", () => {
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

  it("on a tie, the leftmost column decides", () => {
    const rows = [...pad(10), ["Name", "Vertretung", "Monat", "Stunden"], ["Ann", "Bob", "Jan 2026", "40"], ["Cid", "Dan", "Feb 2026", "20"]];
    const dan = claim("Feb 2026", 20, "S!D13", "Dan");
    const out = validateForecastRows([claim("Jan 2026", 40, "S!D12"), dan], strictOn(rows));
    expect(periodsOf(out)).toEqual([["Ann", "2026-01", 40]]);
    expect(out.rejected).toEqual([notOnRow(dan)]);
  });
});
