// §500 — Claude's column mapping (`propose_forecast_mapping`) as a hand-route
// `ColumnMapping`: letters and 1-based rows in, 0-based columns out, and every
// input the converter cannot use refused, never repaired. Each refusal case
// asserts its own reason, so a case refused for another reason fails here.
import { describe, expect, it } from "vitest";
import { claudeMappingOf } from "./claude-mapping";
import type { SheetGrid } from "./sheet-grid";

const WIDE: SheetGrid = {
  name: "S",
  rows: [
    ["Name", "E-Mail", "Rate", "Jan 2026", "Feb 2026"],
    ["Ann", "ann@x.de", "90", "40", "30"],
  ],
  truncated: false,
};
const LONG: SheetGrid = {
  name: "S",
  rows: [
    ["Titel"],
    ["Name", "Jahr", "Monat", "Stunden", "Ist"],
    ["Ann", "2026", "Jan", "40", "35"],
  ],
  truncated: false,
};

const wide = (extra: Record<string, unknown> = {}) => ({ layout: "wide", headerRow: 1, person: "A", periodCols: ["D", "E"], ...extra });
const long = (extra: Record<string, unknown> = {}) => ({ layout: "long", headerRow: 2, person: "A", period: "C", hours: "D", ...extra });
const refusalOf = (raw: unknown, sheet: SheetGrid) => {
  const out = claudeMappingOf(raw, sheet);
  return "refused" in out ? out.refused : "accepted";
};

describe("claudeMappingOf: valid mappings", () => {
  it("turns a wide mapping into 0-based columns and a 0-based header row", () => {
    expect(claudeMappingOf(wide({ email: "B", rate: "C", year: 2026 }), WIDE)).toEqual({
      mapping: { layout: "wide", headerRow: 0, person: 0, email: 1, rate: 2, periodCols: [3, 4], year: 2026 },
    });
  });

  it("turns a long mapping into 0-based columns, with its year column", () => {
    expect(claudeMappingOf(long({ yearCol: "B" }), LONG)).toEqual({
      mapping: { layout: "long", headerRow: 1, person: 0, period: 2, hours: 3, yearCol: 1 },
    });
  });

  it("reads null optional fields as absent", () => {
    expect(claudeMappingOf(long({ email: null, rate: null, yearCol: null, year: null }), LONG)).toEqual({
      mapping: { layout: "long", headerRow: 1, person: 0, period: 2, hours: 3 },
    });
  });

  it("reads columns past Z: AA is column 26", () => {
    const row = Array.from({ length: 28 }, (_, i) => `h${i}`);
    const sheet: SheetGrid = { name: "S", rows: [row], truncated: false };
    expect(claudeMappingOf({ layout: "wide", headerRow: 1, person: "A", periodCols: ["AA", "AB"] }, sheet)).toEqual({
      mapping: { layout: "wide", headerRow: 0, person: 0, periodCols: [26, 27] },
    });
  });
});

describe("claudeMappingOf: refusals", () => {
  it("refuses a letter past the sheet's width", () => {
    expect(refusalOf(long({ hours: "F" }), LONG)).toBe("letter");
    expect(refusalOf(wide({ periodCols: ["D", "F"] }), WIDE)).toBe("letter");
  });

  it("refuses a letter that is not one: lower case, a digit, blank, four letters", () => {
    for (const letter of ["d", "D1", "", " D", "AAAA"]) expect(refusalOf(long({ hours: letter }), LONG)).toBe("letter");
  });

  it("refuses a header row outside the sheet or not a whole row number", () => {
    for (const headerRow of [0, 4, -1, 1.5]) expect(refusalOf(long({ headerRow }), LONG)).toBe("header-row");
  });

  it("refuses two fields on one column, and a period column given twice", () => {
    expect(refusalOf(long({ hours: "C" }), LONG)).toBe("duplicate");
    expect(refusalOf(long({ email: "A" }), LONG)).toBe("duplicate");
    expect(refusalOf(wide({ rate: "D" }), WIDE)).toBe("duplicate");
    expect(refusalOf(wide({ periodCols: ["D", "D"] }), WIDE)).toBe("duplicate");
  });

  it("refuses a mapping without a field its layout requires", () => {
    const without = (raw: Record<string, unknown>, field: string) => Object.fromEntries(Object.entries(raw).filter(([key]) => key !== field));
    expect(refusalOf(without(long(), "person"), LONG)).toBe("missing");
    expect(refusalOf(without(long(), "hours"), LONG)).toBe("missing");
    expect(refusalOf(without(long(), "period"), LONG)).toBe("missing");
    expect(refusalOf(without(wide(), "periodCols"), WIDE)).toBe("missing");
    expect(refusalOf(long({ hours: null }), LONG)).toBe("missing");
  });

  it("refuses a wide mapping with no period columns", () => {
    expect(refusalOf(wide({ periodCols: [] }), WIDE)).toBe("period-cols");
  });

  it("refuses a field of the other layout", () => {
    expect(refusalOf(wide({ hours: "C" }), WIDE)).toBe("other-layout");
    expect(refusalOf(long({ periodCols: ["E"] }), LONG)).toBe("other-layout");
  });

  it("refuses a year that is not a whole number in range", () => {
    for (const year of [2026.5, 1999, 2101, Number.NaN]) expect(refusalOf(long({ year }), LONG)).toBe("year");
  });

  it("refuses garbage types", () => {
    for (const raw of [null, "wide", [], 7]) expect(refusalOf(raw, LONG)).toBe("shape");
    expect(refusalOf(long({ layout: "diagonal" }), LONG)).toBe("shape");
    expect(refusalOf(long({ headerRow: "2" }), LONG)).toBe("shape");
    expect(refusalOf(long({ hours: 3 }), LONG)).toBe("shape");
    expect(refusalOf(long({ year: "2026" }), LONG)).toBe("shape");
    expect(refusalOf(wide({ periodCols: "D" }), WIDE)).toBe("shape");
    expect(refusalOf(wide({ periodCols: ["D", 4] }), WIDE)).toBe("shape");
  });
});
