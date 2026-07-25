import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace } from "./storage";
import { computeBudgetReport } from "./budget-report";
import { absencesForResource, absenceWorkdays, generatePeriods, workdaysInRange } from "./resource-capacity";

const json = readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8");
const ws = jsonToWorkspace(json);

describe("sample-workspace budgets", () => {
  test("parses five buckets", () => {
    expect(ws.budgets?.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
  test("bucket 1 is detailed with three role allocations and real hours", () => {
    const b = ws.budgets!.find((x) => x.id === 1)!;
    expect(b.planningMode ?? "detailed").toBe("detailed");
    expect(b.allocations).toHaveLength(3);
    const r1 = b.allocations.find((a) => a.roleId === 1)!;
    // The buckets are a staggered chain (5 -> 1 -> 4 -> 3 -> 2), so each one
    // carries hours only in the periods its own window covers. Bucket 1 runs
    // 2026-04-01..2026-06-30, and its hours are keyed across all three months
    // so no one person is booked past a working month (Alex Example is on
    // vacation for half of June, which is why June is the thin one).
    expect(b.startDate).toBe("2026-04-01");
    expect(b.endDate).toBe("2026-06-30");
    expect(r1.budgetHours).toEqual({ "2026-04": 150, "2026-05": 165, "2026-06": 65 });
    expect(r1.actualHours).toEqual({ "2026-04": 116, "2026-05": 128, "2026-06": 48 });
  });
  test("bucket 2 is blended with two discipline allocations", () => {
    const b = ws.budgets!.find((x) => x.id === 2)!;
    expect(b.planningMode).toBe("blended");
    expect(b.disciplineAllocations).toHaveLength(2);
    // Bucket 2 is the tail of the chain, spanning 2026-06-01..2026-07-31 so its
    // 220 consultant hours land across two months instead of all in July.
    expect(b.startDate).toBe("2026-06-01");
    expect(b.endDate).toBe("2026-07-31");
    const d3 = b.disciplineAllocations!.find((a) => a.disciplineId === 3)!;
    expect(d3.budgetHours).toEqual({ "2026-06": 100, "2026-07": 120 });
  });
  test("no allocation is keyed outside its bucket's window", () => {
    // An entry keyed to a period the window does not cover is silently dropped
    // by bucketActivePeriods — from the report, the burn-down and the totals.
    for (const b of ws.budgets!) {
      const rows = [...b.allocations, ...(b.disciplineAllocations ?? [])];
      for (const row of rows) {
        for (const key of [...Object.keys(row.budgetHours), ...Object.keys(row.actualHours)]) {
          expect(`${key}-01` >= b.startDate! && key <= b.endDate!.slice(0, 7)).toBe(true);
        }
      }
    }
  });
  test("no resource is budgeted past a working month in any period", () => {
    // Guards the demo's credibility: a month is 21-23 workdays, and absences cut
    // it further (Alex Example loses 10 workdays to June vacation, Sam Placeholder 4
    // to July). Capacity here is the physical ceiling — workdays minus absence
    // days at 8h — not the utilization-scaled figure the planner shows.
    const holidays = new Set<string>();
    const periods = generatePeriods(ws.plan!.startDate, ws.plan!.endDate, ws.plan!.granularity);
    const booked = new Map<string, number>();
    for (const b of ws.budgets!) {
      for (const row of [...b.allocations, ...(b.disciplineAllocations ?? [])]) {
        for (const rid of row.resourceIds ?? []) {
          for (const [key, hours] of Object.entries(row.budgetHours)) {
            booked.set(`${rid}:${key}`, (booked.get(`${rid}:${key}`) ?? 0) + hours);
          }
        }
      }
    }
    for (const r of ws.resources ?? []) {
      const abs = absencesForResource(ws.absences ?? [], r);
      for (const p of periods) {
        const capacity =
          (workdaysInRange(p.start, p.end, holidays) - absenceWorkdays(abs, p.start, p.end, holidays)) * 8;
        const hours = booked.get(`${r.id}:${p.key}`) ?? 0;
        expect(`res${r.id} ${p.key}: ${hours}h vs ${capacity}h capacity`).toBe(
          `res${r.id} ${p.key}: ${hours <= capacity ? hours : "OVER-BOOKED"}h vs ${capacity}h capacity`,
        );
      }
    }
  });
  test("bucket 3 carries per-bucket rate overrides", () => {
    const b = ws.budgets!.find((x) => x.id === 3)!;
    expect(b.rateOverrideInternal).toBe(90);
    expect(b.rateOverrideExternal).toBe(200);
  });
  test("bucket 4 is fixed-price", () => {
    const b = ws.budgets!.find((x) => x.id === 4)!;
    expect(b.type).toBe("fixed");
    expect(b.fixedPriceAmount).toBe(80000);
  });
  test("bucket 5 is closed with a successor", () => {
    const b = ws.budgets!.find((x) => x.id === 5)!;
    expect(b.status).toBe("closed");
    expect(b.successorId).toBe(1);
  });
  test("computeBudgetReport yields a realistic project rollup (cost from role rates, not zeroed)", () => {
    const rep = computeBudgetReport(ws.budgets!, ws.plan, ws.roles, ws.resources, 8, new Set<string>(), ws.absences);
    expect(rep.project.actualHours).toBeGreaterThan(1000);
    expect(rep.project.cost).toBeGreaterThan(80000);   // would be ~9000 if empty overrides zeroed the rates
    expect(rep.project.revenue).toBeGreaterThan(80000);
  });
});
