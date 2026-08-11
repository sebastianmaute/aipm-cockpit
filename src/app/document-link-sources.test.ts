import { describe, it, expect } from "vitest";
import { buildDocLinkCandidates, buildDocRefLookups, VIEW_BY_KIND } from "./document-link-sources";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { ChangeItem, Milestone, RaidItem, Task } from "./types";

// ★ Built from the repo's own `emptyWorkspace()` factory, overriding ONLY the
// slice under test — so a new REQUIRED Workspace field breaks the factory once
// rather than four fixtures here.

function task(id: number, taskName: string): Task {
  return {
    id,
    taskName,
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-08-10",
    lastUpdateDate: "2026-08-10",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
  };
}

function milestone(id: number, name: string): Milestone {
  return { id, name, date: "2026-08-10", linkedTaskIds: [] };
}

function raid(id: number, title: string): RaidItem {
  return {
    id,
    category: "R",
    title,
    status: "Open",
    linkedTaskIds: [],
    raisedDate: "2026-08-10",
    causedByRaidIds: [],
    stakeholderIds: [],
  };
}

function change(id: number, title: string): ChangeItem {
  return {
    id,
    title,
    description: "",
    type: "Scope",
    status: "Proposed",
    raisedDate: "2026-08-10",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
  };
}

function fullWorkspace(): Workspace {
  return {
    ...emptyWorkspace(),
    tasks: [task(1, "Draft the charter")],
    milestones: [milestone(2, "Kickoff")],
    raid: [raid(3, "Vendor may slip")],
    changes: [change(4, "Add a workstream")],
  };
}

describe("buildDocRefLookups", () => {
  // ★★★ The four display fields are NOT the same name. This case is the whole
  // reason the module exists: a wrong guess (`title` for a Task, say) yields
  // `undefined` and every chip renders blank, which nothing else would catch.
  it("reads the right display field for each of the four kinds", () => {
    const lookups = buildDocRefLookups(fullWorkspace());
    expect(lookups.task.get(1)).toBe("Draft the charter"); // Task.taskName
    expect(lookups.milestone.get(2)).toBe("Kickoff"); // Milestone.name
    expect(lookups.raid.get(3)).toBe("Vendor may slip"); // RaidItem.title
    expect(lookups.change.get(4)).toBe("Add a workstream"); // ChangeItem.title
  });

  // ★★ `milestones` and `changes` are OPTIONAL on Workspace. A project that
  // never created one must not crash the Documents pane.
  it("survives a workspace with milestones and changes ABSENT", () => {
    const ws: Workspace = { ...emptyWorkspace(), tasks: [task(1, "T")], raid: [raid(3, "R")] };
    delete (ws as { milestones?: unknown }).milestones;
    delete (ws as { changes?: unknown }).changes;

    const lookups = buildDocRefLookups(ws);
    expect(lookups.milestone.size).toBe(0);
    expect(lookups.change.size).toBe(0);
    // Positive control: the two REQUIRED slices still resolve, so an empty
    // result above cannot be an empty-workspace artefact.
    expect(lookups.task.get(1)).toBe("T");
    expect(lookups.raid.get(3)).toBe("R");
  });
});

describe("buildDocLinkCandidates", () => {
  it("spans all four kinds", () => {
    expect(buildDocLinkCandidates(fullWorkspace())).toEqual([
      { kind: "task", id: 1, title: "Draft the charter" },
      { kind: "milestone", id: 2, title: "Kickoff" },
      { kind: "raid", id: 3, title: "Vendor may slip" },
      { kind: "change", id: 4, title: "Add a workstream" },
    ]);
  });

  it("yields no milestone or change candidates when those slices are ABSENT", () => {
    const ws: Workspace = { ...emptyWorkspace(), tasks: [task(1, "T")], raid: [raid(3, "R")] };
    delete (ws as { milestones?: unknown }).milestones;
    delete (ws as { changes?: unknown }).changes;

    const candidates = buildDocLinkCandidates(ws);
    expect(candidates.map((c) => c.kind)).toEqual(["task", "raid"]);
  });
});

describe("VIEW_BY_KIND", () => {
  it("routes each kind to its own view", () => {
    expect(VIEW_BY_KIND).toEqual({
      task: "open-points",
      milestone: "milestones",
      raid: "raid",
      change: "changes",
    });
  });
});
