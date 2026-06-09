import { describe, expect, it, vi } from "vitest";
import { runTool, TOOL_DEFS, type ToolDispatcher, type Filters } from "./chat-tools";
import { type Task, type RaidItem, type ChangeItem, type Milestone } from "./types";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Alpha",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2026-06-01",
    lastUpdateDate: "2026-05-19",
    priority: "Medium",
    blockers: "",
    notes: "",
    inquiriesSent: 0,
    group: "",
    labels: [],
    ...over,
  } as Task;
}

/**
 * Build a ToolDispatcher whose methods are vi.fn() spies with sensible
 * defaults. Tests override individual returns as needed. runTool only ever
 * touches the dispatcher through this interface, so this is a complete double.
 */
function makeRaidItem(over: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 10,
    category: "R",
    title: "Budget overrun risk",
    status: "Open",
    severity: "High",
    owner: "Alice",
    stakeholderIds: [1, 2],
    linkedTaskIds: [],
    raisedDate: "2026-05-01",
    causedByRaidIds: [],
    ...over,
  } as RaidItem;
}

function makeChangeItem(over: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 20,
    title: "Scope expansion",
    description: "Add new module",
    type: "Scope",
    status: "Proposed",
    impact: "High",
    raisedDate: "2026-05-10",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [3],
    ...over,
  } as ChangeItem;
}

function makeMilestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: 30,
    name: "Phase 1 complete",
    date: "2026-07-01",
    linkedTaskIds: [],
    ...over,
  } as Milestone;
}

function makeDispatcher(over: Partial<ToolDispatcher> = {}): ToolDispatcher {
  return {
    listTasks: vi.fn(() => [makeTask()]),
    getTask: vi.fn((id: number) => (id === 1 ? makeTask() : null)),
    createTask: vi.fn((input) => makeTask({ id: 99, ...(input as object) })),
    updateTask: vi.fn((id: number, patch) =>
      id === 1 ? makeTask({ ...(patch as object) }) : null,
    ),
    deleteTask: vi.fn((id: number) => id === 1),
    deleteAllTasks: vi.fn(() => 3),
    sendInquiry: vi.fn(() => ({ sent: true })),
    setFilters: vi.fn(),
    setLanguage: vi.fn(),
    listRaid: vi.fn(() => [makeRaidItem()].map((r) => ({
      id: r.id, category: r.category, title: r.title, status: r.status,
      severity: r.severity, owner: r.owner, stakeholderIds: r.stakeholderIds ?? [],
    }))),
    listChanges: vi.fn(() => [makeChangeItem()].map((c) => ({
      id: c.id, title: c.title, status: c.status,
      impact: c.impact, decisionDate: c.decisionDate,
      stakeholderIds: c.stakeholderIds ?? [],
    }))),
    listMilestones: vi.fn(() => [makeMilestone()].map((m) => ({
      id: m.id, name: m.name, date: m.date, achievedDate: m.achievedDate,
    }))),
    getSnapshot: vi.fn(() => ({
      today: "2026-06-02",
      language: "en-US" as const,
      holidayCountries: ["DE"],
      storageKind: "browser",
      taskCount: 1,
    })),
    ...over,
  };
}

describe("runTool — list_tasks / get_task", () => {
  it("list_tasks returns the dispatcher's task list", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "list_tasks", {});
    expect(result).toEqual([makeTask()]);
    expect(d.listTasks).toHaveBeenCalledOnce();
  });

  it("get_task coerces a numeric-string id and returns the task", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "get_task", { id: "1" });
    expect(d.getTask).toHaveBeenCalledWith(1);
    expect(result).toEqual(makeTask());
  });

  it("get_task throws when id is not a finite number", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "get_task", { id: "abc" })).rejects.toThrow(
      "id must be a number",
    );
    expect(d.getTask).not.toHaveBeenCalled();
  });

  it("get_task throws when the task does not exist", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "get_task", { id: 42 })).rejects.toThrow(
      "task #42 not found",
    );
  });
});

describe("runTool — create_task", () => {
  it("creates a task from the required fields, omitting optionals", async () => {
    const d = makeDispatcher();
    await runTool(d, "create_task", {
      taskName: "Beta",
      assignee: "Bob",
      dueDate: "2026-07-01",
    });
    expect(d.createTask).toHaveBeenCalledWith({
      taskName: "Beta",
      assignee: "Bob",
      dueDate: "2026-07-01",
      assigneeEmail: undefined,
      lastUpdateDate: undefined,
      priority: undefined,
      blockers: undefined,
      notes: undefined,
      group: undefined,
      labels: undefined,
    });
  });

  it("passes through and sanitizes optional fields", async () => {
    const d = makeDispatcher();
    await runTool(d, "create_task", {
      taskName: "Beta",
      assignee: "Bob",
      dueDate: "2026-07-01",
      priority: "High",
      labels: ["  ux  ", "", 5, "ux"],
    });
    const arg = (d.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.priority).toBe("High");
    // sanitizeLabels trims, drops empties/non-strings, and de-dupes.
    expect(arg.labels).toEqual(["ux"]);
  });

  it("drops an unknown priority value (left undefined)", async () => {
    const d = makeDispatcher();
    await runTool(d, "create_task", {
      taskName: "Beta",
      assignee: "Bob",
      dueDate: "2026-07-01",
      priority: "Critical",
    });
    const arg = (d.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.priority).toBeUndefined();
  });

  it.each([
    ["missing taskName", { assignee: "Bob", dueDate: "2026-07-01" }],
    ["missing assignee", { taskName: "Beta", dueDate: "2026-07-01" }],
    ["missing dueDate", { taskName: "Beta", assignee: "Bob" }],
    ["empty-string taskName", { taskName: "", assignee: "Bob", dueDate: "2026-07-01" }],
  ])("throws when required field is absent/empty: %s", async (_label, input) => {
    const d = makeDispatcher();
    await expect(runTool(d, "create_task", input)).rejects.toThrow(
      "taskName, assignee, and dueDate are required",
    );
    expect(d.createTask).not.toHaveBeenCalled();
  });

  it("ignores a non-array labels value (treated as undefined)", async () => {
    const d = makeDispatcher();
    await runTool(d, "create_task", {
      taskName: "Beta",
      assignee: "Bob",
      dueDate: "2026-07-01",
      labels: "ux",
    });
    const arg = (d.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.labels).toBeUndefined();
  });
});

describe("runTool — update_task / buildPatch", () => {
  it("builds a partial patch from only the provided fields", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, notes: "hello", blockers: "wait" });
    expect(d.updateTask).toHaveBeenCalledWith(1, { notes: "hello", blockers: "wait" });
  });

  it("coerces a non-string field value to empty string when key is present", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, taskName: 123 });
    expect(d.updateTask).toHaveBeenCalledWith(1, { taskName: "" });
  });

  it("omits an unknown priority from the patch entirely", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, priority: "Nope" });
    expect(d.updateTask).toHaveBeenCalledWith(1, {});
  });

  it("keeps a valid priority in the patch", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, priority: "Low" });
    expect(d.updateTask).toHaveBeenCalledWith(1, { priority: "Low" });
  });

  it("sanitizes group and labels in the patch", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, group: "  Phase 1  ", labels: ["a", "a"] });
    const [, patch] = (d.updateTask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patch.group).toBe("Phase 1");
    expect(patch.labels).toEqual(["a"]);
  });

  it("throws on non-numeric id without calling updateTask", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "update_task", { id: {} })).rejects.toThrow(
      "id must be a number",
    );
    expect(d.updateTask).not.toHaveBeenCalled();
  });

  it("throws when the task to update is not found", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "update_task", { id: 7 })).rejects.toThrow(
      "task #7 not found",
    );
  });
});

describe("runTool — delete_task / delete_all_tasks", () => {
  it("deletes an existing task and echoes the id", async () => {
    const d = makeDispatcher();
    expect(await runTool(d, "delete_task", { id: 1 })).toEqual({ deleted: 1 });
  });

  it("throws when deleting a missing task", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "delete_task", { id: 5 })).rejects.toThrow(
      "task #5 not found",
    );
  });

  it("delete_all_tasks returns the deleted count", async () => {
    const d = makeDispatcher();
    expect(await runTool(d, "delete_all_tasks", {})).toEqual({ deleted: 3 });
  });
});

describe("runTool — send_inquiry", () => {
  it("forwards the result from the dispatcher", async () => {
    const d = makeDispatcher({ sendInquiry: vi.fn(() => ({ sent: false, reason: "no-email" })) });
    expect(await runTool(d, "send_inquiry", { id: 1 })).toEqual({
      sent: false,
      reason: "no-email",
    });
  });

  it("throws on a non-numeric id", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "send_inquiry", {})).rejects.toThrow("id must be a number");
  });
});

describe("runTool — set_filters", () => {
  it("passes 'All' through as a priority reset", async () => {
    const d = makeDispatcher();
    await runTool(d, "set_filters", { priority: "All" });
    expect(d.setFilters).toHaveBeenCalledWith({ priority: "All" });
  });

  it("keeps a valid priority and drops an invalid one", async () => {
    const d = makeDispatcher();
    await runTool(d, "set_filters", { priority: "High" });
    expect(d.setFilters).toHaveBeenCalledWith({ priority: "High" });

    const d2 = makeDispatcher();
    await runTool(d2, "set_filters", { priority: "bogus" });
    // Invalid priority is silently omitted, leaving an empty filter object.
    expect(d2.setFilters).toHaveBeenCalledWith({});
  });

  it("normalizes string filters and resets via empty string", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "set_filters", {
      search: "auth",
      assignee: "",
      group: "Phase 1",
      label: "",
    });
    const expected: Filters = { search: "auth", assignee: "", group: "Phase 1", label: "" };
    expect(d.setFilters).toHaveBeenCalledWith(expected);
    expect(result).toEqual({ applied: expected });
  });

  it("coerces a non-string search to empty string when present", async () => {
    const d = makeDispatcher();
    await runTool(d, "set_filters", { search: 123 });
    expect(d.setFilters).toHaveBeenCalledWith({ search: "" });
  });
});

describe("runTool — set_language", () => {
  it.each(["en-US", "en-GB", "de"] as const)("accepts %s", async (lang) => {
    const d = makeDispatcher();
    expect(await runTool(d, "set_language", { language: lang })).toEqual({
      language: lang,
    });
    expect(d.setLanguage).toHaveBeenCalledWith(lang);
  });

  it("throws on an unsupported language without calling setLanguage", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "set_language", { language: "fr" })).rejects.toThrow(
      "unsupported language",
    );
    expect(d.setLanguage).not.toHaveBeenCalled();
  });
});

describe("runTool — get_app_state and edge cases", () => {
  it("get_app_state returns the snapshot", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "get_app_state", {});
    expect(result).toMatchObject({ taskCount: 1, storageKind: "browser" });
  });

  it("throws on an unknown tool name", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "frobnicate", {})).rejects.toThrow("unknown tool: frobnicate");
  });

  it("tolerates a null/non-object rawInput (treated as empty)", async () => {
    const d = makeDispatcher();
    // list_tasks ignores input; a null rawInput must not throw on property access.
    expect(await runTool(d, "list_tasks", null)).toEqual([makeTask()]);
    // get_task with no usable input → id is NaN → validation error.
    await expect(runTool(d, "get_task", null)).rejects.toThrow("id must be a number");
  });
});

describe("TOOL_DEFS — new read-only tools are registered", () => {
  it("list_raid, list_changes, list_milestones appear in TOOL_DEFS", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).toContain("list_raid");
    expect(names).toContain("list_changes");
    expect(names).toContain("list_milestones");
  });

  it("each new tool has an empty-object input_schema (read-only, no params)", () => {
    for (const toolName of ["list_raid", "list_changes", "list_milestones"]) {
      const def = TOOL_DEFS.find((t) => t.name === toolName);
      expect(def).toBeDefined();
      expect(def!.input_schema).toEqual({ type: "object", properties: {} });
    }
  });
});

describe("runTool — list_raid", () => {
  it("returns projected RAID summaries from the dispatcher", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "list_raid", {});
    expect(d.listRaid).toHaveBeenCalledOnce();
    expect(result).toEqual([
      {
        id: 10,
        category: "R",
        title: "Budget overrun risk",
        status: "Open",
        severity: "High",
        owner: "Alice",
        stakeholderIds: [1, 2],
      },
    ]);
  });

  it("returns an empty array when there are no RAID items", async () => {
    const d = makeDispatcher({ listRaid: vi.fn(() => []) });
    expect(await runTool(d, "list_raid", {})).toEqual([]);
  });

  it("does not crash on legacy RAID items with undefined stakeholderIds", async () => {
    const legacy = makeRaidItem({ stakeholderIds: undefined as unknown as number[] });
    const d = makeDispatcher({
      listRaid: vi.fn(() => [{ ...legacy, stakeholderIds: legacy.stakeholderIds ?? [] }]),
    });
    const [item] = (await runTool(d, "list_raid", {})) as { stakeholderIds: number[] }[];
    expect(item.stakeholderIds).toEqual([]);
  });
});

describe("runTool — list_changes", () => {
  it("returns projected change summaries from the dispatcher", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "list_changes", {});
    expect(d.listChanges).toHaveBeenCalledOnce();
    expect(result).toEqual([
      {
        id: 20,
        title: "Scope expansion",
        status: "Proposed",
        impact: "High",
        decisionDate: undefined,
        stakeholderIds: [3],
      },
    ]);
  });

  it("does not crash on legacy change items with undefined stakeholderIds", async () => {
    const legacy = makeChangeItem({ stakeholderIds: undefined as unknown as number[] });
    const d = makeDispatcher({
      listChanges: vi.fn(() => [{ ...legacy, stakeholderIds: legacy.stakeholderIds ?? [] }]),
    });
    const [item] = (await runTool(d, "list_changes", {})) as { stakeholderIds: number[] }[];
    expect(item.stakeholderIds).toEqual([]);
  });
});

describe("runTool — list_milestones", () => {
  it("returns projected milestone summaries from the dispatcher", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "list_milestones", {});
    expect(d.listMilestones).toHaveBeenCalledOnce();
    expect(result).toEqual([
      {
        id: 30,
        name: "Phase 1 complete",
        date: "2026-07-01",
        achievedDate: undefined,
      },
    ]);
  });

  it("includes achievedDate when signed off", async () => {
    const achieved = makeMilestone({ achievedDate: "2026-06-28" });
    const d = makeDispatcher({
      listMilestones: vi.fn(() => [
        { id: achieved.id, name: achieved.name, date: achieved.date, achievedDate: achieved.achievedDate },
      ]),
    });
    const [item] = (await runTool(d, "list_milestones", {})) as { achievedDate?: string }[];
    expect(item.achievedDate).toBe("2026-06-28");
  });
});
