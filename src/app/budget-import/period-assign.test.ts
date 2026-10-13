// §500 — how a header row's cells become periods. The hand route, detection and
// the Claude near-cell check all read a header through `assignRunPeriods`, so
// these pin the one definition.
import { describe, expect, it } from "vitest";
import { assignCellPeriod, assignRunDetailed, assignRunPeriods, classifyPeriodCell, isWeekSpacedColumn, parsePeriodLabel } from "./period-assign";

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

  // Round 2: year-less cells BEFORE the first labelled one count back from it.
  it("counts back from the first labelled year: Nov | Dez | Jan 2027 is Nov and Dez 2026", () => {
    for (const defaultYear of [undefined, 2025, 2027]) {
      expect(assignRunDetailed(["Nov", "Dez", "Jan 2027", "Feb"], { defaultYear })).toEqual([
        { period: "2026-11", assumed: false },
        { period: "2026-12", assumed: false },
        { period: "2027-01", assumed: false },
        { period: "2027-02", assumed: false },
      ]);
    }
    expect(assignRunPeriods(["Jan", "Feb", "Mär 2026"], {})).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(assignRunPeriods(["KW51", "KW52", "KW01 2027"], {})).toEqual(["2026-W51", "2026-W52", "2027-W01"]);
    expect(assignRunPeriods(["Dez", "Jan", "Mar 2027", "Apr"], { defaultYear: 2026 })).toEqual(["2026-12", "2027-01", "2027-03", "2027-04"]);
  });

  it("keeps the default year when no cell names a year", () => {
    expect(assignRunDetailed(["Okt", "Nov", "Dez"], { defaultYear: 2026 })).toEqual([
      { period: "2026-10", assumed: true },
      { period: "2026-11", assumed: true },
      { period: "2026-12", assumed: true },
    ]);
    expect(assignRunPeriods(["Okt", "Nov", "Dez"], {})).toEqual([null, null, null]);
  });
});

// Round 3 (rr2 Minors 1–3).
describe("assignRunPeriods — what a year-less run rolls on, and what anchors it", () => {
  it("rolls only on a step back of six months or more (KW: 26 weeks)", () => {
    expect(assignRunPeriods(["Dez", "Nov", "Okt", "Sep"], { defaultYear: 2026 })).toEqual(["2026-12", "2026-11", "2026-10", "2026-09"]);
    expect(assignRunPeriods(["Okt", "Nov", "Dez", "Jan", "Feb"], { defaultYear: 2026 })).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(assignRunPeriods(["Jul", "Jan"], { defaultYear: 2026 })).toEqual(["2026-07", "2027-01"]);
    expect(assignRunPeriods(["Jun", "Jan"], { defaultYear: 2026 })).toEqual(["2026-06", "2026-01"]);
    expect(assignRunPeriods(["KW27", "KW01"], { defaultYear: 2026 })).toEqual(["2026-W27", "2027-W01"]);
    expect(assignRunPeriods(["KW26", "KW01"], { defaultYear: 2026 })).toEqual(["2026-W26", "2026-W01"]);
  });

  it("lets no lone date or serial header cell anchor or join the run", () => {
    expect(assignRunPeriods(["Name", "Jan", "Feb", "Mär", "31.12.2025"], { defaultYear: 2026 })).toEqual([
      null, "2026-01", "2026-02", "2026-03", null,
    ]);
    expect(assignRunPeriods(["Name", "40100", "Jan", "Feb", "Mär"], { defaultYear: 2026, numbers: "dot" })).toEqual([
      null, null, "2026-01", "2026-02", "2026-03",
    ]);
  });

  it("counts back across kinds by position in the year: KW52 | Jan 2027 is 2026-W52", () => {
    expect(assignRunPeriods(["KW52", "Jan 2027"])).toEqual(["2026-W52", "2027-01"]);
    expect(assignRunPeriods(["Dez", "KW01 2027"])).toEqual(["2026-12", "2027-W01"]);
  });

  // Round 4 (rr3 Minor 4): left of the first label is earlier — counting back
  // never stays in the label's year for a later month, however small the gap.
  it("counts back always back in time: Mai | Jan 2027 is May 2026, Feb | Jan 2027 is Feb 2026", () => {
    expect(assignRunPeriods(["Mai", "Jan 2027"])).toEqual(["2026-05", "2027-01"]);
    expect(assignRunPeriods(["Feb", "Jan 2027"])).toEqual(["2026-02", "2027-01"]);
    expect(assignRunPeriods(["Nov", "Dez", "Jan 2027"])).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(assignRunPeriods(["Jul", "Aug", "Sep", "Okt", "Nov", "Dez", "Jan 2027"])).toEqual([
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01",
    ]);
    expect(assignRunPeriods(["Dez", "Nov", "Okt", "Sep"], { defaultYear: 2026 })).toEqual(["2026-12", "2026-11", "2026-10", "2026-09"]);
  });

  // Round 4 (rr3 Minor 6): in a row of month or week labels, dates and serials
  // never anchor the labels' year, however many of them there are.
  it("lets two serial code cells in a labelled header anchor nothing: 40100 | 40200 | Jan | Feb | Mär", () => {
    const run = assignRunPeriods(["Name", "40100", "40200", "Jan", "Feb", "Mär"], { defaultYear: 2026, numbers: "dot" });
    expect(run.slice(3)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(assignRunPeriods(["31.12.2025", "15.01.2026", "Feb", "Mär"], { defaultYear: 2026 }).slice(2)).toEqual(["2026-02", "2026-03"]);
    expect(assignRunPeriods(["Okt", "Nov", "15.01.2026", "01.02.2026", "Jan 2027"]).slice(0, 2)).toEqual(["2026-10", "2026-11"]);
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

// Round 2: a LONG sheet's period column of dates a week apart is weeks too.
describe("isWeekSpacedColumn and assignCellPeriod — a long sheet's dates", () => {
  it("is true for distinct dates a whole number of weeks apart, the closest one week, in any order", () => {
    expect(isWeekSpacedColumn(["Woche", "2026-01-12", "2026-01-05", "2026-01-05", "", "2026-01-26"])).toBe(true);
    expect(isWeekSpacedColumn(["05.01.2026", "12.01.2026"])).toBe(true);
    expect(isWeekSpacedColumn(["46027", "46034"], "dot")).toBe(true);
  });

  it("is false for first-of-month dates, a lone date, serials in a CSV, or dates mixed with labels", () => {
    expect(isWeekSpacedColumn(["2026-01-01", "2026-02-01", "2026-03-01"])).toBe(false);
    expect(isWeekSpacedColumn(["2026-01-05", "2026-01-05"])).toBe(false);
    expect(isWeekSpacedColumn(["46027", "46034"], "text")).toBe(false);
    expect(isWeekSpacedColumn(["2026-01-05", "2026-01-12", "Feb 2026"])).toBe(false);
  });

  it("reads a date as its ISO week when the column is weekly", () => {
    expect(assignCellPeriod("2026-01-05", { weeks: true })).toEqual({ period: "2026-W02", assumed: false });
    expect(assignCellPeriod("2026-01-05", {})).toEqual({ period: "2026-01", assumed: false });
    expect(assignCellPeriod("Jan", { weeks: true, defaultYear: 2026 })).toEqual({ period: "2026-01", assumed: true });
  });
});

// Round 5 (rr4 Important 2): a title row's date RANGE (`Zeitraum | 01.01.2026 |
// 31.12.2026`) is two dates, so it read as a two-period header and vouched for
// December under a long sheet's hours column.
describe("assignRunPeriods — two dates far apart are a range, not periods", () => {
  it("gives a title row's year-long date range no period, in a CSV and a workbook", () => {
    expect(assignRunPeriods(["Zeitraum", "01.01.2026", "31.12.2026"])).toEqual([null, null, null]);
    expect(assignRunPeriods(["Zeitraum", "46023", "46387"], { numbers: "dot" })).toEqual([null, null, null]);
    expect(assignRunPeriods(["Zeitraum", "01.07.2026", "01.01.2026"])).toEqual([null, null, null]);
  });

  // The run alone: a two-period wide header on the hand route. Whether such a
  // row heads the hours below it on the Claude route is the header search's
  // call (`nearestPeriodRowAbove`, which stops at a header row in between).
  it("reads two dates at most 92 days apart in one run as two period cells, and a range at 93", () => {
    expect(assignRunPeriods(["Name", "01.01.2026", "01.02.2026"])).toEqual([null, "2026-01", "2026-02"]);
    expect(assignRunPeriods(["Name", "01.01.2026", "03.04.2026"])).toEqual([null, "2026-01", "2026-04"]);
    expect(assignRunPeriods(["Name", "01.01.2026", "04.04.2026"])).toEqual([null, null, null]);
  });

  it("leaves a run of three or more dates as it was, however far apart", () => {
    expect(assignRunPeriods(["Name", "01.01.2026", "01.07.2026", "31.12.2026"])).toEqual([null, "2026-01", "2026-07", "2026-12"]);
  });
});
