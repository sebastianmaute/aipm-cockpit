import { describe, expect, it } from "vitest";
import { isExternalTask } from "./task-external";
import type { Resource, Task } from "./types";

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 1,
    taskName: "T",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-03-01",
    lastUpdateDate: "2026-02-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    ...over,
  }) as Task;

const resources = new Map<number, Resource>([
  [1, { id: 1, firstName: "Ext", lastName: "Ernal", isExternal: true } as Resource],
  [2, { id: 2, firstName: "In", lastName: "Ternal" } as Resource],
]);

describe("isExternalTask", () => {
  it("a task linked to an external resource is external", () => {
    expect(isExternalTask(task({ resourceId: 1 }), resources)).toBe(true);
  });

  it("a task linked to an internal resource is not external", () => {
    expect(isExternalTask(task({ resourceId: 2 }), resources)).toBe(false);
  });

  it("an unlinked task is never external, even when its assignee string names an external", () => {
    expect(isExternalTask(task({ assignee: "Ext Ernal" }), resources)).toBe(false);
  });

  it("a dangling link (resource deleted) is not external", () => {
    expect(isExternalTask(task({ resourceId: 99 }), resources)).toBe(false);
  });
});
