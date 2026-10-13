// §500 fix wave 3 (rr2 Minor 6): the Claude-route check reads each column's
// decimal style and week shape once per sheet, not once per claim.
import { describe, expect, it } from "vitest";
import { isWeekSpacedColumn } from "./period-assign";
import type { SheetGrid } from "./sheet-grid";
import { columnFacts, columnStyle } from "./source-evidence";

const SHEET: SheetGrid = {
  name: "S",
  rows: [["Name", "Woche", "Stunden", "Satz"], ["Ann", "2026-01-05", "7,5", "90"], ["Ann", "2026-01-12", "8", "90"]],
  truncated: false,
};

describe("columnFacts", () => {
  it("is computed once per sheet", () => {
    expect(columnFacts(SHEET)).toBe(columnFacts(SHEET));
    expect(columnFacts({ ...SHEET })).not.toBe(columnFacts(SHEET));
  });

  it("answers exactly what the uncached functions answer, for every column", () => {
    const facts = columnFacts(SHEET);
    for (let col = 0; col < 4; col++) {
      expect(facts.style(col)).toBe(columnStyle(SHEET, col));
      expect(facts.weekly(col)).toBe(isWeekSpacedColumn(SHEET.rows.map((r) => r[col] ?? ""), SHEET.numbers));
    }
    expect(facts.style(2)).toBe("comma");
    expect(facts.weekly(1)).toBe(true);
  });
});
