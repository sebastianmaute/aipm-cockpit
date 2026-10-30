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
    expect(off).toEqual({ movedTasks: 0, movedHours: 0, editedCells: 0, costDelta: 0, externalHours: 0, noRateCount: 0, overCapacity: [] });
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

  it("percent-mode resources are compared in shown hours", () => {
    // 50 % of 176 h = 88 h shown; an edit to 200 h is over, an edit to 150 h is not.
    const c = ctxOf([maya(), liam({ utilizationMode: "percent", utilization: { "2026-09": 50 } })], [task()]);
    const alt = ground({ cells: [{ resourceId: 2, periodKey: "2026-09", hours: 200 }, { resourceId: 2, periodKey: "2026-10", hours: 150 }] }, c);
    const e = alternativeEffect(alt, ticked(...alt.cells.map(cellKey)), c);
    expect(e.overCapacity).toEqual([{ resourceId: 2, periodKey: "2026-09", hours: 200, capacityHours: 176 }]);
    // Cost moves with the shown-hour change: (200-88) + 150 h at EUR 80.
    expect(e.costDelta).toBeCloseTo((112 + 150) * 80, 6);
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
});
