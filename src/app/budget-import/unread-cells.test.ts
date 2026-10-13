// §500 fix wave 2 (CR I4): a Claude reply that simply leaves rows out used to
// look complete. `findUnreadCells` lists the number cells it did not cite.
import { describe, expect, it } from "vitest";
import { validateForecastRows } from "./forecast-validate";
import type { SheetGrid } from "./sheet-grid";
import { findUnreadCells } from "./unread-cells";

const WIDE: SheetGrid = {
  name: "S",
  rows: [
    ["Name", "Jan 2026", "Feb 2026", "Mar 2026", "Rate"],
    ["Ann", "10", "20", "30", "90"],
    ["Bob", "1", "2", "3", "80"],
  ],
  truncated: false,
};

const row = (person: string, period: string, hours: number, source: string) => ({ person, period, hours, source });

function unreadOf(sheet: SheetGrid, rows: unknown[]) {
  return findUnreadCells(sheet, validateForecastRows(rows, { sheet, requireSource: true }));
}

describe("findUnreadCells — cells under a period header", () => {
  const complete = [
    row("Ann", "Jan 2026", 10, "S!B2"), row("Ann", "Feb 2026", 20, "S!C2"), row("Ann", "Mar 2026", 30, "S!D2"),
    row("Bob", "Jan 2026", 1, "S!B3"), row("Bob", "Feb 2026", 2, "S!C3"), row("Bob", "Mar 2026", 3, "S!D3"),
  ];

  it("lists nothing for a complete reply", () => {
    expect(unreadOf(WIDE, complete)).toEqual({ cells: [], rows: [] });
  });

  it("lists the March cell of a reply that skipped Ann's March", () => {
    expect(unreadOf(WIDE, complete.filter((r) => r.source !== "S!D2"))).toEqual({ cells: ["S!D2"], rows: [] });
  });

  it("does not list a cell a rejected row cited, nor a column without a period header", () => {
    const wrongHours = [...complete.filter((r) => r.source !== "S!D2"), row("Ann", "Mar 2026", 99, "S!D2")];
    const out = validateForecastRows(wrongHours, { sheet: WIDE, requireSource: true });
    expect(out.rejected).toHaveLength(1);
    expect(findUnreadCells(WIDE, out)).toEqual({ cells: [], rows: [] });
  });
});

describe("findUnreadCells — rows of a long sheet", () => {
  const LONG: SheetGrid = {
    name: "S",
    rows: [
      ["Name", "Monat", "Stunden"],
      ["Ann", "Jan 2026", "8"],
      ["Ann", "Feb 2026", "4"],
      ["Bob", "Jan 2026", "2"],
    ],
    truncated: false,
  };

  it("lists a row no row cites, with its person, when its hours column was cited", () => {
    expect(unreadOf(LONG, [row("Ann", "Jan 2026", 8, "S!C2"), row("Bob", "Jan 2026", 2, "S!C4")])).toEqual({
      cells: [],
      rows: [{ row: 3, person: "Ann" }],
    });
  });

  // Round 3 (rr2 observation 1, controller ruling I4): a person the reply
  // skipped ENTIRELY is reported too.
  it("lists a person Claude skipped entirely", () => {
    expect(unreadOf(LONG, [row("Ann", "Jan 2026", 8, "S!C2"), row("Ann", "Feb 2026", 4, "S!C3")])).toEqual({
      cells: [],
      rows: [{ row: 4, person: "Bob" }],
    });
  });

  it("does not list a total row", () => {
    const withTotal: SheetGrid = { ...LONG, rows: [...LONG.rows, ["Summe", "", "14"]] };
    const complete = [row("Ann", "Jan 2026", 8, "S!C2"), row("Ann", "Feb 2026", 4, "S!C3"), row("Bob", "Jan 2026", 2, "S!C4")];
    expect(unreadOf(withTotal, complete)).toEqual({ cells: [], rows: [] });
  });

  // Round 3 (rr2 Important 3): a workbook's date cells are serials; a period
  // cell is never an unread number cell.
  it("lists nothing after a complete reply on a long workbook of serial dates", () => {
    const xlsx: SheetGrid = {
      name: "S",
      rows: [["Name", "Datum", "Stunden"], ["Ann", "46023", "8"], ["Ann", "46054", "4"], ["Ann", "46082", "2"]],
      truncated: false,
      numbers: "dot",
    };
    const complete = [row("Ann", "2026-01", 8, "S!C2"), row("Ann", "2026-02", 4, "S!C3"), row("Ann", "2026-03", 2, "S!C4")];
    expect(unreadOf(xlsx, complete)).toEqual({ cells: [], rows: [] });
  });
});

describe("findUnreadCells — a person skipped in a wide sheet (round 3)", () => {
  it("lists Bob's row when only Ann was read, and not a Summe row", () => {
    const sheet: SheetGrid = {
      name: "S",
      rows: [["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"], ["Bob Kay", "5", "5"], ["Summe", "15", "25"]],
      truncated: false,
    };
    expect(unreadOf(sheet, [row("Ann", "Jan 2026", 10, "S!B2"), row("Ann", "Feb 2026", 20, "S!C2")])).toEqual({
      cells: [],
      rows: [{ row: 3, person: "Bob Kay" }],
    });
  });

  // Round 4 (rr3 Minor 1): a title block above the header is not data the
  // reply skipped, even when the title row holds a date.
  it("does not list title-block rows above a wide header whose title row holds a date", () => {
    const sheet: SheetGrid = {
      name: "S",
      rows: [
        ["Forecast", "Stand", "01.10.2026"], ["Budget gesamt", "", "1200"], [],
        ["Name", "Jan 2026", "Feb 2026", "Mär 2026"], ["Ann", "8", "8", "8"], ["Bob", "4", "4", "4"],
      ],
      truncated: false,
    };
    const complete = [
      row("Ann", "Jan 2026", 8, "S!B5"), row("Ann", "Feb 2026", 8, "S!C5"), row("Ann", "Mär 2026", 8, "S!D5"),
      row("Bob", "Jan 2026", 4, "S!B6"), row("Bob", "Feb 2026", 4, "S!C6"), row("Bob", "Mär 2026", 4, "S!D6"),
    ];
    expect(unreadOf(sheet, complete)).toEqual({ cells: [], rows: [] });
  });
});
