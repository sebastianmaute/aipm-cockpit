import { describe, expect, it } from "vitest";
import type { BudgetBucket, ChangeItem, Milestone, RaidItem, Task, TaskDependency } from "../types";
import type { KnowledgeItem } from "../document-link";
import type { ProjectDocument } from "../document-model";
import { composeRemap, dropTaskRefs, followEditDeps, remapTaskRefs, taskReferencedOutsideApply } from "./wbs-undo-refs";

const task = (id: number, dependencies?: TaskDependency[]): Task =>
  ({ id, taskName: `Task ${id}`, status: "To Do", ...(dependencies ? { dependencies } : {}) }) as Task;
const fs = (taskId: number): TaskDependency => ({ taskId, type: "FS" });
const NONE = { raid: [], milestones: [], changes: [], budgets: [], knowledgeItems: [], documents: [] };

describe("taskReferencedOutsideApply", () => {
  const created = new Map([[11, task(11)], [12, task(12, [fs(11)])]]);

  it("is false when nothing points at the id", () => {
    expect(taskReferencedOutsideApply([task(1), task(11), task(12, [fs(11)])], 11, created, NONE)).toBe(false);
  });

  it("counts a dependency on a non-created task", () => {
    expect(taskReferencedOutsideApply([task(1, [fs(11)]), task(11)], 11, created, NONE)).toBe(true);
  });

  it("counts a created task's dependency its created image lacks", () => {
    expect(taskReferencedOutsideApply([task(11, [fs(12)]), task(12)], 12, created, NONE)).toBe(true);
  });

  it("does not count a dependency the created image already had", () => {
    expect(taskReferencedOutsideApply([task(11), task(12, [fs(11)])], 11, created, NONE)).toBe(false);
  });

  it("counts a RAID item's link", () => {
    const raid = [{ id: 1, linkedTaskIds: [11] } as unknown as RaidItem];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, raid })).toBe(true);
  });

  it("counts a milestone's link", () => {
    const milestones = [{ id: 1, linkedTaskIds: [11] } as unknown as Milestone];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, milestones })).toBe(true);
  });

  it("counts a change's link", () => {
    const changes = [{ id: 1, linkedTaskIds: [11] } as unknown as ChangeItem];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, changes })).toBe(true);
  });

  it("counts a budget bucket's task", () => {
    const budgets = [{ id: 1, taskIds: [11] } as unknown as BudgetBucket];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, budgets })).toBe(true);
    const noTasks = [{ id: 1 } as unknown as BudgetBucket];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, budgets: noTasks })).toBe(false);
  });

  it("counts a knowledge item's task link", () => {
    const knowledgeItems = [{ url: "https://example.com", taskIds: [11] } as unknown as KnowledgeItem];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, knowledgeItems })).toBe(true);
    const unlinked = [{ url: "https://example.com" } as unknown as KnowledgeItem];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, knowledgeItems: unlinked })).toBe(false);
  });

  it("counts a document's task reference, never another kind's same id", () => {
    const documents = [{ id: 1, linkedEntities: [{ kind: "task", id: 11 }] } as unknown as ProjectDocument];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, documents })).toBe(true);
    const otherKind = [{ id: 1, linkedEntities: [{ kind: "raid", id: 11 }] }, { id: 2 }] as unknown as ProjectDocument[];
    expect(taskReferencedOutsideApply([task(11)], 11, created, { ...NONE, documents: otherKind })).toBe(false);
  });
});

describe("dropTaskRefs", () => {
  it("removes only the dependencies on removed ids", () => {
    const row = task(1, [fs(3), fs(11), { taskId: 12, type: "SS" }]);
    expect(dropTaskRefs(row, new Set([11, 12])).dependencies).toEqual([fs(3)]);
  });

  it("returns the same row when nothing is dropped", () => {
    const row = task(1, [fs(3)]);
    expect(dropTaskRefs(row, new Set([11]))).toBe(row);
    const bare = task(2);
    expect(dropTaskRefs(bare, new Set([11]))).toBe(bare);
  });
});

describe("remapTaskRefs", () => {
  const remap = new Map([[11, 20]]);

  it("remaps every dependency on a remapped id without `only`", () => {
    const row = task(1, [fs(3), fs(11), { taskId: 11, type: "SS" }]);
    expect(remapTaskRefs(row, remap).dependencies).toEqual([fs(3), fs(20), { taskId: 20, type: "SS" }]);
  });

  it("with `only`, remaps just the listed entries", () => {
    // The FS link is the one the entry wrote; the SS one a person added to the row that took id 11.
    const row = task(1, [fs(11), { taskId: 11, type: "SS" }]);
    expect(remapTaskRefs(row, remap, [fs(11)]).dependencies).toEqual([fs(20), { taskId: 11, type: "SS" }]);
  });

  it("with an empty `only`, remaps nothing", () => {
    const row = task(1, [fs(11)]);
    expect(remapTaskRefs(row, remap, [])).toBe(row);
  });

  it("returns the same row when nothing is remapped", () => {
    const row = task(1, [fs(3)]);
    expect(remapTaskRefs(row, remap)).toBe(row);
    expect(remapTaskRefs(row, new Map())).toBe(row);
  });
});

describe("composeRemap", () => {
  it("follows each original id through one more redo's re-mint", () => {
    const base = new Map([[11, 20]]);
    expect([...composeRemap(base, new Map([[20, 30], [12, 31]]), [11, 12, 13])]).toEqual([[11, 30], [12, 31]]);
  });

  it("returns base itself when the step moved nothing", () => {
    const base = new Map([[11, 20]]);
    expect(composeRemap(base, new Map(), [11])).toBe(base);
  });
});

describe("followEditDeps", () => {
  const edits = [
    { id: 2, before: { dependencies: [] }, after: { dependencies: [fs(3), fs(11)] } },
    { id: 1, before: { taskName: "a" }, after: { taskName: "b" } },
  ];

  it("follows only the after dependencies on moved created ids", () => {
    const out = followEditDeps(edits, new Map([[11, 20]]));
    expect(out[0].after.dependencies).toEqual([fs(3), fs(20)]);
    expect(out[0].before).toBe(edits[0].before);
    expect(out[1]).toBe(edits[1]);
  });

  it("returns the edits themselves when nothing moved", () => {
    expect(followEditDeps(edits, new Map())).toBe(edits);
    expect(followEditDeps(edits, new Map([[99, 100]]))).toBe(edits);
  });
});
