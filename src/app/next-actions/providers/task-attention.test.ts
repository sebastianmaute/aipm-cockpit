import { describe, expect, it } from "vitest";
import { taskAttentionProvider } from "./task-attention";
import type { ActionInput } from "../types";
import type { Task } from "../../types";

function mkTask(over: Partial<Task>): Task {
  return {
    id: 1, taskName: "T", assignee: "Alice", assigneeEmail: "a@x.io",
    dueDate: "2026-07-01", lastUpdateDate: "2026-06-28", priority: "Medium",
    status: "In Progress", blockers: "", notes: "",
    ...over,
  } as Task;
}
function mkInput(tasks: Task[], today = "2026-06-28"): ActionInput {
  return {
    tasks, raid: [], changes: [], milestones: [], stakeholders: [],
    commsReminders: [], dashboard: {} as never, features: [],
    today, projectName: "P", now: new Date("2026-06-28T00:00:00Z"),
    reminderLeadDays: 3, dueSoonWorkdays: 3, raidReviewIntervalDays: 30,
    dismissed: new Set<string>(),
  } as ActionInput;
}
const ids = (tasks: Task[], today?: string) =>
  taskAttentionProvider.provide(mkInput(tasks, today)).map((a) => a.id);

describe("taskAttentionProvider", () => {
  it("flags an unassigned active task (blank assignee + no resourceId)", () => {
    expect(ids([mkTask({ assignee: "  ", resourceId: undefined })])).toContain("task-attention:1:unassigned");
  });
  it("does not flag unassigned when an assignee or resourceId is present", () => {
    expect(ids([mkTask({ assignee: "Alice" })])).not.toContain("task-attention:1:unassigned");
    expect(ids([mkTask({ assignee: "", resourceId: 7 })])).not.toContain("task-attention:1:unassigned");
  });
  it("ignores finished tasks entirely", () => {
    expect(ids([mkTask({ assignee: "", status: "Done", completedDate: "2026-06-01" })])).toHaveLength(0);
    expect(ids([mkTask({ assignee: "", status: "Cancelled" })])).toHaveLength(0);
  });
  it("flags a stale task (>=14 days) with day count", () => {
    const out = taskAttentionProvider.provide(mkInput([mkTask({ lastUpdateDate: "2026-06-01" })], "2026-06-28"));
    const stale = out.find((a) => a.id === "task-attention:1:stale");
    expect(stale).toBeTruthy();
    expect(stale!.why.params?.[0]).toBe(27);
  });
  it("does not flag a recently-updated task", () => {
    expect(ids([mkTask({ lastUpdateDate: "2026-06-25" })], "2026-06-28")).not.toContain("task-attention:1:stale");
  });
  it("does not crash on an unparseable lastUpdateDate", () => {
    expect(() => ids([mkTask({ lastUpdateDate: "not-a-date" })])).not.toThrow();
    expect(ids([mkTask({ lastUpdateDate: "not-a-date" })])).not.toContain("task-attention:1:stale");
  });
  it("flags a blocked task", () => {
    expect(ids([mkTask({ blockers: "waiting on legal" })])).toContain("task-attention:1:blocked");
  });
  it("flags dependency-blocked when predecessor not Done", () => {
    const pred = mkTask({ id: 2, taskName: "Predecessor", status: "In Progress" });
    const dependent = mkTask({ id: 1, dependencies: [{ taskId: 2, type: "FS" }] });
    const out = taskAttentionProvider.provide(mkInput([pred, dependent]));
    const dep = out.find((a) => a.id === "task-attention:1:dep-blocked");
    expect(dep).toBeTruthy();
    expect(dep!.why.params?.[0]).toBe("Predecessor");
  });
  it("does not flag dependency-blocked when predecessor is Done", () => {
    const pred = mkTask({ id: 2, status: "Done", completedDate: "2026-06-01" });
    const dependent = mkTask({ id: 1, dependencies: [{ taskId: 2, type: "FS" }] });
    expect(ids([pred, dependent])).not.toContain("task-attention:1:dep-blocked");
  });
  it("does not flag a self-dependency", () => {
    expect(ids([mkTask({ id: 1, dependencies: [{ taskId: 1, type: "FS" }] })]))
      .not.toContain("task-attention:1:dep-blocked");
  });
  it("does not flag a non-FS dependency (only FS blocks start)", () => {
    const pred = mkTask({ id: 2, status: "In Progress" });
    const dependent = mkTask({ id: 1, dependencies: [{ taskId: 2, type: "SS" }] });
    expect(ids([pred, dependent])).not.toContain("task-attention:1:dep-blocked");
  });
  it("emits multiple actions for one task, same cta entity", () => {
    const out = taskAttentionProvider.provide(mkInput([mkTask({ assignee: "", blockers: "x" })]));
    const mine = out.filter((a) => a.cta.kind === "open" && a.cta.view === "open-points" && a.cta.id === 1);
    expect(mine.length).toBeGreaterThanOrEqual(2);
  });
});
