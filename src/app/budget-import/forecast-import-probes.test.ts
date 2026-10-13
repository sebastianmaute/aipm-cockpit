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
});
