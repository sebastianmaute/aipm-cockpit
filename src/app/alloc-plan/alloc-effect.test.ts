import { describe, expect, it } from "vitest";
import { alternativeEffect } from "./alloc-effect";
import { groundAlternative, moveKey, type MoveGroundContext } from "./alloc-ground-moves";
import { cellKey } from "./alloc-plan";
import { type RawAllocAlternative } from "./alloc-alternatives";
import { type Resource, type ResourcePlan, type Role, type Task } from "../types";

const plan: ResourcePlan = { startDate: "2026-09-01", endDate: "2026-10-31", granularity: "month", currency: "EUR" };

function role(id: number, internalRate: number): Role {
  return { id, disciplineId: 1, gradeId: 1, internalRate, externalRate: internalRate * 1.5 } as Role;
}
const roles = [role(1, 50), role(2, 80)];

function resource(id: number, over: Partial<Resource> = {}): Resource {
  return { id, firstName: "F", lastName: `L${id}`, roleId: null, utilizationMode: "hours", utilization: {}, ...over };
}
const maya = (over: Partial<Resource> = {}) =>
  resource(1, { firstName: "Maya", lastName: "Patel", email: "maya@x.io", roleId: 1, utilization: { "2026-09": 120, "2026-10": 80 }, ...over });
const liam = (over: Partial<Resource> = {}) =>
  resource(2, { firstName: "Liam", lastName: "Foster", email: "liam@x.io", roleId: 2, ...over });

function task(over: Partial<Task> = {}): Task {
  return {
    id: 7, taskName: "Build it", assignee: "Maya Patel", assigneeEmail: "maya@x.io", resourceId: 1,
    status: "In Progress", remainingEstimateMinutes: 16 * 60, startDate: "2026-09-21", dueDate: "2026-09-30",
    ...over,
  } as Task;
}

function ctxOf(resources: Resource[], tasks: Task[]): MoveGroundContext & { roles: readonly Role[] } {
  return { resources, tasks, roles, plan, absences: [], workdayHours: 8, holidaySet: new Set<string>(), today: "2026-09-14" };
}
function ground(raw: Partial<RawAllocAlternative>, c: ReturnType<typeof ctxOf>) {
  return groundAlternative({ summary: "S", taskMoves: [], cells: [], ...raw }, c);
}
const move = (taskId: number, toResourceId: number) => ({ taskId, toResourceId });
const ticked = (...keys: string[]) => new Set(keys);

describe("alternativeEffect", () => {
  it("moving 16 h from a €50/h to a €80/h person costs +€480", () => {
    const c = ctxOf([maya(), liam()], [task()]);
    const alt = ground({ taskMoves: [move(7, 2)] }, c);
    const e = alternativeEffect(alt, ticked(moveKey({ taskId: 7 })), c);
    expect(e.movedTasks).toBe(1);
    expect(e.movedHours).toBe(16);
    expect(e.costDelta).toBeCloseTo(480, 6);
    expect(e.externalHours).toBe(0);
    expect(e.noRateCount).toBe(0);
    expect(e.overCapacity).toEqual([]);
  });

  it("an external receiver adds no cost and counts its hours", () => {
    const c = ctxOf([maya(), liam({ isExternal: true })], [task()]);
    const alt = ground({ taskMoves: [move(7, 2)] }, c);
    const e = alternativeEffect(alt, ticked(moveKey({ taskId: 7 })), c);
    // The giver's -16 h still saves €50/h; the external's 16 h cost nothing here.
    expect(e.costDelta).toBeCloseTo(-800, 6);
    expect(e.externalHours).toBe(16);
    expect(e.noRateCount).toBe(0);
  });

  it("a person with no role is counted once", () => {
    const c = ctxOf([maya(), liam({ roleId: null })], [task({ startDate: "2026-09-21", dueDate: "2026-10-09" })]);
    const alt = ground({ taskMoves: [move(7, 2)] }, c);
    const e = alternativeEffect(alt, ticked(moveKey({ taskId: 7 })), c);
    expect(e.noRateCount).toBe(1);
  });

  it("unticking a move removes its cost and its warning", () => {
    const c = ctxOf([maya(), liam({ utilization: { "2026-09": 170 } })], [task()]);
    const alt = ground({ taskMoves: [move(7, 2)] }, c);
    const on = alternativeEffect(alt, ticked(moveKey({ taskId: 7 })), c);
    expect(on.overCapacity).toHaveLength(1);
    expect(on.overCapacity[0]).toMatchObject({ resourceId: 2, periodKey: "2026-09", hours: 186, capacityHours: 176 });
    const off = alternativeEffect(alt, ticked(), c);
    expect(off).toMatchObject({ movedTasks: 0, movedHours: 0, editedCells: 0, coveredCells: 0, costDelta: 0, externalHours: 0, noRateCount: 0, overCapacity: [] });
    expect(off.movePlan.moves).toEqual([]);
  });

  it("a ticked move plus a ticked cell on another period of the same receiver are both counted toward over-capacity", () => {
    const c = ctxOf([maya(), liam({ utilization: { "2026-09": 170, "2026-10": 100 } })], [task()]);
    const alt = ground({ taskMoves: [move(7, 2)], cells: [{ resourceId: 2, periodKey: "2026-10", hours: 190 }] }, c);
    expect(alt.cells).toHaveLength(1);
    const cellOnly = alternativeEffect(alt, ticked(cellKey(alt.cells[0])), c);
    expect(cellOnly.overCapacity.map((o) => o.periodKey)).toEqual(["2026-10"]);
    const both = alternativeEffect(alt, ticked(moveKey({ taskId: 7 }), cellKey(alt.cells[0])), c);
    expect(both.editedCells).toBe(1);
    expect(both.overCapacity.map((o) => o.periodKey)).toEqual(["2026-09", "2026-10"]);
    const moveOnly = alternativeEffect(alt, ticked(moveKey({ taskId: 7 })), c);
    expect(moveOnly.overCapacity.map((o) => o.periodKey)).toEqual(["2026-09"]);
  });

  it("a percent cell is judged by what apply writes: whole percent, capped at 100", () => {
    // 50 % of 176 h = 88 h shown. A 200 h ask is capped at 100 % = 176 h: no warning, cost on 176 - 88.
    const c = ctxOf([maya(), liam({ utilizationMode: "percent", utilization: { "2026-09": 50 } })], [task()]);
    const alt = ground({ cells: [{ resourceId: 2, periodKey: "2026-09", hours: 200 }] }, c);
    const e = alternativeEffect(alt, ticked(...alt.cells.map(cellKey)), c);
    expect(e.overCapacity).toEqual([]);
    expect(e.costDelta).toBeCloseTo((176 - 88) * 80, 6);
  });

  it("a percent cell's hours are rounded to the whole percent apply writes", () => {
    // 100 h of 176 h = 56.8 % -> written as 57 % = 100.32 h.
    const c = ctxOf([maya(), liam({ utilizationMode: "percent", utilization: { "2026-09": 0 } })], [task()]);
    const alt = ground({ cells: [{ resourceId: 2, periodKey: "2026-09", hours: 100 }] }, c);
    const e = alternativeEffect(alt, ticked(...alt.cells.map(cellKey)), c);
    expect(e.costDelta).toBeCloseTo(((alt.cells[0].nextValue / 100) * 176) * 80, 6);
    expect(e.costDelta).not.toBeCloseTo(100 * 80, 3);
  });

  it("an hours-mode person's shown level subtracts absences", () => {
    // 2 workdays of absence in Sep: available 160 h. Stored 150 h shows 134 h; +16 h = 150 h, no warning.
    const absence = { id: 1, assignee: "Liam Foster", resourceId: 2, startDate: "2026-09-01", endDate: "2026-09-02", type: "vacation" };
    const mk = (stored: number) => {
      const c = { ...ctxOf([maya(), liam({ utilization: { "2026-09": stored } })], [task()]), absences: [absence] as never };
      return { c, alt: ground({ taskMoves: [move(7, 2)] }, c) };
    };
    const ok = mk(150);
    expect(alternativeEffect(ok.alt, ticked(moveKey({ taskId: 7 })), ok.c).overCapacity).toEqual([]);
    const over = mk(180);
    const e = alternativeEffect(over.alt, ticked(moveKey({ taskId: 7 })), over.c);
    expect(e.overCapacity).toEqual([{ resourceId: 2, periodKey: "2026-09", hours: 180, capacityHours: 160 }]);
  });

  it("two ticked moves from one giver are planned together, not summed", () => {
    // Maya shows 20 h in September but both tasks want 16 h of it: each plan alone takes 16.
    const c = ctxOf(
      [maya({ utilization: { "2026-09": 20 } }), liam(), resource(3, { roleId: 2 })],
      [task(), task({ id: 8, taskName: "Other" })],
    );
    const alt = ground({ taskMoves: [move(7, 2), move(8, 3)] }, c);
    const perMoveSum = alt.moves.reduce((s, m) => s + m.plan.moves[0].movedHours, 0);
    expect(perMoveSum).toBe(32);
    const e = alternativeEffect(alt, ticked(...alt.moves.map((m) => m.key)), c);
    expect(e.movedTasks).toBe(2);
    expect(e.movedHours).toBe(20);
  });

  it("an unlinked move counts as a moved task but moves no hours", () => {
    const t = task({ assignee: "", assigneeEmail: "", resourceId: undefined });
    const c = ctxOf([maya(), liam()], [t]);
    const alt = ground({ taskMoves: [move(7, 2)] }, c);
    const e = alternativeEffect(alt, ticked(moveKey({ taskId: 7 })), c);
    expect(e.movedTasks).toBe(1);
    expect(e.movedHours).toBe(0);
    expect(e.costDelta).toBe(0);
  });

  // Final review, Important 1. Maya→Liam then Liam→Zoe: planned alone, Liam's move carries nothing, so grounding keeps
  // the model's Zoe cell; planned together, the moves write Zoe's September, and apply would then overwrite it.
  describe("a cell the ticked moves planned together already change", () => {
    const zoe = () => resource(3, { firstName: "Zoe", lastName: "Kim", roleId: 2 });
    const liamsTask = () => task({ id: 14, taskName: "Liam's", assignee: "Liam Foster", assigneeEmail: "liam@x.io", resourceId: 2 });
    const setup = () => {
      const c = ctxOf([maya(), liam(), zoe()], [task(), liamsTask()]);
      const alt = ground({ taskMoves: [move(7, 2), move(14, 3)], cells: [{ resourceId: 3, periodKey: "2026-09", hours: 4 }] }, c);
      return { c, alt };
    };

    it("is kept by grounding (the moves alone do not cover it)", () => {
      expect(setup().alt.cells.map(cellKey)).toEqual(["3:2026-09"]);
    });

    it("adds nothing to the preview and is counted as covered", () => {
      const { c, alt } = setup();
      const e = alternativeEffect(alt, ticked(...alt.moves.map((m) => m.key), cellKey(alt.cells[0])), c);
      expect(e.movedHours).toBe(32);
      // Maya -16 h at €50, Zoe +16 h at €80; Liam gives what he receives. The 4 h cell would add €320 on top.
      expect(e.costDelta).toBeCloseTo(-800 + 1280, 6);
      expect(e.coveredCells).toBe(1);
      expect(e.editedCells).toBe(0);
    });

    it("counts again once a move it depends on is unticked", () => {
      const { c, alt } = setup();
      const e = alternativeEffect(alt, ticked(moveKey({ taskId: 14 }), cellKey(alt.cells[0])), c);
      expect(e.coveredCells).toBe(0);
      expect(e.editedCells).toBe(1);
      expect(e.costDelta).toBeCloseTo(4 * 80, 6);
    });

    it("exposes the combined plan, so each move row reads its own share of it", () => {
      const { c, alt } = setup();
      const e = alternativeEffect(alt, ticked(...alt.moves.map((m) => m.key)), c);
      expect(e.movePlan.moves.find((m) => m.taskId === 14)?.movedHours).toBe(16);
    });
  });
});
