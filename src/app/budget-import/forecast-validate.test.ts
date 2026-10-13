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
    expect(validateForecastRows([], plain)).toEqual({ ok: [], rejected: [], duplicates: [], collisions: [] });
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
