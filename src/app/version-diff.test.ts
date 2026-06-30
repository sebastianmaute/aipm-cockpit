import { describe, it, expect } from "vitest";
import { diffWorkspaces, summarizeDiff } from "./version-diff";
import type { Workspace } from "./workspace";

function ws(over: Partial<Workspace>): Workspace {
  return {
    tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [],
    disciplines: [], grades: [], plan: { } as never, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} as never, ...over,
  } as Workspace;
}
const task = (id: number, over: Record<string, unknown> = {}) => ({ id, title: `T${id}`, ...over } as never);

describe("diffWorkspaces", () => {
  it("detects an added record", () => {
    const c = diffWorkspaces(ws({ tasks: [] }), ws({ tasks: [task(1)] }));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "added" });
  });
  it("detects a removed record", () => {
    const c = diffWorkspaces(ws({ tasks: [task(1)] }), ws({ tasks: [] }));
    expect(c[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "removed" });
  });
  it("detects a modified record with field before/after", () => {
    const c = diffWorkspaces(ws({ tasks: [task(1, { title: "Old", pct: 10 })] }), ws({ tasks: [task(1, { title: "New", pct: 10 })] }));
    expect(c).toHaveLength(1);
    expect(c[0].type).toBe("modified");
    expect(c[0].fields.find((x) => x.field === "title")).toMatchObject({ before: "Old", after: "New" });
    expect(c[0].fields.find((x) => x.field === "pct")).toBeUndefined();
  });
  it("ignores localModifiedAt churn", () => {
    const c = diffWorkspaces(ws({ tasks: [task(1, { localModifiedAt: "a" })] }), ws({ tasks: [task(1, { localModifiedAt: "b" })] }));
    expect(c).toHaveLength(0);
  });
  it("diffs a singleton (project meta) as field changes", () => {
    const c = diffWorkspaces(ws({ project: { name: "A" } as never }), ws({ project: { name: "B" } as never }));
    expect(c[0]).toMatchObject({ collection: "project", type: "modified" });
    expect(c[0].fields[0]).toMatchObject({ field: "name", before: "A", after: "B" });
  });
  it("treats undefined collections as empty", () => {
    const c = diffWorkspaces(ws({ milestones: undefined }), ws({ milestones: [{ id: 5, name: "M" } as never] }));
    expect(c[0]).toMatchObject({ collection: "milestones", recordId: 5, type: "added" });
  });
});

describe("summarizeDiff", () => {
  it("groups counts by collection label", () => {
    const c = diffWorkspaces(
      ws({ tasks: [task(1, { title: "a" })], raid: [] }),
      ws({ tasks: [task(1, { title: "b" }), task(2)], raid: [{ id: 9 } as never] }),
    );
    expect(summarizeDiff(c)).toMatch(/Tasks \(2\)/);
    expect(summarizeDiff(c)).toMatch(/RAID \(1\)/);
  });
  it("returns empty string for no changes", () => { expect(summarizeDiff([])).toBe(""); });
});
