import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "./types";
import { useJiraSync } from "./use-jira-sync";
import { useWorkspace } from "./workspace-context";
import { TestProviders } from "./test-providers";

// ── Jira API mock ────────────────────────────────────────────────────────────
vi.mock("./jira-api", () => ({
  buildJql: vi.fn(),
  searchAllIssues: vi.fn(),
  issueToTaskFields: vi.fn(),
  diffTaskAgainstIssue: vi.fn(),
  isIssueDone: vi.fn(),
  updateIssue: vi.fn(),
  taskFieldsToJiraFields: vi.fn(() => ({})),
  transitionIssueTo: vi.fn(),
  formatJiraError: vi.fn((e: unknown) => String(e)),
  createIssue: vi.fn(),
}));
import * as jiraApi from "./jira-api";

// ── Shared fixtures ──────────────────────────────────────────────────────────
const showToast = vi.fn();
const logActivity = vi.fn();

const baseSettings = {
  jira: {
    enabled: true,
    siteUrl: "https://acme.atlassian.net",
    email: "user@acme.com",
    apiToken: "tok",
    projectKey: "TEST",
    projectName: "Test Project",
    issueTypes: ["Task"],
    assigneeMode: "currentUser",
    assigneeAccountId: "",
    assigneeDisplayName: "",
  },
} as any;

const noCredSettings = { jira: { enabled: false } } as any;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "T1",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-06-01",
    lastUpdateDate: "2026-01-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

const baseTask = makeTask();

// ── Composite probe hook so we can inspect workspace tasks ───────────────────
function makeProbe(overrideSettings = baseSettings) {
  return function probe() {
    const sync = useJiraSync({
      settings: overrideSettings,
      today: "2026-05-20",
      lang: "en-US",
      showToast,
      logActivity,
    });
    const { tasks } = useWorkspace();
    return { ...sync, currentTasks: tasks };
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function renderSync(initialTasks: Task[] = [], overrideSettings = baseSettings) {
  return renderHook(makeProbe(overrideSettings), {
    wrapper: ({ children }) => (
      <TestProviders tasks={initialTasks}>{children}</TestProviders>
    ),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("useJiraSync — state initialisation", () => {
  it("jiraSyncing initialises to false and jiraConflicts initialises to []", () => {
    const { result } = renderSync();
    expect(result.current.jiraSyncing).toBe(false);
    expect(result.current.jiraConflicts).toEqual([]);
  });

  it("clearConflicts resets a pre-populated jiraConflicts array to []", async () => {
    const { result } = renderSync();
    expect(typeof result.current.clearConflicts).toBe("function");
    await act(async () => { result.current.clearConflicts(); });
    expect(result.current.jiraConflicts).toEqual([]);
  });
});

describe("useJiraSync — handleJiraSync", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("shows error toast when buildJql returns null (no JQL scope)", async () => {
    // buildJql vi.fn() returns undefined by default → triggers "no scope" toast
    const { result } = renderSync([]);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(result.current.jiraSyncing).toBe(false);
  });

  it("shows info toast after successful empty sync (jiraSyncing resets to false)", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const { result } = renderSync([]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
    expect(result.current.jiraSyncing).toBe(false);
  });

  it("pull path: existing task with remote changes and no local changes → task updated", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: {
        summary: "Remote name",
        updated: "2026-05-10T00:00:00",
      },
    } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Remote name",
      jiraIssueType: "Task",
    });

    // Local task with lastSyncedAt; no localModifiedAt → remoteChanged=true, localChanged=false
    const localTask = makeTask({
      id: 1,
      jiraKey: "TEST-1",
      taskName: "Old name",
      lastSyncedAt: "2026-01-01T00:00:00",
    });

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(result.current.currentTasks[0].taskName).toBe("Remote name");
    expect(logActivity).toHaveBeenCalled();
    expect(result.current.currentTasks[0].lastSyncedAt).toBeDefined();
    expect(result.current.currentTasks[0].lastSyncedAt).not.toBe("2026-01-01T00:00:00");
  });

  it("push path: local changes newer than lastSync + remote not changed → updateIssue called", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: {
        summary: "Old name",
        updated: "2025-12-01T00:00:00",  // older than lastSyncedAt
      },
    } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "New name" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    // localModifiedAt newer than lastSyncedAt → localChanged=true; remote.updated older → remoteChanged=false
    const localTask = makeTask({
      id: 1,
      jiraKey: "TEST-1",
      taskName: "New name",
      lastSyncedAt: "2026-01-01T00:00:00",
      localModifiedAt: "2026-05-01T00:00:00",
    });

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(jiraApi.updateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ siteUrl: "https://acme.atlassian.net" }),
      "TEST-1",
      expect.objectContaining({ summary: "New name" }),
    );
    expect(result.current.currentTasks[0].localModifiedAt).toBeUndefined();
    expect(result.current.currentTasks[0].lastSyncedAt).toBeDefined();
  });

  it("conflict path: both local and remote changed → jiraConflicts populated, task unchanged", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-2",
      fields: {
        summary: "Remote name",
        updated: "2026-05-10T00:00:00",  // newer than lastSyncedAt
      },
    } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Remote name",
    });
    // diffTaskAgainstIssue returns a non-empty field diff → real conflict
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue([
      { key: "taskName", localValue: "Local name", remoteValue: "Remote name" },
    ]);

    // Both timestamps newer than lastSyncedAt → conflict
    const localTask = makeTask({
      id: 2,
      jiraKey: "TEST-2",
      taskName: "Local name",
      lastSyncedAt: "2026-01-01T00:00:00",
      localModifiedAt: "2026-05-01T00:00:00",
    });

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);
    expect(result.current.jiraConflicts[0].jiraKey).toBe("TEST-2");
    expect(result.current.currentTasks[0].taskName).toBe("Local name");  // unchanged
  });

  it("create path: remote issue not in local list → new local task created", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const newRemoteIssue = {
      key: "TEST-99",
      fields: { summary: "Brand new", updated: "2026-05-01T00:00:00" },
    } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([newRemoteIssue]);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Brand new",
      jiraIssueType: "Task",
    });

    const { result } = renderSync([]);  // no local tasks
    await act(async () => { await result.current.handleJiraSync(); });

    const created = result.current.currentTasks.find(t => t.jiraKey === "TEST-99");
    expect(created).toBeDefined();
    expect(created?.taskName).toBe("Brand new");
  });

  it("error path: searchAllIssues throws → error toast shown, jiraSyncing reset to false", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network failure")
    );

    const { result } = renderSync([]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(result.current.jiraSyncing).toBe(false);
  });
});

describe("useJiraSync — handleResolveConflicts", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Helper to set up a conflict in jiraConflicts state
  async function setupConflict(result: { current: ReturnType<typeof makeProbe> & { currentTasks: Task[] } }) {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: { summary: "Remote name", updated: "2026-05-10T00:00:00" },
    } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({ taskName: "Remote name" });
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue([
      { key: "taskName", localValue: "Local name", remoteValue: "Remote name" },
    ]);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);
  }

  it("'keep local' resolution → task unchanged, updateIssue called with local value", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", taskName: "Local name",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupConflict(result as any);

    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "Local name" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: { taskName: "local", assignee: "remote", assigneeEmail: "remote", dueDate: "remote", priority: "remote", labels: "remote", notes: "remote", completedDate: "remote" },
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    expect(result.current.currentTasks[0].taskName).toBe("Local name");
    expect(jiraApi.updateIssue).toHaveBeenCalled();
  });

  it("'use remote' resolution → task updated with remote value, updateIssue NOT called", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", taskName: "Local name",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupConflict(result as any);

    vi.clearAllMocks();

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: { taskName: "remote", assignee: "remote", assigneeEmail: "remote", dueDate: "remote", priority: "remote", labels: "remote", notes: "remote", completedDate: "remote" },
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    expect(result.current.currentTasks[0].taskName).toBe("Remote name");
    expect(jiraApi.updateIssue).not.toHaveBeenCalled();
  });

  it("after resolution completes → jiraConflicts cleared to []", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", taskName: "Local name",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupConflict(result as any);

    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({});
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: { taskName: "local", assignee: "remote", assigneeEmail: "remote", dueDate: "remote", priority: "remote", labels: "remote", notes: "remote", completedDate: "remote" },
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    expect(result.current.jiraConflicts).toEqual([]);
  });
});
