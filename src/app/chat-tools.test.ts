import { describe, expect, it, vi } from "vitest";
import {
  runTool,
  TOOL_DEFS,
  CALENDAR_SUMMARY_KEYS,
  toKnowledgeSummary,
  toCalendarEventSummary,
  toBudgetBucketSummary,
  type ToolDispatcher,
  type Filters,
} from "./chat-tools";
import { type Task, type RaidItem, type ChangeItem, type Milestone, type TaskDependency } from "./types";

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
    listStakeholders: vi.fn(() => [
      { id: 40, name: "Jane Roe", category: "Sponsor", influence: "High", interest: "Low" },
    ]),
    createRaid: vi.fn((input) => ({
      id: 11, category: "R", title: "T", status: "Open", stakeholderIds: [], ...(input as object),
    })),
    updateRaid: vi.fn((id: number) =>
      id === 10 ? { id: 10, category: "R", title: "T", status: "Open", stakeholderIds: [] } : null,
    ),
    deleteRaid: vi.fn((id: number) => id === 10),
    createChange: vi.fn((input) => ({
      id: 21, title: "C", status: "Proposed", stakeholderIds: [], ...(input as object),
    })),
    updateChange: vi.fn((id: number) =>
      id === 20 ? { id: 20, title: "C", status: "Proposed", stakeholderIds: [] } : null,
    ),
    deleteChange: vi.fn((id: number) => id === 20),
    createMilestone: vi.fn((input) => ({
      id: 31, name: "M", date: "2026-07-01", ...(input as object),
    })),
    updateMilestone: vi.fn((id: number) =>
      id === 30 ? { id: 30, name: "M", date: "2026-07-01" } : null,
    ),
    deleteMilestone: vi.fn((id: number) => id === 30),
    createStakeholder: vi.fn((input) => ({
      id: 41, name: "S", category: "Other", influence: "Medium", interest: "Medium", ...(input as object),
    })),
    updateStakeholder: vi.fn((id: number) =>
      id === 40 ? { id: 40, name: "S", category: "Other", influence: "Medium", interest: "Medium" } : null,
    ),
    deleteStakeholder: vi.fn((id: number) => id === 40),
    updateSettings: vi.fn((patch) => ({ ...(patch as Record<string, unknown>) })),
    listResources: vi.fn(() => [
      { id: 7, firstName: "Ada", lastName: "Lovelace", email: "ada@x.com" },
    ]),
    createResource: vi.fn((input) => ({
      id: 8, firstName: "R", lastName: "", ...(input as object),
    })),
    getResource: vi.fn((id: number) =>
      id === 7 ? { id: 7, firstName: "Ada", lastName: "Lovelace", email: "ada@x.com" } : null,
    ),
    updateResource: vi.fn((id: number, patch) =>
      id === 7 ? { id: 7, firstName: "Ada", lastName: "Lovelace", ...(patch as object) } : null,
    ),
    deleteResource: vi.fn((id: number) => id === 7),
    setTaskDependencies: vi.fn((id: number, raw) =>
      id === 1 ? { id, dependencies: (raw as TaskDependency[]) ?? [], rejected: [], removed: [] } : null,
    ),
    getSnapshot: vi.fn(() => ({
      today: "2026-06-02",
      language: "en-US" as const,
      holidayCountries: ["DE"],
      storageKind: "browser",
      taskCount: 1,
      mode: "advanced" as const,
      enabledModules: [] as import("./feature-modules").FeatureModuleId[],
      currentView: "chat" as import("./nav-config").AppView,
    })),
    getDashboardSnapshot: vi.fn(
      () =>
        ({
          today: "2026-06-02",
          budget: null,
        }) as unknown as ReturnType<ToolDispatcher["getDashboardSnapshot"]>,
    ),
    // None of the tests using this fixture exercise list_allocations; throw a
    // named error (rather than a fake object) so a future test that reuses
    // this fixture and forgets to override it fails legibly.
    listAllocations: vi.fn(() => {
      throw new Error("listAllocations not stubbed");
    }),
    // Same "throw a named error" convention — none of the tests using this
    // fixture exercise these three; a future test that reuses it and forgets
    // to override one fails legibly instead of returning a silent [].
    listKnowledgeItems: vi.fn(() => {
      throw new Error("listKnowledgeItems not stubbed");
    }),
    listCalendarEvents: vi.fn(() => {
      throw new Error("listCalendarEvents not stubbed");
    }),
    listBudgetBuckets: vi.fn(() => {
      throw new Error("listBudgetBuckets not stubbed");
    }),
    ...over,
  };
}

describe("runTool — update_settings", () => {
  it("routes a recognized settings patch and returns the applied fields", async () => {
    const d = makeDispatcher();
    const patch = { dashboardDensity: "compact", showViewHints: false };
    const result = await runTool(d, "update_settings", patch);
    expect(d.updateSettings).toHaveBeenCalledWith(patch);
    expect(result).toEqual({ applied: patch });
  });

  it("throws when no recognized settings field was applied", async () => {
    const d = makeDispatcher({ updateSettings: vi.fn(() => ({})) });
    await expect(runTool(d, "update_settings", { bogus: 1 })).rejects.toThrow(
      "no recognized settings fields to update",
    );
  });

  it("routes a hideExternalTasks patch and returns the applied field", async () => {
    const d = makeDispatcher();
    const patch = { hideExternalTasks: true };
    const result = await runTool(d, "update_settings", patch);
    expect(d.updateSettings).toHaveBeenCalledWith(patch);
    expect(result).toEqual({ applied: patch });
  });

  it("still rejects a payload with no recognized field (e.g. a secret-adjacent one)", async () => {
    const d = makeDispatcher({ updateSettings: vi.fn(() => ({})) });
    await expect(runTool(d, "update_settings", { apiKey: "sk-ant-nope" })).rejects.toThrow(
      "no recognized settings fields to update",
    );
  });
});

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
      status: undefined,
      blockers: undefined,
      notes: undefined,
      group: undefined,
      labels: undefined,
    });
  });

  it("passes a supplied status through to createTask", async () => {
    const d = makeDispatcher();
    await runTool(d, "create_task", {
      taskName: "Beta",
      assignee: "Bob",
      dueDate: "2026-07-01",
      status: "Done",
    });
    const arg = (d.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.status).toBe("Done");
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
    expect(d.updateTask).toHaveBeenCalledWith(1, { description: "hello", blockers: "wait" });
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

  it("carries a status value through in the patch", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, status: "In Progress" });
    expect(d.updateTask).toHaveBeenCalledWith(1, { status: "In Progress" });
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

  it("list_knowledge_items, list_calendar_events, list_budget_buckets appear in TOOL_DEFS", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).toContain("list_knowledge_items");
    expect(names).toContain("list_calendar_events");
    expect(names).toContain("list_budget_buckets");
  });

  it("each new tool has an empty-object input_schema (read-only, no params)", () => {
    for (const toolName of [
      "list_raid",
      "list_changes",
      "list_milestones",
      "list_knowledge_items",
      "list_calendar_events",
      "list_budget_buckets",
    ]) {
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

describe("runTool — list_stakeholders", () => {
  it("returns stakeholder summaries from the dispatcher", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "list_stakeholders", {});
    expect(d.listStakeholders).toHaveBeenCalledOnce();
    expect(result).toEqual([
      { id: 40, name: "Jane Roe", category: "Sponsor", influence: "High", interest: "Low" },
    ]);
  });
});

describe("TOOL_DEFS — write tools are registered with required fields", () => {
  const expectedRequired: Record<string, string[]> = {
    create_raid_item: ["title"],
    update_raid_item: ["id"],
    delete_raid_item: ["id"],
    create_change: ["title"],
    update_change: ["id"],
    delete_change: ["id"],
    create_milestone: ["name", "date"],
    update_milestone: ["id"],
    delete_milestone: ["id"],
    create_stakeholder: ["name"],
    update_stakeholder: ["id"],
    delete_stakeholder: ["id"],
    get_resource: ["id"],
    update_resource: ["id"],
    delete_resource: ["id"],
  };

  it("registers every write tool plus list_stakeholders", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    for (const name of [...Object.keys(expectedRequired), "list_stakeholders"]) {
      expect(names).toContain(name);
    }
  });

  it("declares the right required fields per write tool", () => {
    for (const [name, required] of Object.entries(expectedRequired)) {
      const def = TOOL_DEFS.find((t) => t.name === name);
      expect(def, name).toBeDefined();
      expect((def!.input_schema as { required?: string[] }).required).toEqual(required);
    }
  });
});

describe("runTool — RAID write tools", () => {
  it("create_raid_item forwards input and returns the summary", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "create_raid_item", { title: "New risk", category: "R" });
    expect(d.createRaid).toHaveBeenCalledWith({ title: "New risk", category: "R" });
    expect(result).toMatchObject({ id: 11, title: "New risk" });
  });

  it("update_raid_item strips id from the patch and forwards the rest", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_raid_item", { id: 10, severity: "Critical" });
    expect(d.updateRaid).toHaveBeenCalledWith(10, { severity: "Critical" });
  });

  it("update_raid_item throws when the item is not found", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "update_raid_item", { id: 99 })).rejects.toThrow(
      "RAID item #99 not found",
    );
  });

  it("delete_raid_item echoes the deleted id and throws when missing", async () => {
    const d = makeDispatcher();
    expect(await runTool(d, "delete_raid_item", { id: 10 })).toEqual({ deleted: 10 });
    await expect(runTool(d, "delete_raid_item", { id: 99 })).rejects.toThrow(
      "RAID item #99 not found",
    );
  });

  it("update_raid_item throws on a non-numeric id", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "update_raid_item", { id: "x" })).rejects.toThrow(
      "id must be a number",
    );
    expect(d.updateRaid).not.toHaveBeenCalled();
  });
});

describe("runTool — change/milestone/stakeholder write tools", () => {
  it("create_change forwards input and returns the summary", async () => {
    const d = makeDispatcher();
    const result = await runTool(d, "create_change", { title: "Scope creep", type: "Scope" });
    expect(d.createChange).toHaveBeenCalledWith({ title: "Scope creep", type: "Scope" });
    expect(result).toMatchObject({ id: 21 });
  });

  it("update_change strips id and delete_change echoes id", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_change", { id: 20, status: "Approved" });
    expect(d.updateChange).toHaveBeenCalledWith(20, { status: "Approved" });
    expect(await runTool(d, "delete_change", { id: 20 })).toEqual({ deleted: 20 });
  });

  it("create_milestone forwards input; update/delete route by id", async () => {
    const d = makeDispatcher();
    await runTool(d, "create_milestone", { name: "GA", date: "2026-09-01" });
    expect(d.createMilestone).toHaveBeenCalledWith({ name: "GA", date: "2026-09-01" });
    await runTool(d, "update_milestone", { id: 30, achievedDate: "2026-09-02" });
    expect(d.updateMilestone).toHaveBeenCalledWith(30, { achievedDate: "2026-09-02" });
    expect(await runTool(d, "delete_milestone", { id: 30 })).toEqual({ deleted: 30 });
  });

  it("create_stakeholder forwards input; update/delete route by id", async () => {
    const d = makeDispatcher();
    await runTool(d, "create_stakeholder", { name: "Acme Corp", category: "Vendor" });
    expect(d.createStakeholder).toHaveBeenCalledWith({ name: "Acme Corp", category: "Vendor" });
    await runTool(d, "update_stakeholder", { id: 40, influence: "Low" });
    expect(d.updateStakeholder).toHaveBeenCalledWith(40, { influence: "Low" });
    expect(await runTool(d, "delete_stakeholder", { id: 40 })).toEqual({ deleted: 40 });
  });

  it("throws when updating a missing change/milestone/stakeholder", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "update_change", { id: 99 })).rejects.toThrow("change #99 not found");
    await expect(runTool(d, "update_milestone", { id: 99 })).rejects.toThrow("milestone #99 not found");
    await expect(runTool(d, "update_stakeholder", { id: 99 })).rejects.toThrow("stakeholder #99 not found");
  });

  it("get_resource fetches by id; update strips id; delete echoes id", async () => {
    const d = makeDispatcher();
    expect(await runTool(d, "get_resource", { id: 7 })).toMatchObject({ id: 7, firstName: "Ada" });
    await runTool(d, "update_resource", { id: 7, title: "Lead" });
    expect(d.updateResource).toHaveBeenCalledWith(7, { title: "Lead" });
    expect(await runTool(d, "delete_resource", { id: 7 })).toEqual({ deleted: 7 });
  });

  it("throws when fetching/updating/deleting a missing resource", async () => {
    const d = makeDispatcher();
    await expect(runTool(d, "get_resource", { id: 99 })).rejects.toThrow("resource #99 not found");
    await expect(runTool(d, "update_resource", { id: 99 })).rejects.toThrow("resource #99 not found");
    await expect(runTool(d, "delete_resource", { id: 99 })).rejects.toThrow("resource #99 not found");
  });
});

describe("set_task_dependencies", () => {
  it("passes the id and the raw list to the dispatcher", async () => {
    const calls: unknown[] = [];
    const d = {
      setTaskDependencies: (id: number, raw: unknown) => {
        calls.push([id, raw]);
        return { id, dependencies: [], rejected: [] };
      },
    } as unknown as ToolDispatcher;

    await runTool(d, "set_task_dependencies", {
      id: 7,
      dependencies: [{ taskId: 3, type: "FS" }],
    });

    expect(calls).toEqual([[7, [{ taskId: 3, type: "FS" }]]]);
  });

  it("throws when the task is missing", async () => {
    const d = { setTaskDependencies: () => null } as unknown as ToolDispatcher;

    await expect(runTool(d, "set_task_dependencies", { id: 9, dependencies: [] })).rejects.toThrow(
      "#9 not found",
    );
  });

  it("throws when id is not a number", async () => {
    const d = { setTaskDependencies: () => null } as unknown as ToolDispatcher;

    await expect(
      runTool(d, "set_task_dependencies", { dependencies: [] }),
    ).rejects.toThrow("id must be a number");
  });

  it("rejects a non-array dependencies instead of silently clearing the graph", async () => {
    // A non-array `dependencies` (missing field, a stray string, ...) is
    // byte-identical to a legitimate "clear all links" once it reaches the
    // dispatcher — malformed model output must never wipe a task's
    // dependency graph with zero visible rejection. The dispatcher must
    // never even be called.
    const setTaskDependencies = vi.fn();
    const d = { setTaskDependencies } as unknown as ToolDispatcher;

    await expect(
      runTool(d, "set_task_dependencies", { id: 7, dependencies: "FS on task 12" }),
    ).rejects.toThrow("dependencies must be an array");
    await expect(
      runTool(d, "set_task_dependencies", { id: 7 }),
    ).rejects.toThrow("dependencies must be an array");
    expect(setTaskDependencies).not.toHaveBeenCalled();
  });

  it("still clears every link for a real empty array", async () => {
    const d = {
      setTaskDependencies: (id: number, raw: unknown) => ({ id, dependencies: raw, rejected: [] }),
    } as unknown as ToolDispatcher;

    await expect(runTool(d, "set_task_dependencies", { id: 7, dependencies: [] })).resolves.toEqual({
      id: 7,
      dependencies: [],
      rejected: [],
    });
  });
});

describe("get_dashboard_snapshot", () => {
  it("returns the dispatcher's snapshot verbatim", async () => {
    const snapshot = { today: "2026-07-25", budget: null } as unknown as ReturnType<
      ToolDispatcher["getDashboardSnapshot"]
    >;
    const d = { getDashboardSnapshot: () => snapshot } as unknown as ToolDispatcher;

    await expect(runTool(d, "get_dashboard_snapshot", {})).resolves.toBe(snapshot);
  });
});

describe("list_allocations", () => {
  it("returns the dispatcher's allocations snapshot verbatim", async () => {
    const snapshot = {
      planStartDate: "2026-08-01",
      planEndDate: "2026-09-30",
      granularity: "month",
      periods: ["2026-08", "2026-09"],
      resources: [],
      truncated: false,
    } as unknown as ReturnType<ToolDispatcher["listAllocations"]>;
    const d = { listAllocations: () => snapshot } as unknown as ToolDispatcher;

    await expect(runTool(d, "list_allocations", {})).resolves.toBe(snapshot);
  });
});

// NOTE: the plan this test block came from guessed field names (KnowledgeItem
// title/description, BudgetBucket label/roleId/periods) that don't exist on
// the real types — see chat-tools.ts for what's actually there. Verified via
// document-link.ts (KnowledgeItem = KnowledgeLink & {taskIds?}, no description
// field at all — it's a link, not a document with a summary) and types.ts
// (BudgetBucket.name, .allocations: BucketAllocation[] with roleId/budgetHours
// per role, not a flat roleId/periods pair). These tests assert the REAL shape.
describe("read-tool summary mappers", () => {
  it("maps a knowledge item to id, name, url, link kind and linked task ids", () => {
    const summary = toKnowledgeSummary({
      id: "dl-1",
      name: "Charter",
      url: "https://example.com/charter",
      kind: "file",
      linkKind: "confluence",
      taskIds: [5],
    });
    expect(summary).toEqual({
      id: "dl-1",
      name: "Charter",
      url: "https://example.com/charter",
      linkKind: "confluence",
      taskIds: [5],
    });
  });

  it("defaults a knowledge item's link kind to document and task ids to empty", () => {
    const summary = toKnowledgeSummary({
      id: "dl-2",
      name: "Spec",
      url: "https://example.com/spec",
      kind: "file",
    });
    expect(summary.linkKind).toBe("document");
    expect(summary.taskIds).toEqual([]);
  });

  it("returns a calendar event's series definition rather than an expansion", () => {
    const summary = toCalendarEventSummary({
      id: 7,
      title: "Weekly sync",
      startDate: "2026-02-02",
      startTime: "09:00",
      durationMinutes: 30,
      recurrence: { freq: "weekly", interval: 1 },
    });
    expect(summary.recurrence).toEqual({ freq: "weekly", interval: 1 });
    // ★★ Assert NO key outside the summary's own contract, rather than probing
    // for a field named `occurrences`. `occurrences` has never existed on this
    // type, so `Array.isArray(summary.occurrences)` was `Array.isArray(undefined)`
    // — false unconditionally, green even if the mapper expanded the series into
    // a field called anything else. This catches an expansion under ANY name.
    const ALLOWED_KEYS = new Set<string>(CALENDAR_SUMMARY_KEYS);
    expect(Object.keys(summary).filter((k) => !ALLOWED_KEYS.has(k))).toEqual([]);
    expect(summary.attendeeResourceIds).toEqual([]);
    expect(summary.exceptions).toEqual([]);
  });

  it("passes a calendar event's recurrence exceptions through verbatim", () => {
    const summary = toCalendarEventSummary({
      id: 8,
      title: "Weekly sync",
      startDate: "2026-02-02",
      startTime: "09:00",
      durationMinutes: 30,
      recurrence: { freq: "weekly", interval: 1 },
      exceptions: [
        { date: "2026-02-09", kind: "skip" },
        { date: "2026-02-16", kind: "move", toDate: "2026-02-17", toTime: "10:00" },
      ],
    });
    expect(summary.exceptions).toEqual([
      { date: "2026-02-09", kind: "skip" },
      { date: "2026-02-16", kind: "move", toDate: "2026-02-17", toTime: "10:00" },
    ]);
  });

  it("maps a budget bucket to id, name and its per-role budget hours", () => {
    // No `as never`: a complete, REAL BudgetBucket. The cast disabled all
    // structural checking, so a fixture drifting from the type (a renamed key,
    // a newly-required field) would only surface as a runtime assertion, if at
    // all. Typed properly, tsc catches the drift.
    const summary = toBudgetBucketSummary({
      id: 3,
      name: "Delivery",
      type: "tm",
      currency: "EUR",
      status: "open",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      allocations: [
        { roleId: 2, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} },
      ],
    });
    expect(summary.id).toBe(3);
    expect(summary.name).toBe("Delivery");
    expect(summary.allocations).toEqual([{ roleId: 2, budgetHours: { "2026-01": 40 } }]);
  });
});

describe("runTool — knowledge/calendar/budget read tools", () => {
  it("routes list_knowledge_items to the dispatcher", async () => {
    const items = [{ id: "dl-1", name: "Charter", url: "https://x", linkKind: "document" as const, taskIds: [] }];
    const d = { listKnowledgeItems: () => items } as unknown as ToolDispatcher;
    await expect(runTool(d, "list_knowledge_items", {})).resolves.toBe(items);
  });

  it("routes list_calendar_events to the dispatcher", async () => {
    const events: unknown[] = [];
    const d = { listCalendarEvents: () => events } as unknown as ToolDispatcher;
    await expect(runTool(d, "list_calendar_events", {})).resolves.toBe(events);
  });

  it("routes list_budget_buckets to the dispatcher", async () => {
    const buckets: unknown[] = [];
    const d = { listBudgetBuckets: () => buckets } as unknown as ToolDispatcher;
    await expect(runTool(d, "list_budget_buckets", {})).resolves.toBe(buckets);
  });
});

describe("document tool defs", () => {
  it("registers all five document tools", () => {
    const names = TOOL_DEFS.map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_documents",
        "get_document",
        "create_document",
        "update_document",
        "delete_document",
      ]),
    );
  });

  // ★★★ An ops array, NEVER a bare `blocks` replacement array. A
  // replace-the-whole-thing write is the set_task_dependencies failure class:
  // omission reads as deletion, and chat tool writes have NO undo capture.
  it("gives update_document an ops array, not a bare blocks array", () => {
    const def = TOOL_DEFS.find((d) => d.name === "update_document")!;
    const props = def.input_schema.properties as Record<string, unknown>;
    expect(props.ops).toBeDefined();
    expect(props.blocks).toBeUndefined();
  });

  // The six variants must match the real DocBlock union in document-model.ts —
  // this description is the model's ONLY source of truth for the shape, and a
  // block it invents is silently dropped by the sanitizer.
  it("describes exactly the six real block types", () => {
    const def = TOOL_DEFS.find((d) => d.name === "create_document")!;
    const props = def.input_schema.properties as Record<string, { items?: { properties?: Record<string, { enum?: string[] }> } }>;
    expect(props.blocks?.items?.properties?.type?.enum).toEqual([
      "heading",
      "paragraph",
      "bullets",
      "table",
      "dataSection",
      "pageBreak",
    ]);
  });
});
