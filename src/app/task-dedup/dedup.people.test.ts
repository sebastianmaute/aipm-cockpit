// AI people protection, Task 6 (R4): "a dedup merge keeps the survivor's own person fields unchanged (the
// AI chose no person); the merged-away tasks' person fields are dropped, as today." The merge offers the
// model no person field at all, so this holds with protection on and off alike; it is pinned here so a
// future `unifiedFields.assignee` cannot slip in unnoticed.
import { describe, it, expect } from "vitest";
import { applyMerges, groundMergeGroups, parseMergeProposal, PROPOSE_MERGES_TOOL } from "./dedup";
import type { Task } from "../types";

const task = (id: number, assignee: string, over: Partial<Task> = {}): Task => ({
  id, taskName: `Task ${id}`, assignee, assigneeEmail: `${assignee.toLowerCase()}@x.io`, dueDate: "2026-11-01",
  lastUpdateDate: "2026-10-01", priority: "Medium", status: "To Do", blockers: "", description: "",
  inquiriesSent: 0, group: "", labels: [], resourceId: id, ...over,
});

describe("a dedup merge and people", () => {
  it("offers the model no person field to set on the survivor", () => {
    const unified = PROPOSE_MERGES_TOOL.input_schema.properties.groups.items.properties.unifiedFields.properties;
    expect(Object.keys(unified)).toEqual(["title", "description"]);
  });

  it("keeps the survivor's own assignee even when the model sends one, and drops the merged-away task", () => {
    const tasks = [task(1, "Ann"), task(2, "Bo")];
    const raw = parseMergeProposal({
      groups: [{ keepId: 1, mergeIds: [2], rationale: "same", unifiedFields: { title: "Merged", assignee: "Bo", assigneeEmail: "bo@x.io", resourceId: 2 } }],
    })!;
    const { nextTasks, removed } = applyMerges(tasks, groundMergeGroups(raw, tasks), "2026-10-30T00:00:00.000Z");
    expect(nextTasks).toHaveLength(1);
    expect(nextTasks[0]).toMatchObject({ id: 1, taskName: "Merged", assignee: "Ann", assigneeEmail: "ann@x.io", resourceId: 1 });
    expect(removed.map((r) => r.id)).toEqual([2]);
  });
});
