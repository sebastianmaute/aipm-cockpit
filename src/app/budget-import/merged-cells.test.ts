// §500 final review 3 — sheet shapes that come straight from Excel's merged
// cells, and a header run that only looks like months. Each once went straight
// to the preview and wrote the left or top sub-column (or a week as a month)
// with no question; detection now asks, and so does `questionsFor` of a
// mapping someone else chose.
import { describe, expect, it } from "vitest";
import { detectLayout, questionsFor } from "./layout-detect";
import type { NumberOrigin } from "./sheet-grid";

const PEOPLE = ["Ann Lee", "Bob Ray", "Cem Oz", "Dana Fox", "Eli Roe", "Fay Wu"];

/** `Name | <m1> | (blank) | <m2> | (blank) | <m3> | (blank)` over a sub-header
 *  row naming the two sub-columns, then one row per person. */
function mergedMonths(months: readonly string[], sub: readonly [string, string]): string[][] {
  const header = ["Name", ...months.flatMap((m) => [m, ""])];
  const subHeader = ["", ...months.flatMap(() => [...sub])];
  const rows = PEOPLE.map((p, i) => [p, ...months.flatMap((_, m) => [String(10 * (m + 1) + i), String(100 + 10 * m + i)])]);
  return [header, subHeader, ...rows];
}

const MONTHS_CSV = ["Jan 2026", "Feb 2026", "Mär 2026"];
const MONTHS_SERIAL = ["46023", "46054", "46082"];
const PERIOD_ASK = { field: "period", candidates: [1, 2, 3, 4, 5, 6], blankHeaded: [2, 4, 6] };

describe("I1 — a month header merged over two sub-columns asks for the period", () => {
  it.each([
    ["CSV, Ist first", MONTHS_CSV, ["Ist", "Plan"], "text"],
    ["CSV, Plan first", MONTHS_CSV, ["Plan", "Ist"], "text"],
    ["CSV, € | Std", MONTHS_CSV, ["€", "Std"], "text"],
    ["workbook serials, Actual first", MONTHS_SERIAL, ["Actual", "Forecast"], "dot"],
    ["workbook serials, Forecast first", MONTHS_SERIAL, ["Forecast", "Actual"], "dot"],
    ["workbook serials, € | Std", MONTHS_SERIAL, ["€", "Std"], "dot"],
  ] as const)("%s: detection asks, the blank-headed columns among the candidates", (_label, months, sub, numbers) => {
    const rows = mergedMonths(months, sub);
    const detected = detectLayout(rows, { numbers: numbers as NumberOrigin, defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "wide", headerRow: 0, person: 0, periodCols: [1, 3, 5] });
    expect(detected.ambiguous).toEqual([PERIOD_ASK]);
  });

  it("a Claude wide mapping of the same sheet is asked the same", () => {
    const rows = mergedMonths(MONTHS_CSV, ["Ist", "Plan"]);
    expect(questionsFor(rows, { layout: "wide", headerRow: 0, person: 0, periodCols: [1, 3, 5], year: 2026 })).toEqual([PERIOD_ASK]);
  });

  it("a blank-headed number column right after the run asks; one with text, or one further right, does not", () => {
    const after = [["Name", "Jan 2026", "Feb 2026", "Mär 2026", ""], ...PEOPLE.map((p) => [p, "10", "20", "30", "500"])];
    expect(detectLayout(after, { defaultYear: 2026 }).ambiguous).toEqual([{ field: "period", candidates: [1, 2, 3, 4], blankHeaded: [4] }]);
    const notes = [["Name", "Jan 2026", "Feb 2026", "Mär 2026", ""], ...PEOPLE.map((p) => [p, "10", "20", "30", "ok"])];
    expect(detectLayout(notes, { defaultYear: 2026 }).ambiguous).toEqual([]);
    const far = [["Name", "Jan 2026", "Feb 2026", "Mär 2026", "Notes", ""], ...PEOPLE.map((p) => [p, "10", "20", "30", "ok", "7"])];
    expect(detectLayout(far, { defaultYear: 2026 }).ambiguous).toEqual([]);
  });

  it("a plain wide sheet with no blank-headed number column stays clear", () => {
    const rows = [["Name", ...MONTHS_CSV], ...PEOPLE.map((p) => [p, "10", "20", "30"])];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([]);
  });
});

/** Six people, each on a person row and a merged-person row below it. */
function mergedPeopleWide(first: string, second: string): string[][] {
  return [
    ["Name", "Art", "Jan 2026", "Feb 2026", "Mär 2026"],
    ...PEOPLE.flatMap((p) => [[p, first, "10", "20", "30"], ["", second, "100", "110", "120"]]),
  ];
}

function mergedPeopleLong(first: string, second: string): string[][] {
  return [
    ["Name", "Monat", "Art", "Stunden"],
    ...PEOPLE.flatMap((p) => [[p, "Jan 2026", first, "10"], ["", "Jan 2026", second, "100"]]),
  ];
}

/** The 0-based rows of the merged-person rows: every second row from row 2. */
const CONTINUATION_ROWS = PEOPLE.map((_, i) => 2 + 2 * i);

describe("I2 — a person merged over several rows asks", () => {
  it("wide Name | Art | months: the blank-person Plan rows are a continuation question", () => {
    const detected = detectLayout(mergedPeopleWide("Ist", "Plan"), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "wide", person: 0, periodCols: [2, 3, 4] });
    expect(detected.ambiguous).toEqual([{ field: "continuation", candidates: CONTINUATION_ROWS, samples: ["Ist", "Plan"] }]);
  });

  it("the long twin Name | Monat | Art | Stunden asks the same", () => {
    const detected = detectLayout(mergedPeopleLong("Ist", "Plan"), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "long", person: 0, period: 1, hours: 3 });
    expect(detected.ambiguous).toEqual([{ field: "continuation", candidates: CONTINUATION_ROWS, samples: ["Ist", "Plan"] }]);
  });

  it("a Claude mapping of either sheet is asked the same", () => {
    expect(questionsFor(mergedPeopleWide("Ist", "Plan"), { layout: "wide", headerRow: 0, person: 0, periodCols: [2, 3, 4], year: 2026 }))
      .toEqual([{ field: "continuation", candidates: CONTINUATION_ROWS, samples: ["Ist", "Plan"] }]);
    expect(questionsFor(mergedPeopleLong("Ist", "Plan"), { layout: "long", headerRow: 0, person: 0, period: 1, hours: 3, year: 2026 }))
      .toEqual([{ field: "continuation", candidates: CONTINUATION_ROWS, samples: ["Ist", "Plan"] }]);
  });

  it("an unlabelled total row at the bottom asks too, with no samples: it is never summed into the last person", () => {
    const rows = [["Name", "Jan 2026", "Feb 2026", "Mär 2026"], ...PEOPLE.map((p) => [p, "10", "20", "30"]), ["", "60", "120", "180"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([{ field: "continuation", candidates: [7], samples: [] }]);
  });

  it("a blank-person spacer row with no numbers does not ask", () => {
    const rows = [["Name", "Art", "Jan 2026", "Feb 2026", "Mär 2026"], ...PEOPLE.flatMap((p) => [[p, "Plan", "10", "20", "30"], ["", "-", "", "", ""]])];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([]);
  });

  it("a total row labelled in the person column behaves as today", () => {
    const rows = [["Name", "Jan 2026", "Feb 2026", "Mär 2026"], ...PEOPLE.map((p) => [p, "10", "20", "30"]), ["Summe", "60", "120", "180"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([]);
  });
});

// §500 final review 4, I1: a person row with a total word in ANOTHER column
// (`Ann Lee | Gesamt`) was skipped as a total row, so the blank-person Ist and
// Plan rows below it had no person row and asked nothing, and the reader wrote
// Ann's Gesamt as her forecast. Only the person cell decides now.
const TOTAL_WIDE_HEADER = ["Name", "Art", "Jan 2026", "Feb 2026", "Mär 2026"];
const TOTAL_LONG_HEADER = ["Name", "Monat", "Art", "Stunden"];

/** Ann on a `<total>` row with Ist and Plan rows below it; everyone else one Plan row. */
function totalPersonWide(total: string): string[][] {
  return [
    TOTAL_WIDE_HEADER,
    ["Ann Lee", total, "110", "130", "150"], ["", "Ist", "10", "20", "30"], ["", "Plan", "100", "110", "120"],
    ...PEOPLE.slice(1).map((p) => [p, "Plan", "10", "20", "30"]),
  ];
}

function totalPersonLong(total: string): string[][] {
  return [
    TOTAL_LONG_HEADER,
    ["Ann Lee", "Jan 2026", total, "110"], ["", "Jan 2026", "Ist", "10"], ["", "Jan 2026", "Plan", "100"],
    ...PEOPLE.slice(1).map((p) => [p, "Jan 2026", "Plan", "10"]),
  ];
}

/** Every person laid out as `Gesamt / Ist / Plan`. */
const allTotalsWide = (): string[][] => [
  TOTAL_WIDE_HEADER,
  ...PEOPLE.flatMap((p) => [[p, "Gesamt", "110", "130", "150"], ["", "Ist", "10", "20", "30"], ["", "Plan", "100", "110", "120"]]),
];
const allTotalsLong = (): string[][] => [
  TOTAL_LONG_HEADER,
  ...PEOPLE.flatMap((p) => [[p, "Jan 2026", "Gesamt", "110"], ["", "Jan 2026", "Ist", "10"], ["", "Jan 2026", "Plan", "100"]]),
];
/** The blank-person rows of `allTotals*`: rows 2, 3, 5, 6 … */
const ALL_TOTALS_CONTINUATIONS = PEOPLE.flatMap((_, i) => [2 + 3 * i, 3 + 3 * i]);

describe("final review 4, I1 — a total word beside the person does not hide the rows below", () => {
  it.each(["Gesamt", "Summe Plan+Ist", "Total"])("wide, Ann's row says %s: detection asks the continuation question", (total) => {
    const detected = detectLayout(totalPersonWide(total), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "wide", person: 0, periodCols: [2, 3, 4] });
    expect(detected.ambiguous).toEqual([{ field: "continuation", candidates: [2, 3], samples: [total, "Ist"] }]);
  });

  it("long, Ann's row says Gesamt: detection asks the continuation question", () => {
    const detected = detectLayout(totalPersonLong("Gesamt"), { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "long", person: 0, period: 1, hours: 3 });
    expect(detected.ambiguous).toEqual([{ field: "continuation", candidates: [2, 3], samples: ["Gesamt", "Ist"] }]);
  });

  it("every person on a Gesamt row: detection takes the Name column and asks, wide and long", () => {
    const wide = detectLayout(allTotalsWide(), { defaultYear: 2026 });
    expect(wide.mapping).toMatchObject({ layout: "wide", person: 0, periodCols: [2, 3, 4] });
    expect(wide.ambiguous).toEqual([{ field: "continuation", candidates: ALL_TOTALS_CONTINUATIONS, samples: ["Gesamt", "Ist"] }]);
    const long = detectLayout(allTotalsLong(), { defaultYear: 2026 });
    expect(long.mapping).toMatchObject({ layout: "long", person: 0, period: 1, hours: 3 });
    expect(long.ambiguous).toEqual([{ field: "continuation", candidates: ALL_TOTALS_CONTINUATIONS, samples: ["Gesamt", "Ist"] }]);
  });

  it("a Claude mapping of either sheet is asked the same", () => {
    const ask = { field: "continuation", candidates: ALL_TOTALS_CONTINUATIONS, samples: ["Gesamt", "Ist"] };
    expect(questionsFor(allTotalsWide(), { layout: "wide", headerRow: 0, person: 0, periodCols: [2, 3, 4], year: 2026 })).toEqual([ask]);
    expect(questionsFor(allTotalsLong(), { layout: "long", headerRow: 0, person: 0, period: 1, hours: 3, year: 2026 })).toEqual([ask]);
    expect(questionsFor(totalPersonWide("Gesamt"), { layout: "wide", headerRow: 0, person: 0, periodCols: [2, 3, 4], year: 2026 }))
      .toEqual([{ field: "continuation", candidates: [2, 3], samples: ["Gesamt", "Ist"] }]);
  });

  it("a blank-person row holding a total word still does not ask", () => {
    const rows = [TOTAL_WIDE_HEADER, ...PEOPLE.map((p) => [p, "Plan", "10", "20", "30"]), ["", "Summe", "60", "120", "180"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([]);
    expect(questionsFor(rows, { layout: "wide", headerRow: 0, person: 0, periodCols: [2, 3, 4], year: 2026 })).toEqual([]);
  });
});

// §500 final review 4, I2: the long twin of final review 3's I1. Excel keeps a
// merged `Stunden` header's text in its LEFT cell, so `Name | Monat | Stunden |
// (blank)` read the left sub-column (Ist, or the costs) with no question.
const LONG_MONTHS_CSV = ["Jan 2026", "Feb 2026", "Mär 2026"];
const LONG_MONTHS_SERIAL = ["46023", "46054", "46082"];

/** `Name | Monat | Stunden | (blank)` over an optional sub-header row, one row per person and month. */
function mergedHours(months: readonly string[], sub: readonly [string, string] | null, values: readonly [string, string]): string[][] {
  const rows = PEOPLE.flatMap((p) => months.map((m) => [p, m, ...values]));
  return [["Name", "Monat", "Stunden", ""], ...(sub === null ? [] : [["", "", ...sub]]), ...rows];
}

describe("final review 4, I2 — an hours header merged over two sub-columns asks for the hours", () => {
  it.each([
    ["CSV, Ist first", LONG_MONTHS_CSV, ["Ist", "Plan"], ["10", "100"], "text"],
    ["CSV, Plan first", LONG_MONTHS_CSV, ["Plan", "Ist"], ["100", "10"], "text"],
    ["CSV, € | Std", LONG_MONTHS_CSV, ["€", "Std"], ["500", "40"], "text"],
    ["workbook serials, Ist first", LONG_MONTHS_SERIAL, ["Ist", "Plan"], ["10", "100"], "dot"],
    ["workbook serials, Plan first", LONG_MONTHS_SERIAL, ["Plan", "Ist"], ["100", "10"], "dot"],
    ["workbook serials, € | Std", LONG_MONTHS_SERIAL, ["€", "Std"], ["500", "40"], "dot"],
  ] as const)("%s: detection and a Claude mapping both ask, the blank-headed column a candidate", (_label, months, sub, values, numbers) => {
    const rows = mergedHours(months, sub, values);
    const detected = detectLayout(rows, { numbers: numbers as NumberOrigin, defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "long", headerRow: 0, person: 0, period: 1, hours: 2 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
    const claude = { layout: "long" as const, headerRow: 0, person: 0, period: 1, hours: 2, year: 2026 };
    expect(questionsFor(rows, claude, { numbers: numbers as NumberOrigin })).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  it("with no sub-header row it asks the same", () => {
    expect(detectLayout(mergedHours(LONG_MONTHS_CSV, null, ["10", "100"]), { defaultYear: 2026 }).ambiguous)
      .toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  it("the labelled column stays preselected over a blank-headed one with a higher number share", () => {
    const rows = [["Name", "Monat", "Plan", ""], ...PEOPLE.flatMap((p, i) => LONG_MONTHS_CSV.map((m, j) => [p, m, i === 0 && j === 0 ? "-" : "10", "100"]))];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.mapping).toMatchObject({ layout: "long", hours: 2 });
    expect(detected.ambiguous).toEqual([{ field: "hours", candidates: [2, 3] }]);
  });

  it("a plain long sheet with no blank-headed number column stays clear", () => {
    const rows = [["Name", "Monat", "Stunden"], ...PEOPLE.flatMap((p) => LONG_MONTHS_CSV.map((m) => [p, m, "10"]))];
    expect(detectLayout(rows, { defaultYear: 2026 }).ambiguous).toEqual([]);
    expect(questionsFor(rows, { layout: "long", headerRow: 0, person: 0, period: 1, hours: 2, year: 2026 })).toEqual([]);
    const notes = [["Name", "Monat", "Stunden", ""], ...PEOPLE.flatMap((p) => LONG_MONTHS_CSV.map((m) => [p, m, "10", "ok"]))];
    expect(detectLayout(notes, { defaultYear: 2026 }).ambiguous).toEqual([]);
  });
});

describe("M4 — an N/YYYY header run that continues past 12 asks", () => {
  const header = (n: number): string[] => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(2, "0")}/2026`);

  it("01/2026 … 14/2026 asks for the period, every such column a candidate", () => {
    const rows = [["Name", ...header(14)], ...PEOPLE.map((p) => [p, ...header(14).map(() => "40")])];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    const all = Array.from({ length: 14 }, (_, i) => i + 1);
    expect(detected.ambiguous).toEqual([{ field: "period", candidates: all, pastTwelve: all }]);
  });

  it("a run that stops at 12 reads as months, as today", () => {
    const rows = [["Name", ...header(12)], ...PEOPLE.map((p) => [p, ...header(12).map(() => "40")])];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.ambiguous).toEqual([]);
    expect(detected.mapping?.periodCols).toHaveLength(12);
  });
});
