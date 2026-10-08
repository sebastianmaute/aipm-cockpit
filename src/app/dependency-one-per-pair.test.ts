import { beforeEach, describe, expect, it, vi } from "vitest";
import { dropDanglingDependencies, parseDependenciesString, sanitizeDependencies } from "./sanitize";
import { resolveDependencyWrite } from "./task-dependency-write";
import { resolveSuccessorLinks } from "./successor-links";
import type { Task, TaskDependency } from "./types";
import * as diagnostics from "./diagnostics";

// §135: a task pair carries at most ONE dependency type (owner decision
// 2026-10-08). A second link to the same task with a different type used to
// survive every load and write path while the editor showed only the first, so
// it was invisible there and could not be removed on its own. Every path now
// keeps the FIRST link to a task and drops the rest.

function task(id: number, dependencies?: TaskDependency[]): Task {
  return {
    id, taskName: `Task ${id}`, assignee: "", assigneeEmail: "", dueDate: "",
    lastUpdateDate: "", priority: "Medium", status: "To Do", blockers: "", description: "",
    ...(dependencies ? { dependencies } : {}),
  };
}

const KNOWN = new Set([1, 2, 3]);

describe("one dependency link per task pair (§135)", () => {
  it("sanitizeDependencies keeps the first link to a task and drops a second type", () => {
    expect(sanitizeDependencies(
      [{ taskId: 2, type: "FS" }, { taskId: 2, type: "SS" }, { taskId: 3, type: "FF" }], KNOWN, 1,
    )).toEqual([{ taskId: 2, type: "FS" }, { taskId: 3, type: "FF" }]);
  });

  // The decoder leaves the mixed pair for the load pass, which every load runs after
  // decoding (CSV, Markdown, Turso) — so the collapse and its report happen once.
  it("a decoded mixed pair is collapsed by the load pass, keeping the first in stored order", () => {
    const decoded = parseDependenciesString("SS:2|FS:2|FF:3");
    expect(decoded).toEqual([{ taskId: 2, type: "SS" }, { taskId: 2, type: "FS" }, { taskId: 3, type: "FF" }]);
    const out = dropDanglingDependencies([task(1, decoded), task(2), task(3)]);
    expect(out[0].dependencies).toEqual([{ taskId: 2, type: "SS" }, { taskId: 3, type: "FF" }]);
  });

  describe("the load pass reports what it collapsed", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("logs one warning with the counts when a mixed pair is collapsed", () => {
      const log = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
      dropDanglingDependencies([
        task(1, [{ taskId: 2, type: "FS" }, { taskId: 2, type: "SS" }, { taskId: 2, type: "FF" }]),
        task(3, [{ taskId: 2, type: "FS" }, { taskId: 2, type: "SF" }]),
        task(2),
      ]);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("warn", "dependency.mixedPairCollapsed", { tasks: 2, links: 3 });
    });

    it("logs nothing for an exact duplicate or a dangling link, which lose no relation type", () => {
      const log = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
      dropDanglingDependencies([task(1, [{ taskId: 2, type: "FS" }, { taskId: 2, type: "FS" }, { taskId: 9, type: "SS" }]), task(2)]);
      expect(log).not.toHaveBeenCalled();
    });
  });

  // The two load funnels run this over every load, JSON and IndexedDB included,
  // which never pass through the string codec.
  it("the load pass collapses a mixed pair that arrived in a JSON file", () => {
    const tasks = [task(1, [{ taskId: 2, type: "FS" }, { taskId: 2, type: "SF" }]), task(2)];
    const out = dropDanglingDependencies(tasks);
    expect(out[0].dependencies).toEqual([{ taskId: 2, type: "FS" }]);
    expect(out[1]).toBe(tasks[1]);
  });

  it("the load pass returns the same array when no pair is mixed", () => {
    const tasks = [task(1, [{ taskId: 2, type: "FS" }, { taskId: 3, type: "SS" }]), task(2), task(3)];
    expect(dropDanglingDependencies(tasks)).toBe(tasks);
  });

  it("an AI write naming one task twice reports the second as a duplicate", () => {
    const r = resolveDependencyWrite(1, [{ taskId: 2, type: "FS" }, { taskId: 2, type: "SS" }], [task(1), task(2)]);
    expect(r.applied).toEqual([{ taskId: 2, type: "FS" }]);
    expect(r.rejected).toEqual([{ taskId: 2, type: "SS", reason: "duplicate" }]);
  });

  // The successor group is never seeded from stored links, so picking a target
  // that already depends on this task with another type is the user CHANGING
  // the type. It replaces the stored link rather than adding a second one.
  it("a successor link to a target that already has another type replaces that type", () => {
    const tasks = [task(1), task(2, [{ taskId: 1, type: "FS" }, { taskId: 3, type: "FF" }]), task(3)];
    const { edits, skipped, alreadyPresent, typeChanged } = resolveSuccessorLinks({
      ownId: 1, links: [{ taskId: 2, type: "SS" }], tasks,
    });
    expect(typeChanged).toBe(1);
    expect(skipped).toBe(0);
    expect(alreadyPresent).toBe(0);
    expect(edits.get(2)).toEqual({
      before: [{ taskId: 1, type: "FS" }, { taskId: 3, type: "FF" }],
      after: [{ taskId: 1, type: "SS" }, { taskId: 3, type: "FF" }],
    });
  });
});
