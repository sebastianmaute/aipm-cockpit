// Pins the Resources workload triage handlers that §491 step 16 moved out of
// task-manager.tsx. Each setter is a tiny state cell, so an updater runs
// against a real previous value and the test reads the result, not the call.
// The arming rule's wiring through the real TaskManager stays pinned by
// `task-manager.clear-unlinked-arming.test.tsx`; this file pins the rule itself.
import type { Dispatch, SetStateAction } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectedNotice, LIAM, LIAM_OWNS, RIG_TASK, rigSpies, useReassignRig, utilOf } from "../test/reassign-hours-rig";
import type { Absence, RaidItem, Resource, Shift, Task } from "./types";
import { buildWorkloadTriageHandlers, workloadPaneProps, type UnlinkedWorkloadRow } from "./workload-triage-handlers";
import { makeEditGuard } from "./read-only-guard";

function cell<T>(initial: readonly T[]) {
  let value = initial;
  const set: Dispatch<SetStateAction<readonly T[]>> = (u) => {
    value = typeof u === "function" ? u(value) : u;
  };
  return { set, get: () => value };
}

const task = (id: number, assignee: string, assigneeEmail = ""): Task =>
  ({ id, taskName: `T${id}`, assignee, assigneeEmail, dueDate: "2026-03-01" }) as Task;
const raidItem = (id: number, owner: string): RaidItem => ({ id, title: `R${id}`, owner }) as RaidItem;
const absence = (id: number, assignee: string): Absence => ({
  id, assignee, startDate: "2026-03-02", endDate: "2026-03-06", type: "vacation",
});
const shift = (id: number, assignee: string): Shift => ({ id, assignee, hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] });
const row = (display: string, email = ""): UnlinkedWorkloadRow => ({ display, email, firstName: "", lastName: "" });

function setup(seed: { tasks?: Task[]; raid?: RaidItem[]; absences?: Absence[]; shifts?: Shift[] } = {}) {
  const tasks = cell(seed.tasks ?? []);
  const raid = cell(seed.raid ?? []);
  const absences = cell(seed.absences ?? []);
  const shifts = cell(seed.shifts ?? []);
  const arm = vi.fn();
  const reassignTasks = vi.fn();
  const handlers = buildWorkloadTriageHandlers({
    absences: absences.get(),
    shifts: shifts.get(),
    setTasks: tasks.set,
    setRaid: raid.set,
    setAbsences: absences.set,
    setShifts: shifts.set,
    allowDestructiveSave: arm,
    reassignTasks,
  });
  return { handlers, tasks, raid, absences, shifts, arm, reassignTasks };
}

describe("onReassignTask", () => {
  // §774 — the owner write goes through the shared reassign step, which writes
  // the owner fields itself; the handler only names the new owner.
  it("hands the resource's name, email and id for that task to the reassign step", () => {
    const { handlers, tasks, reassignTasks } = setup({ tasks: [task(1, "Old"), task(2, "Other")] });
    handlers.onReassignTask(1, { id: 7, firstName: "Ada", lastName: "Lovelace", email: "ada@x.com" } as Resource);
    expect(reassignTasks).toHaveBeenCalledTimes(1);
    expect(reassignTasks).toHaveBeenCalledWith([{ taskId: 1, assignee: "Ada Lovelace", assigneeEmail: "ada@x.com", resourceId: 7 }], "user");
    expect(tasks.get().map((t) => t.assignee)).toEqual(["Old", "Other"]); // no second, direct write
  });

  it("unassigns on a null resource, blanking the email and the link", () => {
    const { handlers, reassignTasks } = setup({ tasks: [{ ...task(1, "Old", "old@x.com"), resourceId: 3 }] });
    handlers.onReassignTask(1, null);
    expect(reassignTasks).toHaveBeenCalledWith([{ taskId: 1, assignee: "", assigneeEmail: "", resourceId: undefined }], "user");
  });

  it("triage reassign moves the hours", () => {
    const spies = rigSpies();
    const { result } = renderHook(() => {
      const rig = useReassignRig(spies);
      const noop = () => {};
      const handlers = buildWorkloadTriageHandlers({
        absences: [], shifts: [], setTasks: rig.setTasks, setRaid: noop, setAbsences: noop, setShifts: noop,
        allowDestructiveSave: undefined, reassignTasks: rig.reassignHours.reassignTasks,
      });
      return { rig, handlers };
    });
    act(() => { result.current.handlers.onReassignTask(10, LIAM); });
    const { rig } = result.current;
    expect(rig.tasks[0]).toMatchObject(LIAM_OWNS);
    expect(utilOf(rig.resources, 2)).toEqual({ "2026-09": 8, "2026-10": 8 });
    expect(utilOf(rig.resources, 1)).toEqual({ "2026-09": 32, "2026-10": 32, "2026-11": 20 });
    expect(rig.undo.stack).toHaveLength(1);
    const notice = expectedNotice({ task: { ...RIG_TASK, ...LIAM_OWNS }, fromResourceId: 1, toResourceId: 2 });
    expect(notice).toContain("16");
    expect(spies.showToastAction).toHaveBeenLastCalledWith("info", notice, expect.anything());
  });
});

describe("onRescheduleTask", () => {
  it("moves only that task's due date", () => {
    const { handlers, tasks } = setup({ tasks: [task(1, "A"), task(2, "B")] });
    handlers.onRescheduleTask(2, "2026-04-15");
    expect(tasks.get().map((t) => t.dueDate)).toEqual(["2026-03-01", "2026-04-15"]);
  });
});

describe("onClearUnlinked", () => {
  it("blanks matching task assignees and RAID owners, trimmed and case-insensitive, and keeps the records", () => {
    const { handlers, tasks, raid } = setup({
      tasks: [task(1, "  bob LEE "), task(2, "Alice")],
      raid: [raidItem(1, "Bob Lee"), raidItem(2, "Alice")],
    });
    handlers.onClearUnlinked(row("Bob Lee"));
    expect(tasks.get().map((t) => [t.id, t.assignee])).toEqual([[1, ""], [2, "Alice"]]);
    expect(raid.get().map((r) => [r.id, r.owner])).toEqual([[1, ""], [2, "Alice"]]);
  });

  it("also blanks a task matched by email alone, and blanks its email", () => {
    const { handlers, tasks } = setup({ tasks: [task(1, "Someone Else", "BOB@x.com"), task(2, "Alice", "a@x.com")] });
    handlers.onClearUnlinked(row("Bob Lee", " bob@x.com "));
    expect(tasks.get()[0]).toMatchObject({ assignee: "", assigneeEmail: "" });
    expect(tasks.get()[1]).toMatchObject({ assignee: "Alice", assigneeEmail: "a@x.com" });
  });

  it("removes matching absences and shifts outright", () => {
    const { handlers, absences, shifts } = setup({
      absences: [absence(1, "Bob Lee"), absence(2, "Alice")],
      shifts: [shift(1, "bob lee"), shift(2, "Alice")],
    });
    handlers.onClearUnlinked(row("Bob Lee"));
    expect(absences.get().map((a) => a.id)).toEqual([2]);
    expect(shifts.get().map((s) => s.id)).toEqual([2]);
  });

  // ★ A whitespace-only owner trims to "", the same as a blank row. Only the
  // blank-name/email guards keep the two from matching (an empty owner fails
  // `!!s` with or without them, so it alone would leave the guards unpinned).
  it("matches nothing on a blank name or email, so blank and whitespace-only owners stay untouched", () => {
    const { handlers, tasks, absences, arm } = setup({
      tasks: [task(1, "", ""), task(2, "   ", "  ")],
      absences: [absence(1, "Alice"), absence(2, "   ")],
    });
    handlers.onClearUnlinked(row("   ", "  "));
    expect(tasks.get()[1]).toMatchObject({ assignee: "   ", assigneeEmail: "  " });
    expect(absences.get()).toHaveLength(2);
    expect(arm).not.toHaveBeenCalled();
  });

  it("arms the destructive-save bypass once when it removes an absence", () => {
    const { handlers, arm } = setup({ absences: [absence(1, "Ghost")] });
    handlers.onClearUnlinked(row("Ghost"));
    expect(arm).toHaveBeenCalledTimes(1);
  });

  it("arms once when it removes only a shift", () => {
    const { handlers, arm } = setup({ absences: [absence(1, "Alice")], shifts: [shift(1, "Ghost")] });
    handlers.onClearUnlinked(row("Ghost"));
    expect(arm).toHaveBeenCalledTimes(1);
  });

  it("does NOT arm when it only edits tasks and RAID, since a field edit removes no record", () => {
    const { handlers, tasks, arm } = setup({
      tasks: [task(1, "Ghost")],
      raid: [raidItem(1, "Ghost")],
      absences: [absence(1, "Alice")],
      shifts: [shift(1, "Alice")],
    });
    handlers.onClearUnlinked(row("Ghost"));
    expect(tasks.get()[0]!.assignee).toBe("");
    expect(arm).not.toHaveBeenCalled();
  });

  it("does not throw when no arming function is wired", () => {
    const absences = cell([absence(1, "Ghost")]);
    const noop = cell<Task>([]);
    const { onClearUnlinked } = buildWorkloadTriageHandlers({
      absences: absences.get(), shifts: [],
      setTasks: noop.set, setRaid: cell<RaidItem>([]).set, setAbsences: absences.set, setShifts: cell<Shift>([]).set,
      allowDestructiveSave: undefined, reassignTasks: vi.fn(),
    });
    expect(() => onClearUnlinked(row("Ghost"))).not.toThrow();
    expect(absences.get()).toEqual([]);
  });
});

// Final review, Minor 6 — the Resources pane's workload props, as task-manager spreads them. Mutation: pass a triage
// handler through unguarded and a popout writes; drop the reassign step or the undo stack and §769 loses its one entry.
describe("workloadPaneProps", () => {
  const triage = () => ({ onReassignTask: vi.fn(), onRescheduleTask: vi.fn(), onClearUnlinked: vi.fn() });
  const reassignTasks = vi.fn();
  const isLoadHeld = vi.fn(() => false);
  const captureComposite = vi.fn();

  it("guards every triage handler: read-only, each one notifies and writes nothing", () => {
    const t = triage();
    const notify = vi.fn();
    const props = workloadPaneProps(t, makeEditGuard(true, notify), { reassignTasks, isLoadHeld } as never, captureComposite as never);
    props.onReassignTask(1, null);
    props.onRescheduleTask(1, "2026-09-01");
    props.onClearUnlinked({ display: "Ghost", email: "" } as UnlinkedWorkloadRow);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(t.onReassignTask).not.toHaveBeenCalled();
    expect(t.onRescheduleTask).not.toHaveBeenCalled();
    expect(t.onClearUnlinked).not.toHaveBeenCalled();
  });

  it("editable, each handler runs; the reassign step and the undo stack pass through as they are", () => {
    const t = triage();
    const props = workloadPaneProps(t, makeEditGuard(false, vi.fn()), { reassignTasks, isLoadHeld } as never, captureComposite as never);
    props.onReassignTask(1, null);
    props.onRescheduleTask(2, "2026-09-01");
    expect(t.onReassignTask).toHaveBeenCalledWith(1, null);
    expect(t.onRescheduleTask).toHaveBeenCalledWith(2, "2026-09-01");
    expect(props.onReassignTasks).toBe(reassignTasks);
    expect(props.onIsLoadHeld).toBe(isLoadHeld);
    expect(props.onCaptureComposite).toBe(captureComposite);
  });
});
