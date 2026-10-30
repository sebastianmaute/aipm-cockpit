import { describe, expect, it } from "vitest";
import { groundAlternative, moveKey, planTickedMoves, type MoveGroundContext } from "./alloc-ground-moves";
import { type RawAllocAlternative } from "./alloc-alternatives";
import { type Resource, type ResourcePlan, type Task } from "../types";

const plan: ResourcePlan = { startDate: "2026-09-01", endDate: "2026-10-31", granularity: "month", currency: "EUR" };

function resource(id: number, over: Partial<Resource> = {}): Resource {
  return { id, firstName: "F", lastName: `L${id}`, roleId: null, utilizationMode: "hours", utilization: {}, ...over };
}
const maya = () => resource(1, { firstName: "Maya", lastName: "Patel", email: "maya@x.io", utilization: { "2026-09": 120, "2026-10": 80 } });
const liam = (over: Partial<Resource> = {}) => resource(2, { firstName: "Liam", lastName: "Foster", email: "liam@x.io", ...over });

function task(over: Partial<Task> = {}): Task {
  return {
    id: 7, taskName: "Build it", assignee: "Maya Patel", assigneeEmail: "maya@x.io", resourceId: 1,
    status: "In Progress", remainingEstimateMinutes: 16 * 60, startDate: "2026-09-21", dueDate: "2026-09-30",
    ...over,
  } as Task;
}

function ctxOf(resources: Resource[], tasks: Task[]): MoveGroundContext {
  return { resources, tasks, plan, absences: [], workdayHours: 8, holidaySet: new Set<string>(), today: "2026-09-14" };
}
function alt(over: Partial<RawAllocAlternative> = {}): RawAllocAlternative {
  return { summary: "S", taskMoves: [], cells: [], ...over };
}
const reasons = (a: ReturnType<typeof groundAlternative>) => a.skippedMoves.map((s) => s.reason);

describe("groundAlternative: moves", () => {
  it("skips a task that does not exist", () => {
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 99, toResourceId: 2 }] }), ctxOf([maya(), liam()], [task()]));
    expect(reasons(g)).toEqual(["unknown-task"]);
    expect(g.moves).toEqual([]);
  });
  it("skips a Done task", () => {
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), ctxOf([maya(), liam()], [task({ status: "Done" })]));
    expect(reasons(g)).toEqual(["closed"]);
  });
  it("skips a Cancelled task", () => {
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), ctxOf([maya(), liam()], [task({ status: "Cancelled" })]));
    expect(reasons(g)).toEqual(["closed"]);
  });
  it("skips a Jira task", () => {
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), ctxOf([maya(), liam()], [task({ jiraKey: "ABC-1" })]));
    expect(reasons(g)).toEqual(["jira"]);
  });
  it("skips a move to the owner the task already has", () => {
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 1 }] }), ctxOf([maya(), liam()], [task()]));
    expect(reasons(g)).toEqual(["same-owner"]);
  });
  it("skips a target that is not in resources", () => {
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 42 }] }), ctxOf([maya(), liam()], [task()]));
    expect(reasons(g)).toEqual(["unknown-resource"]);
  });
  it("keeps the first move of a task and marks the second duplicate", () => {
    const g = groundAlternative(
      alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }, { taskId: 7, toResourceId: 3 }] }),
      ctxOf([maya(), liam(), resource(3)], [task()]),
    );
    expect(g.moves.map((m) => m.toResourceId)).toEqual([2]);
    expect(g.skippedMoves).toEqual([{ taskId: 7, toResourceId: 3, reason: "duplicate" }]);
  });
  it("the first mention of a task wins, whichever order the checks would fail in", () => {
    const c = ctxOf([maya(), liam()], [task()]);
    const a = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 42 }, { taskId: 7, toResourceId: 2 }] }), c);
    expect(a.skippedMoves).toEqual([
      { taskId: 7, toResourceId: 42, reason: "unknown-resource" },
      { taskId: 7, toResourceId: 2, reason: "duplicate" },
    ]);
    expect(a.moves).toEqual([]);
    const b = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }, { taskId: 7, toResourceId: 42 }] }), c);
    expect(b.moves.map((m) => m.toResourceId)).toEqual([2]);
    expect(b.skippedMoves).toEqual([{ taskId: 7, toResourceId: 42, reason: "duplicate" }]);
  });
  it("a linked move carries its planned hours", () => {
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), ctxOf([maya(), liam()], [task()]));
    expect(g.moves).toHaveLength(1);
    const m = g.moves[0];
    expect(m.key).toBe(moveKey({ taskId: 7 }));
    expect(m.key).toBe("move:7");
    expect(m.linked).toBe(true);
    expect(m.fromResourceId).toBe(1);
    expect(m.fromLabel).toBe("Maya Patel");
    expect(m.toLabel).toBe("Liam Foster");
    expect(m.taskName).toBe("Build it");
    expect(m.plan.moves[0].movedHours).toBe(16);
  });
  it("an unassigned task's move is kept, unlinked, with no hours", () => {
    const t = task({ assignee: "", assigneeEmail: "", resourceId: undefined });
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), ctxOf([maya(), liam()], [t]));
    expect(g.moves).toHaveLength(1);
    expect(g.moves[0].linked).toBe(false);
    expect(g.moves[0].fromResourceId).toBeUndefined();
    expect(g.moves[0].plan.moves[0].movedHours).toBe(0);
  });
  it("no remaining estimate: the move is kept and its plan says why", () => {
    const g = groundAlternative(
      alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }),
      ctxOf([maya(), liam()], [task({ remainingEstimateMinutes: undefined })]),
    );
    expect(g.moves).toHaveLength(1);
    expect(g.moves[0].plan.moves[0].reason).toBe("noEstimate");
  });
  it("percent receiver at 100 %: kept with the receiver-cap periods", () => {
    const full = liam({ utilizationMode: "percent", utilization: { "2026-09": 100 } });
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), ctxOf([maya(), full], [task()]));
    expect(g.moves).toHaveLength(1);
    expect(g.moves[0].plan.moves[0].receiverCapPeriods).toContain("2026-09");
    expect(g.moves[0].snapshot.utilization[2]["2026-09"]).toBe(100);
    expect(g.moves[0].snapshot.utilization[1]["2026-09"]).toBe(120);
  });
  it("a giver shortfall period is in the snapshot with its stored value", () => {
    const thin = resource(1, { firstName: "Maya", lastName: "Patel", utilization: { "2026-10": 80 } });
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), ctxOf([thin, liam()], [task()]));
    expect(g.moves[0].plan.moves[0].shortfallPeriods).toContain("2026-09");
    expect(g.moves[0].snapshot.utilization[1]["2026-09"]).toBe(0);
  });
  it("snapshot holds owner, estimate, dates, status and the touched utilization", () => {
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), ctxOf([maya(), liam({ utilization: { "2026-09": 10 } })], [task()]));
    const s = g.moves[0].snapshot;
    expect(s.owner).toEqual({ assignee: "Maya Patel", assigneeEmail: "maya@x.io", resourceId: 1 });
    expect(s.remainingEstimateMinutes).toBe(960);
    expect(s.startDate).toBe("2026-09-21");
    expect(s.dueDate).toBe("2026-09-30");
    expect(s.status).toBe("In Progress");
    expect(s.utilization[1]["2026-09"]).toBe(120);
    expect(s.utilization[2]["2026-09"]).toBe(10);
  });
});

describe("groundAlternative: cells", () => {
  const cell = (resourceId: number, periodKey: string, hours: number) => ({ resourceId, periodKey, hours });
  const moved = () => alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] });

  it("a cell on a period a linked move touches is skipped as covered-by-move (giver and receiver)", () => {
    const raw = { ...moved(), cells: [cell(1, "2026-09", 100), cell(2, "2026-09", 30), cell(1, "2026-10", 50)] };
    const g = groundAlternative(raw, ctxOf([maya(), liam()], [task()]));
    const covered = g.skipped.filter((s) => s.reason === "covered-by-move").map((s) => `${s.resourceId}:${s.periodKey}`);
    expect(covered.sort()).toEqual(["1:2026-09", "2:2026-09"]);
    expect(g.cells.map((c) => `${c.resourceId}:${c.periodKey}`)).toEqual(["1:2026-10"]);
  });
  it("a cell for the receiver of an UNLINKED move is kept", () => {
    const t = task({ assignee: "", assigneeEmail: "", resourceId: undefined });
    const raw = { ...moved(), cells: [cell(2, "2026-09", 30)] };
    const g = groundAlternative(raw, ctxOf([maya(), liam()], [t]));
    expect(g.cells).toHaveLength(1);
    expect(g.skipped).toEqual([]);
  });
  it("grounding the same raw answer again gives the same result", () => {
    const raw = { ...moved(), cells: [cell(1, "2026-09", 100), cell(2, "2026-10", 5)] };
    const c = ctxOf([maya(), liam()], [task()]);
    const a = groundAlternative(raw, c);
    const b = groundAlternative(raw, c);
    expect(b).toEqual(a);
    expect(b.skipped.map((s) => s.reason)).toContain("covered-by-move");
  });
  it("carries summary and rationale; an empty alternative stays empty", () => {
    const g = groundAlternative(alt({ summary: "Sum", rationale: "Why" }), ctxOf([maya(), liam()], [task()]));
    expect(g).toMatchObject({ summary: "Sum", rationale: "Why", moves: [], skippedMoves: [], cells: [], skipped: [], truncated: false });
  });
});

// Final review, Important 1 — Maya→Liam then Liam→Zoe. Liam holds no September hours, so the second move planned
// alone moves nothing and covers no Zoe cell; planned with the first, it carries Maya's 16 h on to Zoe.
describe("planTickedMoves", () => {
  const zoe = () => resource(3, { firstName: "Zoe", lastName: "Kim" });
  const liamsTask = () => task({ id: 14, taskName: "Liam's", assignee: "Liam Foster", assigneeEmail: "liam@x.io", resourceId: 2 });
  const chained = () => {
    const c = ctxOf([maya(), liam(), zoe()], [task(), liamsTask()]);
    return { c, g: groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }, { taskId: 14, toResourceId: 3 }] }), c) };
  };

  it("plans the ticked linked moves together and names every cell that plan changes", () => {
    const { c, g } = chained();
    expect(g.moves.find((m) => m.taskId === 14)?.plan.moves[0].movedHours).toBe(0);
    const p = planTickedMoves(g.moves, new Set(g.moves.map((m) => m.key)), c);
    expect(p.plan.moves.map((m) => [m.taskId, m.movedHours])).toEqual([[7, 16], [14, 16]]);
    // Liam receives and gives the same 16 h: his stored September does not change, so it is not covered.
    expect([...p.changedCells].sort()).toEqual(["1:2026-09", "3:2026-09"]);
  });

  it("leaves an unticked move out", () => {
    const { c, g } = chained();
    const p = planTickedMoves(g.moves, new Set([moveKey({ taskId: 14 })]), c);
    expect(p.plan.moves.map((m) => [m.taskId, m.movedHours])).toEqual([[14, 0]]);
    expect([...p.changedCells]).toEqual([]);
  });

  it("an unlinked move plans no hours", () => {
    const t = task({ assignee: "", assigneeEmail: "", resourceId: undefined });
    const c = ctxOf([maya(), liam()], [t]);
    const g = groundAlternative(alt({ taskMoves: [{ taskId: 7, toResourceId: 2 }] }), c);
    const p = planTickedMoves(g.moves, new Set(g.moves.map((m) => m.key)), c);
    expect(p.plan.moves).toEqual([]);
    expect(p.changedCells.size).toBe(0);
  });
});
