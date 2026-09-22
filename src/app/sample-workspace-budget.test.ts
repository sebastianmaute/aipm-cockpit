import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace } from "./storage";
import { bucketActivePeriods, computeBudgetReport } from "./budget-report";
import { detectInsights } from "./insights/detect";
import { absencesForResource, absenceWorkdays, generatePeriods, workdaysInRange } from "./resource-capacity";
import { actualHoursIn, isDayKey } from "./actual-hours";

const json = readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8");
const ws = jsonToWorkspace(json);

describe("sample-workspace budgets", () => {
  test("parses seven buckets", () => {
    expect(ws.budgets?.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  test("bucket 1 is detailed with three role allocations and real hours", () => {
    const b = ws.budgets!.find((x) => x.id === 1)!;
    expect(b.planningMode ?? "detailed").toBe("detailed");
    expect(b.allocations).toHaveLength(3);
    const r1 = b.allocations.find((a) => a.roleId === 1)!;
    // The buckets are a staggered chain (5 -> 1 -> 4 -> 3 -> 2, and 7 -> 3), so
    // each one carries hours only in the periods its own window covers. Bucket 1
    // runs 2026-07-01..2026-09-30 (June is the Discovery bucket 5's) and is the
    // CURRENT bucket on DEMO_AS_OF (2026-09-18): July-August are hand-entered
    // month totals, September is TimeLog-applied day keys up to the as-of date.
    // The stored budget equals Sofia Ramirez's planned capacity (the plan's budget
    // follows planning), so August is the thin month: half of it is vacation.
    expect(b.startDate).toBe("2026-07-01");
    expect(b.endDate).toBe("2026-09-30");
    expect(r1.budgetHours).toEqual({ "2026-07": 166, "2026-08": 40, "2026-09": 141 });
    expect(r1.actualHours["2026-07"]).toBe(156);
    expect(r1.actualHours["2026-08"]).toBe(38);
    const septDays = Object.keys(r1.actualHours).filter(isDayKey);
    // Every working day 2026-09-01..09-18 at 6 h, none on a weekend or after the as-of date.
    expect(septDays).toHaveLength(14);
    expect(septDays.every((d) => d >= "2026-09-01" && d <= "2026-09-18")).toBe(true);
    expect(septDays.every((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))).toBe(true);
    expect(actualHoursIn(r1.actualHours, "2026-09")).toBe(84);
  });
  test("bucket 2 is blended with two discipline allocations", () => {
    const b = ws.budgets!.find((x) => x.id === 2)!;
    expect(b.planningMode).toBe("blended");
    expect(b.disciplineAllocations).toHaveLength(2);
    // Bucket 2 is the tail of the chain and still in the FUTURE on DEMO_AS_OF,
    // spanning 2026-10-01..2026-12-18 so its 264 consultant hours (Liam
    // Foster's 50 % capacity) land across three months instead of all in one.
    expect(b.startDate).toBe("2026-10-01");
    expect(b.endDate).toBe("2026-12-18");
    const d3 = b.disciplineAllocations!.find((a) => a.disciplineId === 3)!;
    expect(d3.budgetHours).toEqual({ "2026-10": 88, "2026-11": 84, "2026-12": 92 });
  });
  test("no allocation is keyed outside its bucket's window", () => {
    // An entry keyed to a period the window does not cover is silently dropped
    // by bucketActivePeriods — from the report, the burn-down and the totals.
    for (const b of ws.budgets!) {
      const rows = [...b.allocations, ...(b.disciplineAllocations ?? [])];
      for (const row of rows) {
        for (const key of Object.keys(row.budgetHours)) {
          expect(`${key}-01` >= b.startDate! && key <= b.endDate!.slice(0, 7)).toBe(true);
        }
        for (const key of Object.keys(row.actualHours)) {
          const inRange = isDayKey(key)
            ? key >= b.startDate! && key <= b.endDate!
            : `${key}-01` >= b.startDate! && key <= b.endDate!.slice(0, 7);
          expect(inRange).toBe(true);
        }
      }
    }
  });
  test("no resource is budgeted past a working month in any period", () => {
    // Guards the demo's credibility: a month is 21-23 workdays, and absences cut
    // it further (Sofia Ramirez loses 10 workdays to August vacation, Noah Bennett 5
    // to November and 1 to a September sick day). Capacity here is the physical ceiling — workdays minus absence
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
  test("bucket 4 is fixed-price, in USD, with a pinned rate", () => {
    const b = ws.budgets!.find((x) => x.id === 4)!;
    expect(b.type).toBe("fixed");
    expect(b.fixedPriceAmount).toBe(80000);
    // Non-EUR on purpose: the sample is the only fixture that exercises the
    // currency boundary end to end, and a rate of 1 would make it vacuous.
    // The rate is a bucket-level OVERRIDE, kept even though the master now also
    // carries a workspace `fxRates` table, because resolveRate takes the
    // override ahead of any cached ECB rate — so this bucket converts
    // identically whether or not the app has refreshed that table. 1.1 survives
    // sanitizeAmount's 4dp rounding for the FX rate override exactly.
    expect(b.currency).toBe("USD");
    expect(b.fxRateOverride).toBe(1.1);
  });
  test("bucket 6 is a second fixed-price bucket, in GBP, converted through the fxRates table", () => {
    const b = ws.budgets!.find((x) => x.id === 6)!;
    expect(b.type).toBe("fixed");
    expect(b.currency).toBe("GBP");
    expect(b.fxRateOverride).toBeUndefined();
    expect(ws.fxRates?.rates.GBP).toBe(0.85);
    expect(b.planningMode).toBe("blended");
  });
  test("buckets 5 and 7 are closed with successors, and 7 carries its own rate overrides", () => {
    const b5 = ws.budgets!.find((x) => x.id === 5)!;
    expect(b5.status).toBe("closed");
    expect(b5.successorId).toBe(1);
    const b7 = ws.budgets!.find((x) => x.id === 7)!;
    expect(b7.status).toBe("closed");
    expect(b7.successorId).toBe(3);
    expect(b7.rateOverrideInternal).toBe(105);
    expect(b7.rateOverrideExternal).toBe(185);
  });
  test("computeBudgetReport yields a realistic project rollup (cost from role rates, not zeroed)", () => {
    const rep = computeBudgetReport(ws.budgets!, ws.plan, ws.roles, ws.resources, 8, new Set<string>(), ws.absences, [], null);
    expect(rep.project.actualHours).toBeGreaterThan(1000);
    expect(rep.project.cost).toBeGreaterThan(80000);   // would be ~9000 if empty overrides zeroed the rates
    expect(rep.project.revenue).toBeGreaterThan(80000);
  });
  test("with budgetFollowsPlan on, no resource is staffed in two buckets in the same period", () => {
    // A staffed row's budget IS its resources' full planned capacity for every
    // period of the bucket's window (effectiveBudgetHours), so a person staffed
    // in two overlapping buckets is counted twice and every bucket reads far
    // under plan. Unstaffed rows fall back to their stored hours and are exempt.
    expect(ws.plan.budgetFollowsPlan).toBe(true);
    const seen = new Map<string, number>();
    const clashes: string[] = [];
    for (const b of ws.budgets!) {
      for (const p of bucketActivePeriods(b, ws.plan)) {
        const ids = new Set([...b.allocations, ...(b.disciplineAllocations ?? [])].flatMap((r) => r.resourceIds));
        for (const rid of ids) {
          const other = seen.get(`${rid}:${p.key}`);
          if (other !== undefined && other !== b.id) clashes.push(`res${rid} ${p.key}: b${other} + b${b.id}`);
          seen.set(`${rid}:${p.key}`, b.id);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    expect(clashes).toEqual([]);
  });
  test("closed buckets land within 15% of plan, and the curated budgetVariance insight matches the live detector", () => {
    const rep = computeBudgetReport(ws.budgets!, ws.plan, ws.roles, ws.resources, 8, new Set<string>(), ws.absences, [], null);
    const closed = rep.buckets.filter((b) => b.status === "closed");
    expect(closed.length).toBeGreaterThanOrEqual(2);
    for (const b of closed) {
      expect([b.name, Math.abs(b.actualHours - b.budgetHours) / b.budgetHours <= 0.15]).toEqual([b.name, true]);
    }
    const live = detectInsights({
      tasks: ws.tasks, milestones: ws.milestones ?? [], raid: ws.raid, budgets: ws.budgets ?? [], roles: ws.roles,
      resources: ws.resources, plan: ws.plan, priorOverdueCount: null, timelogViolations: null, holidaySet: new Set<string>(),
    }, "2026-09-18").find((d) => d.type === "budgetVariance");
    const curated = (ws.insights ?? []).find((i) => i.type === "budgetVariance");
    expect(live).toBeDefined();
    expect(curated?.data).toEqual(live?.data);
  });
});
