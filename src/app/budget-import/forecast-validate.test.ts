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

const plain = { sheet: GRID, requireSource: false };
const strict = { sheet: GRID, requireSource: true };

function gridNamed(name: string): SheetGrid {
  return { name, rows: [["Person", "2026-01"], ["Ann", "40"]], truncated: false };
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

  it("reads the cell in its column's decimal style", () => {
    // "12,5" is 12.5 in its comma-style column.
    const german: SheetGrid = { name: "Sheet1", rows: [["Person", "2026-01", "2026-02"], ["Ann", "12,5", "1.234,5"]], truncated: false };
    const opts = { sheet: german, requireSource: true };
    expect(validateForecastRows([row("Sheet1!B2", 12.5)], opts).rejected).toEqual([]);
    expect(validateForecastRows([row("Sheet1!C2", 700)], opts).rejected).toHaveLength(1);
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

  it("rejects a source whose sheet part is empty", () => {
    const unnamed: SheetGrid = { name: "", rows: [["Person", "2026-01"], ["Ann", "40"]], truncated: false };
    const opts = { sheet: unnamed, requireSource: true };
    for (const ref of ["!B2", "''!B2"]) {
      expect(validateForecastRows([row(ref)], opts).rejected.map((r) => r.reason)).toEqual(["source"]);
    }
    expect(validateForecastRows([row("!B2")], strict).rejected).toHaveLength(1);
  });

  it("does not check the source when requireSource is false, but keeps a string one", () => {
    const out = validateForecastRows([row("Sheet1!Z99")], plain);
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 40, source: "Sheet1!Z99" }]);
    expect(validateForecastRows([row(5)], plain).ok[0].source).toBeUndefined();
  });

  it("maps A1 letters to columns: AA is column 26, row 2 is rows[1]", () => {
    const wide: SheetGrid = {
      name: "Sheet1",
      rows: [
        [...Array.from({ length: 26 }, () => ""), "2026-01"],
        ["Ann", ...Array.from({ length: 25 }, () => ""), "12"],
      ],
      truncated: false,
    };
    const out = validateForecastRows([row("Sheet1!AA2", 12)], { sheet: wide, requireSource: true });
    expect(out.rejected).toEqual([]);
  });

  describe("sheet names with metacharacters", () => {
    it("matches a name with regex metacharacters, quoted and unquoted", () => {
      const sheet = gridNamed("Plan (v2)+");
      const opts = { sheet, requireSource: true };
      expect(validateForecastRows([row("Plan (v2)+!B2")], opts).rejected).toEqual([]);
      expect(validateForecastRows([row("'Plan (v2)+'!B2")], opts).rejected).toEqual([]);
    });

    it("does not treat the sheet name as a pattern", () => {
      const sheet = gridNamed("Plan (v2)+");
      const opts = { sheet, requireSource: true };
      for (const ref of ["Plan (v2)!B2", "Plan v2!B2", "Plan (v2)++!B2", "'Plan (v2)'!B2"]) {
        expect(validateForecastRows([row(ref)], opts).rejected).toHaveLength(1);
      }
    });

    it("reads a doubled apostrophe in a quoted name as one", () => {
      const sheet = gridNamed("Bob's");
      const opts = { sheet, requireSource: true };
      expect(validateForecastRows([row("'Bob''s'!B2")], opts).rejected).toEqual([]);
      expect(validateForecastRows([row("Bob's!B2")], opts).rejected).toEqual([]);
      expect(validateForecastRows([row("'Bob's'!B2")], opts).rejected).toHaveLength(1);
      expect(validateForecastRows([row("'Bobs'!B2")], opts).rejected).toHaveLength(1);
    });

    it("accepts a quoted plain name", () => {
      expect(validateForecastRows([row("'Sheet1'!B2")], strict).rejected).toEqual([]);
    });
  });
});

describe("validateForecastRows: source evidence (Claude route)", () => {
  const cite = (person: string, period: string, hours: number, source: string, extra: object = {}) => ({
    person,
    period,
    hours,
    source,
    ...extra,
  });

  it("accepts a correct wide citation (person in the row, period in the column header)", () => {
    expect(validateForecastRows([cite("Ann", "2026-02", 35.5, "Sheet1!C2")], strict).rejected).toEqual([]);
    expect(validateForecastRows([cite("bob ", "2026-01", 20, "Sheet1!B3")], strict).rejected).toEqual([]);
  });

  it("accepts a correct long citation (person, period and hours in one row)", () => {
    const long: SheetGrid = {
      name: "Sheet1",
      rows: [["Person", "Period", "Hours"], ["Ann", "Jan 2026", "40"]],
      truncated: false,
    };
    const opts = { sheet: long, requireSource: true };
    expect(validateForecastRows([cite("Ann", "2026-01", 40, "Sheet1!C2")], opts).rejected).toEqual([]);
    const wrongPeriod = validateForecastRows([cite("Ann", "2026-02", 40, "Sheet1!C2")], opts);
    expect(wrongPeriod.rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("rejects Bob citing Ann's January cell for February", () => {
    const out = validateForecastRows([cite("Bob", "2026-02", 40, "Sheet1!B2")], strict);
    expect(out.ok).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("rejects a cell on another person's row even with the right period and hours", () => {
    const out = validateForecastRows([cite("Bob", "2026-01", 40, "Sheet1!B2")], strict);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("rejects the person's own row cited for a period of another column", () => {
    const out = validateForecastRows([cite("Ann", "2026-02", 40, "Sheet1!B2")], strict);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  const withEmail: SheetGrid = {
    name: "Sheet1",
    rows: [["Person", "Email", "2026-01"], ["Annie", " Ann@X.io", "40"]],
    truncated: false,
  };

  it("requires the person on the cited row: an email alone does not vouch", () => {
    const opts = { sheet: withEmail, requireSource: true };
    const byEmail = cite("Ann", "2026-01", 40, "Sheet1!C2", { email: "ann@x.io" });
    const out = validateForecastRows([byEmail], opts);
    expect(out.ok).toEqual([]);
    expect(out.rejected).toEqual([{ row: byEmail, reason: "source", detail: "person-not-on-row" }]);
  });

  it("keeps an email that is on the cited row", () => {
    const opts = { sheet: withEmail, requireSource: true };
    const out = validateForecastRows([cite("annie", "2026-01", 40, "Sheet1!C2", { email: "ann@x.io" })], opts);
    expect(out.ok).toEqual([{ person: "annie", email: "ann@x.io", period: "2026-01", hours: 40, source: "Sheet1!C2" }]);
  });

  // Reviewer probe (§500 final review): the model put Bob's email on Ann's row,
  // and matching by email first sent Ann's 40 hours to Bob.
  it("strips an email the cited row does not hold, so it cannot re-route the hours", () => {
    const out = validateForecastRows([cite("Ann", "2026-01", 40, "Sheet1!B2", { email: "bob@corp" })], strict);
    expect(out.rejected).toEqual([]);
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 40, source: "Sheet1!B2" }]);
  });

  it("keeps a model email on the hand route, where nothing is cited", () => {
    const out = validateForecastRows([cite("Ann", "2026-01", 40, "Sheet1!B2", { email: "bob@corp" })], plain);
    expect(out.ok[0].email).toBe("bob@corp");
  });

  it("does not let the cited cell vouch for the person", () => {
    const out = validateForecastRows([cite("40", "2026-01", 40, "Sheet1!B2")], strict);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });
});

describe("validateForecastRows: why a source was rejected", () => {
  const cite = (person: string, period: string, hours: number, source?: string) => ({ person, period, hours, source });
  const detailsOf = (rows: unknown[], opts = strict) =>
    validateForecastRows(rows, opts).rejected.map((r) => (r.reason === "source" ? r.detail : r.reason));

  it("names a missing, malformed or out-of-sheet reference", () => {
    expect(detailsOf([cite("Ann", "2026-01", 40)])).toEqual(["bad-ref"]);
    expect(detailsOf([cite("Ann", "2026-01", 40, "Other!B2")])).toEqual(["bad-ref"]);
    expect(detailsOf([cite("Ann", "2026-01", 40, "Sheet1!b2")])).toEqual(["bad-ref"]);
    expect(detailsOf([cite("Ann", "2026-01", 40, "Sheet1!Z99")])).toEqual(["bad-ref"]);
  });

  it("names a cell that does not hold the hours", () => {
    expect(detailsOf([cite("Ann", "2026-01", 80, "Sheet1!B2")])).toEqual(["value-mismatch"]);
    expect(detailsOf([cite("Ann", "2026-01", 40, "Sheet1!A2")])).toEqual(["value-mismatch"]);
  });

  it("names a person who is not on the cited row", () => {
    expect(detailsOf([cite("Bob", "2026-01", 40, "Sheet1!B2")])).toEqual(["person-not-on-row"]);
  });

  it("names a period that is neither in the row nor above the cell", () => {
    expect(detailsOf([cite("Ann", "2026-02", 40, "Sheet1!B2")])).toEqual(["period-not-near"]);
  });

  it("names a cell already used by an earlier row, on either route", () => {
    const rows = [cite("Ann", "2026-01", 40, "Sheet1!B2"), cite("Ann", "2026-01", 40, "Sheet1!B2")];
    expect(detailsOf(rows)).toEqual(["cell-reused"]);
    expect(detailsOf(rows, plain)).toEqual(["cell-reused"]);
  });

  it("gives no detail for the other reasons", () => {
    const out = validateForecastRows([cite("Ann", "2026-01", -1, "Sheet1!B2")], strict);
    expect(out.rejected).toEqual([{ row: cite("Ann", "2026-01", -1, "Sheet1!B2"), reason: "hours" }]);
  });
});

describe("validateForecastRows: a default year for headers without one", () => {
  const sheet: SheetGrid = { name: "Sheet1", rows: [["Person", "Jan", "Feb"], ["Ann", "40", "35"]], truncated: false };
  const cite = (period: string) => ({ person: "Ann", period, hours: 40, source: "Sheet1!B2" });

  it("accepts a row under a year-less header, the period written with or without its year", () => {
    for (const period of ["Jan 2026", "Jan", "2026-01"]) {
      const out = validateForecastRows([cite(period)], { sheet, requireSource: true, defaultYear: 2026 });
      expect(out.rejected).toEqual([]);
      expect(out.ok.map((r) => r.period)).toEqual(["2026-01"]);
    }
  });

  it("rejects a period of another year than the header is read in", () => {
    const out = validateForecastRows([cite("Jan 2026")], { sheet, requireSource: true, defaultYear: 2025 });
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("without a year, a year-less period is not a period and the header vouches for nothing", () => {
    expect(validateForecastRows([cite("Jan")], strict).rejected.map((r) => r.reason)).toEqual(["period"]);
    const opts = { sheet, requireSource: true };
    expect(validateForecastRows([cite("Jan 2026")], opts).rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("does not let the person cell vouch for the period: Jan is a name, not January", () => {
    const long: SheetGrid = { name: "Sheet1", rows: [["Person", "Period", "Hours"], ["Jan", "Feb", "40"]], truncated: false };
    const opts = { sheet: long, requireSource: true, defaultYear: 2026 };
    const asJanuary = { person: "Jan", period: "Jan", hours: 40, source: "Sheet1!C2" };
    expect(validateForecastRows([asJanuary], opts).rejected.map((r) => r.reason)).toEqual(["source"]);
    const asFebruary = { ...asJanuary, period: "Feb" };
    expect(validateForecastRows([asFebruary], opts).ok.map((r) => r.period)).toEqual(["2026-02"]);
  });
});

describe("validateForecastRows: a source cell is used once", () => {
  const row = (source: string) => ({ person: "Ann", period: "2026-01", hours: 40, source });

  it("rejects the second row citing the same cell", () => {
    const out = validateForecastRows([row("Sheet1!B2"), row("Sheet1!B2")], strict);
    expect(out.ok).toEqual([{ person: "Ann", period: "2026-01", hours: 40, source: "Sheet1!B2" }]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
    expect(out.duplicates).toEqual([]);
  });

  it("treats quoted and bare spellings of one cell as the same cell", () => {
    const out = validateForecastRows([row("'Sheet1'!B2"), row("Sheet1!B2")], strict);
    expect(out.ok).toHaveLength(1);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("applies on the hand-parsed route too", () => {
    const out = validateForecastRows([row("Sheet1!B2"), row("Sheet1!B2")], plain);
    expect(out.ok).toHaveLength(1);
    expect(out.rejected.map((r) => r.reason)).toEqual(["source"]);
  });

  it("does not burn a cell on a row that was rejected for another reason", () => {
    const out = validateForecastRows([{ ...row("Sheet1!B2"), hours: -1 }, row("Sheet1!B2")], plain);
    expect(out.ok).toHaveLength(1);
    expect(out.rejected.map((r) => r.reason)).toEqual(["hours"]);
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

  it("reports two accepted Claude rows citing cells of one row with the same person and period", () => {
    const sheet: SheetGrid = { name: "S", rows: [["Name", "Jan 2026", "Jan 2026"], ["Ann", "10", "20"]], truncated: false };
    const out = validateForecastRows(
      [
        { person: "Ann", period: "2026-01", hours: 10, source: "S!B2" },
        { person: "Ann", period: "2026-01", hours: 20, source: "'S'!C2" },
      ],
      { sheet, requireSource: true },
    );
    expect(out.rejected).toEqual([]);
    expect(out.collisions).toEqual([{ person: "Ann", period: "2026-01", sources: ["S!B2", "'S'!C2"] }]);
    expect(out.ok).toEqual([]);
  });
});

// §500 fix wave 2 (CR I3, RR I2, RR minor 3, CR minor 5): the Claude route's
// period must be the NEAREST header above the cited cell, read as that header
// row's run; the person cell is excluded by position; numbers are read by the
// sheet's own rule.
describe("validateForecastRows: the nearest period header above the cited cell", () => {
  const strictOn = (rows: string[][], defaultYear?: number, numbers?: "dot" | "text") => ({
    sheet: { name: "S", rows, truncated: false, numbers } as SheetGrid,
    requireSource: true,
    defaultYear,
  });
  const detail = (out: ReturnType<typeof validateForecastRows>) =>
    out.rejected.map((r) => (r.reason === "source" ? r.detail : r.reason));

  it("rejects a period that only a Start date elsewhere on the row names (CR probe)", () => {
    const opts = strictOn([["Name", "Start", "Jan 2026", "Feb 2026"], ["Ann", "01.02.2026", "10", "20"]]);
    // The hand route reads this cell, so its period decides (rr7 I1).
    expect(detail(validateForecastRows([{ person: "Ann", period: "2026-02", hours: 10, source: "S!C2" }], opts))).toEqual(["period-conflict"]);
    expect(validateForecastRows([{ person: "Ann", period: "2026-01", hours: 10, source: "S!C2" }], opts).ok).toHaveLength(1);
  });

  it("reads stacked year blocks by the block the cell sits in", () => {
    const opts = strictOn([
      ["Name", "Jan 2026", "Feb 2026"], ["Ann", "10", "20"],
      ["Name", "Jan 2027", "Feb 2027"], ["Ann", "30", "40"],
    ]);
    expect(validateForecastRows([{ person: "Ann", period: "Jan 2027", hours: 30, source: "S!B4" }], opts).ok.map((r) => r.period)).toEqual(["2027-01"]);
    // The hand route reads this cell, so its period decides (rr7 I1).
    expect(detail(validateForecastRows([{ person: "Ann", period: "Jan 2026", hours: 30, source: "S!B4" }], opts))).toEqual(["period-conflict"]);
  });

  it("reads a year-less header as its run: Jan after Dez is next January (RR probe)", () => {
    const opts = strictOn([["Name", "Nov", "Dez", "Jan", "Feb"], ["Ann", "1", "2", "3", "4"]], 2026);
    const claim = (period: string) => validateForecastRows([{ person: "Ann", period, hours: 3, source: "S!D2" }], opts);
    expect(claim("Jan 2027").ok.map((r) => r.period)).toEqual(["2027-01"]);
    expect(claim("Jan").ok.map((r) => r.period)).toEqual(["2027-01"]);
    // The hand route reads this cell, so its period decides (rr7 I1).
    expect(detail(claim("Jan 2026"))).toEqual(["period-conflict"]);
  });

  it("reads dates a week apart as weeks, matching a week or the same date", () => {
    const opts = strictOn([["Name", "2026-01-05", "2026-01-12"], ["Ann", "40", "40"]]);
    const claim = (period: string) => validateForecastRows([{ person: "Ann", period, hours: 40, source: "S!C2" }], opts);
    expect(claim("2026-W03").ok.map((r) => r.period)).toEqual(["2026-W03"]);
    expect(claim("2026-01-12").ok.map((r) => r.period)).toEqual(["2026-W03"]);
    // The hand route reads this cell, so its period decides (rr7 I1).
    expect(detail(claim("2026-01"))).toEqual(["period-conflict"]);
  });

  it("falls back to the row when the column above holds no period, combining a year cell on the row", () => {
    const opts = strictOn([["Name", "Jahr", "Monat", "Stunden"], ["Ann", "2027", "Jan", "8"]], 2026);
    const claim = (period: string) => validateForecastRows([{ person: "Ann", period, hours: 8, source: "S!D2" }], opts);
    expect(claim("Jan 2027").ok.map((r) => r.period)).toEqual(["2027-01"]);
    expect(claim("Jan").ok.map((r) => r.period)).toEqual(["2027-01"]);
    // The hand route reads this cell, so its period decides (rr7 I1).
    expect(detail(claim("Jan 2026"))).toEqual(["period-conflict"]);
  });

  it("excludes the person cell by position, not by value: person Mai, period Mai", () => {
    const opts = strictOn([["Name", "Monat", "Stunden"], ["Mai", "Mai", "8"]], 2026);
    const out = validateForecastRows([{ person: "Mai", period: "Mai", hours: 8, source: "S!C2" }], opts);
    expect(out.rejected).toEqual([]);
    expect(out.ok.map((r) => r.period)).toEqual(["2026-05"]);
  });

  it("reads the cited cell by the sheet's number rule: a CSV 7,5 backs 7.5, never 75", () => {
    const csv = strictOn([["Person", "2026-01"], ["Ann", "7,5"]]);
    const claim = (hours: number) => validateForecastRows([{ person: "Ann", period: "2026-01", hours, source: "S!B2" }], csv);
    expect(detail(claim(75))).toEqual(["value-mismatch"]);
    expect(claim(7.5).ok).toHaveLength(1);
  });

  it("reads a workbook's stored numbers with a dot and its text cells by the column's style", () => {
    const xlsx = strictOn([["Person", "2026-01"], ["Ann", "2.625"], ["Bob", "7,5"]], undefined, "dot");
    const claim = (person: string, hours: number, source: string) =>
      validateForecastRows([{ person, period: "2026-01", hours, source }], xlsx);
    // Bob's "7,5" makes the column comma-style, where "2.625" would read 2625:
    // Ann's 2.625 is accepted only because a stored number reads with a dot.
    expect(claim("Ann", 2.625, "S!B2").ok).toHaveLength(1);
    expect(claim("Bob", 7.5, "S!B3").ok).toHaveLength(1);
    expect(detail(claim("Bob", 75, "S!B3"))).toEqual(["value-mismatch"]);
  });
});

describe("validateForecastRows: the year it assumed (Claude route)", () => {
  const opts = (rows: string[][]) => ({ sheet: { name: "S", rows, truncated: false } as SheetGrid, requireSource: true, defaultYear: 2026 });

  it("reports the default year when an accepted row's period took its year from it", () => {
    const out = validateForecastRows([{ person: "Ann", period: "Jan", hours: 1, source: "S!B2" }], opts([["Name", "Jan", "Feb"], ["Ann", "1", "2"]]));
    expect(out.assumedYear).toEqual({ year: 2026, rolled: false });
  });

  it("says so when the header ran into the next year", () => {
    const out = validateForecastRows([{ person: "Ann", period: "Jan", hours: 2, source: "S!C2" }], opts([["Name", "Dez", "Jan"], ["Ann", "1", "2"]]));
    expect(out.ok.map((r) => r.period)).toEqual(["2027-01"]);
    expect(out.assumedYear).toEqual({ year: 2026, rolled: true });
  });

  it("reports nothing when the sheet names the year, or for a rejected row", () => {
    const labelled = validateForecastRows([{ person: "Ann", period: "Jan 2026", hours: 1, source: "S!B2" }], opts([["Name", "Jan 2026"], ["Ann", "1"]]));
    expect(labelled.assumedYear).toBeUndefined();
    const rejected = validateForecastRows([{ person: "Bob", period: "Jan", hours: 1, source: "S!B2" }], opts([["Name", "Jan"], ["Ann", "1"]]));
    expect(rejected.assumedYear).toBeUndefined();
  });
});

describe("validateForecastRows: a long sheet of Monday dates (round 2)", () => {
  const sheet: SheetGrid = {
    name: "S",
    rows: [["Name", "Woche", "Stunden"], ["Ann", "2026-01-05", "40"], ["Ann", "2026-01-12", "30"]],
    truncated: false,
  };
  const claim = (period: string) => validateForecastRows([{ person: "Ann", period, hours: 30, source: "S!C3" }], { sheet, requireSource: true });

  it("reads the period cell as its ISO week, as the hand route does", () => {
    expect(claim("2026-W03").ok.map((r) => r.period)).toEqual(["2026-W03"]);
    expect(claim("2026-01-12").ok.map((r) => r.period)).toEqual(["2026-W03"]);
    // The hand route reads this cell, so its period decides (rr7 I1).
    expect(claim("2026-01").rejected.map((r) => (r.reason === "source" ? r.detail : r.reason))).toEqual(["period-conflict"]);
  });
});

describe("validateForecastRows: a title row's lone date is no period header (round 3)", () => {
  it("accepts long-sheet claims under a title row that holds a date (rr2 probe)", () => {
    const sheet: SheetGrid = {
      name: "S",
      rows: [["Forecast", "", "01.10.2026"], ["Name", "Monat", "Stunden"], ["Ann", "Okt 2026", "8"], ["Ann", "Nov 2026", "4"]],
      truncated: false,
    };
    const out = validateForecastRows([
      { person: "Ann", period: "Okt 2026", hours: 8, source: "S!C3" },
      { person: "Ann", period: "Nov 2026", hours: 4, source: "S!C4" },
    ], { sheet, requireSource: true });
    expect(out.rejected).toEqual([]);
    expect(out.ok.map((r) => r.period)).toEqual(["2026-10", "2026-11"]);
  });
});

// Round 5 (rr4 Important 2): a title row's date RANGE became the long sheet's
// period header — the right months rejected, a wrong December accepted.
describe("validateForecastRows: a title row's date range is no period header (round 5)", () => {
  const sheet: SheetGrid = {
    name: "S",
    rows: [["Zeitraum", "01.01.2026", "31.12.2026"], ["Name", "Monat", "Stunden"], ["Ann", "Jan 2026", "8"], ["Ann", "Feb 2026", "4"]],
    truncated: false,
  };

  it("accepts the months on the cited rows", () => {
    const out = validateForecastRows([
      { person: "Ann", period: "Jan 2026", hours: 8, source: "S!C3" },
      { person: "Ann", period: "Feb 2026", hours: 4, source: "S!C4" },
    ], { sheet, requireSource: true });
    expect(out.rejected).toEqual([]);
    expect(out.ok.map((r) => [r.period, r.hours])).toEqual([["2026-01", 8], ["2026-02", 4]]);
  });

  it("rejects a December claimed for the same cells", () => {
    const out = validateForecastRows([
      { person: "Ann", period: "Dez 2026", hours: 8, source: "S!C3" },
      { person: "Ann", period: "Dez 2026", hours: 4, source: "S!C4" },
    ], { sheet, requireSource: true });
    expect(out.ok).toEqual([]);
    // The hand route reads this cell, so its period decides (rr7 I1).
    expect(out.rejected.map((r) => (r.reason === "source" ? r.detail : r.reason))).toEqual(["period-conflict", "period-conflict"]);
  });
});

// Round 4 (rr3 Important 1): text inside the grid never bounds the search for a
// period header. A placeholder, a unit row or a Plan | Ist sub-header between
// the header and the cited cell once rejected every claim beneath it.
describe("validateForecastRows: in-grid text does not bound the header search (round 4)", () => {
  const sheetOf = (rows: string[][]): SheetGrid => ({ name: "S", rows, truncated: false });
  const claim = (person: string, period: string, hours: number, source: string) => ({ person, period, hours, source });

  it.each(["-", "Urlaub", "krank"])("accepts every claim of a complete reply with %s in a month cell", (placeholder) => {
    const sheet = sheetOf([["Name", "Jan 2026", "Feb 2026", "Mär 2026"], ["Ann", "8", placeholder, "8"], ["Bob", "4", "4", "4"]]);
    const out = validateForecastRows([
      claim("Ann", "Jan 2026", 8, "S!B2"), claim("Ann", "Mär 2026", 8, "S!D2"),
      claim("Bob", "Jan 2026", 4, "S!B3"), claim("Bob", "Feb 2026", 4, "S!C3"), claim("Bob", "Mär 2026", 4, "S!D3"),
    ], { sheet, requireSource: true });
    expect(out.rejected).toEqual([]);
    expect(out.ok).toHaveLength(5);
  });

  it("accepts year-less claims under a year-less header with n/a in a month cell", () => {
    const sheet = sheetOf([["Name", "Jan", "Feb", "Mär"], ["Ann", "8", "n/a", "8"], ["Bob", "4", "4", "4"]]);
    const out = validateForecastRows([
      claim("Ann", "Jan", 8, "S!B2"), claim("Ann", "Mär", 8, "S!D2"),
      claim("Bob", "Jan", 4, "S!B3"), claim("Bob", "Feb", 4, "S!C3"), claim("Bob", "Mär", 4, "S!D3"),
    ], { sheet, requireSource: true, defaultYear: 2026 });
    expect(out.rejected).toEqual([]);
    expect(out.ok.filter((r) => r.person === "Bob").map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("accepts every claim under a unit row (Std) beneath the month header", () => {
    const sheet = sheetOf([["Name", "Jan 2026", "Feb 2026", "Mär 2026"], ["", "Std", "Std", "Std"], ["Ann", "8", "8", "8"]]);
    const out = validateForecastRows([
      claim("Ann", "Jan 2026", 8, "S!B3"), claim("Ann", "Feb 2026", 8, "S!C3"), claim("Ann", "Mär 2026", 8, "S!D3"),
    ], { sheet, requireSource: true });
    expect(out.rejected).toEqual([]);
    expect(out.ok.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("accepts the Plan cells under a Plan | Ist sub-header", () => {
    const sheet = sheetOf([["Name", "Jan 2026", "", "Feb 2026", ""], ["", "Plan", "Ist", "Plan", "Ist"], ["Ann", "8", "6", "8", "7"]]);
    const out = validateForecastRows([
      claim("Ann", "Jan 2026", 8, "S!B3"), claim("Ann", "Feb 2026", 8, "S!D3"),
    ], { sheet, requireSource: true });
    expect(out.rejected).toEqual([]);
    expect(out.ok.map((r) => r.period)).toEqual(["2026-01", "2026-02"]);
  });

  it("accepts Bob's sprint-date claims under a - in Ann's row and sums his January to 80", () => {
    const sheet = sheetOf([
      ["Name", "05.01.2026", "19.01.2026", "02.02.2026", "16.02.2026"],
      ["Ann", "40", "-", "40", "40"],
      ["Bob", "40", "40", "40", "40"],
    ]);
    const out = validateForecastRows([
      claim("Ann", "05.01.2026", 40, "S!B2"), claim("Ann", "02.02.2026", 40, "S!D2"), claim("Ann", "16.02.2026", 40, "S!E2"),
      claim("Bob", "05.01.2026", 40, "S!B3"), claim("Bob", "19.01.2026", 40, "S!C3"),
      claim("Bob", "02.02.2026", 40, "S!D3"), claim("Bob", "16.02.2026", 40, "S!E3"),
    ], { sheet, requireSource: true });
    expect(out.rejected).toEqual([]);
    expect(out.collisions).toEqual([]);
    expect(out.ok.find((r) => r.person === "Bob" && r.period === "2026-01")?.hours).toBe(80);
    expect(out.ok.find((r) => r.person === "Ann" && r.period === "2026-01")?.hours).toBe(40);
  });
});

// Fix 7 (replaces final review I1's header-row stop): the column header above
// the cited cell and a period cell on the cited row are two sources. When both
// exist and name DIFFERENT periods, the claim is refused `period-conflict` —
// visible, never wrong hours. When only one exists, it decides, as before. A
// row's date is no evidence against a header that labels its column as
// something else (`Start`) and heads only numbers on the row: the CR probe's
// wide sheet with a Start column.
describe("validateForecastRows: conflicting period evidence is refused (fix 7)", () => {
  const strictOn = (rows: string[][], numbers?: "dot" | "text") => ({
    sheet: { name: "S", rows, truncated: false, numbers } as SheetGrid,
    requireSource: true,
  });
  const claim = (period: string, hours: number, source: string, person = "Ann") => ({ person, period, hours, source });
  const detail = (out: ReturnType<typeof validateForecastRows>) =>
    out.rejected.map((r) => (r.reason === "source" ? r.detail : r.reason));
  const periodsOf = (out: ReturnType<typeof validateForecastRows>) => out.ok.map((r) => [r.period, r.hours]);

  const quarter = (header: string[], numbers?: "dot" | "text") => strictOn(numbers === "dot"
    ? [["Zeitraum", "46023", "46112"], [], header, ["Ann", "46023", "40", "35"], ["Ann", "46054", "30", "25"], ["Ann", "46082", "20", "15"]]
    : [["Zeitraum", "01.01.2026", "31.03.2026"], [], header, ["Ann", "Jan 2026", "40", "35"], ["Ann", "Feb 2026", "30", "25"], ["Ann", "Mär 2026", "20", "15"]], numbers);

  // rr7 I1: where the hand route reads the sheet clearly, its reading decides
  // (the "hand route's reading" describe below); these title rows no longer
  // refuse the right months there.
  it.each([
    ["Name | Monat | Stunden, CSV", ["Name", "Monat", "Stunden"], "text"],
    ["Name | Monat | Stunden, workbook serials", ["Name", "Monat", "Stunden"], "dot"],
    ["Wer | Wann | Wieviel, CSV", ["Wer", "Wann", "Wieviel"], "text"],
  ] as const)("accepts the right months under a Q1 range title row over a clear long sheet (%s)", (_label, header, numbers) => {
    const opts = quarter([...header], numbers);
    const all = validateForecastRows([claim("Jan 2026", 40, "S!C4"), claim("Feb 2026", 30, "S!C5"), claim("Mar 2026", 20, "S!C6")], opts);
    expect(all.rejected).toEqual([]);
    expect(periodsOf(all)).toEqual([["2026-01", 40], ["2026-02", 30], ["2026-03", 20]]);
    const wrong = validateForecastRows([claim("Mar 2026", 40, "S!C4")], opts);
    expect(wrong.ok).toEqual([]);
    expect(wrong.rejected).toEqual([{ row: claim("Mar 2026", 40, "S!C4"), reason: "source", detail: "period-conflict", periods: { sheet: "2026-01" } }]);
  });

  // Plan | Ist is ambiguous for the hand route, so the evidence rules decide.
  it.each([
    ["CSV", "text"],
    ["workbook serials", "dot"],
  ] as const)("refuses every claim for a cell whose row and title disagree, where the hand route asks (%s)", (_label, numbers) => {
    const opts = quarter(["Name", "Monat", "Plan", "Ist"], numbers);
    // January's cell: the row says January, the title's 31.03.2026 above it says March.
    for (const period of ["Jan 2026", "Mar 2026", "Feb 2026"]) {
      const out = validateForecastRows([claim(period, 40, "S!C4")], opts);
      expect(out.ok).toEqual([]);
      expect(detail(out)).toEqual(["period-conflict"]);
    }
    // Only March's cell, where the row and the title agree, stands.
    const all = validateForecastRows([claim("Jan 2026", 40, "S!C4"), claim("Feb 2026", 30, "S!C5"), claim("Mar 2026", 20, "S!C6")], opts);
    expect(periodsOf(all)).toEqual([["2026-03", 20]]);
    expect(detail(all)).toEqual(["period-conflict", "period-conflict"]);
  });

  it("names both periods of a row and header conflict: the row's, then the header's", () => {
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C4")], quarter(["Name", "Monat", "Plan", "Ist"]));
    expect(out.rejected).toEqual([
      { row: claim("Jan 2026", 40, "S!C4"), reason: "source", detail: "period-conflict", periods: { row: "2026-01", header: "2026-03" } },
    ]);
  });

  it("von | 01.01.2026 | bis | 31.03.2026 title row: the right months stand on a clear sheet, conflict where the hand route asks", () => {
    const clear = strictOn([
      ["von", "01.01.2026", "bis", "31.03.2026"], [],
      ["Name", "Rolle", "Monat", "Stunden"],
      ["Ann", "Dev", "Jan 2026", "40"], ["Ann", "Dev", "Feb 2026", "30"],
    ]);
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!D4"), claim("Feb 2026", 30, "S!D5")], clear))).toEqual([["2026-01", 40], ["2026-02", 30]]);
    expect(detail(validateForecastRows([claim("Mar 2026", 40, "S!D4")], clear))).toEqual(["period-conflict"]);
    // "bis" labels the Monat column, but Dev, not a number, sits under the
    // title's 01.01.2026: no exemption, so the row's January conflicts.
    const asks = strictOn([
      ["von", "01.01.2026", "bis", "31.03.2026"], [],
      ["Name", "Rolle", "Monat", "Plan", "Ist"],
      ["Ann", "Dev", "Jan 2026", "40", "35"], ["Ann", "Dev", "Feb 2026", "30", "25"],
    ]);
    const out = validateForecastRows([claim("Jan 2026", 40, "S!D4"), claim("Feb 2026", 30, "S!D5"), claim("Mar 2026", 40, "S!D4")], asks);
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["period-conflict", "period-conflict", "period-conflict"]);
  });

  it("a three-date metadata row: the right months stand on a clear sheet, conflict where the hand route asks", () => {
    const rows = (hours: string[], cells: (h: string) => string[]) => [
      ["Erstellt", "01.01.2026", "Stand", "15.01.2026", "Druck", "20.01.2026"], [],
      ["Name", "Monat", "Bemerkung", ...hours],
      ["Ann", "Feb 2026", "", ...cells("30")], ["Ann", "Mär 2026", "", ...cells("20")],
    ];
    const clear = strictOn(rows(["Stunden"], (h) => [h]));
    expect(periodsOf(validateForecastRows([claim("Feb 2026", 30, "S!D4"), claim("Mär 2026", 20, "S!D5")], clear))).toEqual([["2026-02", 30], ["2026-03", 20]]);
    expect(detail(validateForecastRows([claim("Jan 2026", 30, "S!D4")], clear))).toEqual(["period-conflict"]);
    const asks = strictOn(rows(["Plan", "Ist"], (h) => [h, "1"]));
    const out = validateForecastRows([claim("Feb 2026", 30, "S!D4"), claim("Mär 2026", 20, "S!D5"), claim("Jan 2026", 30, "S!D4")], asks);
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["period-conflict", "period-conflict", "period-conflict"]);
  });

  it.each([
    ["Stunden | Ist (the hand route reads the row)", ["Stunden", "Ist"]],
    ["Plan | Ist (the hand route asks)", ["Plan", "Ist"]],
  ])("does not sum two cells of one long row as sub-periods of a metadata row's dates: %s", (_label, hours) => {
    // The row and the dates above agree on January, so nothing conflicts; but
    // a header that the row's own period cell is not labelled by is no proof of
    // date columns finer than the period: the two cells collide (blocking)
    // instead of being added to 75.
    const opts = strictOn([
      ["Erstellt", "", "01.01.2026", "15.01.2026", "20.01.2026"], [],
      ["Name", "Monat", ...hours],
      ["Ann", "Jan 2026", "40", "35"],
    ]);
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C4"), claim("Jan 2026", 35, "S!D4")], opts);
    expect(out.rejected).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(out.ok).toEqual([]);
    expect(out.collisions).toEqual([{ person: "Ann", period: "2026-01", sources: ["S!C4", "S!D4"] }]);
  });

  // rr6 N2: a two-row header — the months on row 1, the person label on row 2.
  it.each([
    ["Name | Std | Std | Std", ["Name", "Std", "Std", "Std"], "text"],
    ["Mitarbeiter | Plan | Ist (CSV)", ["Mitarbeiter", "Plan", "Ist", "Plan"], "text"],
    ["Name | Std | Std | Std as workbook serials", ["Name", "Std", "Std", "Std"], "dot"],
  ] as const)("accepts the claims under a two-row header (%s)", (_label, second, numbers) => {
    const months = numbers === "dot" ? ["46023", "46054", "46082"] : ["Jan 2026", "Feb 2026", "Mär 2026"];
    const opts = strictOn([["", ...months], [...second], ["Ann", "40", "35", "30"]], numbers);
    const out = validateForecastRows([claim("Jan 2026", 40, "S!B3"), claim("Feb 2026", 35, "S!C3"), claim("Mar 2026", 30, "S!D3")], opts);
    expect(out.rejected).toEqual([]);
    expect(periodsOf(out)).toEqual([["2026-01", 40], ["2026-02", 35], ["2026-03", 30]]);
    expect(detail(validateForecastRows([claim("Mar 2026", 40, "S!B3")], opts))).toEqual(["period-not-near"]);
  });

  // rr6 N2 T2: the same two-row header with an Eintritt date on Ann's row. The
  // header and the row disagree for January's cell, so no claim for it stands.
  it.each([
    ["workbook serials", [["", "", "46023", "46054", "46082"], ["Name", "Eintritt", "Std", "Std", "Std"], ["Ann", "46082", "40", "35", "30"]], "dot"],
    ["CSV", [["", "", "Jan 2026", "Feb 2026", "Mär 2026"], ["Name", "Eintritt", "Std", "Std", "Std"], ["Ann", "01.03.2026", "40", "35", "30"]], "text"],
  ] as const)("refuses a Mar claim for January's cell when an Eintritt date on the row says March (%s)", (_label, rows, numbers) => {
    const opts = strictOn(rows.map((r) => [...r]), numbers);
    const wrong = validateForecastRows([claim("Mar 2026", 40, "S!C3")], opts);
    expect(wrong.ok).toEqual([]);
    expect(detail(wrong)).toEqual(["period-conflict"]);
    // The right month is refused too: the two sources disagree.
    expect(detail(validateForecastRows([claim("Jan 2026", 40, "S!C3")], opts))).toEqual(["period-conflict"]);
    // March's own cell agrees with the row: accepted.
    expect(periodsOf(validateForecastRows([claim("Mar 2026", 30, "S!E3")], opts))).toEqual([["2026-03", 30]]);
  });

  it("accepts Bob's claims below placeholder rows that name weeks or months in words", () => {
    const opts = strictOn([
      ["Name", "Jan 2026", "Feb 2026", "Mär 2026"],
      ["Carl", "Elternzeit", "Elternzeit", "2 Wochen Urlaub"],
      ["Dora", "", "Elternzeit (3 Monate)", ""],
      ["Eve", "Urlaub", "Urlaub", "Urlaub"],
      ["Bob", "4", "5", "6"],
    ]);
    const bob = (period: string, hours: number, source: string) => claim(period, hours, source, "Bob");
    const out = validateForecastRows([bob("Jan 2026", 4, "S!B5"), bob("Feb 2026", 5, "S!C5"), bob("Mär 2026", 6, "S!D5")], opts);
    expect(out.rejected).toEqual([]);
    expect(periodsOf(out)).toEqual([["2026-01", 4], ["2026-02", 5], ["2026-03", 6]]);
    expect(detail(validateForecastRows([bob("Feb 2026", 4, "S!B5")], opts))).toEqual(["period-not-near"]);
  });

  it("an Eintritt column labelled in the header row vouches for nothing: the header decides (CR probe shape)", () => {
    const opts = strictOn([
      ["Name", "Eintritt", "Jan 2026", "Feb 2026", "Mär 2026"],
      ["Dora", "", "", "Elternzeit (3 Monate)", ""],
      ["Bob", "01.03.2026", "4", "5", "6"],
    ]);
    const bob = (period: string, hours: number, source: string) => claim(period, hours, source, "Bob");
    expect(periodsOf(validateForecastRows([bob("Jan 2026", 4, "S!C3")], opts))).toEqual([["2026-01", 4]]);
    expect(detail(validateForecastRows([bob("Mar 2026", 4, "S!C3")], opts))).toEqual(["period-not-near"]);
  });

  it("a period word above the row's period cell is no label: a title range over Plan | Ist is refused", () => {
    // Projekt / Zeitraum above the long sheet's Name / Monat: the title's dates
    // sit over Stunden and Ist, and "Zeitraum" is a period word, not a label.
    // Plan | Ist: the hand route asks, so the evidence rules decide.
    const opts = strictOn([
      ["Projekt", "Zeitraum", "01.01.2026", "31.03.2026"],
      ["Name", "Monat", "Plan", "Ist"],
      ["Ann", "Mär 2026", "40", "35"],
    ]);
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C3")], opts);
    expect(out.ok).toEqual([]);
    expect(detail(out)).toEqual(["period-conflict"]);
  });

  it("sums sprint dates on a row whose Start date is labelled in the header row: no conflict", () => {
    const opts = strictOn([
      ["Name", "Start", "05.01.2026", "19.01.2026", "02.02.2026", "16.02.2026"],
      ["Bob", "01.03.2026", "40", "40", "40", "40"],
    ]);
    const bob = (period: string, source: string) => claim(period, 40, source, "Bob");
    const out = validateForecastRows([bob("05.01.2026", "S!C2"), bob("19.01.2026", "S!D2"), bob("02.02.2026", "S!E2"), bob("16.02.2026", "S!F2")], opts);
    expect(out.rejected).toEqual([]);
    expect(out.collisions).toEqual([]);
    expect(periodsOf(out)).toEqual([["2026-01", 80], ["2026-02", 80]]);
  });

  it("a date header and a date on the row in the same period are consistent: the claim stands", () => {
    const opts = strictOn([["", "", "05.01.2026", "02.02.2026"], ["Name", "Eintritt", "Std", "Std"], ["Bob", "10.01.2026", "40", "30"]]);
    expect(periodsOf(validateForecastRows([claim("05.01.2026", 40, "S!C3", "Bob")], opts))).toEqual([["2026-01", 40]]);
    expect(detail(validateForecastRows([claim("02.02.2026", 30, "S!D3", "Bob")], opts))).toEqual(["period-conflict"]);
  });

  it("does not count a CSV's five-digit number on the row as a date", () => {
    const opts = strictOn([["", "Jan 2026", "Feb 2026"], ["Name", "Std", "Std", "PersNr"], ["Ann", "40", "35", "46082"]]);
    expect(periodsOf(validateForecastRows([claim("Jan 2026", 40, "S!B3")], opts))).toEqual([["2026-01", 40]]);
  });

  it("does not stop at a person row holding only placeholders: Bob's claims below Carl's Urlaub row are checked against the month header", () => {
    const opts = strictOn([
      ["Name", "Jan 2026", "Feb 2026", "Mär 2026"],
      ["Carl", "Urlaub", "Urlaub", "Urlaub"],
      ["Bob", "4", "5", "6"],
    ]);
    const bob = (period: string, hours: number, source: string) => claim(period, hours, source, "Bob");
    const out = validateForecastRows([bob("Jan 2026", 4, "S!B3"), bob("Feb 2026", 5, "S!C3"), bob("Mär 2026", 6, "S!D3")], opts);
    expect(out.rejected).toEqual([]);
    expect(out.ok.map((r) => [r.period, r.hours])).toEqual([["2026-01", 4], ["2026-02", 5], ["2026-03", 6]]);
    // Still under that header: a wrong month for Bob's January cell is refused.
    expect(detail(validateForecastRows([bob("Feb 2026", 4, "S!B3")], opts))).toEqual(["period-not-near"]);
  });
});

// rr7 I1 (controller ruling): ONE source of truth. When the hand route's own
// detection of the cited sheet is clear (not unknown, nothing ambiguous) and
// reads the cited cell — or, on a long sheet, the cited cell's row — the claim
// must name the period the hand route reads there; a mismatch is
// `period-conflict` with the hand route's period. Title and metadata rows of
// key/value cells (`Erstellt von | Max | 01.03.2026`) once let a wrong month
// through the evidence exemption, and summed Stunden + Ist to 75.
describe("validateForecastRows: the hand route's reading decides the cells it reads (rr7 I1)", () => {
  const strictOn = (rows: string[][], numbers?: "dot" | "text", defaultYear?: number) => ({
    sheet: { name: "S", rows, truncated: false, numbers } as SheetGrid,
    requireSource: true,
    defaultYear,
  });
  const claim = (period: string, hours: number, source: string, person = "Ann") => ({ person, period, hours, source });
  const detail = (out: ReturnType<typeof validateForecastRows>) =>
    out.rejected.map((r) => (r.reason === "source" ? r.detail : r.reason));
  const periodsOf = (out: ReturnType<typeof validateForecastRows>) => out.ok.map((r) => [r.period, r.hours]);

  const keyValueTitle = {
    text: [["Erstellt von", "Max", "01.03.2026", "Stand", "02.03.2026"], ["Name", "Monat", "Stunden", "Bemerkung", "Ist"],
      ["Ann", "Jan 2026", "40", "", "35"], ["Bob", "Feb 2026", "30", "", "25"]],
    dot: [["Erstellt von", "Max", "46082", "Stand", "46083"], ["Name", "Monat", "Stunden", "Bemerkung", "Ist"],
      ["Ann", "46023", "40", "", "35"], ["Bob", "46054", "30", "", "25"]],
  };

  it.each(["text", "dot"] as const)("Erstellt von | Max | 01.03.2026 title (%s): the right months stand, March for January's cell is refused", (numbers) => {
    const opts = strictOn(keyValueTitle[numbers], numbers);
    const ok = validateForecastRows([claim("Jan 2026", 40, "S!C3"), claim("Feb 2026", 30, "S!C4", "Bob")], opts);
    expect(ok.rejected).toEqual([]);
    expect(periodsOf(ok)).toEqual([["2026-01", 40], ["2026-02", 30]]);
    const wrong = validateForecastRows([claim("Mar 2026", 40, "S!C3")], opts);
    expect(wrong.ok).toEqual([]);
    expect(wrong.rejected).toEqual([
      { row: claim("Mar 2026", 40, "S!C3"), reason: "source", detail: "period-conflict", periods: { sheet: "2026-01" } },
    ]);
  });

  const quarterTitle = {
    text: [["Projekt Alpha", "Forecast", "01.01.2026", "31.03.2026"], ["Name", "Monat", "Stunden", "Ist"],
      ["Ann", "01.01.2026", "40", "35"], ["Ann", "01.02.2026", "30", "25"], ["Ann", "01.03.2026", "20", "15"]],
    dot: [["Projekt Alpha", "Forecast", "46023", "46112"], ["Name", "Monat", "Stunden", "Ist"],
      ["Ann", "46023", "40", "35"], ["Ann", "46054", "30", "25"], ["Ann", "46082", "20", "15"]],
  };

  it.each(["text", "dot"] as const)("Projekt Alpha | Forecast | Q1 dates title (%s): each month's cell stands for its own month only", (numbers) => {
    const opts = strictOn(quarterTitle[numbers], numbers);
    const right = validateForecastRows([claim("Jan 2026", 40, "S!C3"), claim("Feb 2026", 30, "S!C4"), claim("Mar 2026", 20, "S!C5")], opts);
    expect(right.rejected).toEqual([]);
    expect(periodsOf(right)).toEqual([["2026-01", 40], ["2026-02", 30], ["2026-03", 20]]);
    // All three claimed as January: only January's own cell stands, nothing sums to 90.
    const allJan = validateForecastRows([claim("Jan 2026", 40, "S!C3"), claim("Jan 2026", 30, "S!C4"), claim("Jan 2026", 20, "S!C5")], opts);
    expect(periodsOf(allJan)).toEqual([["2026-01", 40]]);
    expect(detail(allJan)).toEqual(["period-conflict", "period-conflict"]);
    // A cell on a row the hand route reads, outside its hours column (Ist), keeps that row's period.
    expect(detail(validateForecastRows([claim("Mar 2026", 35, "S!D3")], opts))).toEqual(["period-conflict"]);
  });

  const monthTitle = {
    text: [["Projekt", "Alpha", "01.01.2026", "31.01.2026"], ["Name", "Datum", "Stunden", "Ist"], ["Ann", "15.01.2026", "40", "35"]],
    dot: [["Projekt", "Alpha", "46023", "46053"], ["Name", "Datum", "Stunden", "Ist"], ["Ann", "46037", "40", "35"]],
  };

  it.each(["text", "dot"] as const)("Projekt | Alpha | 01.01. | 31.01. over Stunden | Ist (%s): the two cells collide, never 75", (numbers) => {
    const out = validateForecastRows([claim("Jan 2026", 40, "S!C3"), claim("Jan 2026", 35, "S!D3")], strictOn(monthTitle[numbers], numbers));
    expect(out.rejected).toEqual([]);
    expect(out.subPeriods).toEqual([]);
    expect(out.ok).toEqual([]);
    expect(out.collisions).toEqual([{ person: "Ann", period: "2026-01", sources: ["S!C3", "S!D3"] }]);
  });

  it("reads the hand route in the validation's own default year (one reading per sheet and year)", () => {
    const sheet: SheetGrid = { name: "S", rows: [["Name", "Jan", "Feb", "Mär"], ["Ann", "1", "2", "3"]], truncated: false };
    const in2026 = validateForecastRows([claim("Jan 2026", 1, "S!B2")], { sheet, requireSource: true, defaultYear: 2026 });
    expect(periodsOf(in2026)).toEqual([["2026-01", 1]]);
    const in2027 = validateForecastRows([claim("Jan 2027", 1, "S!B2")], { sheet, requireSource: true, defaultYear: 2027 });
    expect(in2027.rejected).toEqual([]);
    expect(periodsOf(in2027)).toEqual([["2027-01", 1]]);
  });

  it("keeps the evidence rules for a cell the hand route does not read: an ambiguous sheet", () => {
    // Plan | Ist is ambiguous for the hand route, so the quarter range above
    // still conflicts with the rows (fix 7) rather than being settled by it.
    const opts = strictOn([
      ["Zeitraum", "01.01.2026", "", "31.03.2026"], [],
      ["Name", "Monat", "Plan", "Ist"],
      ["Ann", "Jan 2026", "40", "35"],
    ]);
    expect(detail(validateForecastRows([claim("Mar 2026", 35, "S!D4")], opts))).toEqual(["period-conflict"]);
    expect(validateForecastRows([claim("Mar 2026", 35, "S!D4")], opts).rejected[0]).toMatchObject({ periods: { row: "2026-01", header: "2026-03" } });
  });
});
