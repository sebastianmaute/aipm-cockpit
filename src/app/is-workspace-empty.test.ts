import { describe, it, expect } from "vitest";
import { emptyWorkspace, isWorkspaceEmpty, nonEmptyCollectionCount, workspaceRecordCount, isMassDeletion, type Workspace } from "./workspace";

describe("isWorkspaceEmpty", () => {
  it("is true for a blank workspace (default plan doesn't count)", () => {
    expect(isWorkspaceEmpty(emptyWorkspace())).toBe(true);
  });

  it("is false when ANY user collection has a record", () => {
    const ws = emptyWorkspace();
    expect(isWorkspaceEmpty({ ...ws, tasks: [{ id: 1 } as never] })).toBe(false);
    expect(isWorkspaceEmpty({ ...ws, resources: [{ id: 1 } as never] })).toBe(false);
    expect(isWorkspaceEmpty({ ...ws, milestones: [{ id: 1 } as never] })).toBe(false);
    expect(isWorkspaceEmpty({ ...ws, stakeholders: [{ id: 1 } as never] })).toBe(false);
  });

  it("tolerates missing arrays (partial object)", () => {
    expect(isWorkspaceEmpty({} as unknown as Workspace)).toBe(true);
  });
});

describe("nonEmptyCollectionCount", () => {
  it("counts collections that hold records", () => {
    expect(nonEmptyCollectionCount(emptyWorkspace())).toBe(0);
    const ws = emptyWorkspace();
    expect(nonEmptyCollectionCount({ ...ws, tasks: [{ id: 1 } as never] })).toBe(1);
    expect(nonEmptyCollectionCount({ ...ws, tasks: [{ id: 1 } as never], resources: [{ id: 2 } as never] })).toBe(2);
  });
});

describe("workspaceRecordCount", () => {
  it("sums records across collections", () => {
    expect(workspaceRecordCount(emptyWorkspace())).toBe(0);
    const ws = emptyWorkspace();
    expect(workspaceRecordCount({ ...ws, tasks: [{ id: 1 }, { id: 2 }] as never, milestones: [{ id: 3 }] as never })).toBe(3);
  });
});

describe("isMassDeletion", () => {
  it("flags losing almost everything in one step (full or near-total)", () => {
    expect(isMassDeletion(100, 0)).toBe(true);   // lost all
    expect(isMassDeletion(50, 2)).toBe(true);    // removed 48, 2 <= 5
  });
  it("does NOT flag normal edits or moderate deletes", () => {
    expect(isMassDeletion(50, 49)).toBe(false);  // removed 1
    expect(isMassDeletion(50, 40)).toBe(false);  // lost 20%
    expect(isMassDeletion(3, 0)).toBe(false);    // removed 3 < floor 5 (small project)
    expect(isMassDeletion(10, 20)).toBe(false);  // grew
  });
});
