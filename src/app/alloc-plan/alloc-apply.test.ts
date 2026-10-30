import { describe, expect, it } from "vitest";
import { planApply } from "./alloc-apply";
import { groundAlternative, moveKey, type MoveGroundContext } from "./alloc-ground-moves";
import { cellKey } from "./alloc-plan";
import { type RawAllocAlternative } from "./alloc-alternatives";
import { type Resource, type ResourcePlan, type Task } from "../types";

// Third wave, 5 — the apply's accounting, pure: what is written, and each skip counted under its own reason.
const plan: ResourcePlan = { startDate: "2026-09-01", endDate: "2026-10-31", granularity: "month", currency: "EUR" };

function resource(id: number, over: Partial<Resource> = {}): Resource {
  return { id, firstName: "F", lastName: `L${id}`, roleId: null, utilizationMode: "hours", utilization: {}, ...over };
}
const maya = (over: Partial<Resource> = {}) =>
  resource(1, { firstName: "Maya", lastName: "Patel", email: "maya@x.io", utilization: { "2026-09": 120, "2026-10": 80 }, ...over });
const liam = (over: Partial<Resource> = {}) => resource(2, { firstName: "Liam", lastName: "Foster", email: "liam@x.io", ...over });
const zoe = (over: Partial<Resource> = {}) => resource(3, { firstName: "Zoe", lastName: "Kim", ...over });

function task(over: Partial<Task> = {}): Task {
  return {
    id: 7, taskName: "Build it", assignee: "Maya Patel", assigneeEmail: "maya@x.io", resourceId: 1,
    status: "In Progress", remainingEstimateMinutes: 16 * 60, startDate: "2026-09-21", dueDate: "2026-09-30",
    ...over,
  } as Task;
}
const liamsTask = () => task({ id: 14, taskName: "Liam's", assignee: "Liam Foster", assigneeEmail: "liam@x.io", resourceId: 2 });

function ctxOf(resources: Resource[], tasks: Task[]): MoveGroundContext {
  return { resources, tasks, plan, absences: [], workdayHours: 8, holidaySet: new Set<string>(), today: "2026-09-14" };
}
function ground(raw: Partial<RawAllocAlternative>, c: MoveGroundContext) {
  return groundAlternative({ summary: "S", taskMoves: [], cells: [], ...raw }, c);
}
const all = (a: ReturnType<typeof ground>) => new Set([...a.moves.map((m) => m.key), ...a.cells.map(cellKey)]);

describe("planApply", () => {
  it("writes every ticked row when nothing changed", () => {
    const c = ctxOf([maya(), liam(), zoe()], [task()]);
    const a = ground({ taskMoves: [{ taskId: 7, toResourceId: 2 }], cells: [{ resourceId: 3, periodKey: "2026-10", hours: 12 }] }, c);
    const p = planApply(a, all(a), c);
    expect(p).toMatchObject({ chosen: 2, cellCount: 1, stale: 0, covered: 0, unchanged: 0 });
    expect(p.ownerEdits).toEqual([{ taskId: 7, assignee: "Liam Foster", assigneeEmail: "liam@x.io", resourceId: 2 }]);
    expect(p.patches).toEqual([{ id: 3, before: { utilization: {} }, after: { utilization: { "2026-10": 12 } } }]);
  });

  it("leaves out an unticked row without counting it", () => {
    const c = ctxOf([maya(), liam(), zoe()], [task()]);
    const a = ground({ taskMoves: [{ taskId: 7, toResourceId: 2 }], cells: [{ resourceId: 3, periodKey: "2026-10", hours: 12 }] }, c);
    const p = planApply(a, new Set([cellKey(a.cells[0])]), c);
    expect(p).toMatchObject({ chosen: 1, ownerEdits: [], cellCount: 1, stale: 0, covered: 0, unchanged: 0 });
  });

  it("counts a move whose task changed as stale and does not hand it over", () => {
    const c = ctxOf([maya(), liam(), zoe()], [task()]);
    const a = ground({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }, c);
    const p = planApply(a, all(a), { ...c, tasks: [task({ dueDate: "2026-09-29" })] });
    expect(p).toMatchObject({ ownerEdits: [], stale: 1, covered: 0, unchanged: 0 });
  });

  it("counts a cell whose stored value changed as stale and does not write it", () => {
    const c = ctxOf([maya(), liam(), zoe()], [task()]);
    const a = ground({ cells: [{ resourceId: 3, periodKey: "2026-10", hours: 12 }] }, c);
    const p = planApply(a, all(a), { ...c, resources: [maya(), liam(), zoe({ utilization: { "2026-10": 5 } })] });
    expect(p).toMatchObject({ cells: [], patches: [], cellCount: 0, stale: 1 });
  });

  it("counts a cell the moves planned together write as covered, not stale", () => {
    // Maya→Liam, then Liam→Zoe: planned together, the moves write Zoe's September.
    const c = ctxOf([maya(), liam(), zoe()], [task(), liamsTask()]);
    const a = ground({ taskMoves: [{ taskId: 7, toResourceId: 2 }, { taskId: 14, toResourceId: 3 }], cells: [{ resourceId: 3, periodKey: "2026-09", hours: 4 }] }, c);
    expect(a.cells).toHaveLength(1);
    const p = planApply(a, all(a), c);
    expect(p).toMatchObject({ cells: [], cellCount: 0, stale: 0, covered: 1, unchanged: 0 });
    expect(p.ownerEdits.map((e) => e.taskId)).toEqual([7, 14]);
  });

  it("counts a cell already at its next value as unchanged", () => {
    const c = ctxOf([maya(), liam(), zoe()], [task()]);
    const a = ground({ cells: [{ resourceId: 3, periodKey: "2026-10", hours: 12 }] }, c);
    // The live value is what grounding read (so it is fresh) — but the cell's next value equals it.
    const same = { ...a, cells: [{ ...a.cells[0], nextValue: a.cells[0].currentValue }] };
    const p = planApply(same, all(same), c);
    expect(p).toMatchObject({ cells: [same.cells[0]], patches: [], cellCount: 0, stale: 0, covered: 0, unchanged: 1 });
  });

  it("counts a move whose task already has that owner as unchanged and does not hand it over", () => {
    const c = ctxOf([maya(), liam(), zoe()], [task()]);
    const a = ground({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }, c);
    // The receiver is the task's own owner: the owner edit would change nothing.
    const noop = { ...a, moves: [{ ...a.moves[0], toResourceId: 1 }] };
    const p = planApply(noop, new Set([moveKey({ taskId: 7 })]), c);
    expect(p).toMatchObject({ chosen: 1, ownerEdits: [], stale: 0, covered: 0, unchanged: 1 });
  });
});
