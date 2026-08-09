import { describe, expect, it } from "vitest";
import { resolveSuccessorLinks } from "./successor-links";
import { wouldCreateDependencyCycle } from "./sanitize";
import type { Task, TaskDependency } from "./types";

function task(id: number, name: string, dependencies: TaskDependency[] = []): Task {
  return {
    id,
    taskName: name,
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    group: "",
    labels: [],
    inquiriesSent: 0,
    createdDate: "2026-01-01",
    dependencies,
  } as Task;
}

describe("resolveSuccessorLinks", () => {
  it("writes the owning task onto each successor as a predecessor", () => {
    const tasks = [task(1, "Own"), task(2, "Target")];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(0);
    expect(edits.get(2)).toEqual({ before: [], after: [{ taskId: 1, type: "FS" }] });
    expect(edits.has(1)).toBe(false);
  });

  it("preserves the target's existing dependencies", () => {
    const tasks = [task(1, "Own"), task(2, "Target", [{ taskId: 3, type: "SS" }]), task(3, "Other")];
    const { edits } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(edits.get(2)?.before).toEqual([{ taskId: 3, type: "SS" }]);
    expect(edits.get(2)?.after).toEqual([
      { taskId: 3, type: "SS" },
      { taskId: 1, type: "FS" },
    ]);
  });

  // ★★★ THE test for this feature. A chain-free fixture returns false for BOTH
  // argument orders, so it cannot tell a correct guard from a reversed one.
  // This seeds the collision and asserts the two orders DISAGREE on it.
  it("runs the cycle guard reversed for successors", () => {
    // Own(1) already depends on Target(2). Making 2 a SUCCESSOR of 1 would
    // mean 2 depends on 1, closing 1 -> 2 -> 1.
    const tasks = [task(1, "Own", [{ taskId: 2, type: "FS" }]), task(2, "Target")];
    const byId = new Map(tasks.map((t) => [t.id, t]));

    // Control: the two argument orders must not agree on this fixture, or the
    // assertion below would hold for a guard called either way.
    expect(wouldCreateDependencyCycle(2, 1, byId)).toBe(true);
    expect(wouldCreateDependencyCycle(1, 2, byId)).toBe(false);

    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });

  it("skips a link to the owning task itself", () => {
    const tasks = [task(1, "Own")];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 1, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });

  it("skips a target deleted between staging and save, and still applies the rest", () => {
    const tasks = [task(1, "Own"), task(3, "Survivor")];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [
        { taskId: 99, type: "FS" },
        { taskId: 3, type: "FS" },
      ],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.get(3)?.after).toEqual([{ taskId: 1, type: "FS" }]);
  });

  it("skips a target already at the 20-link cap", () => {
    // 20 existing predecessors on the target; sanitizeDependencies caps at 20,
    // so the 21st cannot land and the link is reported as skipped.
    const fillers = Array.from({ length: 20 }, (_, i) => task(100 + i, `Filler ${i}`));
    const targetDeps: TaskDependency[] = fillers.map((f) => ({ taskId: f.id, type: "FS" }));
    const tasks = [task(1, "Own"), task(2, "Target", targetDeps), ...fillers];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });

  it("skips a duplicate link to a target that already has one", () => {
    const tasks = [task(1, "Own"), task(2, "Target", [{ taskId: 1, type: "FS" }])];
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 1,
      links: [{ taskId: 2, type: "FS" }],
      tasks,
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });

  it("returns an empty resolution for an empty link list", () => {
    const tasks = [task(1, "Own"), task(2, "Target")];
    const { edits, skipped } = resolveSuccessorLinks({ ownId: 1, links: [], tasks });
    expect(skipped).toBe(0);
    expect(edits.size).toBe(0);
  });

  // ★★★ The create-path contract. Resolving against the PRE-mint array makes
  // the new id a dangling reference that sanitizeDependencies strips, so every
  // staged link is silently dropped — green tests, no error, no links. Same
  // inputs, two arrays, opposite outcomes.
  it("needs a task list that already contains the newly minted task", () => {
    const existing = [task(2, "Target")];
    const minted = task(7, "Brand new");

    const withoutNew = resolveSuccessorLinks({
      ownId: 7,
      links: [{ taskId: 2, type: "FS" }],
      tasks: existing,
    });
    expect(withoutNew.edits.size).toBe(0);
    expect(withoutNew.skipped).toBe(1);

    const withNew = resolveSuccessorLinks({
      ownId: 7,
      links: [{ taskId: 2, type: "FS" }],
      tasks: [...existing, minted],
    });
    expect(withNew.edits.get(2)?.after).toEqual([{ taskId: 7, type: "FS" }]);
  });

  it("catches a task staged as BOTH predecessor and successor on create", () => {
    // Reachable from the UI: the picker skips its cycle guard while ownTaskId
    // is null. Resolving against a list that includes the new task AND its
    // staged predecessors is what lets the walk see the collision.
    const minted = task(7, "Brand new", [{ taskId: 2, type: "FS" }]);
    const { edits, skipped } = resolveSuccessorLinks({
      ownId: 7,
      links: [{ taskId: 2, type: "FS" }],
      tasks: [task(2, "Target"), minted],
    });
    expect(skipped).toBe(1);
    expect(edits.size).toBe(0);
  });
});
