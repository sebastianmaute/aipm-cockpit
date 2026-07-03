import { describe, it, expect } from "vitest";
import { emptyWorkspace, isWorkspaceEmpty, nonEmptyCollectionCount, type Workspace } from "./workspace";

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
