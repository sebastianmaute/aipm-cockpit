import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useReassignHours, type ReassignHoursDeps } from "./use-reassign-hours";
import { captureFieldPart, useUndoStack } from "./undo/use-undo-stack";
import { planHoursMoves, type OwnerChange } from "./reassign-hours";
import { defaultPeriodLabel, hoursMoveNotice } from "./reassign-hours-notice";
import type { Resource, ResourcePlan, Task } from "./types";

// Sep 1 – Dec 31, monthly. The task spans Sep 1 – Oct 30: 22 workdays in each
// month, so its 16 h split 8 h / 8 h and NOVEMBER IS NEVER TOUCHED — the period
// the "later edit" test edits by hand.
const PLAN: ResourcePlan = { startDate: "2026-09-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const TODAY = "2026-09-01";
const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

const MAYA: Resource = {
  id: 1, firstName: "Maya", lastName: "Patel", roleId: null, utilizationMode: "hours",
  utilization: { "2026-09": 40, "2026-10": 40, "2026-11": 20 },
};
const LIAM: Resource = { id: 2, firstName: "Liam", lastName: "Foster", roleId: null, utilizationMode: "hours", utilization: {} };
const ZOE: Resource = { id: 3, firstName: "Zoe", lastName: "Kim", roleId: null, utilizationMode: "hours", utilization: {} };

const TASK: Task = {
  id: 10, taskName: "Design review", assignee: "Maya Patel", assigneeEmail: "maya@x.com", resourceId: 1,
  startDate: "2026-09-01", dueDate: "2026-10-30", remainingEstimateMinutes: 16 * 60,
  lastUpdateDate: "2026-09-01", priority: "Medium", status: "To Do",
} as Task;
const NO_ESTIMATE: Task = { ...TASK, id: 11, taskName: "No estimate", remainingEstimateMinutes: undefined } as Task;

// 8 h over the same span → 4 h in Sep, 4 h in Oct.
const SMALL: Task = { ...TASK, id: 12, taskName: "Small", remainingEstimateMinutes: 8 * 60 } as Task;

const TO_LIAM = { taskId: 10, assignee: "Liam Foster", assigneeEmail: "liam@x.com", resourceId: 2 };
const SMALL_TO_ZOE = { taskId: 12, assignee: "Zoe Kim", assigneeEmail: "zoe@x.com", resourceId: 3 };

interface Opts { isPopout?: boolean; loadPending?: boolean; withUndo?: boolean; tasks?: readonly Task[] }

function setup(opts: Opts = {}) {
  const logActivityAs = vi.fn();
  const showToast = vi.fn();
  const showToastAction = vi.fn();
  const captureSpy = vi.fn();
  const hook = renderHook(
    ({ isPopout, loadPending }: { isPopout: boolean; loadPending: boolean }) => {
      const [tasks, setTasks] = useState<readonly Task[]>(opts.tasks ?? [TASK]);
      const [resources, setResources] = useState<readonly Resource[]>([MAYA, LIAM, ZOE]);
      const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction });
      const deps: ReassignHoursDeps = {
        lang: "en-US", today: TODAY, isPopout, loadPending,
        tasks, setTasks, resources, setResources,
        plan: PLAN, absences: [], workdayHours: 8, holidaySet: NO_HOLIDAYS,
        captureComposite: opts.withUndo === false ? undefined : isPopout ? captureSpy : undo.captureComposite,
        logActivityAs, showToast,
      };
      return { reassign: useReassignHours(deps), undo, tasks, setTasks, resources, setResources };
    },
    { initialProps: { isPopout: opts.isPopout ?? false, loadPending: opts.loadPending ?? false } },
  );
  return { hook, logActivityAs, showToast, showToastAction, captureSpy };
}

const util = (rs: readonly Resource[], id: number) => rs.find((r) => r.id === id)?.utilization;
const owner = (ts: readonly Task[], id = 10) => {
  const t = ts.find((x) => x.id === id);
  return t && { assignee: t.assignee, assigneeEmail: t.assigneeEmail, resourceId: t.resourceId };
};
const MAYA_OWNS = { assignee: "Maya Patel", assigneeEmail: "maya@x.com", resourceId: 1 };
const LIAM_OWNS = { assignee: "Liam Foster", assigneeEmail: "liam@x.com", resourceId: 2 };
const MOVED_MAYA = { "2026-09": 32, "2026-10": 32, "2026-11": 20 };
const MOVED_LIAM = { "2026-09": 8, "2026-10": 8 };

/** The notice the hook must show, built from the planner and formatter of Tasks 1–2 on the same inputs. */
function expectedNotice(): string | null {
  const change: OwnerChange = { task: { ...TASK, ...LIAM_OWNS } as Task, fromResourceId: 1, toResourceId: 2 };
  const plan = planHoursMoves([change], [MAYA, LIAM], { plan: PLAN, absences: [], workdayHours: 8, holidaySet: NO_HOLIDAYS, today: TODAY });
  return hoursMoveNotice(plan, {
    lang: "en-US",
    resourceName: (id) => (id === 1 ? "Maya Patel" : "Liam Foster"),
    periodLabel: (key) => defaultPeriodLabel(key, "en-US"),
    taskName: () => "Design review",
  });
}

describe("useReassignHours.reassignTasks", () => {
  it("reassignTasks writes owner and hours and records one undo entry", () => {
    const { hook, showToastAction } = setup();
    act(() => { hook.result.current.reassign.reassignTasks([TO_LIAM], "user"); });
    const r = hook.result.current;
    expect(owner(r.tasks)).toEqual(LIAM_OWNS);
    expect(util(r.resources, 1)).toEqual(MOVED_MAYA);
    expect(util(r.resources, 2)).toEqual(MOVED_LIAM);
    expect(r.undo.stack).toHaveLength(1);
    expect(r.undo.stack[0].label).toContain("Design review");
    const notice = expectedNotice();
    expect(notice).toContain("16");
    expect(showToastAction).toHaveBeenCalledTimes(1);
    expect(showToastAction).toHaveBeenLastCalledWith("info", notice, expect.anything());
  });

  it("undo restores owner and hours together", () => {
    const { hook } = setup();
    act(() => { hook.result.current.reassign.reassignTasks([TO_LIAM], "user"); });
    act(() => { hook.result.current.undo.undo(); });
    const r = hook.result.current;
    expect(owner(r.tasks)).toEqual(MAYA_OWNS);
    expect(util(r.resources, 1)).toEqual(MAYA.utilization);
    expect(util(r.resources, 2)).toEqual({});
    expect(r.undo.stack).toHaveLength(0);
  });

  it("redo re-applies owner and hours together", () => {
    const { hook } = setup();
    act(() => { hook.result.current.reassign.reassignTasks([TO_LIAM], "user"); });
    act(() => { hook.result.current.undo.undo(); });
    act(() => { hook.result.current.undo.redo(); });
    const r = hook.result.current;
    expect(owner(r.tasks)).toEqual(LIAM_OWNS);
    expect(util(r.resources, 1)).toEqual(MOVED_MAYA);
    expect(util(r.resources, 2)).toEqual(MOVED_LIAM);
  });

  it("undo keeps a later edit to another period", () => {
    const { hook } = setup();
    act(() => { hook.result.current.reassign.reassignTasks([TO_LIAM], "user"); });
    act(() => {
      hook.result.current.setResources((prev) => prev.map((r) => (r.id === 1 ? { ...r, utilization: { ...r.utilization, "2026-11": 5 } } : r)));
    });
    act(() => { hook.result.current.undo.undo(); });
    const maya = util(hook.result.current.resources, 1);
    expect(maya?.["2026-11"]).toBe(5);
    expect(maya?.["2026-09"]).toBe(40);
    expect(maya?.["2026-10"]).toBe(40);
  });

  it("logs one resource.hoursMoved entry per action", () => {
    const { hook, logActivityAs } = setup();
    act(() => { hook.result.current.reassign.reassignTasks([TO_LIAM], "user"); });
    const moved = logActivityAs.mock.calls.filter((c) => c[1] === "resource.hoursMoved");
    expect(moved).toHaveLength(1);
    expect(moved[0][0]).toBe("user");
    expect(String(moved[0][2])).toContain("Maya Patel");
    expect(String(moved[0][2])).toContain("Liam Foster");
  });

  it("logs no resource.hoursMoved entry when no hours moved", () => {
    const { hook, logActivityAs } = setup({ tasks: [NO_ESTIMATE] });
    act(() => { hook.result.current.reassign.reassignTasks([{ ...TO_LIAM, taskId: 11 }], "user"); });
    expect(owner(hook.result.current.tasks, 11)).toEqual(LIAM_OWNS);
    expect(logActivityAs.mock.calls.filter((c) => c[1] === "resource.hoursMoved")).toHaveLength(0);
  });

  it("a popout moves the hours and shows the notice without an undo entry", () => {
    const { hook, showToast, captureSpy } = setup({ isPopout: true });
    act(() => { hook.result.current.reassign.reassignTasks([TO_LIAM], "user"); });
    const r = hook.result.current;
    expect(owner(r.tasks)).toEqual(LIAM_OWNS);
    expect(util(r.resources, 1)).toEqual(MOVED_MAYA);
    expect(util(r.resources, 2)).toEqual(MOVED_LIAM);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("info", expectedNotice());
  });

  it("with no undo available it still writes and shows the notice", () => {
    const { hook, showToast } = setup({ withUndo: false });
    act(() => { hook.result.current.reassign.reassignTasks([TO_LIAM], "user"); });
    expect(util(hook.result.current.resources, 2)).toEqual(MOVED_LIAM);
    expect(showToast).toHaveBeenCalledWith("info", expectedNotice());
  });

  it("does nothing while loadPending", () => {
    const { hook, logActivityAs, showToast, showToastAction } = setup({ loadPending: true });
    act(() => { hook.result.current.reassign.reassignTasks([TO_LIAM], "user"); });
    const r = hook.result.current;
    expect(owner(r.tasks)).toEqual(MAYA_OWNS);
    expect(util(r.resources, 1)).toEqual(MAYA.utilization);
    expect(r.undo.stack).toHaveLength(0);
    expect(logActivityAs).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(showToastAction).not.toHaveBeenCalled();
    const step = r.reassign.prepare([{ task: { ...TASK, ...LIAM_OWNS } as Task, fromResourceId: 1, toResourceId: 2 }]);
    expect(step.resourcesPart).toBeNull();
    expect(step.notice).toBeNull();
  });
});

describe("useReassignHours.prepare", () => {
  it("returns a live step for a real reassignment, and commit writes the hours and logs once", () => {
    const { hook, logActivityAs } = setup();
    const step = hook.result.current.reassign.prepare([{ task: { ...TASK, ...LIAM_OWNS } as Task, fromResourceId: 1, toResourceId: 2 }]);
    expect(step.resourcesPart).not.toBeNull();
    expect(step.notice).toBe(expectedNotice());
    expect(util(hook.result.current.resources, 2)).toEqual({}); // nothing written before commit
    act(() => { step.commit("ai"); });
    expect(util(hook.result.current.resources, 1)).toEqual(MOVED_MAYA);
    expect(util(hook.result.current.resources, 2)).toEqual(MOVED_LIAM);
    expect(logActivityAs.mock.calls.filter((c) => c[1] === "resource.hoursMoved")).toHaveLength(1);
    expect(logActivityAs).toHaveBeenLastCalledWith("ai", "resource.hoursMoved", expect.any(String));
  });

  it("prepare returns an inert step when nothing moves silently", () => {
    const { hook, logActivityAs } = setup();
    const unchanged = hook.result.current.reassign.prepare([{ task: TASK, fromResourceId: 1, toResourceId: 1 }]);
    const cleared = hook.result.current.reassign.prepare([
      { task: { ...TASK, assignee: "", assigneeEmail: "", resourceId: undefined } as Task, fromResourceId: 1, toResourceId: undefined },
    ]);
    for (const step of [unchanged, cleared]) {
      expect(step.resourcesPart).toBeNull();
      expect(step.notice).toBeNull();
      expect(step.plan.moves).toEqual([]);
      act(() => { step.commit("user"); });
    }
    expect(util(hook.result.current.resources, 1)).toEqual(MAYA.utilization);
    expect(logActivityAs).not.toHaveBeenCalled();
  });
});

// §774 Task 4 — `record`: the prepare paths' one-entry capture.
describe("useReassignHours.record", () => {
  const MOVE = { task: { ...TASK, ...LIAM_OWNS } as Task, fromResourceId: 1, toResourceId: 2 };
  const fieldPart = (setTasks: Parameters<typeof captureFieldPart<Task>>[0]["setter"]) =>
    captureFieldPart<Task>({ setter: setTasks, edits: [{ id: 10, before: MAYA_OWNS, after: LIAM_OWNS }], stampField: "localModifiedAt" });

  it("records nothing and returns false when the step neither moved hours nor has a notice", () => {
    const { hook, showToast, showToastAction } = setup();
    const step = hook.result.current.reassign.prepare([{ task: TASK, fromResourceId: 1, toResourceId: 1 }]);
    let recorded = true;
    act(() => { recorded = hook.result.current.reassign.record(step, { kind: "task.updated", primaryCount: 1, taskPart: null }); });
    expect(recorded).toBe(false);
    expect(hook.result.current.undo.stack).toHaveLength(0);
    expect(showToast).not.toHaveBeenCalled();
    expect(showToastAction).not.toHaveBeenCalled();
  });

  it("records the task part and the hours as ONE entry whose toast is the notice", () => {
    const { hook, showToastAction } = setup();
    const step = hook.result.current.reassign.prepare([MOVE]);
    act(() => {
      hook.result.current.setTasks((prev) => prev.map((x) => (x.id === 10 ? { ...x, ...LIAM_OWNS } : x)));
      step.commit("user");
      expect(hook.result.current.reassign.record(step, { kind: "task.updated", primaryCount: 1, name: "Design review", taskPart: fieldPart(hook.result.current.setTasks) })).toBe(true);
    });
    expect(hook.result.current.undo.stack).toHaveLength(1);
    expect(showToastAction).toHaveBeenLastCalledWith("info", expectedNotice(), expect.anything());
    act(() => { hook.result.current.undo.undo(); });
    expect(owner(hook.result.current.tasks)).toEqual(MAYA_OWNS);
    expect(util(hook.result.current.resources, 2)).toEqual({});
  });

  it("in a popout shows the notice alone and captures nothing", () => {
    const { hook, showToast, captureSpy } = setup({ isPopout: true });
    const step = hook.result.current.reassign.prepare([MOVE]);
    let recorded = false;
    act(() => { recorded = hook.result.current.reassign.record(step, { kind: "task.updated", primaryCount: 1, taskPart: null }); });
    expect(recorded).toBe(true);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("info", expectedNotice());
  });
});

// R10 — two moves in ONE tick: the second must plan from the first one's result.
// Maya gives 8 h of Sep (and Oct) to Liam, then 4 h to Zoe: she ends at 40 - 8 - 4.
describe("useReassignHours: two moves in one tick", () => {
  const CONSERVED = (rs: readonly Resource[]) => {
    expect(util(rs, 1)).toEqual({ "2026-09": 28, "2026-10": 28, "2026-11": 20 });
    expect(util(rs, 2)).toEqual({ "2026-09": 8, "2026-10": 8 });
    expect(util(rs, 3)).toEqual({ "2026-09": 4, "2026-10": 4 });
  };

  it("two reassignTasks calls conserve hours: same giver, two receivers", () => {
    const { hook } = setup({ tasks: [TASK, SMALL] });
    act(() => {
      hook.result.current.reassign.reassignTasks([TO_LIAM], "user");
      hook.result.current.reassign.reassignTasks([SMALL_TO_ZOE], "user");
    });
    CONSERVED(hook.result.current.resources);
    expect(hook.result.current.undo.stack).toHaveLength(2);
  });

  it("two prepare().commit() calls conserve hours: same giver, two receivers", () => {
    const { hook } = setup({ tasks: [TASK, SMALL] });
    act(() => {
      const { prepare } = hook.result.current.reassign;
      prepare([{ task: { ...TASK, ...LIAM_OWNS } as Task, fromResourceId: 1, toResourceId: 2 }]).commit("user");
      prepare([{ task: { ...SMALL, assignee: "Zoe Kim", resourceId: 3 } as Task, fromResourceId: 1, toResourceId: 3 }]).commit("user");
    });
    CONSERVED(hook.result.current.resources);
  });

  it("undo of the second call restores only its own move", () => {
    const { hook } = setup({ tasks: [TASK, SMALL] });
    act(() => {
      hook.result.current.reassign.reassignTasks([TO_LIAM], "user");
      hook.result.current.reassign.reassignTasks([SMALL_TO_ZOE], "user");
    });
    act(() => { hook.result.current.undo.undo(); });
    const r = hook.result.current;
    expect(util(r.resources, 1)).toEqual(MOVED_MAYA);
    expect(util(r.resources, 2)).toEqual(MOVED_LIAM);
    expect(util(r.resources, 3)).toEqual({});
    expect(owner(r.tasks, 10)).toEqual(LIAM_OWNS);
    expect(owner(r.tasks, 12)).toEqual(MAYA_OWNS);
  });

  it("keeps a same-key write that landed earlier in the same tick (delta, not absolute)", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.setResources((prev) => prev.map((r) => (r.id === 1 ? { ...r, utilization: { ...r.utilization, "2026-09": 50 } } : r)));
      hook.result.current.reassign.reassignTasks([TO_LIAM], "user");
    });
    expect(util(hook.result.current.resources, 1)).toEqual({ "2026-09": 42, "2026-10": 32, "2026-11": 20 });
    expect(util(hook.result.current.resources, 2)).toEqual(MOVED_LIAM);
    // ★ KNOWN LIMIT (ruling R11), pinned, not a goal: undo is absolute per key, so the
    // same-cell external +10 that landed before the move in the same tick is lost on undo
    // (Sep back to the 40 the hook saw) and redo writes the planned 32, not 42.
    act(() => { hook.result.current.undo.undo(); });
    expect(util(hook.result.current.resources, 1)?.["2026-09"]).toBe(40);
    act(() => { hook.result.current.undo.redo(); });
    expect(util(hook.result.current.resources, 1)?.["2026-09"]).toBe(32);
  });

  it("a second reassignTasks in the same tick reads the owner the first one wrote", () => {
    const { hook } = setup({ tasks: [TASK] });
    act(() => {
      hook.result.current.reassign.reassignTasks([TO_LIAM], "user");
      hook.result.current.reassign.reassignTasks([{ taskId: 10, assignee: "Zoe Kim", assigneeEmail: "zoe@x.com", resourceId: 3 }], "user");
    });
    const r = hook.result.current;
    // The second move is Liam → Zoe, so Liam ends empty again and Maya keeps her 8 h-per-month loss.
    expect(util(r.resources, 1)).toEqual(MOVED_MAYA);
    expect(util(r.resources, 2)).toEqual({ "2026-09": 0, "2026-10": 0 });
    expect(util(r.resources, 3)).toEqual(MOVED_LIAM);
  });
});
