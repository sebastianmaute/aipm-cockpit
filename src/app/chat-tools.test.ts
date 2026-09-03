import { describe, expect, it, vi } from "vitest";
import { asTimeZoneForTests } from "./timezone";
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
import {
  type Task,
  type RaidItem,
  type ChangeItem,
  type Milestone,
  type Resource,
  type Stakeholder,
  type TaskDependency,
} from "./types";
import { entityToken } from "./ai-entity-token";
import { ACTIVITY_MAX_ENTRIES, type ActivityEntry } from "./activity-log";
import type { ActivitySummary } from "./history-search";

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
    // FULL rows, backed by the same makers the summaries above project from,
    // so a token derived here matches what the list tools describe. Ids match
    // the `update*`/`delete*` stubs (raid 10, change 20, milestone 30,
    // stakeholder 40) — a miss must return null, not a stand-in row.
    getRaidRow: vi.fn((id: number) => (id === 10 ? makeRaidItem() : null)),
    getChangeRow: vi.fn((id: number) => (id === 20 ? makeChangeItem() : null)),
    getMilestoneRow: vi.fn((id: number) => (id === 30 ? makeMilestone() : null)),
    getStakeholderRow: vi.fn((id: number) =>
      id === 40
        ? ({
            id: 40,
            name: "Jane Roe",
            category: "Sponsor",
            influence: "High",
            interest: "Low",
            raci: {},
          } as Stakeholder)
        : null,
    ),
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
    getResourceRow: vi.fn((id: number) =>
      id === 7
        ? ({
            id: 7,
            firstName: "Ada",
            lastName: "Lovelace",
            email: "ada@x.com",
            roleId: null,
            utilizationMode: "percent",
            utilization: {},
          } as Resource)
        : null,
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
      timezone: asTimeZoneForTests("UTC"),
      activitySummary: {
        total: 2,
        byActor: { user: 1, ai: 1, integration: 0, unknown: 0 },
        latestAt: "2026-06-02T08:00:00.000Z",
        days: 7,
      },
    })),
    getActivityLog: vi.fn(() => []),
    // ★ Defaults ENABLED so every pre-existing search_history test keeps
    //   exercising the engine; the §162 refusal tests override it to false.
    isHistorySearchEnabled: vi.fn(() => true),
    // ★ Same default-enabled reasoning for search_chats.
    isChatSearchEnabled: vi.fn(() => true),
    // Same "throw a named error" convention as listAllocations: no test using
    // this fixture drives search_chats by default, and a silent
    // `{available: false}` default would answer a forgotten override with
    // `coverage: "unavailable"` — the one value that is a lie about what was
    // searched rather than an obvious stub.
    getChatThreads: vi.fn(() => {
      throw new Error("getChatThreads not stubbed");
    }),
    getTimezone: vi.fn(() => "UTC"),
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
    // The five document methods. Same "throw a named error" convention as the
    // four above for the ones no test here drives; the routing tests below
    // override the two they exercise. Their guards live in
    // chat-tools-documents.test.ts — these exist so runTool's dispatcher type
    // is satisfied and so the routing seam itself can be pinned.
    listDocuments: vi.fn(() => {
      throw new Error("listDocuments not stubbed");
    }),
    getDocument: vi.fn(() => {
      throw new Error("getDocument not stubbed");
    }),
    createDocument: vi.fn(() => {
      throw new Error("createDocument not stubbed");
    }),
    updateDocument: vi.fn(() => {
      throw new Error("updateDocument not stubbed");
    }),
    deleteDocument: vi.fn(() => {
      throw new Error("deleteDocument not stubbed");
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

// `makeDispatcher`'s `getTask(1)` hands back a pristine `makeTask()`, so this is
// the token an honest read of task #1 yields. Every patch-shape case below has
// to carry it now that `update_task` refuses an unauthenticated write.
//
// ★ It is deliberately NOT hoisted into `makeDispatcher`: the cases that assert
//   on the patch are the ones proving the token never reaches it, and passing
//   the field explicitly is what makes that visible at the call site.
const FRESH_TASK_TOKEN = entityToken("task", makeTask());

describe("runTool — update_task / buildPatch", () => {
  it("builds a partial patch from only the provided fields", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", {
      id: 1, expectedToken: FRESH_TASK_TOKEN, notes: "hello", blockers: "wait",
    });
    expect(d.updateTask).toHaveBeenCalledWith(1, { description: "hello", blockers: "wait" });
  });

  it("coerces a non-string field value to empty string when key is present", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, expectedToken: FRESH_TASK_TOKEN, taskName: 123 });
    expect(d.updateTask).toHaveBeenCalledWith(1, { taskName: "" });
  });

  it("omits an unknown priority from the patch entirely", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, expectedToken: FRESH_TASK_TOKEN, priority: "Nope" });
    // Also the anti-leak case for the token itself: `buildPatch` is a
    // whitelist, so `expectedToken` cannot reach the stored entity.
    expect(d.updateTask).toHaveBeenCalledWith(1, {});
  });

  it("keeps a valid priority in the patch", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", { id: 1, expectedToken: FRESH_TASK_TOKEN, priority: "Low" });
    expect(d.updateTask).toHaveBeenCalledWith(1, { priority: "Low" });
  });

  it("carries a status value through in the patch", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", {
      id: 1, expectedToken: FRESH_TASK_TOKEN, status: "In Progress",
    });
    expect(d.updateTask).toHaveBeenCalledWith(1, { status: "In Progress" });
  });

  it("sanitizes group and labels in the patch", async () => {
    const d = makeDispatcher();
    await runTool(d, "update_task", {
      id: 1, expectedToken: FRESH_TASK_TOKEN, group: "  Phase 1  ", labels: ["a", "a"],
    });
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
    // ★ NO `expectedToken` HERE, ON PURPOSE. It pins the ORDER of the two
    //   guards: not-found is resolved first, so a vanished task still reports
    //   "not found" rather than the token's "changed since you read it", which
    //   would send the model re-reading a row that is gone. Add a token here
    //   and the case passes whichever order the code uses.
    await expect(runTool(d, "update_task", { id: 7 })).rejects.toThrow(
      "task #7 not found",
    );
  });
});

/** A dispatcher over a MUTABLE row, so a concurrent write actually moves the
 *  token.
 *
 *  ★★★ `makeDispatcher` CANNOT SUBSTITUTE AND THE FAILURE IS SILENT. Its
 *  `getTask` returns a pristine `makeTask()` every call and its `updateTask`
 *  stores nothing, so no write ever changes what a later read sees. A staleness
 *  test written against it can never produce a mismatch: the guard is never
 *  reached, nothing throws, and the case fails for a reason unrelated to the
 *  thing it claims to cover. */
function statefulTaskDispatcher(seed: Task): ToolDispatcher {
  let row: Task = { ...seed };
  return makeDispatcher({
    getTask: vi.fn((id: number) => (id === 1 ? { ...row } : null)),
    updateTask: vi.fn((id: number, patch: Partial<Task>) =>
      id === 1 ? (row = { ...row, ...patch }) : null,
    ),
  });
}

describe("runTool — update_task concurrency token", () => {
  it("refuses a stale write and leaves the human's value in place", async () => {
    const d = statefulTaskDispatcher(makeTask());
    // The model reads the task and derives a token from what it got back.
    const read = (await runTool(d, "get_task", { id: 1 })) as Task;
    const stale = entityToken("task", read);

    // A human edits the same task while the model is still thinking.
    d.updateTask(1, { taskName: "Renamed by a human" });

    await expect(
      runTool(d, "update_task", { id: 1, expectedToken: stale, taskName: "Renamed by the AI" }),
    ).rejects.toThrow(/changed since you read it/);

    // ★★ THE LOAD-BEARING ASSERTION. Asserting only that it threw would pass
    //    against a tool that refused AND wrote anyway — the overwrite this
    //    guard exists to stop, reported as a refusal.
    expect(d.getTask(1)?.taskName).toBe("Renamed by a human");
  });

  it("refuses an update that supplies no token at all", async () => {
    const d = statefulTaskDispatcher(makeTask());
    await expect(
      runTool(d, "update_task", { id: 1, taskName: "Renamed by the AI" }),
    ).rejects.toThrow(/expectedToken is required/);
    expect(d.getTask(1)?.taskName).toBe("Alpha");
  });

  it("accepts a write whose token is current", async () => {
    // ★★ THE CONTROL. Without it a guard hardcoded to refuse every write —
    //    `if (true) throw` — passes both cases above.
    const d = statefulTaskDispatcher(makeTask());
    const read = (await runTool(d, "get_task", { id: 1 })) as Task;

    await runTool(d, "update_task", {
      id: 1,
      expectedToken: entityToken("task", read),
      taskName: "Renamed by the AI",
    });

    expect(d.getTask(1)?.taskName).toBe("Renamed by the AI");
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

  // ★★★ activityLog must NEVER reach getSnapshot(). runTool's `get_app_state`
  //     case returns getSnapshot() VERBATIM, and the model calls that tool
  //     freely. The log IS bounded — ACTIVITY_MAX_ENTRIES (500), enforced on
  //     LOAD (sanitizeActivityLog), on WRITE (appendActivityEntry, which
  //     appendActivity delegates to) and on MERGE (mergeActivityLogs) — so do
  //     NOT read this guard as resting on an unbounded collection and delete it
  //     once you notice the cap. 500 audit entries, each carrying up to
  //     MAX_FIELD_CHANGES (12) field-level before/after diffs, is still far more
  //     than belongs in the context window on every snapshot read. The one tool
  //     that wants the log reads it through getActivityLog() instead.
  //
  //     This test exists because "completing the pattern" later is a natural,
  //     plausible edit that every other test in the suite would stay green for.
  it("keeps activityLog OFF the app-state snapshot", async () => {
    const d = makeDispatcher();
    const snapshot = (await runTool(d, "get_app_state", {})) as Record<string, unknown>;
    expect("activityLog" in snapshot).toBe(false);
  });

  // ★ The BOUNDED summary is allowed where the log is not, and the bound is the
  //   whole argument — four counts, a window and one timestamp. Pinned as an
  //   exact key set so "while we're here, carry the matching entries too" fails
  //   rather than quietly widening what every get_app_state call ships.
  it("carries the bounded activity summary through get_app_state verbatim", async () => {
    const d = makeDispatcher();
    const snapshot = (await runTool(d, "get_app_state", {})) as Record<string, unknown>;
    const summary = snapshot.activitySummary as ActivitySummary | undefined;
    expect(Object.keys(summary ?? {}).sort()).toEqual(["byActor", "days", "latestAt", "total"]);
    expect(Object.keys(summary?.byActor ?? {})).toHaveLength(4);
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
  // ★ Every entity `update_*` requires `expectedToken` as well as `id`. That
  //   is the ADVERTISED surface only — nothing rejects a call that omits it,
  //   which is why `requireToken` refuses absence on the ACCEPTED surface. The
  //   create/delete tools take no token: a create has no prior version to be
  //   stale against, and a delete of a changed row is covered by the register's
  //   own confirm step rather than by this guard.
  const expectedRequired: Record<string, string[]> = {
    create_raid_item: ["title"],
    update_raid_item: ["id", "expectedToken"],
    delete_raid_item: ["id"],
    create_change: ["title"],
    update_change: ["id", "expectedToken"],
    delete_change: ["id"],
    create_milestone: ["name", "date"],
    update_milestone: ["id", "expectedToken"],
    delete_milestone: ["id"],
    create_stakeholder: ["name"],
    update_stakeholder: ["id", "expectedToken"],
    delete_stakeholder: ["id"],
    get_resource: ["id"],
    update_resource: ["id", "expectedToken"],
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

// The routing SEAM only. The five tools' boundary guards are pinned in
// chat-tools-documents.test.ts; what cannot be tested there is that runTool
// reaches that module at all — the document names fall through runTool's switch
// to its `default` arm, which used to throw `unknown tool` for anything it did
// not recognise.
describe("runTool — document tool routing", () => {
  it("routes a document tool to the document module's dispatcher", async () => {
    const listDocuments = vi.fn(() => [
      { id: 1, title: "Status", blockCount: 2, updatedAt: "2026-08-01T08:00:00.000Z" },
    ]);
    const d = makeDispatcher({ listDocuments });
    await expect(runTool(d, "list_documents", {})).resolves.toEqual([
      { id: 1, title: "Status", blockCount: 2, updatedAt: "2026-08-01T08:00:00.000Z" },
    ]);
    expect(listDocuments).toHaveBeenCalledTimes(1);
  });

  // ★★ The guard has to be reachable THROUGH runTool, not merely present in the
  // module: routing that skipped it would still resolve this call, and a
  // non-array ops would then read as "no ops" at the dispatcher.
  it("applies the document module's guards on the way through", async () => {
    const updateDocument = vi.fn(() => ({ id: 1, title: "Status", blockCount: 1, applied: 1, rejected: [], removed: 0 }));
    const d = makeDispatcher({ updateDocument });

    await expect(runTool(d, "update_document", { id: 1, ops: "wipe it" })).rejects.toThrow(/ops/i);
    expect(updateDocument).not.toHaveBeenCalled();

    // Paired positive: the same dispatcher IS reachable through runTool, so the
    // absence assertion above is about the guard and not about dead routing.
    await expect(
      runTool(d, "update_document", { id: 1, ops: [{ op: "append", block: { type: "pageBreak" } }] }),
    ).resolves.toMatchObject({ applied: 1 });
    expect(updateDocument).toHaveBeenCalledTimes(1);
  });

  it("still throws unknown tool for a name nothing routes", async () => {
    await expect(runTool(makeDispatcher(), "burn_everything", {})).rejects.toThrow(
      /unknown tool: burn_everything/,
    );
  });
});

describe("search_history", () => {
  // Deliberately NOT already in newest-first order, so the ordering assertion
  // below is about the engine's sort and not about the fixture's own order.
  const LOG: ActivityEntry[] = [
    { id: "a", timestamp: "2026-08-10T09:00:00.000Z", kind: "task.created", args: [1, "Alpha"] },
    { id: "b", timestamp: "2026-08-12T09:00:00.000Z", kind: "task.created", args: [2, "Beta"] },
  ];

  it("is registered in TOOL_DEFS", () => {
    expect(TOOL_DEFS.some((d) => d.name === "search_history")).toBe(true);
  });

  // ★★ The description is the ONLY place the model learns how to read an empty
  //    or unattributed result, and NEITHER property is visible in the return
  //    value: a June that aged out comes back as `{events: [], truncated:
  //    false}`, and an actor-less entry looks exactly like a user-authored one.
  //    `truncated` reports what the CAPPED log held — never what the cap
  //    already dropped. A description "tightened" back to the original
  //    "audit trail of every create, update, delete, status change, AI action
  //    and integration sync" drops both cautions at once.
  // ★★★ THE ABSENCE ASSERTION IS THE POINT OF THIS TEST AND IT IS VACUOUS
  //    ALONE. The description used to claim "your OWN tool calls are not
  //    recorded in it (document writes are the sole exception)", which this
  //    test PINNED — and which stopped being true the moment the chat
  //    dispatcher started logging its own entity writes with `actor: "ai"`.
  //    So the assertion is inverted: the retired claim must stay GONE. On its
  //    own that passes against an empty description, so the actor-disclosure
  //    assertions beside it are what make the test non-vacuous — never delete
  //    one half and keep the other.
  // ★ The retention figure is derived from ACTIVITY_MAX_ENTRIES, not typed
  //   here, so a moved cap cannot leave a stale number in the prompt.
  it("discloses retention and actor, and never re-claims the closed coverage gap", () => {
    const desc = TOOL_DEFS.find((d) => d.name === "search_history")?.description ?? "";
    expect(desc).toContain(String(ACTIVITY_MAX_ENTRIES));
    expect(desc).toMatch(/aged out/i);
    // RETIRED CLAIM — the dispatcher logs its own entity writes now.
    expect(desc).not.toMatch(/own tool calls are not recorded/i);
    // POSITIVE half: the actor disclosure, without which the absence check
    // above passes on a description that says nothing at all.
    expect(desc).toMatch(/actor/i);
    expect(desc).toMatch(/never attribute an entry whose actor is absent/i);
    // The claim that started this: the description must not advertise
    // "every ... AI action" again.
    expect(desc).not.toMatch(/every create, update, delete/i);
  });

  it("returns rendered events newest-first from the dispatcher's log", async () => {
    const d = makeDispatcher({ getActivityLog: () => LOG });
    const r = (await runTool(d, "search_history", {})) as {
      events: { summary: string }[];
      truncated: boolean;
    };
    expect(r.events.map((e) => e.summary)).toEqual([
      "Task #2 created: Beta",
      "Task #1 created: Alpha",
    ]);
    expect(r.truncated).toBe(false);
  });

  it("passes the model's filters through", async () => {
    const d = makeDispatcher({ getActivityLog: () => LOG });
    const r = (await runTool(d, "search_history", { query: "beta" })) as {
      events: { summary: string }[];
    };
    expect(r.events).toHaveLength(1);
  });

  // ★ The model is untrusted input: a non-object/garbage arg must not throw.
  it("ignores malformed arguments rather than throwing", async () => {
    const d = makeDispatcher({ getActivityLog: () => [] });
    await expect(
      runTool(d, "search_history", { query: 42, kinds: "nope", limit: "ten" }),
    ).resolves.toEqual({ events: [], truncated: false });
  });

  // ★★★ §162 — THE EXECUTOR REFUSES, not just the prompt builder. The tool is
  //   reached by NAME, and toggling the setting off mid-conversation leaves
  //   prior tool_use/tool_result pairs in the re-sent history for the model to
  //   mimic, so the advertisement gate alone leaves a switched-off capability
  //   able to answer.
  it("refuses to execute when the kill switch is off", async () => {
    const d = makeDispatcher({
      getActivityLog: () => LOG,
      isHistorySearchEnabled: () => false,
    });
    await expect(runTool(d, "search_history", {})).rejects.toThrow(/switched off/i);
  });

  // ★★ THE LOAD-BEARING HALF. "It threw" is satisfied by a guard that throws
  //   for the wrong reason, or by one placed so late the log was already read.
  //   Pin that the refusal happens BEFORE the log is touched — otherwise a
  //   guard sitting after `getActivityLog()` passes the test above while doing
  //   none of the work the entry asks for.
  it("refuses WITHOUT reading the log", async () => {
    const getActivityLog = vi.fn(() => LOG);
    const d = makeDispatcher({ getActivityLog, isHistorySearchEnabled: () => false });
    await expect(runTool(d, "search_history", {})).rejects.toThrow();
    expect(getActivityLog).not.toHaveBeenCalled();
  });

  // ★ Absence is ON — the tool shipped enabled in 0.241.0, so only an explicit
  //   false disables. Pinned at the executor because the predicate it shares
  //   with `toolsFor` is the thing that must not drift.
  it("serves normally when the switch is enabled", async () => {
    const d = makeDispatcher({ getActivityLog: () => LOG, isHistorySearchEnabled: () => true });
    const r = (await runTool(d, "search_history", {})) as { events: unknown[] };
    expect(r.events).toHaveLength(2);
  });

  // ★★ PAIRED POSITIVE for the guard above, and the test that actually pins it.
  //    On an EMPTY log the case above returns `{events: [], truncated: false}`
  //    for several wrong reasons too — a guard that forwarded `"nope"` verbatim
  //    would reach `new Set("nope")`, a set of four CHARACTERS matching no kind,
  //    and still pass. With a real log that mistake returns zero events, so this
  //    is the one that distinguishes "garbage treated as absent" from "garbage
  //    treated as a filter that matches nothing".
  it("treats garbage kinds/limit as absent, not as a filter matching nothing", async () => {
    const d = makeDispatcher({ getActivityLog: () => LOG });
    const r = (await runTool(d, "search_history", { kinds: "nope", limit: "ten" })) as {
      events: { summary: string }[];
      truncated: boolean;
    };
    expect(r.events).toHaveLength(2);
    expect(r.truncated).toBe(false);
  });

  // `truncated` is what the model reads to decide whether it may claim a
  // complete answer, so it must cross the tool layer unaltered.
  it("passes the engine's truncated flag through", async () => {
    const d = makeDispatcher({ getActivityLog: () => LOG });
    const r = (await runTool(d, "search_history", { limit: 1 })) as {
      events: { summary: string }[];
      truncated: boolean;
    };
    expect(r.events.map((e) => e.summary)).toEqual(["Task #2 created: Beta"]);
    expect(r.truncated).toBe(true);
  });

  // ★★ The tool layer's own half of the timezone fix: the engine can filter in
  //    any zone it is handed, but only this proves the dispatcher's zone is
  //    what reaches it. A hardcoded "UTC" at the call site passes every engine
  //    test in history-search.test.ts and fails here.
  //    22:30Z on the 16th is 00:30 on the 17th in Berlin, so a Berlin project
  //    must answer the 17th and not the 16th, and must quote the +02:00 clock.
  it("filters and stamps in the dispatcher's timezone, not UTC", async () => {
    const log: ActivityEntry[] = [
      { id: "z", timestamp: "2026-08-16T22:30:00.000Z", kind: "task.created", args: [9, "Late"] },
    ];
    const d = makeDispatcher({
      getActivityLog: () => log,
      getTimezone: () => "Europe/Berlin",
    });
    const on = async (day: string) =>
      (await runTool(d, "search_history", { since: day, until: day })) as {
        events: { at: string }[];
      };
    expect((await on("2026-08-17")).events.map((e) => e.at)).toEqual([
      "2026-08-17T00:30:00+02:00",
    ]);
    expect((await on("2026-08-16")).events).toHaveLength(0);
  });

  // A real kind filter must still WORK — otherwise "garbage becomes undefined"
  // above is indistinguishable from "kinds is ignored entirely".
  it("honours a well-formed kinds filter", async () => {
    const d = makeDispatcher({ getActivityLog: () => LOG });
    const r = (await runTool(d, "search_history", { kinds: ["milestone.deleted"] })) as {
      events: unknown[];
    };
    expect(r.events).toHaveLength(0);
  });
});

describe("runTool — search_chats", () => {
  const THREAD = {
    id: "t1",
    projectId: "p1",
    name: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    history: [],
    display: [{ kind: "user" as const, text: "the vendor decision" }],
  };
  const LIVE = { threads: [THREAD], activeThreadId: null, available: true };

  // ★★★ THE WIRING, which `chat-search-tool.test.ts` cannot see. That file
  //   pins the executor in isolation; this one pins that the CASE hands it the
  //   dispatcher's threads and the dispatcher's ZONE. A case wired to a
  //   hardcoded "UTC" passes every isolated test and silently moves the
  //   model's day boundaries away from the `Today is …` date it reasons from.
  it("routes to the engine with the dispatcher's threads and timezone", async () => {
    const d = makeDispatcher({
      getChatThreads: () => LIVE,
      getTimezone: () => "Europe/Berlin",
    });
    const r = (await runTool(d, "search_chats", {})) as {
      hits: { updatedAt: string }[];
      coverage: string;
    };
    expect(r.hits).toHaveLength(1);
    expect(r.coverage).toBe("turso");
    expect(r.hits[0].updatedAt).toContain("+02:00");
  });

  // ★★★ THE PREDICATE, not merely a refusal. `isHistorySearchEnabled` is left
  //   ON, so a case that copy-pasted the neighbouring guard would serve here
  //   and this test is the only thing that would notice — the two switches are
  //   separate settings, and reading the wrong one advertises off while
  //   serving on.
  it("refuses on its OWN kill switch, not the history one", async () => {
    // ★ No `getChatThreads` not-called assertion, deliberately, and the
    //   asymmetry with search_history's is real: `runChatSearch` takes
    //   `enabled` as an argument, so the case evaluates every argument before
    //   the guard can run. That is affordable here and is not there — the
    //   registry read is a module-slot pointer, while `getActivityLog()`
    //   materialises up to 500 audit entries. Asserting it would pin a
    //   property this wiring does not have.
    const d = makeDispatcher({
      getChatThreads: () => LIVE,
      isChatSearchEnabled: () => false,
      isHistorySearchEnabled: () => true,
    });
    await expect(runTool(d, "search_chats", {})).rejects.toThrow(/switched off/i);
  });
});
