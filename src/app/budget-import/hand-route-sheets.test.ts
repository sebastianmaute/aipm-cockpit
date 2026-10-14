// §500 — the reviewers' trap sheets through the hand route's reader: detection,
// the mapping in effect (detected, edited, or Claude's), `gridToForecastRows`
// and `validateForecastRows`. Since Claude only proposes a mapping, this reader
// is what imports on both routes. Every test pins a wrong number that must NOT
// be written. (Moved from the removed Claude claim checker's suite.)
import { describe, expect, it } from "vitest";
import { gridToForecastRows, repeatedHeaderRows } from "./forecast-rows";
import type { ColumnMapping } from "./forecast-types";
import { validateForecastRows } from "./forecast-validate";
import { detectLayout } from "./layout-detect";
import type { NumberOrigin, SheetGrid } from "./sheet-grid";

type Numbers = "text" | "dot";
const sheetOf = (rows: string[][], numbers?: NumberOrigin): SheetGrid => ({ name: "S", rows, truncated: false, numbers });
const detected = (rows: string[][], numbers: Numbers = "text") => detectLayout(rows, { numbers, defaultYear: 2026 });
const read = (rows: string[][], mapping: ColumnMapping, numbers: Numbers = "text") => {
  const out = gridToForecastRows(rows, mapping, "S", numbers);
  return { out, validated: validateForecastRows(out.rows, { sheet: sheetOf(rows, numbers) }) };
};
const triples = (rows: ReadonlyArray<{ person: string; period: string; hours: number }>) => rows.map((r) => [r.person, r.period, r.hours]);
const both = ["text", "dot"] as const;

describe("stacked year blocks (rr8 N1, residue 9)", () => {
  const sheets: Record<Numbers, string[][]> = {
    text: [["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"], ["Bob", "11", "21"], ["Name", "Jan 2027", "Feb 2027"], ["Ann", "30", "40"], ["Bob", "31", "41"]],
    dot: [["Name", "46023", "46054"], ["Ann", "10", "20"], ["Bob", "11", "21"], ["Name", "46388", "46419"], ["Ann", "30", "40"], ["Bob", "31", "41"]],
  };

  it.each(both)("the detection is wide and asks for the header row (%s)", (numbers) => {
    expect(detected(sheets[numbers], numbers)).toMatchObject({
      kind: "wide", mapping: { headerRow: 0 }, ambiguous: [{ field: "header", candidates: [0, 3] }],
    });
  });

  it.each(both)("header row 1: block 2 is never read into 2026 nor summed (%s)", (numbers) => {
    const { out, validated } = read(sheets[numbers], { ...detected(sheets[numbers], numbers).mapping!, headerRow: 0 }, numbers);
    expect(triples(out.rows)).toEqual([["Ann", "2026-01", 10], ["Ann", "2026-02", 20], ["Bob", "2026-01", 11], ["Bob", "2026-02", 21]]);
    expect(validated.duplicates).toEqual([]);
    expect(out.rowsBelowRepeatedHeader).toBe(2);
  });
});

// Fix 8: a row with its own period cell is a long row, whose cells share its
// one period. Two cells of it are never summed as sub-periods: a metadata row
// the detection takes for a wide header once summed Stunden + Ist to 75.
describe("a row with its own period cell is never a sub-period row", () => {
  const people = ["Ann", "Bob", "Cem", "Dora", "Eve"];
  const metadataRows = [["Erstellt", "", "01.01.2026", "15.01.2026", "20.01.2026"], ["Name", "Monat", "Stunden", "Ist"], ...people.map((p) => [p, "Jan 2026", "40", "35"])];
  const sprintRows = [["Name", "Start", "05.01.2026", "19.01.2026", "02.02.2026", "16.02.2026"], ["Bob", "01.03.2026", "40", "40", "40", "40"]];

  it("the detection reads the metadata row as a wide header, and asks", () => {
    expect(detected(metadataRows)).toMatchObject({
      kind: "wide", ambiguous: [{ field: "period", candidates: [1, 2, 3, 4] }], mapping: { headerRow: 0, periodCols: [2, 3, 4] },
    });
  });

  it("the wide reading confirmed: every person's two cells collide, never 75", () => {
    const { validated } = read(metadataRows, detected(metadataRows).mapping!);
    expect(validated.ok).toEqual([]);
    expect(validated.subPeriods).toEqual([]);
    expect(validated.collisions.map((c) => c.person)).toEqual(people);
    expect(validated.collisions[0]).toEqual({ person: "Ann", period: "2026-01", sources: ["S!C3", "S!D3"] });
  });

  it("mapped long with Stunden, as the sheet is: Stunden only, never the Ist", () => {
    const { validated } = read(metadataRows, { layout: "long", headerRow: 1, person: 0, period: 1, hours: 2, year: 2026 });
    expect(triples(validated.ok)).toEqual(people.map((p) => [p, "2026-01", 40]));
  });

  it("sprint dates beside a Start date collide: refused visibly, not summed", () => {
    const { validated } = read(sprintRows, detected(sprintRows).mapping!);
    expect(validated.ok).toEqual([]);
    expect(validated.collisions.map((c) => c.period)).toEqual(["2026-01", "2026-02"]);
  });
});

// Round 5 ruling 1: a REPEATED HEADER row ends the reading, and detection asks
// which header row is meant whatever the block sizes.
describe("a repeated header row ends the reading (round 5)", () => {
  const longBlocks = (perBlock: 1 | 2, numbers: Numbers) => {
    const [jan, feb] = numbers === "dot" ? ["46023", "46054"] : ["Jan 2026", "Feb 2026"];
    const block = (hours: [string, string]) => (perBlock === 1 ? [["Ann", jan, hours[0]]] : [["Ann", jan, hours[0]], ["Bob", feb, hours[1]]]);
    return [["Name", "Monat", "Forecast"], ...block(["40", "30"]), ["Name", "Monat", "Ist"], ...block(["35", "25"])];
  };
  const atHeader = (rows: string[][], numbers: Numbers, headerRow: number) => read(rows, { ...detected(rows, numbers).mapping!, headerRow }, numbers);
  const cases = ([1, 2] as const).flatMap((n) => both.map((numbers) => [n, numbers] as const));

  it.each(cases)("stacked long blocks of %i row(s) (%s) ask for the header row", (n, numbers) => {
    expect(detected(longBlocks(n, numbers), numbers).ambiguous).toContainEqual({ field: "header", candidates: [0, n + 1] });
  });

  it.each(cases)("header row 1 (%i row(s), %s): the Forecast block only, no Ist hours and no sum", (n, numbers) => {
    const { out, validated } = atHeader(longBlocks(n, numbers), numbers, 0);
    expect(triples(out.rows)).toEqual(n === 1 ? [["Ann", "2026-01", 40]] : [["Ann", "2026-01", 40], ["Bob", "2026-02", 30]]);
    expect(validated.duplicates).toEqual([]);
    expect(out.rowsBelowRepeatedHeader).toBe(n);
  });

  it.each(cases)("the later header row (%i row(s), %s): the Ist block only", (n, numbers) => {
    expect(atHeader(longBlocks(n, numbers), numbers, n + 1).out.rows.map((r) => r.hours)).toEqual(n === 1 ? [35] : [35, 25]);
  });

  it("a sheet with one header row stays clear, and a person named like the header label is no repeated header when the row holds hours", () => {
    expect(detected([["Name", "Monat", "Stunden"], ["Ann", "Jan 2026", "40"], ["Bob", "Feb 2026", "30"]]).ambiguous).toEqual([]);
    const rows = [["Name", "Monat", "Stunden"], ["Ann", "Jan 2026", "40"], ["Name", "Feb 2026", "30"]];
    expect(detected(rows).ambiguous).toEqual([]);
    expect(gridToForecastRows(rows, detected(rows).mapping!, "S").rows).toHaveLength(2);
  });
});

// Round 6: a repeated header row need not repeat the header's person label.
describe("a repeated header row under another label ends the reading too (round 6)", () => {
  const wide = (numbers: Numbers, label: string) => numbers === "dot"
    ? [["Name", "46023", "46054"], ["Ann", "10", "20"], ["Bob", "11", "21"], [label, "46388", "46419"], ["Ann", "30", "40"], ["Bob", "31", "41"]]
    : [["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"], ["Bob", "11", "21"], [label, "Jan 2027", "Feb 2027"], ["Ann", "30", "40"], ["Bob", "31", "41"]];
  const long = (numbers: Numbers, perBlock: 1 | 2, second: string[]) => {
    const [jan, feb] = numbers === "dot" ? ["46023", "46054"] : ["Jan 2026", "Feb 2026"];
    const block = (h: [string, string]) => (perBlock === 1 ? [["Ann", jan, h[0]]] : [["Ann", jan, h[0]], ["Bob", feb, h[1]]]);
    return [["Name", "Monat", "Forecast"], ...block(["40", "30"]), second, ...block(["35", "25"])];
  };
  const row1 = (rows: string[][], numbers: Numbers): ColumnMapping => ({ ...detected(rows, numbers).mapping!, headerRow: 0 });

  it.each(both)("wide, Mitarbeiter under Name (%s): asks; with row 1 block 2 is neither read nor summed", (numbers) => {
    const rows = wide(numbers, "Mitarbeiter");
    expect(detected(rows, numbers).ambiguous).toContainEqual({ field: "header", candidates: [0, 3] });
    const { out, validated } = read(rows, row1(rows, numbers), numbers);
    expect(out.rows.map((r) => r.hours)).toEqual([10, 20, 11, 21]);
    expect(validated.duplicates).toEqual([]);
  });

  it.each(([1, 2] as const).flatMap((n) => both.map((numbers) => [n, numbers] as const)))(
    "long, Mitarbeiter under Name, %i row(s) per block (%s): asks; with row 1 the Ist block is neither read nor summed", (n, numbers) => {
      const rows = long(numbers, n, ["Mitarbeiter", "Monat", "Ist"]);
      const asked = detected(rows, numbers).ambiguous.find((a) => a.field === "header");
      expect(asked?.candidates).toEqual(expect.arrayContaining([0, n + 1]));
      const { out, validated } = read(rows, row1(rows, numbers), numbers);
      expect(out.rows.map((r) => r.hours)).toEqual(n === 1 ? [40] : [40, 30]);
      expect(validated.duplicates).toEqual([]);
    },
  );

  it.each(both)("(c) a second wide header under an unrelated label with month labels (%s) is a repeated header", (numbers) => {
    const rows = wide(numbers, "Team B");
    expect(repeatedHeaderRows(rows, row1(rows, numbers), numbers)).toEqual([3]);
    expect(read(rows, row1(rows, numbers), numbers).out.rows.map((r) => r.hours)).toEqual([10, 20, 11, 21]);
  });

  it.each([
    ["Std in the hours column", ["Team B", "", "Std"]],
    ["Stunden in the hours column", ["Team B", "", "Stunden"]],
    ["a period word in the period column", ["Team B", "Monat", ""]],
  ])("(d) a second long header with %s is a repeated header", (_label, second) => {
    const rows = long("text", 2, second);
    expect(repeatedHeaderRows(rows, row1(rows, "text"))).toEqual([3]);
    expect(read(rows, row1(rows, "text")).out.rows.map((r) => r.hours)).toEqual([40, 30]);
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

// Round 7 I-A (rr10): a row inside the reading that it reads nothing from (a
// blank or "-" forecast, blank months) contributes nothing: Bob's Ist or
// Budget cell is never forecast hours.
describe("a row the reading reads nothing from contributes nothing (round 7 I-A)", () => {
  it("wide: Bob's Budget 120 on a row with blank months is not read", () => {
    const rows = [["Name", "Start", "Jan 2026", "Feb 2026", "Mar 2026", "Budget"],
      ["Ann", "01.01.2026", "10", "20", "30", "60"], ["Bob", "01.02.2026", "", "", "", "120"]];
    const { out } = read(rows, detected(rows).mapping!);
    expect(out.rows.filter((r) => r.person === "Bob")).toEqual([]);
    expect(out.rows.some((r) => r.hours === 120)).toBe(false);
  });

  it("long: Bob's Ist 25 beside a blank or '-' forecast is not read with Stunden mapped", () => {
    for (const blank of ["", "-"]) {
      const rows = [["Name", "Monat", "Stunden", "Ist"], ["Ann", "Jan 2026", "40", "35"], ["Bob", "Feb 2026", blank, "25"], ["Cid", "Jan 2026", "30", "28"]];
      const { out } = read(rows, { layout: "long", headerRow: 0, person: 0, period: 1, hours: 2, year: 2026 });
      expect(triples(out.rows)).toEqual([["Ann", "2026-01", 40], ["Cid", "2026-01", 30]]);
    }
  });
});
