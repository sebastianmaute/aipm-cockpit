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
