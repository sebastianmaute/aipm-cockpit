import { describe, expect, it } from "vitest";
import { resolveDependencyWrite } from "./task-dependency-write";
import { type Task } from "./types";

function task(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    taskName: `Task ${id}`,
    assignee: "",
    dueDate: "",
    status: "To Do",
    priority: "Medium",
    ...over,
  } as Task;
}

describe("resolveDependencyWrite", () => {
  it("accepts valid links", () => {
    const tasks = [task(1), task(2), task(3)];
    const r = resolveDependencyWrite(3, [{ taskId: 1, type: "FS" }, { taskId: 2, type: "SS" }], tasks);
    expect(r.applied).toEqual([{ taskId: 1, type: "FS" }, { taskId: 2, type: "SS" }]);
    expect(r.rejected).toEqual([]);
  });

  it("refuses a self-dependency", () => {
    const tasks = [task(1), task(2)];
    const r = resolveDependencyWrite(1, [{ taskId: 1, type: "FS" }], tasks);
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ taskId: 1, type: "FS", reason: "self" }]);
  });

  it("refuses an unknown task id", () => {
    const tasks = [task(1)];
    const r = resolveDependencyWrite(1, [{ taskId: 99, type: "FS" }], tasks);
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ taskId: 99, type: "FS", reason: "unknown-id" }]);
  });

  it("refuses a bad link type", () => {
    const tasks = [task(1), task(2)];
    const r = resolveDependencyWrite(2, [{ taskId: 1, type: "NOPE" }], tasks);
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ taskId: 1, type: "NOPE", reason: "bad-type" }]);
  });

  it("refuses a direct cycle", () => {
    // 1 already depends on 2, so 2 -> 1 would close the loop.
    const tasks = [task(1, { dependencies: [{ taskId: 2, type: "FS" }] }), task(2)];
    const r = resolveDependencyWrite(2, [{ taskId: 1, type: "FS" }], tasks);
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ taskId: 1, type: "FS", reason: "cycle" }]);
  });

  it("refuses a transitive cycle", () => {
    const tasks = [
      task(1),
      task(2, { dependencies: [{ taskId: 1, type: "FS" }] }),
      task(3, { dependencies: [{ taskId: 2, type: "FS" }] }),
    ];
    const r = resolveDependencyWrite(1, [{ taskId: 3, type: "FS" }], tasks);
    expect(r.applied).toEqual([]);
    expect(r.rejected[0]?.reason).toBe("cycle");
  });

  it("refuses a set that is acyclic link-by-link but cyclic together", () => {
    const tasks = [task(1), task(2, { dependencies: [{ taskId: 1, type: "FS" }] }), task(3)];
    const r = resolveDependencyWrite(1, [{ taskId: 3, type: "FS" }, { taskId: 2, type: "FS" }], tasks);
    expect(r.applied).toEqual([{ taskId: 3, type: "FS" }]);
    expect(r.rejected).toEqual([{ taskId: 2, type: "FS", reason: "cycle" }]);
  });

  it("drops a duplicate link", () => {
    const tasks = [task(1), task(2)];
    const r = resolveDependencyWrite(2, [{ taskId: 1, type: "FS" }, { taskId: 1, type: "FS" }], tasks);
    expect(r.applied).toEqual([{ taskId: 1, type: "FS" }]);
    expect(r.rejected).toEqual([{ taskId: 1, type: "FS", reason: "duplicate" }]);
  });

  it("clears every link for an empty array", () => {
    const tasks = [task(1), task(2, { dependencies: [{ taskId: 1, type: "FS" }] })];
    const r = resolveDependencyWrite(2, [], tasks);
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("treats a non-array input as a clear", () => {
    const tasks = [task(1), task(2)];
    expect(resolveDependencyWrite(2, null, tasks).applied).toEqual([]);
    expect(resolveDependencyWrite(2, "nope", tasks).applied).toEqual([]);
  });

  it("caps the link count and reports the overflow", () => {
    const tasks = [task(1), ...Array.from({ length: 25 }, (_, i) => task(i + 2))];
    const raw = Array.from({ length: 25 }, (_, i) => ({ taskId: i + 2, type: "FS" as const }));
    const r = resolveDependencyWrite(1, raw, tasks);
    expect(r.applied).toHaveLength(20);
    expect(r.rejected).toHaveLength(5);
    expect(r.rejected.every((x) => x.reason === "cap")).toBe(true);
  });
});
