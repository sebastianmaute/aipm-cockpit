import { describe, expect, it } from "vitest";
import { MAX_IMPORT_HOURS_PER_CELL, validateForecastRows } from "./forecast-validate";
import type { SheetGrid } from "./sheet-grid";

const GRID: SheetGrid = {
  name: "Sheet1",
  rows: [
    ["Person", "2026-01", "2026-02"],
    ["Ann", "40", "35,5"],
    ["Bob", "20", "x"],
    [],
    ["Cy"],
  ],
  truncated: false,
};

const plain = { sheet: GRID };

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
    expect(validateForecastRows([], plain)).toEqual({ ok: [], rejected: [], duplicates: [], collisions: [], subPeriods: [] });
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

describe("validateForecastRows: hours normalisation", () => {
  it("rounds every row to two decimals, not only sums", () => {
    const out = validateForecastRows([{ person: "Ann", period: "2026-01", hours: 40.004 }], plain);
    expect(out.ok[0].hours).toBe(40);
  });

  it("turns -0 into 0", () => {
    const out = validateForecastRows([{ person: "Ann", period: "2026-01", hours: -0 }], plain);
    expect(Object.is(out.ok[0].hours, 0)).toBe(true);
  });
});

describe("validateForecastRows: duplicates", () => {
  it("sums Ann / 'ann ' for the same period into one row and reports it", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 40, email: "a@x.io", rate: 90, source: "Sheet1!B2" },
        { person: "ann ", period: "2026-01", hours: 20, email: "other@x.io", rate: 10, source: "Sheet1!B9" },
      ],
      plain,
    );
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 60, email: "a@x.io", rate: 90 }]);
    expect("source" in out.ok[0]).toBe(false);
    expect(out.duplicates).toEqual([
      { person: "Ann", period: "2026-01", count: 2, sources: ["Sheet1!B2", "Sheet1!B9"] },
    ]);
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
    expect(out.duplicates).toEqual([{ person: "Ann", period: "2026-01", count: 3, sources: [] }]);
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
    expect(out.duplicates).toEqual([{ person: "Ann", period: "2026-01", count: 2, sources: [] }]);
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
});

// §500 fix wave 2 (CR C1): two cells of ONE sheet row that land on the same
// person and period are a collision — never summed, never written.
describe("validateForecastRows: same-row collisions", () => {
  it("reports two hand-route cells of one row as a collision and keeps them out of ok", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 10, source: "Sheet1!B2" },
        { person: "Ann", period: "2026-01", hours: 20, source: "Sheet1!C2" },
        { person: "Ann", period: "2026-02", hours: 5, source: "Sheet1!D2" },
      ],
      plain,
    );
    expect(out.collisions).toEqual([{ person: "Ann", period: "2026-01", sources: ["Sheet1!B2", "Sheet1!C2"] }]);
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-02", hours: 5, source: "Sheet1!D2" }]);
    expect(out.duplicates).toEqual([]);
  });

  it("keeps summing duplicates that come from DIFFERENT rows", () => {
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 10, source: "Sheet1!B2" },
        { person: "Ann", period: "2026-01", hours: 20, source: "Sheet1!B3" },
      ],
      plain,
    );
    expect(out.collisions).toEqual([]);
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 30 }]);
    expect(out.duplicates).toHaveLength(1);
  });

  it("reports two cells of one row with the same person and period, whichever spelling names the sheet", () => {
    const sheet: SheetGrid = { name: "S", rows: [["Name", "Jan 2026", "Jan 2026"], ["Ann", "10", "20"]], truncated: false };
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 10, source: "S!B2" },
        { person: "Ann", period: "2026-01", hours: 20, source: "'S'!C2" },
      ],
      { sheet },
    );
    expect(out.rejected).toEqual([]);
    expect(out.collisions).toEqual([{ person: "Ann", period: "2026-01", sources: ["S!B2", "'S'!C2"] }]);
    expect(out.ok).toEqual([]);
  });
});
