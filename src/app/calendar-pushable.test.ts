import { describe, expect, it } from "vitest";
import { isPushableAbsence, isPushableChange, isPushableRaid, isPushableTask } from "./calendar-pushable";
import { planEntityReconcile } from "./calendar-reconcile";
import type { Absence, ChangeItem, RaidItem, Task } from "./types";

// §486 fix round 1 (I2) — an opted-out item that LEAVES the synced set (task
// done, RAID closed, change undated, absence past) must stay in the push input,
// or the push deletes the event the user chose to keep. Each case runs the
// predicate end-to-end through the planner: the kept event survives, and the
// same item WITHOUT the flag loses it (so the case measures the widening).
const TODAY = "2026-06-10";
const task = (over: Partial<Task> = {}): Task => ({
  id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-07-01", lastUpdateDate: "2026-06-01",
  priority: "Medium", status: "To Do", blockers: "", description: "", ...over,
});
const raid = (over: Partial<RaidItem> = {}): RaidItem => ({
  id: 1, category: "R", title: "R", status: "Open", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [],
  raisedDate: "2026-01-01", targetDate: "2026-07-01", ...over,
});
const change = (over: Partial<ChangeItem> = {}): ChangeItem => ({
  id: 1, title: "C", description: "", type: "Scope", status: "Approved", raisedDate: "2026-01-01",
  decisionDate: "2026-07-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], ...over,
});
const absence = (over: Partial<Absence> = {}): Absence => ({
  id: 1, assignee: "Jane", startDate: "2026-07-01", endDate: "2026-07-05", type: "vacation", ...over,
});

/** The event ids a push would DELETE for `items`, filtered by `pushable`. */
function deletedIds<T extends { id: number; outlookEventId?: string; calendarOptOut?: boolean }>(
  items: T[], pushable: (x: T) => boolean,
): string[] {
  return planEntityReconcile(items.filter(pushable), [{ id: "EVT" }]).delete;
}

const CASES = [
  {
    name: "task marked Done",
    left: task({ status: "Done", completedDate: "2026-06-05", outlookEventId: "EVT" }),
    pushable: isPushableTask,
  },
  {
    name: "RAID item closed",
    left: raid({ status: "Closed", closedDate: "2026-06-05", outlookEventId: "EVT" }),
    pushable: isPushableRaid,
  },
  {
    name: "change without a decision date",
    left: change({ decisionDate: undefined, outlookEventId: "EVT" }),
    pushable: isPushableChange,
  },
  {
    name: "absence in the past",
    left: absence({ startDate: "2026-05-01", endDate: "2026-05-05", outlookEventId: "EVT" }),
    pushable: (a: Absence) => isPushableAbsence(a, TODAY),
  },
] as const;

describe("calendar pushable predicates keep an opted-out item's event (§486)", () => {
  it.each(CASES)("$name: synced → the push deletes its event (control)", ({ left, pushable }) => {
    expect(deletedIds([left] as never[], pushable as never)).toEqual(["EVT"]);
  });

  it.each(CASES)("$name: opted out → the push keeps its event", ({ left, pushable }) => {
    const optedOut = { ...left, calendarOptOut: true };
    expect(deletedIds([optedOut] as never[], pushable as never)).toEqual([]);
    // …and neither creates nor updates it.
    const plan = planEntityReconcile([optedOut].filter(pushable as never), [{ id: "EVT" }]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it.each(CASES)("$name: opted out with no link stays out (nothing to keep)", ({ left, pushable }) => {
    expect((pushable as (x: unknown) => boolean)({ ...left, outlookEventId: undefined, calendarOptOut: true })).toBe(false);
  });

  it("only a literal true keeps it — a truthy non-boolean does not", () => {
    const bogus = { ...CASES[0].left, calendarOptOut: "false" as unknown as boolean };
    expect(isPushableTask(bogus)).toBe(false);
  });

  it("the synced shapes are unchanged", () => {
    expect(isPushableTask(task())).toBe(true);
    expect(isPushableTask(task({ dueDate: "" }))).toBe(false);
    expect(isPushableRaid(raid())).toBe(true);
    expect(isPushableRaid(raid({ targetDate: undefined }))).toBe(false);
    expect(isPushableChange(change())).toBe(true);
    expect(isPushableAbsence(absence(), TODAY)).toBe(true);
    expect(isPushableAbsence(absence({ type: "sick" }), TODAY)).toBe(false);
  });
});
