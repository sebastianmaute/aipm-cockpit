// src/app/use-task-row-handlers.test.ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskRowHandlers } from "./use-task-row-handlers";
import { loadJiraApi } from "./use-jira-sync";
import type { Task, Resource } from "./types";

vi.mock("./workspace-tab-context", () => ({
  useWorkspaceTab: vi.fn(() => ({
    activeTab: "chat" as const,
    setActiveTab: vi.fn(),
    isPopout: false,
  })),
}));

vi.mock("./use-jira-sync", () => ({ loadJiraApi: vi.fn() }));

/** A mutable Settings.jira that satisfies onPushToJira's prerequisites. */
function jiraEnabled() {
  return {
    enabled: true,
    siteUrl: "https://x.atlassian.net",
    email: "a@b.c",
    apiToken: "tok",
    projectKey: "LOP",
    issueTypes: ["Task"],
  } as unknown as Parameters<typeof useTaskRowHandlers>[0]["settings"]["jira"];
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Test task",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    ...overrides,
  };
}

function makeArgs(
  overrides: Partial<Parameters<typeof useTaskRowHandlers>[0]> = {},
) {
  const tasksRef = { current: [makeTask()] };
  return {
    tasksRef,
    settings: {
      jira: {
        enabled: false,
        siteUrl: "",
        email: "",
        apiToken: "",
        projectKey: "",
        issueTypes: [],
      },
    } as unknown as Parameters<typeof useTaskRowHandlers>[0]["settings"],
    lang: "en-US" as const,
    today: "2030-01-01",
    editingId: null,
    showToast: vi.fn() as (kind: "info" | "error", text: string) => void,
    openEditModal: vi.fn() as (task: Task) => void,
    setTasks: vi.fn() as Parameters<typeof useTaskRowHandlers>[0]["setTasks"],
    setRaidFilterTaskId: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["setRaidFilterTaskId"],
    setWorkspaceCollapsed: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["setWorkspaceCollapsed"],
    deselectIdRef: { current: vi.fn() as (id: number) => void },
    handleCancelEdit: vi.fn(),
    logActivity: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["logActivity"],
    capture: vi.fn() as Parameters<typeof useTaskRowHandlers>[0]["capture"],
    ...overrides,
  };
}

describe("useTaskRowHandlers", () => {
  it("returns empty pushingIds initially", () => {
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs()));
    expect(result.current.pushingIds.size).toBe(0);
  });

  it("onDelete calls setTasks when user confirms", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onDelete(1));
    expect(setTasks).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("onEdit calls openEditModal with the task", () => {
    const openEditModal = vi.fn();
    const task = makeTask();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ openEditModal })),
    );
    act(() => result.current.onEdit(task));
    expect(openEditModal).toHaveBeenCalledWith(task);
  });

  it("onStatusChange no-ops for a Jira-synced task", () => {
    const setTasks = vi.fn();
    const synced = makeTask({ id: 1, jiraKey: "LOP-1", status: "In Progress" });
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onStatusChange(1, "Done"));
    // The produced list leaves the synced row's status unchanged.
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    expect(updater([synced])[0].status).toBe("In Progress");
  });

  it("onStatusChange updates a non-synced task (gate is conditional)", () => {
    const setTasks = vi.fn();
    const open = makeTask({ id: 1, status: "To Do" });
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onStatusChange(1, "In Progress"));
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    expect(updater([open])[0].status).toBe("In Progress");
  });

  it("captures a field-edit undo entry for a status change (status + completedDate)", () => {
    const captureFieldEdit = vi.fn();
    const setTasks = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "To Do", completedDate: undefined })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() => result.current.onStatusChange(1, "Done"));
    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "task.updated",
        id: 1,
        before: { status: "To Do", completedDate: undefined },
      }),
    );
    const opts = captureFieldEdit.mock.calls[0][0] as {
      after: { status: string; completedDate: string };
    };
    expect(opts.after.status).toBe("Done");
    expect(opts.after.completedDate).toBeTruthy();
  });

  it("does not capture a field-edit undo entry for a Jira-synced task's status", () => {
    const captureFieldEdit = vi.fn();
    const setTasks = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, jiraKey: "LOP-1", status: "In Progress" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() => result.current.onStatusChange(1, "Done"));
    expect(captureFieldEdit).not.toHaveBeenCalled();
  });

  it("does not capture a field-edit undo entry when the status is unchanged (no-op)", () => {
    const captureFieldEdit = vi.fn();
    const setTasks = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "To Do" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() => result.current.onStatusChange(1, "To Do"));
    expect(captureFieldEdit).not.toHaveBeenCalled();
  });

  it("handleClearRaidTaskFilter calls setRaidFilterTaskId with null", () => {
    const setRaidFilterTaskId = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setRaidFilterTaskId })),
    );
    act(() => result.current.handleClearRaidTaskFilter());
    expect(setRaidFilterTaskId).toHaveBeenCalledWith(null);
  });
});

describe("useTaskRowHandlers — onSendInquiry", () => {
  let hrefValue = "";
  let originalLocation: Location;
  beforeEach(() => {
    hrefValue = "";
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get href() {
          return hrefValue;
        },
        set href(v: string) {
          hrefValue = v;
        },
      },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
  });

  it("opens a mailto and increments inquiriesSent when an email is on file", () => {
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", inquiriesSent: 2 });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onSendInquiry(task));
    expect(hrefValue.startsWith("mailto:")).toBe(true);
    const updater = setTasks.mock.calls.at(-1)![0] as (p: Task[]) => Task[];
    expect(updater([task])[0].inquiriesSent).toBe(3);
  });

  it("sends to the linked resource's LIVE email, not a stale cached assigneeEmail", () => {
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "old@corp.com", resourceId: 7 });
    const resourcesById = new Map<number, Resource>([
      [7, { id: 7, firstName: "Live", lastName: "Person", roleId: null, utilizationMode: "percent", utilization: {}, email: "current@corp.com" } as Resource],
    ]);
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, resourcesById })));
    act(() => result.current.onSendInquiry(task));
    expect(hrefValue).toContain(encodeURIComponent("current@corp.com"));
    expect(hrefValue).not.toContain(encodeURIComponent("old@corp.com"));
  });

  it("aborts silently when the email prompt is cancelled", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "", assignee: "No Email Person" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onSendInquiry(task));
    expect(setTasks).not.toHaveBeenCalled();
    expect(hrefValue).toBe("");
  });

  it("alerts and aborts on an invalid prompted email", () => {
    vi.spyOn(window, "prompt").mockReturnValue("not-an-email");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "", assignee: "No Email Person" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onSendInquiry(task));
    expect(alertSpy).toHaveBeenCalled();
    expect(setTasks).not.toHaveBeenCalled();
  });

  it("persists a valid prompted email and proceeds to send", () => {
    vi.spyOn(window, "prompt").mockReturnValue("bob@example.com");
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "", assignee: "Bob" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onSendInquiry(task));
    // First updater persists the prompted email onto the row.
    const persist = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    expect(persist([task])[0].assigneeEmail).toBe("bob@example.com");
    expect(hrefValue.startsWith("mailto:")).toBe(true);
  });

  it("uses the default template body (rendered, plain-texted) when resolveTemplateBody returns one", () => {
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", taskName: "Ship It" });
    const resolveTemplateBody = vi.fn(() => "<p>Hi {{taskName}}</p>");
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, resolveTemplateBody })));
    act(() => result.current.onSendInquiry(task));
    const decoded = decodeURIComponent(hrefValue);
    expect(decoded).toContain("Hi Ship It");
    expect(resolveTemplateBody).toHaveBeenCalledWith("status-inquiry");
  });

  it("falls back to the i18n body when no template is resolved", () => {
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", taskName: "Ship It" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, resolveTemplateBody: () => null })));
    act(() => result.current.onSendInquiry(task));
    expect(hrefValue.startsWith("mailto:")).toBe(true);
    // i18n fallback body does NOT contain the raw template markup
    expect(decodeURIComponent(hrefValue)).not.toContain("{{taskName}}");
  });

  it("delegates to sendCommTemplate when provided", () => {
    const sendCommTemplate = vi.fn();
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", taskName: "Ship" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, sendCommTemplate })));
    act(() => result.current.onSendInquiry(task));
    expect(sendCommTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: "alice@example.com" }));
    expect(hrefValue).toBe(""); // did NOT use mailto directly
  });
});

describe("useTaskRowHandlers — onPushToJira", () => {
  const loadJiraApiMock = vi.mocked(loadJiraApi);
  afterEach(() => vi.restoreAllMocks());

  function apiStub(createIssue: ReturnType<typeof vi.fn>) {
    loadJiraApiMock.mockResolvedValue({
      createIssue,
      taskFieldsToJiraFields: vi.fn(() => ({})),
      formatJiraError: vi.fn((e: unknown) => String(e)),
    } as unknown as Awaited<ReturnType<typeof loadJiraApi>>);
  }

  it("rejects when Jira is disabled (error toast, returns false)", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ showToast })));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("no-ops a task that already has a jiraKey (no API call, false)", async () => {
    const createIssue = vi.fn();
    apiStub(createIssue);
    const tasksRef = { current: [makeTask({ id: 1, jiraKey: "LOP-9" })] };
    const settings = { jira: jiraEnabled() } as Parameters<typeof useTaskRowHandlers>[0]["settings"];
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ tasksRef, settings })));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(false);
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("on success stamps jiraKey/lastSyncedAt, clears localModifiedAt, toasts info, returns true", async () => {
    const createIssue = vi.fn(async () => ({ key: "LOP-42" }));
    apiStub(createIssue);
    const setTasks = vi.fn();
    const showToast = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, localModifiedAt: "2030-01-02T00:00:00Z" })] };
    const settings = { jira: jiraEnabled() } as Parameters<typeof useTaskRowHandlers>[0]["settings"];
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, settings, setTasks, showToast })),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(true);
    const pushed = (setTasks.mock.calls.at(-1)![0] as Task[]).find((t) => t.id === 1)!;
    expect(pushed.jiraKey).toBe("LOP-42");
    expect(pushed.lastSyncedAt).toBeTruthy();
    expect(pushed.localModifiedAt).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("reports an error and returns false when createIssue rejects", async () => {
    apiStub(vi.fn(async () => { throw new Error("boom"); }));
    const showToast = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1 })] };
    const settings = { jira: jiraEnabled() } as Parameters<typeof useTaskRowHandlers>[0]["settings"];
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, settings, showToast })),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("reports an error when the created issue has no key", async () => {
    apiStub(vi.fn(async () => ({})));
    const showToast = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1 })] };
    const settings = { jira: jiraEnabled() } as Parameters<typeof useTaskRowHandlers>[0]["settings"];
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, settings, showToast })),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });
});

describe("useTaskRowHandlers — onDelete & navigation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does nothing when the delete confirmation is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const setTasks = vi.fn();
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onDelete(1));
    expect(setTasks).not.toHaveBeenCalled();
  });

  it("removes the task, strips it from other tasks' dependencies, deselects and logs", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const setTasks = vi.fn();
    const logActivity = vi.fn();
    const deselect = vi.fn();
    const target = makeTask({ id: 1, taskName: "Doomed" });
    const dependent = makeTask({ id: 2, dependencies: [{ taskId: 1, type: "FS" }] as Task["dependencies"] });
    const tasksRef = { current: [target, dependent] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, logActivity, deselectIdRef: { current: deselect } })),
    );
    act(() => result.current.onDelete(1));
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    const next = updater([target, dependent]);
    expect(next.map((t) => t.id)).toEqual([2]);
    expect(next[0].dependencies).toEqual([]);
    expect(deselect).toHaveBeenCalledWith(1);
    expect(logActivity).toHaveBeenCalledWith("task.deleted", 1, "Doomed");
  });

  it("captures the deleted task PLUS dependents whose dependency was stripped (undo)", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const capture = vi.fn();
    const target = makeTask({ id: 1, taskName: "Doomed" });
    const dependent = makeTask({ id: 2, dependencies: [{ taskId: 1, type: "FS" }] as Task["dependencies"] });
    const tasksRef = { current: [target, dependent] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks: vi.fn(), capture })),
    );
    act(() => result.current.onDelete(1));
    expect(capture).toHaveBeenCalledTimes(1);
    const opts = capture.mock.calls[0][0] as { kind: string; removed: Task[]; edited: Task[] };
    expect(opts.kind).toBe("task.deleted");
    expect(opts.removed.map((t) => t.id)).toEqual([1]);
    expect(opts.edited.map((t) => t.id)).toEqual([2]);
  });

  it("onJumpToRaid sets the filter, switches to the raid tab, and uncollapses", () => {
    const setRaidFilterTaskId = vi.fn();
    const setWorkspaceCollapsed = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setRaidFilterTaskId, setWorkspaceCollapsed })),
    );
    act(() => result.current.onJumpToRaid(7));
    expect(setRaidFilterTaskId).toHaveBeenCalledWith(7);
    // setWorkspaceCollapsed receives an updater that forces false when collapsed.
    const updater = setWorkspaceCollapsed.mock.calls[0][0] as (p: boolean) => boolean;
    expect(updater(true)).toBe(false);
  });

  it("handleJumpToTaskFromRaid opens the editor only for a known task", () => {
    const openEditModal = vi.fn();
    const tasksRef = { current: [makeTask({ id: 5 })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, openEditModal })),
    );
    act(() => result.current.handleJumpToTaskFromRaid(999));
    expect(openEditModal).not.toHaveBeenCalled();
    act(() => result.current.handleJumpToTaskFromRaid(5));
    expect(openEditModal).toHaveBeenCalledWith(tasksRef.current[0]);
  });
});
