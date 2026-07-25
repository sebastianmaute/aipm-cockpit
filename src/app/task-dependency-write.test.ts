import { describe, expect, it } from "vitest";
import { sanitizeDependencies } from "./sanitize";
import { resolveDependencyWrite } from "./task-dependency-write";
import { type Task } from "./types";

function task(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    taskName: `Task ${id}`,
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    ...over,
  };
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

  it("stringifies a non-string type for the coercion branch", () => {
    // This is untrusted AI JSON — the model can omit `type`, send `null`, or
    // send a number. All three fail validation the same way as "NOPE" above,
    // but exercise the `String(typeRaw)` fallback instead of the plain
    // string passthrough.
    const tasks = [task(1), task(2)];
    const r = resolveDependencyWrite(2, [
      { taskId: 1 }, // missing `type`
      { taskId: 1, type: null },
      { taskId: 1, type: 3 },
    ], tasks);
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([
      { taskId: 1, type: "undefined", reason: "bad-type" },
      { taskId: 1, type: "null", reason: "bad-type" },
      { taskId: 1, type: "3", reason: "bad-type" },
    ]);
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

  it("applies the valid links and refuses only the cyclic one", () => {
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

  it("keeps the applied set aligned with sanitizeDependencies directly (drift alarm)", () => {
    // resolveDependencyWrite reimplements sanitizeDependencies' precedence in
    // pass 1 to attach a reason to every rejection (the sanitizer itself
    // returns no reason info). If the sanitizer ever adds/reorders a rule so
    // pass 1 becomes too STRICT — wrongly rejecting something the real
    // sanitizer would keep — `applied` would be starved of an item it should
    // contain. Pinning `applied` to a direct `sanitizeDependencies` call on
    // the same input catches exactly that drift.
    //
    // It does NOT catch the opposite drift: if pass 1 becomes too PERMISSIVE
    // (an item that should have been rejected for some other reason slips
    // through to pass 2), pass 2's real `sanitizeDependencies` call is still
    // the final gate, so the item is dropped there and `applied` stays
    // correct — only its `rejected` entry ends up mislabelled "cap" instead
    // of the true reason, and this assertion never inspects `rejected`.
    const tasks = [task(1), task(2), task(3)];
    const knownTaskIds = new Set(tasks.map((t) => t.id));
    const raw = [
      { taskId: 2, type: "FS" },
      { taskId: 1, type: "FS" }, // self
      { taskId: 99, type: "FS" }, // unknown id
      { taskId: 3, type: "SS" },
      { taskId: 3, type: "SS" }, // duplicate
      { taskId: 2, type: "NOPE" }, // bad type
    ];
    const r = resolveDependencyWrite(1, raw, tasks);
    expect(r.applied).toEqual(sanitizeDependencies(raw, knownTaskIds, 1));
  });

  it("silently drops entries with no classifiable shape", () => {
    // A non-object entry, or an object whose taskId isn't a finite number,
    // can't be reported as a DepRejection (its `taskId` field requires a real
    // number) — this is deliberate, not an oversight, and both land in
    // neither applied nor rejected.
    const tasks = [task(1), task(2)];
    const r = resolveDependencyWrite(2, ["not-an-object", { taskId: Number.NaN, type: "FS" }], tasks);
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([]);
  });
});
