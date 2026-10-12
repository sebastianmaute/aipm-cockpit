import { describe, expect, it } from "vitest";
import { MAX_IMPORT_HOURS_PER_CELL, validateForecastRows } from "./forecast-validate";
import type { SheetGrid } from "./sheet-grid";

const GRID: SheetGrid = {
  name: "Sheet1",
  rows: [
    ["Person", "2026-01", "2026-02"],
    ["Ann", "40", "1.234,5"],
    ["Bob", "20", "x"],
    [],
    ["Cy"],
  ],
  truncated: false,
};

const plain = { sheet: GRID, requireSource: false };
const strict = { sheet: GRID, requireSource: true };

function gridNamed(name: string): SheetGrid {
  return { name, rows: [["Ann", "40"]], truncated: false };
}

describe("validateForecastRows: shape", () => {
  it("rejects every element when the input is not an array", () => {
    for (const input of [null, undefined, {}, "rows", 42]) {
      const out = validateForecastRows(input, plain);
      expect(out.ok).toEqual([]);
      expect(out.rejected).toHaveLength(1);
      expect(out.rejected[0].reason).toBe("shape");
    }
  });

  it("rejects non-object elements as shape", () => {
    const out = validateForecastRows([null, 5, "x", [1]], plain);
    expect(out.ok).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["shape", "shape", "shape", "shape"]);
  });

  it("accepts an empty array", () => {
    expect(validateForecastRows([], plain)).toEqual({ ok: [], rejected: [], duplicates: [] });
  });

  it("rejects a non-number rate, a negative rate and a non-string email as shape", () => {
    const base = { person: "Ann", period: "2026-01", hours: 10 };
    const out = validateForecastRows(
      [
        { ...base, rate: "90" },
        { ...base, rate: -1 },
        { ...base, rate: Number.NaN },
        { ...base, email: 5 },
      ],
      plain,
    );
    expect(out.ok).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["shape", "shape", "shape", "shape"]);
  });

  it("keeps rate 0, a rate and an email on an accepted row", () => {
    const out = validateForecastRows(
      [{ person: "Ann", period: "2026-01", hours: 10, rate: 0, email: "a@x.io" }],
      plain,
    );
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 10, rate: 0, email: "a@x.io" }]);
  });

  it("keeps the offending element in rejected.row", () => {
    const bad = { person: "Ann", period: "2026-01", hours: -1 };
    expect(validateForecastRows([bad], plain).rejected[0].row).toBe(bad);
  });
});

describe("validateForecastRows: hours", () => {
  it("rejects -1, 745, NaN, Infinity and a string as hours", () => {
    const rows = [-1, 745, Number.NaN, Number.POSITIVE_INFINITY, "40"].map((hours) => ({
      person: "Ann",
      period: "2026-01",
      hours,
    }));
    const out = validateForecastRows(rows, plain);
    expect(out.ok).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["hours", "hours", "hours", "hours", "hours"]);
  });

  it("accepts the bounds 0 and 744", () => {
    expect(MAX_IMPORT_HOURS_PER_CELL).toBe(744);
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 0 },
        { person: "Bob", period: "2026-01", hours: 744 },
      ],
      plain,
    );
    expect(out.ok.map((r) => r.hours)).toEqual([0, 744]);
  });
});

describe("validateForecastRows: period and person", () => {
  it("rejects an unrecognised period as period", () => {
    const out = validateForecastRows([{ person: "Ann", period: "Q1", hours: 10 }], plain);
    expect(out.rejected.map((r) => r.reason)).toEqual(["period"]);
  });

  it("rejects a non-string period as period", () => {
    const out = validateForecastRows([{ person: "Ann", period: 202601, hours: 10 }], plain);
    expect(out.rejected.map((r) => r.reason)).toEqual(["period"]);
  });

  it("re-canonicalises the period and trims the person", () => {
    const out = validateForecastRows([{ person: "  Ann  ", period: "Jan 2026", hours: 10 }], plain);
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 10 }]);
  });

  it("rejects a blank or non-string person as person", () => {
    const out = validateForecastRows(
      [
        { person: "   ", period: "2026-01", hours: 10 },
        { person: "", period: "2026-01", hours: 10 },
        { person: 7, period: "2026-01", hours: 10 },
        { period: "2026-01", hours: 10 },
      ],
      plain,
    );
    expect(out.rejected.map((r) => r.reason)).toEqual(["person", "person", "person", "person"]);
  });
});

describe("validateForecastRows: source (Claude route)", () => {
  const row = (source: unknown, hours = 40) => ({ person: "Ann", period: "2026-01", hours, source });

  it("rejects a row without a source", () => {
    const out = validateForecastRows([{ person: "Ann", period: "2026-01", hours: 40 }], strict);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("rejects a non-string source", () => {
    expect(validateForecastRows([row(5)], strict).rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("accepts a source cell holding the same number", () => {
    const out = validateForecastRows([row("Sheet1!B2")], strict);
    expect(out.rejected).toEqual([]);
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 40, source: "Sheet1!B2" }]);
  });

  it("rejects a source cell holding a different number", () => {
    expect(validateForecastRows([row("Sheet1!B2", 80)], strict).rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("accepts within 0.005 and rejects beyond it", () => {
    expect(validateForecastRows([row("Sheet1!B2", 40.004)], strict).ok).toHaveLength(1);
    expect(validateForecastRows([row("Sheet1!B2", 40.01)], strict).rejected).toHaveLength(1);
  });

  it("reads the cell in either decimal style", () => {
    // "12,5" is 12.5 as a comma number and unreadable as a dot number.
    const german: SheetGrid = { name: "Sheet1", rows: [["Ann", "12,5", "1.234,5"]], truncated: false };
    const opts = { sheet: german, requireSource: true };
    expect(validateForecastRows([row("Sheet1!B1", 12.5)], opts).rejected).toEqual([]);
    expect(validateForecastRows([row("Sheet1!C1", 700)], opts).rejected).toHaveLength(1);
  });

  it("rejects a cell outside the grid, past a ragged row, or on an empty row", () => {
    for (const ref of ["Sheet1!Z99", "Sheet1!B5", "Sheet1!B4", "Sheet1!AA1", "Sheet1!A6"]) {
      expect(validateForecastRows([row(ref)], strict).rejected.map((r) => r.reason)).toEqual(["source"]);
    }
  });

  it("rejects a non-numeric cell", () => {
    expect(validateForecastRows([row("Sheet1!C3")], strict).rejected).toHaveLength(1);
    expect(validateForecastRows([row("Sheet1!A2")], strict).rejected).toHaveLength(1);
  });

  it("rejects malformed references and a wrong sheet", () => {
    const refs = [
      "B2",
      "Sheet1!",
      "Sheet1!b2",
      "Sheet1!B0",
      "Sheet1!B02",
      "Sheet1!B2 ",
      " Sheet1!B2",
      "Sheet1!B2:C3",
      "Sheet1!$B$2",
      "Sheet1!ABCD1",
      "Other!B2",
      "sheet1!B2",
      "Sheet1!B2!B2",
    ];
    for (const ref of refs) {
      expect(validateForecastRows([row(ref)], strict).rejected.map((r) => r.reason)).toEqual(["source"]);
    }
  });

  it("does not check the source when requireSource is false, but keeps a string one", () => {
    const out = validateForecastRows([row("Sheet1!Z99")], plain);
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 40, source: "Sheet1!Z99" }]);
    expect(validateForecastRows([row(5)], plain).ok[0].source).toBeUndefined();
  });

  it("maps A1 letters to columns: AA is column 26, row 1 is rows[0]", () => {
    const wide: SheetGrid = {
      name: "Sheet1",
      rows: [[...Array.from({ length: 26 }, () => ""), "12"]],
      truncated: false,
    };
    const out = validateForecastRows([row("Sheet1!AA1", 12)], { sheet: wide, requireSource: true });
    expect(out.rejected).toEqual([]);
  });

  describe("sheet names with metacharacters", () => {
    it("matches a name with regex metacharacters, quoted and unquoted", () => {
      const sheet = gridNamed("Plan (v2)+");
      const opts = { sheet, requireSource: true };
      expect(validateForecastRows([row("Plan (v2)+!B1")], opts).rejected).toEqual([]);
      expect(validateForecastRows([row("'Plan (v2)+'!B1")], opts).rejected).toEqual([]);
    });

    it("does not treat the sheet name as a pattern", () => {
      const sheet = gridNamed("Plan (v2)+");
      const opts = { sheet, requireSource: true };
      for (const ref of ["Plan (v2)!B1", "Plan v2!B1", "Plan (v2)++!B1", "'Plan (v2)'!B1"]) {
        expect(validateForecastRows([row(ref)], opts).rejected).toHaveLength(1);
      }
    });

    it("reads a doubled apostrophe in a quoted name as one", () => {
      const sheet = gridNamed("Bob's");
      const opts = { sheet, requireSource: true };
      expect(validateForecastRows([row("'Bob''s'!B1")], opts).rejected).toEqual([]);
      expect(validateForecastRows([row("Bob's!B1")], opts).rejected).toEqual([]);
      expect(validateForecastRows([row("'Bob's'!B1")], opts).rejected).toHaveLength(1);
      expect(validateForecastRows([row("'Bobs'!B1")], opts).rejected).toHaveLength(1);
    });

    it("accepts a quoted plain name", () => {
      expect(validateForecastRows([row("'Sheet1'!B2")], strict).rejected).toEqual([]);
    });
  });
});

describe("validateForecastRows: duplicates", () => {
  it("sums Ann / 'ann ' for the same period into one row and reports it", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 40, email: "a@x.io", rate: 90, source: "Sheet1!B2" },
        { person: "ann ", period: "2026-01", hours: 20, email: "other@x.io", rate: 10 },
      ],
      plain,
    );
    expect(out.ok).toEqual([
      { person: "Ann", period: "2026-01", hours: 60, email: "a@x.io", rate: 90, source: "Sheet1!B2" },
    ]);
    expect(out.duplicates).toEqual([{ person: "Ann", period: "2026-01", count: 2 }]);
  });

  it("matches duplicates across period spellings", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-1", hours: 10 },
        { person: "Ann", period: "Jan 2026", hours: 5 },
        { person: "Ann", period: "2026-01", hours: 1 },
      ],
      plain,
    );
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 16 }]);
    expect(out.duplicates).toEqual([{ person: "Ann", period: "2026-01", count: 3 }]);
  });

  it("does not merge different periods or different people", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 10 },
        { person: "Ann", period: "2026-02", hours: 10 },
        { person: "Bob", period: "2026-01", hours: 10 },
      ],
      plain,
    );
    expect(out.ok).toHaveLength(3);
    expect(out.duplicates).toEqual([]);
  });

  it("keeps the first occurrence's position", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 1 },
        { person: "Bob", period: "2026-01", hours: 2 },
        { person: "ann", period: "2026-01", hours: 3 },
      ],
      plain,
    );
    expect(out.ok.map((r) => [r.person, r.hours])).toEqual([["Ann", 4], ["Bob", 2]]);
  });

  it("lets a sum exceed 744 while each row is still capped", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 744 },
        { person: "Ann", period: "2026-01", hours: 744 },
        { person: "Ann", period: "2026-01", hours: 745 },
      ],
      plain,
    );
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 1488 }]);
    expect(out.duplicates).toEqual([{ person: "Ann", period: "2026-01", count: 2 }]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["hours"]);
  });

  it("does not float-drift a sum", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 0.1 },
        { person: "Ann", period: "2026-01", hours: 0.2 },
      ],
      plain,
    );
    expect(out.ok[0].hours).toBe(0.3);
  });

  it("does not count a rejected row toward a duplicate", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 10 },
        { person: "Ann", period: "2026-01", hours: -5 },
      ],
      plain,
    );
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 10 }]);
    expect(out.duplicates).toEqual([]);
  });

  it("validates the source of each duplicate before summing", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 40, source: "Sheet1!B2" },
        { person: "ann", period: "2026-01", hours: 99, source: "Sheet1!B2" },
      ],
      strict,
    );
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 40, source: "Sheet1!B2" }]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
    expect(out.duplicates).toEqual([]);
  });
});
