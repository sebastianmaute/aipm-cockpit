// src/app/inline-ai-edit/plan.test.ts
import { describe, it, expect } from "vitest";
import { describeToolCalls, type ToolUseLike } from "./plan";
import { type Workspace } from "../workspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const task = { id: 42, taskName: "Fix login bug", assignee: "Anna", dueDate: "2026-08-12", status: "To Do", priority: "Medium" } as any;
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as Workspace;

function block(name: string, input: Record<string, unknown>): ToolUseLike {
  return { type: "tool_use", id: "b1", name, input };
}

describe("describeToolCalls", () => {
  it("diffs an update_task on the target task", () => {
    const plan = describeToolCalls([block("update_task", { id: 42, dueDate: "2026-08-15", status: "In Progress" })], { task, ws });
    expect(plan.updates).toEqual([
      { field: "dueDate", before: "2026-08-12", after: "2026-08-15" },
      { field: "status", before: "To Do", after: "In Progress" },
    ]);
    expect(plan.creates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it("summarises a related create", () => {
    const plan = describeToolCalls([block("create_raid_item", { category: "Risk", title: "Payment timeout" })], { task, ws });
    expect(plan.creates).toEqual([{ entity: "raid", title: "Payment timeout", toolName: "create_raid_item", input: { category: "Risk", title: "Payment timeout" } }]);
  });

  it("rejects an update whose id is not the target task and not in the workspace", () => {
    const plan = describeToolCalls([block("update_task", { id: 999, status: "Done" })], { task, ws });
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([{ toolName: "update_task", reason: "unknown-id", detail: "999" }]);
  });

  it("returns an empty plan for no blocks", () => {
    expect(describeToolCalls([], { task, ws })).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
  });

  it("ignores read-only tool calls (list_tasks/get_task)", () => {
    const plan = describeToolCalls([block("list_tasks", {})], { task, ws });
    expect(plan).toEqual({ updates: [], creates: [], deletes: [], rejected: [] });
  });

  it("rejects an out-of-enum status/priority instead of previewing an undroppable diff", () => {
    const bad = describeToolCalls([block("update_task", { id: 42, status: "Frobnicate", priority: "Critical" })], { task, ws });
    expect(bad.updates).toEqual([]);
    expect(bad.rejected).toEqual([
      { toolName: "update_task", reason: "bad-input", detail: "status=Frobnicate" },
      { toolName: "update_task", reason: "bad-input", detail: "priority=Critical" },
    ]);
  });

  it("ignores startDate/resourceId in update_task (not dispatcher-writable)", () => {
    const plan = describeToolCalls([block("update_task", { id: 42, startDate: "2026-01-01", resourceId: 5 })], { task, ws });
    expect(plan.updates).toEqual([]);
    expect(plan.rejected).toEqual([]);
  });

  it("deletes the target task but rejects delete_task on a different task", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const other = { id: 43, taskName: "Other" } as any;
    const ws2 = { tasks: [task, other], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as Workspace;
    const del = describeToolCalls([block("delete_task", { id: 42 })], { task, ws: ws2 });
    expect(del.deletes).toEqual([{ entity: "task", label: "Fix login bug", toolName: "delete_task", id: 42 }]);
    expect(del.rejected).toEqual([]);
    const rej = describeToolCalls([block("delete_task", { id: 43 })], { task, ws: ws2 });
    expect(rej.deletes).toEqual([]);
    expect(rej.rejected).toEqual([{ toolName: "delete_task", reason: "unsupported", detail: "43" }]);
  });
});
