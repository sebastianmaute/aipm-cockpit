// §500 — the reviewers' probe sheets, end to end through the pure engines:
// detect → rows → validate → plan. Each case is a real-world sheet shape that
// once produced wrong hours with no clear warning (final review, fix wave 2).
import { describe, expect, it } from "vitest";
import type { BudgetBucket, Resource, ResourcePlan, Role } from "../types";
import { buildForecastImportPlan, type ImportPlan } from "./forecast-plan";
import { gridToForecastRows } from "./forecast-rows";
import { validateForecastRows } from "./forecast-validate";
import { detectLayout } from "./layout-detect";
import type { NumberOrigin, SheetGrid } from "./sheet-grid";

const ROLE: Role = { id: 10, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 };
const ANN: Resource = { id: 1, firstName: "Ann", lastName: "Lee", roleId: ROLE.id, utilizationMode: "percent", utilization: {} };

function bucketOf(startDate: string, endDate: string): BudgetBucket {
  return { id: 1, name: "B", type: "tm", currency: "EUR", startDate, endDate, status: "open", allocations: [] } as BudgetBucket;
}

type Run = { grid: SheetGrid; out: ReturnType<typeof gridToForecastRows>; validated: ReturnType<typeof validateForecastRows> };

/** Detect, read and validate one sheet the way the hook does, the year defaulting to 2026. */
function readSheet(rows: string[][], numbers: NumberOrigin = "text", defaultYear = 2026): Run {
  const grid: SheetGrid = { name: "S", rows, truncated: false, numbers };
  const detected = detectLayout(rows, { numbers, defaultYear });
  if (detected.mapping === null) throw new Error("no layout detected");
  const out = gridToForecastRows(rows, detected.mapping, "S", numbers);
  return { grid, out, validated: validateForecastRows(out.rows, { sheet: grid, requireSource: false, defaultYear }) };
}

function planOf(run: Run, bucket: BudgetBucket, granularity: ResourcePlan["granularity"]): ImportPlan {
  const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2027-12-31", granularity, currency: "EUR" };
  return buildForecastImportPlan(run.validated.ok, {
    bucket, resources: [ANN], roles: [ROLE], plan, holidaySet: new Set(), overrides: new Map(),
  });
}

const cellsOf = (plan: ImportPlan): Array<[string, number]> => plan.changes.map((c) => [c.period, c.next]);

describe("probe: a weekly forecast headed by Monday dates (CR C1)", () => {
  const expected: Array<[string, number]> = [
    ["2026-W02", 40], ["2026-W03", 40], ["2026-W04", 40], ["2026-W05", 40], ["2026-W06", 40],
  ];

  it("ISO dates in a CSV give W02..W06 = 40 each in a weekly plan, nothing summed", () => {
    const run = readSheet([
      ["Name", "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"],
      ["Ann Lee", "40", "40", "40", "40", "40"],
    ]);
    expect(run.out.rows.map((r) => r.period)).toEqual(expected.map(([p]) => p));
    expect(run.validated.duplicates).toEqual([]);
    const plan = planOf(run, bucketOf("2026-01-01", "2026-03-31"), "week");
    expect(cellsOf(plan)).toEqual(expected);
    expect(plan.changes.some((c) => c.partial)).toBe(false);
  });

  it("dotted dates and workbook serials read the same", () => {
    const dotted = readSheet([
      ["Name", "05.01.2026", "12.01.2026", "19.01.2026", "26.01.2026", "02.02.2026"],
      ["Ann Lee", "40", "40", "40", "40", "40"],
    ]);
    const serials = readSheet([["Name", "46027", "46034", "46041", "46048", "46055"], ["Ann Lee", "40", "40", "40", "40", "40"]], "dot");
    for (const run of [dotted, serials]) {
      expect(cellsOf(planOf(run, bucketOf("2026-01-01", "2026-03-31"), "week"))).toEqual(expected);
    }
  });
});

describe("probe: headers without a year that run into the next year (CR C1, CR I2, RR I2)", () => {
  const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

  it("a two-year Jan…Dez Jan…Dez gives 2026 and 2027 cells, nothing summed", () => {
    const run = readSheet([
      ["Name", ...months, ...months],
      ["Ann Lee", ...months.map(() => "10"), ...months.map(() => "20")],
    ]);
    expect(run.validated.duplicates).toEqual([]);
    const plan = planOf(run, bucketOf("2026-01-01", "2027-12-31"), "month");
    expect(plan.changes.find((c) => c.period === "2026-01")?.next).toBe(10);
    expect(plan.changes.find((c) => c.period === "2027-01")?.next).toBe(20);
    expect(plan.changes).toHaveLength(24);
  });

  it("a fiscal Jul…Jun reads Jan–Jun in the next year", () => {
    const fiscal = ["Jul", "Aug", "Sep", "Okt", "Nov", "Dez", "Jan", "Feb", "Mär", "Apr", "Mai", "Jun"];
    const run = readSheet([["Name", ...fiscal], ["Ann Lee", ...fiscal.map((_, i) => String(i + 1))]]);
    expect(run.out.rows.map((r) => r.period)).toEqual([
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
      "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06",
    ]);
  });

  it("Okt | Nov | Dez | Jan | Feb reads January and February in 2027", () => {
    const run = readSheet([["Name", "Okt", "Nov", "Dez", "Jan", "Feb"], ["Ann Lee", "1", "2", "3", "4", "5"]]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("KW50 KW51 KW52 KW01 KW02 reads the last two in 2027", () => {
    const run = readSheet([["Name", "KW50", "KW51", "KW52", "KW01", "KW02"], ["Ann Lee", "8", "8", "8", "8", "8"]]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-W50", "2026-W51", "2026-W52", "2027-W01", "2027-W02"]);
  });
});

describe("probe: detection reads the sheet without the year first (RR I1)", () => {
  it("Name | Start | Jan 2026 | Feb 2026 stays wide: a Start column of month names is not the period", () => {
    const rows = [["Name", "Start", "Jan 2026", "Feb 2026"], ["Ann Lee", "Mai", "8", "4"]];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.kind).toBe("wide");
    expect(detected.mapping?.periodCols).toEqual([2, 3]);
    const run = readSheet(rows);
    expect(run.out.rows.map((r) => [r.period, r.hours])).toEqual([["2026-01", 8], ["2026-02", 4]]);
  });

  it("Name | Phase | Wann | Stunden keeps C as the period column", () => {
    const rows = [
      ["Name", "Phase", "Wann", "Stunden"],
      ["Ann Lee", "Mai", "Jan 2026", "8"],
      ["Ann Lee", "Juni", "Feb 2026", "4"],
    ];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.kind).toBe("long");
    expect(detected.mapping?.period).toBe(2);
    expect(readSheet(rows).out.rows.map((r) => [r.period, r.hours])).toEqual([["2026-01", 8], ["2026-02", 4]]);
  });

  it("Name | Jan | Feb | Mär is wide once the year is used", () => {
    const rows = [["Name", "Jan", "Feb", "Mär"], ["Ann Lee", "1", "2", "3"]];
    expect(detectLayout(rows).kind).toBe("unknown");
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.kind).toBe("wide");
    expect(detected.mapping).toMatchObject({ periodCols: [1, 2, 3], year: 2026 });
  });
});

describe("probe: a long sheet with a year column (CR I2)", () => {
  it("Name | Jahr | Monat | Stunden imports 2027 even with the default year 2026", () => {
    const run = readSheet([["Name", "Jahr", "Monat", "Stunden"], ["Ann Lee", "2027", "Jan", "8"]]);
    expect(run.out.rows.map((r) => [r.period, r.hours])).toEqual([["2027-01", 8]]);
  });
});

describe("probe: one sheet row naming a period twice (CR C1)", () => {
  it("Name | Jan 2026 | Jan 2026 blocks Apply with same-row-period, nothing summed", () => {
    const run = readSheet([["Name", "Jan 2026", "Jan 2026", "Feb 2026"], ["Ann Lee", "10", "20", "5"]]);
    expect(run.validated.collisions).toEqual([{ person: "Ann Lee", period: "2026-01", sources: ["S!B2", "S!C2"] }]);
    const bucket = bucketOf("2026-01-01", "2026-03-31");
    const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2027-12-31", granularity: "month", currency: "EUR" };
    const out = buildForecastImportPlan(run.validated.ok, {
      bucket, resources: [ANN], roles: [ROLE], plan, holidaySet: new Set(), overrides: new Map(), collisions: run.validated.collisions,
    });
    expect(out.blockers).toContain("same-row-period");
    expect(cellsOf(out)).toEqual([["2026-02", 5]]);
  });
});

describe("probe: year-less headers before the first labelled one (round 2)", () => {
  it("Nov | Dez | Jan 2027 … reads every column, Nov and Dez in 2026, nothing assumed", () => {
    const run = readSheet([["Name", "Nov", "Dez", "Jan 2027", "Feb 2027", "Mär 2027"], ["Ann Lee", "1", "2", "3", "4", "5"]]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(run.out.ignoredColumns).toEqual([]);
    expect(run.out.assumedYear).toBeUndefined();
  });
});

describe("probe: a long sheet of Monday dates (round 2)", () => {
  it("reads each date as its ISO week: 40 h per week in a weekly plan, nothing combined", () => {
    const dates = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"];
    const run = readSheet([["Name", "Woche", "Stunden"], ...dates.map((d) => ["Ann Lee", d, "40"])]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-W02", "2026-W03", "2026-W04", "2026-W05", "2026-W06"]);
    expect(run.validated.duplicates).toEqual([]);
    expect(cellsOf(planOf(run, bucketOf("2026-01-01", "2026-03-31"), "week"))).toEqual(
      ["2026-W02", "2026-W03", "2026-W04", "2026-W05", "2026-W06"].map((w) => [w, 40]),
    );
  });

  it("keeps first-of-month dates as months", () => {
    const run = readSheet([["Name", "Monat", "Stunden"], ["Ann Lee", "2026-01-01", "8"], ["Ann Lee", "2026-02-01", "4"], ["Ann Lee", "2026-03-01", "2"]]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});

// Round 3 (rr2 Important 1): a year-less wide sheet with a date column was
// detected as LONG once A2 ran the long pass before the wide pass with a year.
describe("probe: a year-less wide sheet with a date column stays wide (round 3)", () => {
  const months6 = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun"];
  const periodsOf = (run: Run) => run.out.rows.map((r) => [r.person, r.period, r.hours]);

  it("Name | Start | Jan | Feb | Mär", () => {
    const rows = [["Name", "Start", "Jan", "Feb", "Mär"], ["Ann Lee", "01.02.2026", "8", "4", "2"], ["Bob Kay", "15.03.2026", "1", "2", "3"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("wide");
    expect(periodsOf(readSheet(rows))).toEqual([
      ["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 4], ["Ann Lee", "2026-03", 2],
      ["Bob Kay", "2026-01", 1], ["Bob Kay", "2026-02", 2], ["Bob Kay", "2026-03", 3],
    ]);
  });

  it("Name | Startdatum | Jan…Dez with an ISO start date", () => {
    const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    const run = readSheet([["Name", "Startdatum", ...months], ["Ann Lee", "2026-02-01", ...months.map(() => "8")]]);
    expect(run.out.rows.map((r) => r.period)).toEqual(months.map((_, i) => `2026-${String(i + 1).padStart(2, "0")}`));
    expect(run.out.rows.every((r) => r.hours === 8)).toBe(true);
    expect(run.out.ignoredColumns).toEqual([]);
  });

  it("Mitarbeiter | Start | Ende | Jan…Jun", () => {
    const run = readSheet([["Mitarbeiter", "Start", "Ende", ...months6], ["Ann Lee", "01.01.2026", "30.06.2026", "8", "8", "8", "8", "8", "8"]]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
  });

  it("Name | Start | KW01 | KW02 | KW03", () => {
    const run = readSheet([["Name", "Start", "KW01", "KW02", "KW03"], ["Ann Lee", "05.01.2026", "8", "8", "8"]]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-W01", "2026-W02", "2026-W03"]);
  });

  it("a workbook Name | Rolle | Eintritt | Jan…Jun with Eintritt as a serial date", () => {
    const run = readSheet([
      ["Name", "Rolle", "Eintritt", ...months6],
      ["Ann Lee", "Dev", "45000", "8", "8", "8", "8", "8", "8"],
      ["Bob Kay", "QA", "45200", "4", "4", "4", "4", "4", "4"],
    ], "dot");
    expect(run.out.rows.filter((r) => r.person === "Ann Lee").map((r) => [r.period, r.hours])).toEqual(
      ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].map((p) => [p, 8]),
    );
    expect(run.out.rows).toHaveLength(12);
  });
});

// Round 3 (rr2 Important 2): date columns finer than the period are sub-period
// columns and are summed; only identical or equivalent labels collide.
describe("probe: bi-weekly and semi-monthly date headers (round 3)", () => {
  const monthPlan = (run: Run) => {
    const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2027-12-31", granularity: "month", currency: "EUR" };
    return buildForecastImportPlan(run.validated.ok, {
      bucket: bucketOf("2026-01-01", "2026-03-31"), resources: [ANN], roles: [ROLE], plan,
      holidaySet: new Set(), overrides: new Map(), collisions: run.validated.collisions,
    });
  };

  it("sprint dates 05.01 | 19.01 | 02.02 | 16.02.2026 sum to 80 per month, no blocker, reported", () => {
    const run = readSheet([["Name", "05.01.2026", "19.01.2026", "02.02.2026", "16.02.2026"], ["Ann Lee", "40", "40", "40", "40"]]);
    expect(run.validated.collisions).toEqual([]);
    expect(run.validated.subPeriods).toEqual([
      { person: "Ann Lee", period: "2026-01", count: 2, sources: ["S!B2", "S!C2"] },
      { person: "Ann Lee", period: "2026-02", count: 2, sources: ["S!D2", "S!E2"] },
    ]);
    expect(run.validated.duplicates).toEqual([]);
    const plan = monthPlan(run);
    expect(plan.blockers).toEqual([]);
    expect(cellsOf(plan)).toEqual([["2026-01", 80], ["2026-02", 80]]);
  });

  it("semi-monthly 01.01 | 15.01 | 01.02 | 15.02.2026 sum the same way", () => {
    const run = readSheet([["Name", "01.01.2026", "15.01.2026", "01.02.2026", "15.02.2026"], ["Ann Lee", "40", "40", "40", "40"]]);
    expect(run.validated.collisions).toEqual([]);
    expect(cellsOf(monthPlan(run))).toEqual([["2026-01", 80], ["2026-02", 80]]);
  });

  it("equivalent labels still block: 2026-01 | Jan 2026, and one date twice", () => {
    expect(readSheet([["Name", "2026-01", "Jan 2026", "Feb 2026"], ["Ann Lee", "1", "2", "3"]]).validated.collisions).toHaveLength(1);
    expect(readSheet([["Name", "05.01.2026", "05.01.2026", "Feb 2026"], ["Ann Lee", "1", "2", "3"]]).validated.collisions).toHaveLength(1);
  });

  it("sums date claims under distinct date headers on the Claude route too", () => {
    const grid: SheetGrid = { name: "S", rows: [["Name", "05.01.2026", "19.01.2026"], ["Ann Lee", "40", "30"]], truncated: false };
    const out = validateForecastRows([
      { person: "Ann Lee", period: "05.01.2026", hours: 40, source: "S!B2" },
      { person: "Ann Lee", period: "19.01.2026", hours: 30, source: "S!C2" },
    ], { sheet: grid, requireSource: true });
    expect(out.collisions).toEqual([]);
    expect(out.ok).toEqual([{ person: "Ann Lee", period: "2026-01", hours: 70 }]);
    expect(out.subPeriods).toHaveLength(1);
  });

  // Round 4 (rr3 Important 1c): a placeholder above a cell once hid its date
  // header, and Bob's January became a same-row collision.
  it("a - in Ann's row does not stop Bob's sprint dates being summed: 2026-01 = 80, no blocker", () => {
    const run = readSheet([
      ["Name", "05.01.2026", "19.01.2026", "02.02.2026", "16.02.2026"],
      ["Ann Lee", "40", "-", "40", "40"],
      ["Bob Kay", "40", "40", "40", "40"],
    ]);
    expect(run.validated.collisions).toEqual([]);
    expect(run.validated.ok.find((r) => r.person === "Bob Kay" && r.period === "2026-01")?.hours).toBe(80);
    expect(monthPlan(run).blockers).not.toContain("same-row-period");
  });

  // Final review 2, round 2: a person row of placeholders alone is not a header
  // row, so Bob's sprint dates below it still sit under their date headers.
  it("Carl's row of - only does not stop Bob's sprint dates being summed: 2026-01 = 80, no blocker", () => {
    const run = readSheet([
      ["Name", "05.01.2026", "19.01.2026", "02.02.2026", "16.02.2026"],
      ["Carl", "-", "-", "-", "-"],
      ["Bob Kay", "40", "40", "40", "40"],
      ["Ann Lee", "20", "20", "20", "20"], ["Dora", "8", "8", "8", "8"], ["Eve", "4", "4", "4", "4"],
    ]);
    expect(run.validated.collisions).toEqual([]);
    expect(run.validated.ok.find((r) => r.person === "Bob Kay" && r.period === "2026-01")?.hours).toBe(80);
    expect(run.validated.ok.find((r) => r.person === "Bob Kay" && r.period === "2026-02")?.hours).toBe(80);
    expect(monthPlan(run).blockers).not.toContain("same-row-period");
  });
});

// Round 3 (rr2 observation 2): stacked year blocks. Detection takes the second
// block's header; the rows of the first block are reported, not dropped silently.
describe("probe: stacked year blocks on the hand route (round 3)", () => {
  it("reports the first block's rows above the detected header row", () => {
    const run = readSheet([
      ["Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["Ann Lee", "10", "20", "30"],
      [],
      ["Name", "Jan 2027", "Feb 2027", "Mar 2027"], ["Ann Lee", "40", "50", "60"],
    ]);
    expect(detectLayout(run.grid.rows, { defaultYear: 2026 }).mapping?.headerRow).toBe(3);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(run.out.rowsAboveHeader).toBe(1);
  });

  it("counts no title or header row above the header", () => {
    const run = readSheet([["Forecast 2026"], [], ["Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["Ann Lee", "1", "2", "3"]]);
    expect(run.out.rowsAboveHeader).toBe(0);
  });

  // Round 4 (rr3 Minor 3): metadata rows above the header are not unread data.
  it("counts no metadata row: a workbook Stand | 46296 (a serial date)", () => {
    const run = readSheet([["Stand", "46296"], [], ["Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["Ann Lee", "1", "2", "3"]], "dot");
    expect(run.out.rows).toHaveLength(3);
    expect(run.out.rowsAboveHeader).toBe(0);
  });

  it("does not count a serial date under an earlier block's month header as data", () => {
    const run = readSheet([
      ["Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["Stand", "46296", "", ""], [],
      ["Name", "Jan 2027", "Feb 2027", "Mar 2027"], ["Ann Lee", "1", "2", "3"],
    ], "dot");
    expect(run.out.rows.map((r) => r.period)).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(run.out.rowsAboveHeader).toBe(0);
  });

  it("counts no metadata row: a CSV Version | 3 and Projekt | 4711", () => {
    const run = readSheet([["Version", "3"], ["Projekt", "4711"], [], ["Name", "Jan 2026", "Feb 2026", "Mar 2026"], ["Ann Lee", "1", "2", "3"]]);
    expect(run.out.rows).toHaveLength(3);
    expect(run.out.rowsAboveHeader).toBe(0);
  });

  it("still counts a long block's data row above a long header", () => {
    const run = readSheet([["Name", "Monat", "Stunden"], ["Ann Lee", "Jan 2026", "8"], [], ["Name", "Monat", "Stunden"], ["Ann Lee", "Feb 2026", "4"]]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-02"]);
    expect(run.out.rowsAboveHeader).toBe(1);
  });
});

// Round 4 (rr3 Minor 6): two numeric code cells once moved Jan…Mär into 2010.
describe("probe: numeric code cells in a header of year-less months (round 4)", () => {
  it("two serial code cells beside year-less months leave the months in the default year, no collision", () => {
    const rows = [["Name", "40100", "40200", "Jan", "Feb", "Mär"], ["Ann Lee", "", "", "8", "8", "8"]];
    const run = readSheet(rows, "dot");
    expect(run.validated.collisions).toEqual([]);
    expect(run.out.rows.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});

// Round 4 (rr3 Minor 5): a workbook's serial date column is period-shaped, never
// an unread hours column.
describe("probe: a serial date column is not an ignored number column (round 4)", () => {
  it("Name | Eintritt | Jan | Feb | Mär with Eintritt 45000 in a workbook lists no ignored column", () => {
    const run = readSheet([
      ["Name", "Eintritt", "Jan", "Feb", "Mär"],
      ["Ann Lee", "45000", "8", "8", "8"],
      ["Bob Kay", "45200", "4", "4", "4"],
    ], "dot");
    expect(run.out.rows).toHaveLength(6);
    expect(run.out.ignoredColumns).toEqual([]);
  });

  it("still lists a CSV column of five-digit numbers: a serial counts as a date only in a workbook", () => {
    const run = readSheet([
      ["Name", "Kosten", "Jan", "Feb", "Mär"],
      ["Ann Lee", "45000", "8", "8", "8"],
      ["Bob Kay", "45200", "4", "4", "4"],
    ]);
    expect(run.out.ignoredColumns).toEqual([{ col: 1, header: "Kosten" }]);
  });
});

// Round 5 (rr4 Important 1): moving both two-period wide passes ahead of the
// long passes turned long WORKBOOKS with two date columns wide — a data row of
// two serials read as a two-period header, the serials below as hours. The
// round-3 order is back. The year-less `Name | Start | Jan | Feb` it misread
// reads wide since the final review's I4 (below).
describe("probe: long workbooks with two date columns stay long (round 5)", () => {
  const rowsOf = (run: Run) => run.out.rows.map((r) => [r.person, r.period, r.hours]);
  const readLong = (rows: string[][]) => {
    expect(detectLayout(rows, { numbers: "dot", defaultYear: 2026 }).kind).toBe("long");
    const run = readSheet(rows, "dot");
    expect(run.validated.rejected).toEqual([]);
    return run;
  };

  it("Name | Von | Bis | Stunden with a serial date range per row", () => {
    const run = readLong([
      ["Name", "Von", "Bis", "Stunden"],
      ["Ann Lee", "46023", "46053", "40"], ["Ann Lee", "46054", "46081", "30"], ["Bob Kay", "46023", "46053", "20"],
    ]);
    expect(rowsOf(run)).toEqual([["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 30], ["Bob Kay", "2026-01", 20]]);
  });

  it("Name | Eintritt | Monat | Stunden with the months stored as dates", () => {
    const run = readLong([
      ["Name", "Eintritt", "Monat", "Stunden"],
      ["Ann Lee", "45000", "46023", "8"], ["Ann Lee", "45000", "46054", "4"],
      ["Bob Kay", "45500", "46023", "2"], ["Bob Kay", "45500", "46054", "6"],
    ]);
    expect(rowsOf(run)).toEqual([["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 4], ["Bob Kay", "2026-01", 2], ["Bob Kay", "2026-02", 6]]);
  });

  it("Name | Monat | Stunden | Erfasst with both date columns stored as dates", () => {
    const run = readLong([
      ["Name", "Monat", "Stunden", "Erfasst"],
      ["Ann Lee", "46023", "8", "46030"], ["Ann Lee", "46054", "4", "46060"], ["Bob Kay", "46023", "2", "46031"],
    ]);
    expect(rowsOf(run)).toEqual([["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 4], ["Bob Kay", "2026-01", 2]]);
  });

  it("weekly Name | Woche | Stunden | Start with Monday dates and a start date", () => {
    const run = readLong([
      ["Name", "Woche", "Stunden", "Start"],
      ["Ann Lee", "46027", "40", "46000"], ["Ann Lee", "46034", "32", "46000"], ["Bob Kay", "46027", "20", "46010"],
    ]);
    expect(rowsOf(run)).toEqual([["Ann Lee", "2026-W02", 40], ["Ann Lee", "2026-W03", 32], ["Bob Kay", "2026-W02", 20]]);
  });

  it("a date-range title row over a long sheet offers no December hours", () => {
    const run = readLong([
      ["Zeitraum", "46023", "46387"],
      ["Name", "Monat", "Stunden"],
      ["Ann Lee", "46023", "8"], ["Ann Lee", "46054", "6"], ["Ann Lee", "46082", "4"], ["Bob Kay", "46023", "2"], ["Bob Kay", "46054", "3"],
    ]);
    expect(rowsOf(run)).toEqual([
      ["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 6], ["Ann Lee", "2026-03", 4], ["Bob Kay", "2026-01", 2], ["Bob Kay", "2026-02", 3],
    ]);
  });

  // Final review I4: this read long until a period-headed column stopped being
  // a long sheet's hours column (residue (13) closed).
  it("Name | Start | Jan | Feb reads wide: nothing lands in the start month", () => {
    const rows = [["Name", "Start", "Jan", "Feb"], ["Ann Lee", "01.02.2026", "8", "4"], ["Bob Kay", "15.03.2026", "1", "2"]];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.kind).toBe("wide");
    expect(detected.mapping).toMatchObject({ person: 0, periodCols: [2, 3] });
    const run = readSheet(rows);
    expect(rowsOf(run)).toEqual([["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 4], ["Bob Kay", "2026-01", 1], ["Bob Kay", "2026-02", 2]]);
    expect(run.out.ignoredColumns).toEqual([]);
  });

  it("a long sheet with Start | Ende date pairs on every row stays long", () => {
    const rows = [
      ["Name", "Start", "Ende", "Monat", "Stunden"],
      ["Ann Lee", "01.01.2026", "30.06.2026", "Jan 2026", "8"],
      ["Ann Lee", "01.01.2026", "30.06.2026", "Feb 2026", "4"],
      ["Bob Kay", "01.03.2026", "31.12.2026", "Mär 2026", "2"],
    ];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.kind).toBe("long");
    expect(detected.mapping).toMatchObject({ period: 3, hours: 4 });
    expect(rowsOf(readSheet(rows))).toEqual([["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 4], ["Bob Kay", "2026-03", 2]]);
  });
});

// Round 5 (rr4 Important 2): two dates more than 92 days apart are a range, not
// two period columns; two closer ones still head a two-period wide sheet.
describe("probe: a title row's date range over a long sheet (round 5)", () => {
  it("reads the long sheet under Zeitraum | 01.01.2026 | 31.12.2026, every row in its month", () => {
    const rows = [["Zeitraum", "01.01.2026", "31.12.2026"], ["Name", "Monat", "Stunden"], ["Ann Lee", "Jan 2026", "8"], ["Ann Lee", "Feb 2026", "4"]];
    const detected = detectLayout(rows, { defaultYear: 2026 });
    expect(detected.kind).toBe("long");
    expect(detected.mapping).toMatchObject({ headerRow: 1, period: 1, hours: 2 });
    const run = readSheet(rows);
    expect(run.validated.rejected).toEqual([]);
    expect(run.out.rows.map((r) => [r.person, r.period, r.hours])).toEqual([["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 4]]);
  });

  it("still reads Name | 01.01.2026 | 01.02.2026 as a two-period wide sheet", () => {
    const rows = [["Name", "01.01.2026", "01.02.2026"], ["Ann Lee", "8", "4"], ["Bob Kay", "1", "2"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).mapping).toMatchObject({ layout: "wide", periodCols: [1, 2] });
    expect(readSheet(rows).out.rows.map((r) => [r.person, r.period, r.hours])).toEqual([
      ["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 4], ["Bob Kay", "2026-01", 1], ["Bob Kay", "2026-02", 2],
    ]);
  });
});

const triplesOf = (run: Run) => run.out.rows.map((r) => [r.person, r.period, r.hours]);

// Final review I2: a start-date column was taken as the period column ahead of
// the real one, and every row's hours were summed into the start month.
describe("probe: a start-date column beside the period column (final review I2)", () => {
  it.each([
    ["Name", "Start date", "Month", "Hours"],
    ["Resource", "Start date", "Period", "Hours"],
    ["Name", "Start", "Zeitraum", "Stunden"],
    ["Name", "Beginn", "Wann", "Stunden"],
  ])("%s | %s | %s | %s reads the third column as the period: Jan 80, Feb 60", (...header) => {
    const rows = [header, ["Ann Lee", "01.01.2026", "Jan 2026", "80"], ["Ann Lee", "01.01.2026", "Feb 2026", "60"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).mapping).toMatchObject({ layout: "long", period: 2, hours: 3 });
    const run = readSheet(rows);
    expect(triplesOf(run)).toEqual([["Ann Lee", "2026-01", 80], ["Ann Lee", "2026-02", 60]]);
    // Not the start month's sum.
    expect(run.validated.ok.some((r) => r.hours === 140)).toBe(false);
    expect(run.validated.duplicates).toEqual([]);
  });

  // Both columns hold full dates, so only the HEADER can tell them apart.
  it.each([
    ["Start date | Month", ["Name", "Start date", "Month", "Hours"], ["15.01.2026", "01.01.2026", "01.02.2026"], "text"],
    ["Start | Zeitraum", ["Name", "Start", "Zeitraum", "Stunden"], ["15.01.2026", "01.01.2026", "01.02.2026"], "text"],
    ["Start date | Month as workbook serials", ["Name", "Start date", "Month", "Hours"], ["46037", "46023", "46054"], "dot"],
  ] as const)("%s, both of dates, reads the period header's column: Jan 80, Feb 60", (_label, header, [start, jan, feb], numbers) => {
    const rows = [[...header], ["Ann Lee", start, jan, "80"], ["Ann Lee", start, feb, "60"]];
    expect(detectLayout(rows, { numbers, defaultYear: 2026 }).mapping).toMatchObject({ layout: "long", period: 2, hours: 3 });
    const run = readSheet(rows, numbers);
    expect(triplesOf(run)).toEqual([["Ann Lee", "2026-01", 80], ["Ann Lee", "2026-02", 60]]);
    expect(run.validated.ok.some((r) => r.hours === 140)).toBe(false);
  });
});

// Final review I3: an ID or row-number column was taken as the hours column
// when the hours header was not a known hours word.
describe("probe: an ID or number column is never the hours (final review I3)", () => {
  it("ID | Name | Month | Effort reads the Effort hours, not the employee IDs", () => {
    const rows = [["ID", "Name", "Month", "Effort"], ["12", "Ann Lee", "Jan 2026", "40"], ["12", "Ann Lee", "Feb 2026", "30"], ["14", "Bob Kay", "Jan 2026", "20"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).mapping).toMatchObject({ layout: "long", person: 1, period: 2, hours: 3 });
    const run = readSheet(rows);
    expect(triplesOf(run)).toEqual([["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 30], ["Bob Kay", "2026-01", 20]]);
    expect(run.out.rows.some((r) => r.hours === 12 || r.hours === 14)).toBe(false);
  });

  it("Nr | Name | Monat | Aufwand reads the Aufwand hours, not the row numbers", () => {
    const rows = [["Nr", "Name", "Monat", "Aufwand"], ["1", "Ann Lee", "Jan 2026", "40"], ["2", "Ann Lee", "Feb 2026", "30"], ["3", "Bob Kay", "Jan 2026", "20"]];
    const run = readSheet(rows);
    expect(triplesOf(run)).toEqual([["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 30], ["Bob Kay", "2026-01", 20]]);
    expect(run.out.rows.some((r) => [1, 2, 3].includes(r.hours))).toBe(false);
  });

  // The ID column to the RIGHT of the figures: neither a hours word nor the
  // rightmost pick protects the figures, only the ID exclusion does.
  it.each(["PersNr", "ID"])("Name | Monat | Menge | %s reads Menge, not the IDs", (idHeader) => {
    const rows = [["Name", "Monat", "Menge", idHeader], ["Ann Lee", "Jan 2026", "40", "4711"], ["Ann Lee", "Feb 2026", "30", "4711"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).mapping).toMatchObject({ layout: "long", period: 1, hours: 2 });
    const run = readSheet(rows);
    expect(triplesOf(run)).toEqual([["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 30]]);
    expect(run.out.ignoredColumns).toEqual([]);
  });

  it("takes the rightmost of two unnamed number columns: Team | Menge reads Menge", () => {
    const rows = [["Name", "Monat", "Team", "Menge"], ["Ann Lee", "Jan 2026", "7", "40"], ["Ann Lee", "Feb 2026", "7", "30"]];
    const run = readSheet(rows);
    expect(triplesOf(run)).toEqual([["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 30]]);
    expect(run.out.rows.some((r) => r.hours === 7)).toBe(false);
  });

  it("never takes a workbook's trailing serial-date column as the hours: Wert, not Erfasst", () => {
    const rows = [["Name", "Monat", "Wert", "Erfasst"], ["Ann Lee", "Jan 2026", "40", "46030"], ["Ann Lee", "Feb 2026", "30", "46060"]];
    expect(detectLayout(rows, { numbers: "dot", defaultYear: 2026 }).mapping).toMatchObject({ layout: "long", period: 1, hours: 2 });
    expect(triplesOf(readSheet(rows, "dot"))).toEqual([["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 30]]);
  });

  it("never takes a year column as the hours, even the rightmost: Wert, not Basisjahr", () => {
    const rows = [["Name", "Jahr", "Monat", "Wert", "Basisjahr"], ["Ann Lee", "2026", "Jan", "40", "2025"], ["Ann Lee", "2026", "Feb", "30", "2025"]];
    const run = readSheet(rows);
    expect(triplesOf(run)).toEqual([["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 30]]);
    expect(run.out.rows.some((r) => r.hours === 2025)).toBe(false);
  });
});

// Final review I4: labelled months beside a date column read long — the date
// column as the period, the first month column as the hours.
describe("probe: a column headed by a period is never a long sheet's hours (final review I4)", () => {
  const expectedWide = [["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 50], ["Bob Kay", "2026-01", 30], ["Bob Kay", "2026-02", 20]];

  it.each([
    ["CSV", "01.03.2026", "01.05.2026", "text"],
    ["workbook serial", "46082", "46143", "dot"],
  ] as const)("Name | Start | Jan 2026 | Feb 2026 (%s Start) reads wide, nothing in the start month", (_label, annStart, bobStart, numbers) => {
    const rows = [["Name", "Start", "Jan 2026", "Feb 2026"], ["Ann Lee", annStart, "40", "50"], ["Bob Kay", bobStart, "30", "20"]];
    expect(detectLayout(rows, { numbers, defaultYear: 2026 }).mapping).toMatchObject({ layout: "wide", periodCols: [2, 3] });
    const run = readSheet(rows, numbers);
    expect(triplesOf(run)).toEqual(expectedWide);
    expect(run.out.rows.some((r) => r.period === "2026-03" || r.period === "2026-05")).toBe(false);
  });

  // The long guards, in a CSV (their workbook-serial twins are in "long
  // workbooks with two date columns stay long" above).
  it.each([
    ["Von | Bis", [["Name", "Von", "Bis", "Stunden"], ["Ann Lee", "01.01.2026", "31.01.2026", "40"], ["Ann Lee", "01.02.2026", "28.02.2026", "30"]]],
    ["Eintritt | Monat", [["Name", "Eintritt", "Monat", "Stunden"], ["Ann Lee", "15.03.2023", "01.01.2026", "40"], ["Ann Lee", "15.03.2023", "01.02.2026", "30"]]],
    ["Monat | Stunden | Erfasst", [["Name", "Monat", "Stunden", "Erfasst"], ["Ann Lee", "01.01.2026", "40", "08.01.2026"], ["Ann Lee", "01.02.2026", "30", "06.02.2026"]]],
  ])("Name | %s stays long in a CSV", (_label, rows) => {
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("long");
    const run = readSheet(rows);
    expect(run.validated.rejected).toEqual([]);
    expect(triplesOf(run)).toEqual([["Ann Lee", "2026-01", 40], ["Ann Lee", "2026-02", 30]]);
  });

  it("weekly Name | Woche | Stunden | Start stays long in a CSV", () => {
    const rows = [["Name", "Woche", "Stunden", "Start"], ["Ann Lee", "05.01.2026", "40", "01.12.2025"], ["Ann Lee", "12.01.2026", "32", "01.12.2025"]];
    expect(detectLayout(rows, { defaultYear: 2026 }).kind).toBe("long");
    expect(triplesOf(readSheet(rows))).toEqual([["Ann Lee", "2026-W02", 40], ["Ann Lee", "2026-W03", 32]]);
  });

  // Start and Ende as serials, Monat as text labels. With Monat stored as dates
  // too, three serial columns read wide from a data row: residue (10).
  it("Name | Start | Ende | Monat | Stunden stays long with workbook serial dates", () => {
    const rows = [
      ["Name", "Start", "Ende", "Monat", "Stunden"],
      ["Ann Lee", "46023", "46203", "Jan 2026", "8"], ["Ann Lee", "46023", "46203", "Feb 2026", "4"], ["Bob Kay", "46082", "46387", "Mär 2026", "2"],
    ];
    expect(detectLayout(rows, { numbers: "dot", defaultYear: 2026 }).mapping).toMatchObject({ layout: "long", period: 3, hours: 4 });
    expect(triplesOf(readSheet(rows, "dot"))).toEqual([["Ann Lee", "2026-01", 8], ["Ann Lee", "2026-02", 4], ["Bob Kay", "2026-03", 2]]);
  });
});
