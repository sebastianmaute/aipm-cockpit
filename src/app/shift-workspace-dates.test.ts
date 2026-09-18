import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace, type Workspace } from "./workspace";
import { demoShiftFor, shiftWorkspaceDates } from "./shift-workspace-dates";

const master = jsonToWorkspace(
  readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"),
  { strict: true },
);
const DATE = /^\d{4}-\d{2}-\d{2}/;

function collect(v: unknown, path: string, out: Map<string, string>) {
  if (Array.isArray(v)) { v.forEach((x, i) => collect(x, `${path}[${i}]`, out)); return; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) collect(x, `${path}.${DATE.test(k) ? "<key>" : k}`, out);
    return;
  }
  if (typeof v === "string" && DATE.test(v)) out.set(path, v);
}

describe("demoShiftFor", () => {
  it("counts whole calendar months for a month plan", () => {
    expect(demoShiftFor("2026-09-18", "2026-09-30", "month")).toBe(0);
    expect(demoShiftFor("2026-09-18", "2026-12-01", "month")).toBe(3);
    expect(demoShiftFor("2026-09-18", "2027-01-05", "month")).toBe(4);
  });
  it("counts whole ISO weeks for a week plan", () => {
    expect(demoShiftFor("2026-09-18", "2026-09-20", "week")).toBe(0); // same ISO week (Fri → Sun)
    expect(demoShiftFor("2026-09-18", "2026-09-21", "week")).toBe(1);
  });
});

describe("shiftWorkspaceDates", () => {
  it("is the identity for n = 0", () => {
    // The master carries weekend date-only values (e.g. budget bucket 4's startDate
    // "2026-08-01" is a Saturday, bucket 6's "2026-11-01" a Sunday — list them with
    //   node -e "const w=require('./sample-workspace-small.json');(function f(v,p){if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&[0,6].includes(new Date(v+'T00:00:00Z').getUTCDay()))console.log(p,v);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v))f(x,p+'.'+k)})(w,'')"
    // ) — this is what pins the n===0 guard: without it,
    // shiftDate's roll-to-Monday step would move these even though n is 0.
    expect(shiftWorkspaceDates(master, 0)).toEqual(master);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(master);
    shiftWorkspaceDates(master, 3);
    expect(JSON.stringify(master)).toBe(before);
  });

  it("moves EVERY date-bearing value in the master (discovery, not a field list)", () => {
    const before = new Map<string, string>();
    const after = new Map<string, string>();
    collect(master, "", before);
    collect(shiftWorkspaceDates(master, 3), "", after);
    expect(before.size).toBeGreaterThan(20); // anti-vacuity: the master carries dates
    const unmoved = [...before].filter(([p, v]) => after.get(p) === v).map(([p]) => p);
    expect(unmoved).toEqual([]);
  });

  it("adds months with day clamping and rolls a weekend date-only value to Monday", () => {
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const, startDate: "2026-01-31", endDate: "2026-03-07" } };
    const out = shiftWorkspaceDates(ws, 1);
    expect(out.plan.startDate).toBe("2026-03-02"); // 01-31 +1m → 02-28 (Sat) → Mon 03-02
    expect(out.plan.endDate).toBe("2026-04-07");   // Tue stays
  });

  it("shifts a timestamp's date part without rolling and keeps the time", () => {
    const ws = { ...master, status: { ...master.status, narrativeUpdatedAt: "2026-01-31T09:15:00.000Z" } } as Workspace;
    expect(shiftWorkspaceDates(ws, 1).status?.narrativeUpdatedAt).toBe("2026-02-28T09:15:00.000Z");
  });

  it("re-keys month periods and sums day keys that collide after the roll", () => {
    const bucket = {
      ...master.budgets![0],
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 10 }, actualHours: { "2026-05-30": 2, "2026-05-31": 3, "2026-06": 1 } }],
    };
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const }, budgets: [bucket] };
    const a = shiftWorkspaceDates(ws, 1).budgets![0].allocations[0];
    expect(a.budgetHours).toEqual({ "2026-07": 10 });
    // 05-30 (Sat) and 05-31 (Sun) +1m → 06-30 (Tue) and 06-30 (clamped from 06-31 → Tue): summed
    expect(a.actualHours).toEqual({ "2026-06-30": 5, "2026-07": 1 });
  });

  it("re-keys ISO week periods for a week plan", () => {
    const ws = {
      ...master,
      plan: { ...master.plan, granularity: "week" as const },
      budgets: [{ ...master.budgets![0], allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-W52": 4 }, actualHours: {} }] }],
    };
    // 2026 has an ISO week 53 (2026-01-01 is a Thursday), so Monday of 2026-W52
    // (2026-12-21) + 14 days lands on 2027-01-04, which is ISO week 2027-W01 —
    // NOT 2027-W02 as a naive "+2" on the week number would suggest. Verified via
    // isoWeekParts(2026-12-28)/(2026-12-31) both reporting {year:2026, week:53}.
    expect(shiftWorkspaceDates(ws, 2).budgets![0].allocations[0].budgetHours).toEqual({ "2027-W01": 4 });
  });
});
