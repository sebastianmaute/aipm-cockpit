// §500 — where a read row's hours cell sits: what `validateForecastRows` reads
// to tell a sub-period sum from a same-row collision.
import { describe, expect, it } from "vitest";
import { columnNaming, headerDateOf, sourcePosition } from "./source-cells";
import type { SheetGrid } from "./sheet-grid";

describe("sourcePosition", () => {
  it("reads a bare or quoted sheet name, a doubled apostrophe as one, and AA as column 26", () => {
    expect(sourcePosition("S!B2", "S")).toEqual({ rowIdx: 1, colIdx: 1 });
    expect(sourcePosition("'My Sheet'!C7", "My Sheet")).toEqual({ rowIdx: 6, colIdx: 2 });
    expect(sourcePosition("'Ann''s'!A1", "Ann's")).toEqual({ rowIdx: 0, colIdx: 0 });
    expect(sourcePosition("S!AA3", "S")).toEqual({ rowIdx: 2, colIdx: 26 });
  });

  it("compares the sheet name literally, never as a pattern", () => {
    expect(sourcePosition("a(b+!B2", "a(b+")).toEqual({ rowIdx: 1, colIdx: 1 });
    expect(sourcePosition("aab!B2", "a.b")).toBeNull();
  });

  it("names nothing for another sheet, an empty sheet name or a malformed cell", () => {
    expect(sourcePosition("T!B2", "S")).toBeNull();
    expect(sourcePosition("!B2", "")).toBeNull();
    for (const cell of ["S!b2", "S!B0", "S!B", "S!2"]) expect(sourcePosition(cell, "S")).toBeNull();
  });
});

describe("columnNaming", () => {
  it("finds the column naming the person, trimmed and case-insensitive, never the cell itself", () => {
    expect(columnNaming(["Team", "Ann", "Ann"], 2, "ann")).toBe(1);
    expect(columnNaming(["Ann", "Jan 2026", "40"], 2, " ann ")).toBe(0);
    expect(columnNaming(["Ann", "40"], 1, "")).toBeNull();
  });
});

describe("headerDateOf", () => {
  const sheet = (rows: string[][]): SheetGrid => ({ name: "S", rows, truncated: false });

  it("gives the date header above a sprint column", () => {
    expect(headerDateOf(sheet([["Name", "05.01.2026", "19.01.2026"], ["Ann", "40", "30"]]), { rowIdx: 1, colIdx: 2, personCol: 0 })).toBe("2026-01-19");
  });

  it("gives none on a row with a period cell of its own, nor under a month label", () => {
    const withStart = sheet([["Name", "Start", "05.01.2026", "19.01.2026"], ["Ann", "01.03.2026", "40", "30"]]);
    expect(headerDateOf(withStart, { rowIdx: 1, colIdx: 2, personCol: 0 })).toBeNull();
    expect(headerDateOf(sheet([["Name", "Jan 2026"], ["Ann", "40"]]), { rowIdx: 1, colIdx: 1, personCol: 0 })).toBeNull();
  });
});
