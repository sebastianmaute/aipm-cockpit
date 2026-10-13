// §500 — how a header row's cells become periods. The hand route, detection and
// the Claude near-cell check all read a header through `assignRunPeriods`, so
// these pin the one definition.
import { describe, expect, it } from "vitest";
import { assignRunDetailed, assignRunPeriods, classifyPeriodCell, parsePeriodLabel } from "./period-assign";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

describe("assignRunPeriods — year rollover", () => {
  it("reads a two-year year-less Jan…Dec Jan…Dec as 2026 then 2027", () => {
    const out = assignRunPeriods(["Name", ...MONTHS_EN, ...MONTHS_EN], { defaultYear: 2026 });
    expect(out[0]).toBeNull();
    expect(out.slice(1, 13)).toEqual(MONTHS_EN.map((_, i) => `2026-${String(i + 1).padStart(2, "0")}`));
    expect(out.slice(13)).toEqual(MONTHS_EN.map((_, i) => `2027-${String(i + 1).padStart(2, "0")}`));
  });

  it("reads a fiscal Jul…Jun as Jul–Dec 2026 and Jan–Jun 2027", () => {
    const fiscal = ["Jul", "Aug", "Sep", "Okt", "Nov", "Dez", "Jan", "Feb", "Mär", "Apr", "Mai", "Jun"];
    expect(assignRunPeriods(fiscal, { defaultYear: 2026 })).toEqual([
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
      "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06",
    ]);
  });

  it("reads KW50…KW52 KW01 KW02 across the turn of the year", () => {
    expect(assignRunPeriods(["KW50", "KW51", "KW52", "KW01", "KW02"], { defaultYear: 2026 })).toEqual([
      "2026-W50", "2026-W51", "2026-W52", "2027-W01", "2027-W02",
    ]);
  });

  it("lets a cell that names its year set the running year: Dez 2026 | Jan is January 2027", () => {
    expect(assignRunPeriods(["Dez 2026", "Jan", "Feb"], { defaultYear: 2025 })).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(assignRunPeriods(["KW50 2026", "KW01"], {})).toEqual(["2026-W50", "2027-W01"]);
    expect(assignRunPeriods(["2026-12", "Jan"], {})).toEqual(["2026-12", "2027-01"]);
  });

  it("checks week 53 against the year the week lands in", () => {
    // 2026 has 53 ISO weeks, 2027 has 52.
    expect(assignRunPeriods(["KW52", "KW53"], { defaultYear: 2026 })).toEqual(["2026-W52", "2026-W53"]);
    expect(assignRunPeriods(["KW52", "KW01", "KW53"], { defaultYear: 2026 })).toEqual(["2026-W52", "2027-W01", null]);
  });

  it("does not roll on an equal index, and skips non-period cells without breaking the run", () => {
    expect(assignRunPeriods(["Jan 2026", "Jan 2026"], {})).toEqual(["2026-01", "2026-01"]);
    expect(assignRunPeriods(["Nov", "Total", "Dez", "Rate", "Jan"], { defaultYear: 2026 })).toEqual([
      "2026-11", null, "2026-12", null, "2027-01",
    ]);
  });

  it("reads nothing year-less before a year is known", () => {
    expect(assignRunPeriods(["Nov", "Dez", "Jan 2027", "Feb"], {})).toEqual([null, null, "2027-01", "2027-02"]);
  });

  it("marks which periods took their year from the default year", () => {
    expect(assignRunDetailed(["Dez", "Jan", "Mar 2027", "Apr"], { defaultYear: 2026 })).toEqual([
      { period: "2026-12", assumed: true },
      { period: "2027-01", assumed: true },
      { period: "2027-03", assumed: false },
      { period: "2027-04", assumed: false },
    ]);
  });
});

describe("assignRunPeriods — dates a week apart", () => {
  it("reads Monday ISO dates a week apart as ISO weeks", () => {
    expect(assignRunPeriods(["Name", "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"])).toEqual([
      null, "2026-W02", "2026-W03", "2026-W04", "2026-W05", "2026-W06",
    ]);
  });

  it("reads dotted dates a week apart, with a gap of two weeks, as ISO weeks", () => {
    expect(assignRunPeriods(["05.01.2026", "12.01.2026", "26.01.2026"])).toEqual(["2026-W02", "2026-W03", "2026-W05"]);
  });

  it("reads Excel serials a week apart as weeks in a workbook, as months in a CSV", () => {
    const serials = ["46027", "46034", "46041"]; // 2026-01-05, -12, -19
    expect(assignRunPeriods(serials, { numbers: "dot" })).toEqual(["2026-W02", "2026-W03", "2026-W04"]);
    expect(assignRunPeriods(serials, { numbers: "text" })).toEqual(["2026-01", "2026-01", "2026-01"]);
  });

  it("keeps month-spaced dates as months: Feb 1 to Mar 1 is 28 days", () => {
    expect(assignRunPeriods(["2026-01-01", "2026-02-01", "2026-03-01"])).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(assignRunPeriods(["2026-02-01", "2026-03-01"])).toEqual(["2026-02", "2026-03"]);
  });

  it("needs the closest gap to be exactly one week", () => {
    expect(assignRunPeriods(["2026-01-05", "2026-01-19", "2026-02-02"])).toEqual(["2026-01", "2026-01", "2026-02"]);
  });

  it("keeps months when the run mixes dates with month labels", () => {
    expect(assignRunPeriods(["2026-01-05", "2026-01-12", "Feb 2026"])).toEqual(["2026-01", "2026-01", "2026-02"]);
  });
});

describe("parsePeriodLabel and classifyPeriodCell — one cell", () => {
  it("reads one cell without a run: no rollover, a date is its month", () => {
    expect(parsePeriodLabel("Jan", 2026)).toBe("2026-01");
    expect(parsePeriodLabel("2026-01-05")).toBe("2026-01");
    expect(parsePeriodLabel("Jan")).toBeNull();
  });

  it("says what a cell names before any year is filled in", () => {
    expect(classifyPeriodCell("Jan")).toEqual({ kind: "month", index: 1 });
    expect(classifyPeriodCell("KW53")).toEqual({ kind: "week", index: 53 });
    expect(classifyPeriodCell("KW54")).toBeNull();
    expect(classifyPeriodCell("05.01.2026")).toEqual({ kind: "month", index: 1, year: 2026, date: "2026-01-05" });
    expect(classifyPeriodCell("2027")).toBeNull();
  });
});
