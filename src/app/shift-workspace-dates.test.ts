import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace, type Workspace } from "./workspace";
import { demoShiftFor, shiftWorkspaceDates } from "./shift-workspace-dates";
import { bucketActivePeriods, computeBudgetReport } from "./budget-report";

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
    // The master's own weekend date-only values are now all month-boundary
    // dates (verified: budgets[3].startDate "2026-08-01" Sat, budgets[3].endDate
    // "2026-10-31" Sat, budgets[5].startDate "2026-11-01" Sun — see the boundary
    // test below), so per the controller ruling they no longer roll at any n,
    // including n=0 — this assertion no longer exercises the n===0 guard by
    // itself. Kept as a broad regression check; the guard itself is pinned by
    // the dedicated non-boundary-weekend fixture test right after this one.
    expect(shiftWorkspaceDates(master, 0)).toEqual(master);
  });

  it("the n===0 guard: a non-boundary weekend date-only value must not roll at n=0", () => {
    // The current master carries no such value (checked: every weekend
    // date-only value/key in it is a month boundary), so this synthetic
    // fixture is what actually pins the guard now — without it, shiftDate's
    // roll-to-Monday step would move a mid-month Saturday/Sunday even at n=0.
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const, startDate: "2026-08-15" } };
    expect(new Date("2026-08-15T00:00:00Z").getUTCDay()).toBe(6); // Saturday, mid-month — anti-vacuity
    expect(shiftWorkspaceDates(ws, 0).plan.startDate).toBe("2026-08-15");
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

  it("adds months with day clamping for a non-boundary date", () => {
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const, startDate: "2026-08-05", endDate: "2026-03-07" } };
    const out = shiftWorkspaceDates(ws, 1);
    expect(out.plan.endDate).toBe("2026-04-07"); // Tue stays (non-boundary, no rolling needed)
  });

  it("exempts a month-boundary date-only value from weekend rolling (controller ruling)", () => {
    // 2026-01-31 is the LAST day of January. Naive addMonths+clamp gives 02-28
    // too (Jan has more days than Feb), so this alone wouldn't distinguish the
    // fix from the old code — the point is that 02-28 IS a Saturday and must
    // stay put: rolling a bucket's boundary date off the 1st/last of its month
    // desyncs it from `bucketActivePeriods` (budget-report.ts), which compares
    // against a period's `start`, always the 1st of a month.
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const, startDate: "2026-01-31", endDate: "2026-01-01" } };
    const out = shiftWorkspaceDates(ws, 1);
    expect(new Date("2026-02-28T00:00:00Z").getUTCDay()).toBe(6); // Saturday — anti-vacuity
    expect(out.plan.startDate).toBe("2026-02-28"); // last-of-month stays last-of-month, unrolled
    expect(out.plan.endDate).toBe("2026-02-01");   // 1st-of-month stays 1st-of-month
  });

  it("still rolls a weekend date-only value to Monday when it is NOT a month boundary", () => {
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const, startDate: "2026-08-05", endDate: "2026-08-06" } };
    const out = shiftWorkspaceDates(ws, 1);
    expect(new Date("2026-09-05T00:00:00Z").getUTCDay()).toBe(6); // Saturday — anti-vacuity
    expect(new Date("2026-09-06T00:00:00Z").getUTCDay()).toBe(0); // Sunday — anti-vacuity
    expect(out.plan.startDate).toBe("2026-09-07"); // Sat rolled to Monday
    expect(out.plan.endDate).toBe("2026-09-07");   // Sun rolled to Monday
  });

  it("maps a last-day-of-month boundary to the target month's OWN last day, not a day-clamp", () => {
    // 2026-04-30 is April's last day. A naive clamp (min(30, May's 31)) would
    // leave it at 2026-05-30 — one day short of May's actual last day.
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const, startDate: "2026-04-30", endDate: "2026-04-30" } };
    const out = shiftWorkspaceDates(ws, 1);
    expect(out.plan.startDate).toBe("2026-05-31");
  });

  it("shifts a timestamp's date part without rolling and keeps the time", () => {
    // 2026-08-05 is NOT a month boundary, and +1m (2026-09-05) is a Saturday —
    // chosen so this pins the `roll=false` flag specifically: a mutant that
    // rolls timestamps would move this one to 2026-09-07, whereas testing on a
    // month-boundary date (e.g. 2026-01-31) would pass either way, since the
    // boundary rule above computes the same result regardless of `roll`.
    const ws = { ...master, status: { ...master.status, narrativeUpdatedAt: "2026-08-05T09:15:00.000Z" } } as Workspace;
    expect(new Date("2026-09-05T00:00:00Z").getUTCDay()).toBe(6); // Saturday — anti-vacuity
    expect(shiftWorkspaceDates(ws, 1).status?.narrativeUpdatedAt).toBe("2026-09-05T09:15:00.000Z");
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

  // Only two NUMBERS can be merged; any other colliding pair has no sound sum,
  // so the shift refuses (loadDemo surfaces it as the demo-error toast) rather
  // than silently keeping one value. Same collision as the test above.
  it("throws when two date keys collide after the roll and a value is not numeric", () => {
    const bucket = {
      ...master.budgets![0],
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-05-30": "two", "2026-05-31": 3 } }],
    };
    const ws = { ...master, plan: { ...master.plan, granularity: "month" as const }, budgets: [bucket] } as unknown as Workspace;
    expect(() => shiftWorkspaceDates(ws, 1)).toThrow("non-numeric collision on key 2026-06-30");
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

  // Controller ruling / probe: before the month-boundary exemption above,
  // rolling a bucket's weekend 1st-of-month `startDate` off the 1st desynced
  // it from `bucketActivePeriods` (budget-report.ts), which keeps only periods
  // whose `start` (always the 1st) falls within [bucket.startDate,
  // bucket.endDate] — silently dropping the bucket's first month of budget and
  // actuals. This holds for every n in -3..15 on the real master.
  it("preserves every bucket's active-period count and totals for n in -3..15 (probe)", () => {
    const before = master.budgets!.map((b) => ({
      id: b.id,
      periods: bucketActivePeriods(b, master.plan).length,
    }));
    expect(before.every((b) => b.periods > 0)).toBe(true); // anti-vacuity
    const beforeRep = computeBudgetReport(
      master.budgets!, master.plan, master.roles, master.resources, 8, new Set<string>(), master.absences, [], null,
    );
    for (let n = -3; n <= 15; n++) {
      if (n === 0) continue; // identity, covered above
      const shifted = shiftWorkspaceDates(master, n);
      for (const b of before) {
        const sb = shifted.budgets!.find((x) => x.id === b.id)!;
        const afterPeriods = bucketActivePeriods(sb, shifted.plan).length;
        expect([n, b.id, afterPeriods]).toEqual([n, b.id, b.periods]);
      }
      const afterRep = computeBudgetReport(
        shifted.budgets!, shifted.plan, shifted.roles, shifted.resources, 8, new Set<string>(), shifted.absences, [], null,
      );
      for (const br of beforeRep.buckets) {
        const ar = afterRep.buckets.find((x) => x.bucketId === br.bucketId)!;
        // actualHours is literal TimeLog history keyed by day/month — invariant
        // under the shift regardless of which real calendar month it lands in.
        expect([n, br.bucketId, ar.actualHours]).toEqual([n, br.bucketId, br.actualHours]);
        // budgetHours is NOT expected to be bit-identical for a staffed
        // (budgetFollowsPlan) bucket: `effectiveBudgetHours` derives it from
        // real resource CAPACITY for the period (workdays minus absences), and
        // a real calendar month's workday count varies (28-31 days, different
        // weekend distributions) depending on which actual month the shift
        // lands the bucket in — unrelated to the boundary fix. Measured on this
        // master over n = -3..15: the largest observed relative move with the
        // fix in place is ~7.1% (bucket 5, n=8).
        // ★ THE PIN IS THE PERIOD-COUNT AND EXACT-ACTUALS ASSERTIONS ABOVE, not
        // this bound. With the boundary exemption reverted, the dropped-month
        // moves measured 22%-100% — so the LOW end of that range sits close to
        // any loose bound, and a bound alone is no reliable detector of a
        // dropped month. This is a SANITY FLOOR on budgetHours, tightened to
        // 12% (still above the ~7.1% legitimate maximum on every n here).
        expect(ar.budgetHours, `n=${n} bucket=${br.bucketId} budgetHours=0`).toBeGreaterThan(0);
        const rel = Math.abs(ar.budgetHours - br.budgetHours) / br.budgetHours;
        expect(rel, `n=${n} bucket=${br.bucketId} budgetHours ${br.budgetHours} -> ${ar.budgetHours} (${(rel * 100).toFixed(1)}%)`)
          .toBeLessThanOrEqual(0.12);
      }
    }
  });
});
