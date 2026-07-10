import { describe, it, expect } from "vitest";
import { applyTaskLink } from "./task-link";
import type { Task } from "./types";

function task(id: number, deps: Task["dependencies"] = []): Task {
  return { id, dependencies: deps } as Task;
}

describe("applyTaskLink", () => {
  it("predecessor: child becomes a dependency of the parent", () => {
    const tasks = [task(1), task(2)];
    const out = applyTaskLink(tasks, 1, { childId: 2, direction: "predecessor", type: "FS" });
    expect(out.find((t) => t.id === 1)?.dependencies).toEqual([{ taskId: 2, type: "FS" }]);
    expect(out.find((t) => t.id === 2)?.dependencies).toEqual([]);
  });

  it("successor: parent becomes a dependency of the child", () => {
    const tasks = [task(1), task(2)];
    const out = applyTaskLink(tasks, 1, { childId: 2, direction: "successor", type: "FS" });
    expect(out.find((t) => t.id === 2)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
    expect(out.find((t) => t.id === 1)?.dependencies).toEqual([]);
  });

  it("does not duplicate an existing dependency", () => {
    const tasks = [task(1, [{ taskId: 2, type: "FS" }]), task(2)];
    const out = applyTaskLink(tasks, 1, { childId: 2, direction: "predecessor", type: "FS" });
    expect(out.find((t) => t.id === 1)?.dependencies).toHaveLength(1);
  });

  it("treats an absent dependencies array as empty", () => {
    const tasks = [{ id: 1 } as Task, { id: 2 } as Task];
    const out = applyTaskLink(tasks, 1, { childId: 2, direction: "predecessor", type: "SS" });
    expect(out.find((t) => t.id === 1)?.dependencies).toEqual([{ taskId: 2, type: "SS" }]);
  });

  it("adds a second distinct predecessor to an existing list", () => {
    const tasks = [task(1, [{ taskId: 3, type: "FS" }]), task(2)];
    const out = applyTaskLink(tasks, 1, { childId: 2, direction: "predecessor", type: "FF" });
    expect(out.find((t) => t.id === 1)?.dependencies).toEqual([
      { taskId: 3, type: "FS" },
      { taskId: 2, type: "FF" },
    ]);
  });
});
