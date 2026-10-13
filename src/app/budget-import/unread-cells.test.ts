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

  it("lists a row of an accepted person that no row cites", () => {
    expect(unreadOf(LONG, [row("Ann", "Jan 2026", 8, "S!C2")])).toEqual({ cells: [], rows: [3] });
  });

  it("does not list a person Claude did not accept at all", () => {
    expect(unreadOf(LONG, [row("Ann", "Jan 2026", 8, "S!C2"), row("Ann", "Feb 2026", 4, "S!C3")])).toEqual({ cells: [], rows: [] });
  });
});
