import { describe, expect, it } from "vitest";
import { emptyWorkspace, migrateWorkspaceV7 } from "./storage";

describe("changes workspace field + v7 migration", () => {
  it("emptyWorkspace seeds changes: []", () => {
    expect(emptyWorkspace().changes).toEqual([]);
  });
  it("migrateWorkspaceV7 seeds changes on an older workspace", () => {
    const ws = { ...emptyWorkspace(), changes: undefined } as ReturnType<typeof emptyWorkspace>;
    expect(migrateWorkspaceV7(ws).changes).toEqual([]);
  });
  it("migrateWorkspaceV7 preserves existing changes", () => {
    const ws = { ...emptyWorkspace(), changes: [{ id: 1, title: "x", description: "", type: "Scope", status: "Proposed", raisedDate: "2026-06-01", linkedTaskIds: [], linkedRaidIds: [] }] } as ReturnType<typeof emptyWorkspace>;
    expect(migrateWorkspaceV7(ws).changes).toHaveLength(1);
  });
});
