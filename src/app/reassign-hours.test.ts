import { describe, expect, it } from "vitest";
import { planHoursMoves, type HoursMoveCtx, type OwnerChange } from "./reassign-hours";
import {
  absencesForResource,
  generatePeriods,
  periodCapacityHours,
  workdaysInRange,
} from "./resource-capacity";
import { availableCapacityHours } from "./alloc-plan/alloc-plan";
import { type Absence, type Resource, type ResourcePlan, type Task } from "./types";

const plan: ResourcePlan = { startDate: "2026-09-01", endDate: "2026-10-31", granularity: "month", currency: "EUR" };
const NO_HOLIDAYS = new Set<string>();
const ctx: HoursMoveCtx = { plan, absences: [], workdayHours: 8, holidaySet: NO_HOLIDAYS, today: "2026-09-14" };
const [SEP, OCT] = generatePeriods(plan.startDate, plan.endDate, plan.granularity);

function resource(id: number, over: Partial<Resource>): Resource {
  return { id, firstName: "F", lastName: `L${id}`, roleId: null, utilizationMode: "hours", utilization: {}, ...over };
}
const maya = () => resource(1, { utilization: { "2026-09": 120, "2026-10": 80 } });
const liam = (util: Record<string, number> = {}) => resource(2, { utilization: util });
const ana = (util: Record<string, number> = { "2026-09": 90 }) =>
  resource(3, { utilizationMode: "percent", utilization: util });

function task(over: Partial<Task> = {}): Task {
  return {
    id: 7, title: "T", status: "In Progress", remainingEstimateMinutes: 24 * 60,
    startDate: "2026-09-21", dueDate: "2026-10-09", ...over,
  } as Task;
}
const change = (t: Task, from: number | undefined, to: number | undefined): OwnerChange =>
  ({ task: t, fromResourceId: from, toResourceId: to });
const shown = (r: Resource, p = SEP, c: HoursMoveCtx = ctx) =>
  periodCapacityHours(r, p, absencesForResource(c.absences, r), c.workdayHours, c.holidaySet);
const byKey = (m: { perPeriod: { periodKey: string; hours: number }[] }, k: string) =>
  m.perPeriod.find((p) => p.periodKey === k)?.hours ?? 0;

describe("planHoursMoves", () => {
  it("splits the remaining estimate by workdays inside the span", () => {
    const { moves } = planHoursMoves([change(task(), 1, 2)], [maya(), liam()], ctx);
    const sep = workdaysInRange("2026-09-21", "2026-09-30", NO_HOLIDAYS);
    const oct = workdaysInRange("2026-10-01", "2026-10-09", NO_HOLIDAYS);
    expect(byKey(moves[0], "2026-09")).toBeCloseTo((24 * sep) / (sep + oct), 1);
    expect(byKey(moves[0], "2026-10")).toBeCloseTo((24 * oct) / (sep + oct), 1);
    expect(moves[0].movedHours).toBeCloseTo(24, 1);
    expect(moves[0].shortfallHours).toBe(0);
  });

  it("takes from the giver and gives the receiver exactly the same shown hours", () => {
    const { moves, nextResources } = planHoursMoves([change(task(), 1, 2)], [maya(), liam()], ctx);
    for (const p of [SEP, OCT]) {
      const m = byKey(moves[0], p.key);
      expect(shown(nextResources[0], p)).toBeCloseTo(shown(maya(), p) - m, 5);
      expect(shown(nextResources[1], p)).toBeCloseTo(m, 5);
    }
  });

  it("caps at the giver's shown planned hours and reports the shortfall", () => {
    const giver = resource(1, { utilization: { "2026-09": 4 } });
    const { moves, nextResources } = planHoursMoves([change(task(), 1, 2)], [giver, liam()], ctx);
    expect(byKey(moves[0], "2026-09")).toBe(4);
    expect(moves[0].shortfallHours).toBeGreaterThan(0);
    expect(nextResources[0].utilization["2026-09"]).toBe(0);
    expect(nextResources[1].utilization["2026-09"]).toBe(4);
  });

  it("starts the span today when the start date has passed", () => {
    const { moves } = planHoursMoves([change(task({ startDate: "2026-09-01" }), 1, 2)], [maya(), liam()], ctx);
    const sep = workdaysInRange("2026-09-14", "2026-09-30", NO_HOLIDAYS);
    const oct = workdaysInRange("2026-10-01", "2026-10-09", NO_HOLIDAYS);
    expect(byKey(moves[0], "2026-09")).toBeCloseTo((24 * sep) / (sep + oct), 1);
  });

  it("puts an overdue task's hours in today's period", () => {
    const { moves } = planHoursMoves([change(task({ dueDate: "2026-09-10" }), 1, 2)], [maya(), liam()], ctx);
    expect(moves[0].perPeriod).toEqual([{ periodKey: "2026-09", hours: 24 }]);
  });

  it("puts a span with no workdays in the due date's period (R2)", () => {
    const t = task({ startDate: "2026-10-31", dueDate: "2026-10-31" }); // a Saturday
    const { moves } = planHoursMoves([change(t, 1, 2)], [maya(), liam()], ctx);
    expect(moves[0].perPeriod).toEqual([{ periodKey: "2026-10", hours: 24 }]);
  });

  it("uses the due date alone when the start is after it (R2)", () => {
    const t = task({ startDate: "2026-10-20", dueDate: "2026-09-30" });
    const { moves } = planHoursMoves([change(t, 1, 2)], [maya(), liam()], ctx);
    expect(moves[0].perPeriod).toEqual([{ periodKey: "2026-09", hours: 24 }]);
  });

  it("counts span days outside the plan as outsideWindowHours", () => {
    const { moves } = planHoursMoves([change(task({ dueDate: "2026-11-20" }), 1, 2)], [maya(), liam()], ctx);
    expect(moves[0].outsideWindowHours).toBeGreaterThan(0);
    expect(moves[0].movedHours + moves[0].outsideWindowHours).toBeCloseTo(24, 0);
    const out = planHoursMoves(
      [change(task({ startDate: "2026-11-02", dueDate: "2026-11-20" }), 1, 2)],
      [maya(), liam()],
      ctx,
    );
    expect(out.moves[0].reason).toBe("outsideWindow");
    expect(out.moves[0].movedHours).toBe(0);
    expect(out.edits).toEqual([]);
  });

  it("moves nothing for a closed task", () => {
    for (const status of ["Done", "Cancelled"] as const) {
      const { moves, edits } = planHoursMoves([change(task({ status }), 1, 2)], [maya(), liam()], ctx);
      expect(moves[0].reason).toBe("closed");
      expect(moves[0].movedHours).toBe(0);
      expect(edits).toEqual([]);
    }
  });

  it("moves nothing without a remaining estimate", () => {
    for (const v of [undefined, 0]) {
      const { moves } = planHoursMoves([change(task({ remainingEstimateMinutes: v }), 1, 2)], [maya(), liam()], ctx);
      expect(moves[0].reason).toBe("noEstimate");
    }
  });

  it("moves nothing when either side is unlinked", () => {
    expect(planHoursMoves([change(task(), 1, undefined)], [maya(), liam()], ctx).moves[0].reason).toBe("unlinked");
    expect(planHoursMoves([change(task(), undefined, 2)], [maya(), liam()], ctx).moves[0].reason).toBe("unlinked");
  });

  it("converts to percent for a percent-mode receiver", () => {
    const start = ana({});
    const { moves, nextResources } = planHoursMoves(
      [change(task(), 2, 3)],
      [liam({ "2026-09": 100, "2026-10": 100 }), start],
      ctx,
    );
    for (const p of [SEP, OCT]) {
      const avail = availableCapacityHours(start, p, [], 8, NO_HOLIDAYS);
      const dPct = (byKey(moves[0], p.key) / avail) * 100;
      expect(Math.abs((nextResources[1].utilization[p.key] ?? 0) - dPct)).toBeLessThanOrEqual(0.01);
    }
  });

  it("caps a percent-mode receiver at 100 %", () => {
    const { moves, nextResources } = planHoursMoves([change(task({ dueDate: "2026-09-30" }), 1, 3)], [maya(), ana()], ctx);
    const avail = availableCapacityHours(ana(), SEP, [], 8, NO_HOLIDAYS);
    expect(nextResources[1].utilization["2026-09"]).toBeLessThanOrEqual(100);
    const room = Math.floor((avail * 0.1) * 10 + 1e-9) / 10; // the planner floors the room to 0.1 h
    expect(byKey(moves[0], "2026-09")).toBe(room);
    expect(moves[0].receiverCapHours).toBeGreaterThan(0);
    expect(moves[0].movedHours + moves[0].receiverCapHours).toBeCloseTo(24, 1);
    expect(shown(nextResources[0], SEP)).toBeCloseTo(120 - byKey(moves[0], "2026-09"), 1);
  });

  it("raises an hours-mode receiver past absence", () => {
    const absences: Absence[] = [
      { id: 1, assignee: "x", resourceId: 2, startDate: "2026-09-02", endDate: "2026-09-04" } as Absence,
    ];
    const c = { ...ctx, absences };
    const { moves, nextResources } = planHoursMoves([change(task(), 1, 2)], [maya(), liam({})], c);
    const m = byKey(moves[0], "2026-09");
    expect(m).toBeGreaterThan(0);
    expect(nextResources[1].utilization["2026-09"]).toBeCloseTo(24 + m, 5);
    expect(shown(nextResources[1], SEP, c) - shown(liam({}), SEP, c)).toBeCloseTo(m, 5);
  });

  it("reports a receiver pushed over capacity", () => {
    const { overCapacity, nextResources } = planHoursMoves(
      [change(task(), 1, 2)],
      [maya(), liam({ "2026-09": 170 })],
      ctx,
    );
    const avail = availableCapacityHours(liam(), SEP, [], 8, NO_HOLIDAYS);
    const expected = Math.round((nextResources[1].utilization["2026-09"] / avail) * 100);
    expect(overCapacity).toEqual([{ resourceId: 2, periodKey: "2026-09", percent: expected }]);
    expect(expected).toBeGreaterThan(100);
  });

  it("caps the running total across a batch", () => {
    const giver = resource(1, { utilization: { "2026-09": 14, "2026-10": 10 } });
    const second = task({ id: 8 });
    const { moves, nextResources } = planHoursMoves(
      [change(task(), 1, 2), change(second, 1, 2)],
      [giver, liam()],
      ctx,
    );
    for (const p of [SEP, OCT]) expect(nextResources[0].utilization[p.key]).toBeGreaterThanOrEqual(0);
    expect(nextResources[0].utilization["2026-09"]).toBe(0);
    expect(moves[1].shortfallHours).toBeGreaterThan(moves[0].shortfallHours);
    expect(byKey(moves[0], "2026-09") + byKey(moves[1], "2026-09")).toBeCloseTo(14, 5);
    expect(nextResources[1].utilization["2026-09"]).toBeCloseTo(14, 5);
  });

  it("leaves the input resources untouched", () => {
    const input = [maya(), liam(), ana()];
    const snapshot = structuredClone(input);
    const out = planHoursMoves([change(task(), 1, 2)], input, ctx);
    expect(input).toEqual(snapshot);
    expect(out.nextResources[0]).not.toBe(input[0]);
    expect(out.edits.map((e) => e.id)).toEqual([1, 2]);
    expect(out.edits[0].before.utilization).toEqual(snapshot[0].utilization);
  });

  it("lowers a percent-mode giver's stored percent by exactly the moved hours", () => {
    const giver = ana({ "2026-09": 90 });
    const { moves, nextResources } = planHoursMoves([change(task({ dueDate: "2026-09-30" }), 3, 2)], [liam(), giver], ctx);
    const m = byKey(moves[0], "2026-09");
    expect(m).toBe(24);
    expect(Math.abs(shown(nextResources[1], SEP) - (shown(giver, SEP) - m))).toBeLessThanOrEqual(0.01);
    expect(nextResources[1].utilization["2026-09"]).toBeLessThan(90);
  });

  it("gives a fully absent percent-mode receiver nothing and leaves the share with the giver", () => {
    const absences: Absence[] = [
      { id: 1, assignee: "x", resourceId: 3, startDate: "2026-09-01", endDate: "2026-09-30" } as Absence,
    ];
    const c = { ...ctx, absences };
    const receiver = ana({ "2026-09": 50 });
    const { moves, nextResources } = planHoursMoves([change(task(), 1, 3)], [maya(), receiver], c);
    expect(byKey(moves[0], "2026-09")).toBe(0);
    expect(byKey(moves[0], "2026-10")).toBeGreaterThan(0);
    expect(moves[0].receiverCapHours).toBeGreaterThan(12);
    expect(nextResources[0].utilization["2026-09"]).toBe(120);
    expect(nextResources[1].utilization["2026-09"]).toBe(50);
  });

  it("splits onto week keys for a week-granularity plan", () => {
    const weekPlan: ResourcePlan = { ...plan, granularity: "week" };
    const wc: HoursMoveCtx = { ...ctx, plan: weekPlan };
    const weeks = generatePeriods(weekPlan.startDate, weekPlan.endDate, "week");
    const util = Object.fromEntries(weeks.map((w) => [w.key, 40]));
    const { moves } = planHoursMoves([change(task(), 1, 2)], [resource(1, { utilization: util }), liam()], wc);
    const total = workdaysInRange("2026-09-21", "2026-10-09", NO_HOLIDAYS);
    const expected = weeks
      .map((w) => ({
        key: w.key,
        wd: workdaysInRange(w.start > "2026-09-21" ? w.start : "2026-09-21", w.end < "2026-10-09" ? w.end : "2026-10-09", NO_HOLIDAYS),
      }))
      .filter((w) => w.wd > 0);
    expect(moves[0].perPeriod.map((p) => p.periodKey)).toEqual(expected.map((w) => w.key));
    expect(expected.length).toBeGreaterThan(2);
    for (const w of expected) expect(byKey(moves[0], w.key)).toBeCloseTo((24 * w.wd) / total, 1);
    expect(moves[0].perPeriod.every((p) => /^\d{4}-W\d{2}$/.test(p.periodKey))).toBe(true);
  });

  it("caps an hours-mode giver by shown hours, honouring an absence override", () => {
    const giver = resource(1, { utilization: { "2026-09": 110 }, absenceOverride: { "2026-09": 100 } });
    const { moves, nextResources } = planHoursMoves([change(task({ dueDate: "2026-09-30" }), 1, 2)], [giver, liam()], ctx);
    expect(byKey(moves[0], "2026-09")).toBe(10);
    expect(moves[0].shortfallHours).toBe(14);
    expect(nextResources[0].utilization["2026-09"]).toBe(100);
  });

  it("skips an unchanged owner without a move", () => {
    expect(planHoursMoves([change(task(), 1, 1)], [maya()], ctx).moves).toEqual([]);
    expect(planHoursMoves([change(task(), undefined, undefined)], [maya()], ctx).moves).toEqual([]);
  });
});
