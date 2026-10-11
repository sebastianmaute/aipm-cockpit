// Pins the Resources workload triage handlers that §491 step 16 moved out of
// task-manager.tsx. Each setter is a tiny state cell, so an updater runs
// against a real previous value and the test reads the result, not the call.
// The arming rule's wiring through the real TaskManager stays pinned by
// `task-manager.clear-unlinked-arming.test.tsx`; this file pins the rule itself.
import type { Dispatch, SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Absence, RaidItem, Resource, Shift, Task } from "./types";
import { buildWorkloadTriageHandlers, type UnlinkedWorkloadRow } from "./workload-triage-handlers";

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
  const handlers = buildWorkloadTriageHandlers({
    absences: absences.get(),
    shifts: shifts.get(),
    setTasks: tasks.set,
    setRaid: raid.set,
    setAbsences: absences.set,
    setShifts: shifts.set,
    allowDestructiveSave: arm,
  });
  return { handlers, tasks, raid, absences, shifts, arm };
}

describe("onReassignTask", () => {
  it("copies the resource's name, email and id onto that task only", () => {
    const { handlers, tasks } = setup({ tasks: [task(1, "Old"), task(2, "Other")] });
    handlers.onReassignTask(1, { id: 7, firstName: "Ada", lastName: "Lovelace", email: "ada@x.com" } as Resource);
    expect(tasks.get()[0]).toMatchObject({ assignee: "Ada Lovelace", assigneeEmail: "ada@x.com", resourceId: 7 });
    expect(tasks.get()[1]).toMatchObject({ assignee: "Other" });
  });

  it("unassigns on a null resource, blanking the email and the link", () => {
    const { handlers, tasks } = setup({ tasks: [{ ...task(1, "Old", "old@x.com"), resourceId: 3 }] });
    handlers.onReassignTask(1, null);
    expect(tasks.get()[0]).toMatchObject({ assignee: "", assigneeEmail: "", resourceId: undefined });
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
      allowDestructiveSave: undefined,
    });
    expect(() => onClearUnlinked(row("Ghost"))).not.toThrow();
    expect(absences.get()).toEqual([]);
  });
});
