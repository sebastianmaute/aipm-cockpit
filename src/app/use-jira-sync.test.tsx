import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskStatus } from "./types";
import type { JiraIssue } from "./jira-api";
import { JiraApiError } from "./jira-api";
import type { Settings } from "./settings-types";
import { useJiraSync } from "./use-jira-sync";
import { useWorkspace } from "./workspace-context";
import { TestProviders } from "./test-providers";
import { __resetMintStateForTests, mintId } from "./id-mint-session";

// New Jira tasks draw ids from the session-scoped minter. Clear its high-water
// state before every test so created-id assertions stay deterministic and the
// no-reuse test controls the mark itself.
beforeEach(() => {
  __resetMintStateForTests();
});

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
  classifyJiraError: vi.fn((e: unknown) => {
    // Minimal real-logic mirror so tests that don't override still work
    if (e instanceof Error && e.name === "JiraApiError") {
      const status = (e as { status?: number }).status ?? 0;
      if (status === 401 || status === 403) return "auth";
      if (status >= 500) return "network";
      return "other";
    }
    return "network";
  }),
  createIssue: vi.fn(),
  JiraApiError: class JiraApiError extends Error {
    status: number;
    payload: unknown;
    constructor(status: number, payload: unknown) {
      super(`Jira ${status}`);
      this.name = "JiraApiError";
      this.status = status;
      this.payload = payload;
    }
  },
}));
import * as jiraApi from "./jira-api";

// ── Shared fixtures ──────────────────────────────────────────────────────────
const showToast = vi.fn();
const logActivityAs = vi.fn();

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
} as unknown as Settings;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "T1",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-06-01",
    lastUpdateDate: "2026-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    ...overrides,
  };
}

// ── Composite probe hook so we can inspect workspace tasks ───────────────────
function makeProbe(
  overrideSettings = baseSettings,
  overrides: { today?: string; onJiraAuthResult?: ReturnType<typeof vi.fn<(ok: boolean) => void>> } = {},
) {
  return function useProbe() {
    const sync = useJiraSync({
      settings: overrideSettings,
      today: overrides.today ?? "2026-05-20",
      lang: "en-US",
      showToast,
      logActivityAs,
      onJiraAuthResult: overrides.onJiraAuthResult,
    });
    const { tasks } = useWorkspace();
    return { ...sync, currentTasks: tasks };
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function renderSync(
  initialTasks: Task[] = [],
  overrideSettings = baseSettings,
  overrides: { today?: string; onJiraAuthResult?: ReturnType<typeof vi.fn<(ok: boolean) => void>> } = {},
) {
  return renderHook(makeProbe(overrideSettings, overrides), {
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
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Remote name",
      status: "To Do",
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
    // The sync summary is stamped with the "integration" actor: `actor` names the
    // subsystem that AUTHORED the data, not whether a gesture started the run.
    // Args are exact for this fixture — one remote issue pulled onto one local
    // task, so `added + pulled` = 1, nothing pushed, no conflicts.
    expect(logActivityAs).toHaveBeenCalledWith("integration", "jira.sync", 1, 0, 0);
    expect(result.current.currentTasks[0].lastSyncedAt).toBeDefined();
    expect(result.current.currentTasks[0].lastSyncedAt).not.toBe("2026-01-01T00:00:00");
  });

  it("pull path: synced Done task reopened in Jira → status becomes In Progress and completedDate cleared", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: {
        summary: "Reopened",
        updated: "2026-05-10T00:00:00",
        status: { statusCategory: { key: "indeterminate" } },
      },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    // Patch mirrors the real issueToTaskFields contract for a non-done issue:
    // a valid open status and NO completedDate.
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Reopened",
      status: "In Progress",
      completedDate: undefined,
      jiraIssueType: "Task",
    });

    // Local task was previously Done (completedDate set) and synced.
    const localTask = makeTask({
      id: 1,
      jiraKey: "TEST-1",
      taskName: "Was done",
      status: "Done",
      completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00",
    });

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    const updated = result.current.currentTasks[0];
    expect(updated.status).toBe("In Progress");
    expect(updated.completedDate).toBeFalsy();  // stale completedDate cleared (invariant holds)
  });

  it("push path: local changes newer than lastSync + remote not changed → updateIssue called", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: {
        summary: "Old name",
        updated: "2025-12-01T00:00:00",  // older than lastSyncedAt
      },
    } as unknown as JiraIssue;
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

  // ── Push-path transition guard (open-followups §227, sibling of the
  //   conflict-path guard covered below in "useJiraSync — handleResolveConflicts") ──
  it("push path: consistent Done row → transitionIssueTo called", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: {
        summary: "Old name",
        updated: "2025-12-01T00:00:00",  // older than lastSyncedAt
      },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "New name" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (jiraApi.transitionIssueTo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    // localModifiedAt newer than lastSyncedAt → localChanged=true; remote.updated older → remoteChanged=false
    const localTask = makeTask({
      id: 1,
      jiraKey: "TEST-1",
      taskName: "New name",
      status: "Done",
      completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00",
      localModifiedAt: "2026-05-01T00:00:00",
    });

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(jiraApi.updateIssue).toHaveBeenCalled();
    expect(jiraApi.transitionIssueTo).toHaveBeenCalledWith(
      expect.objectContaining({ siteUrl: "https://acme.atlassian.net" }),
      "TEST-1",
      "done",
    );
  });

  it("push path: does not transition a split row whose status is not Done", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: {
        summary: "Old name",
        updated: "2025-12-01T00:00:00",  // older than lastSyncedAt
      },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "New name" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    // A SPLIT local row: a completedDate beside a non-Done status. Nothing in
    // src writes this since 0.257.0, but an older build, a hand edit or a
    // third-party template can have stored it (open-followups §227).
    // ★ The fixture MUST be split — a consistent Done+date row would make the
    //   old (`!!completedDate`) and new (`status === "Done"`) guards agree,
    //   and this test would pass against the unfixed code, proving nothing.
    const localTask = makeTask({
      id: 1,
      jiraKey: "TEST-1",
      taskName: "New name",
      status: "In Progress",
      completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00",
      localModifiedAt: "2026-05-01T00:00:00",
    });

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    // Fences the test: proves the push branch actually ran, rather than
    // passing because nothing executed.
    expect(jiraApi.updateIssue).toHaveBeenCalled();
    expect(jiraApi.transitionIssueTo).not.toHaveBeenCalled();
  });

  it("conflict path: both local and remote changed → jiraConflicts populated, task unchanged", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-2",
      fields: {
        summary: "Remote name",
        updated: "2026-05-10T00:00:00",  // newer than lastSyncedAt
      },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Remote name",
      status: "To Do",
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
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([newRemoteIssue]);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Brand new",
      status: "In Progress",
      jiraIssueType: "Task",
    });

    const { result } = renderSync([]);  // no local tasks
    await act(async () => { await result.current.handleJiraSync(); });

    const created = result.current.currentTasks.find(t => t.jiraKey === "TEST-99");
    expect(created).toBeDefined();
    expect(created?.taskName).toBe("Brand new");
    expect(created?.status).toBe("In Progress");  // status follows Jira statusCategory
  });

  it("create path: minted id sits above the session mark and never reuses a deleted id", async () => {
    // Local list holds a task at id 5. Simulate a prior create-then-delete by
    // advancing the session mark to 6 (as if task id 6 was minted then deleted,
    // so it is absent from the list). A Jira import must mint id 7 — strictly
    // above both the list max (5) and the deleted id (6) — never reusing 6.
    mintId("task", [{ id: 5 }]); // high-water → 6

    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const newRemoteIssue = {
      key: "TEST-100",
      fields: { summary: "After delete", updated: "2026-05-01T00:00:00" },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([newRemoteIssue]);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "After delete",
      status: "To Do",
      jiraIssueType: "Task",
    });

    const { result } = renderSync([makeTask({ id: 5 })]);
    await act(async () => { await result.current.handleJiraSync(); });

    const created = result.current.currentTasks.find(t => t.jiraKey === "TEST-100");
    expect(created).toBeDefined();
    expect(created?.id).toBe(7); // above list max (5) AND the deleted id (6)
  });

  it("error path: searchAllIssues throws network error → info toast (unreachable), jiraSyncing reset to false", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network failure")
    );

    const { result } = renderSync([]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
    expect(result.current.jiraSyncing).toBe(false);
  });
});

describe("read-only project sync", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const roSettings = {
    jira: {
      ...baseSettings.jira,
      projectKey: "LOP",
      projectName: "LOP Project",
      extraProjects: [{ key: "OPS", name: "Ops", readOnly: true }],
    },
  } as unknown as Settings;

  it("reverts a locally-changed read-only-project task without pushing", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project in (LOP, OPS)");
    const remoteIssue = {
      key: "OPS-1",
      fields: {
        summary: "remote name",
        updated: "2025-12-01T00:00:00", // <= lastSyncedAt → remote UNCHANGED
        status: { statusCategory: { key: "indeterminate" } },
      },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "remote name",
      status: "To Do",
      jiraIssueType: "Task",
    });

    // local changed (localModifiedAt after lastSyncedAt), remote unchanged
    const localTask = makeTask({
      id: 1,
      jiraKey: "OPS-1",
      taskName: "local edit",
      lastSyncedAt: "2026-01-01T00:00:00",
      localModifiedAt: "2026-05-01T00:00:00",
    });

    const { result } = renderSync([localTask], roSettings);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(jiraApi.updateIssue).not.toHaveBeenCalled();
    expect(result.current.currentTasks[0].taskName).toBe("remote name"); // reverted
    expect(result.current.currentTasks[0].localModifiedAt).toBeUndefined();
  });

  it("never queues a conflict for a read-only-project task", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project in (LOP, OPS)");
    const remoteIssue = {
      key: "OPS-1",
      fields: {
        summary: "remote name",
        updated: "2026-05-10T00:00:00", // AFTER lastSyncedAt → remote ALSO changed
        status: { statusCategory: { key: "indeterminate" } },
      },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "remote name",
      status: "To Do",
      jiraIssueType: "Task",
    });
    // Would produce a conflict if the read-only branch didn't short-circuit.
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue([
      { key: "taskName", localValue: "local edit", remoteValue: "remote name" },
    ]);

    const localTask = makeTask({
      id: 1,
      jiraKey: "OPS-1",
      taskName: "local edit",
      lastSyncedAt: "2026-01-01T00:00:00",
      localModifiedAt: "2026-05-01T00:00:00",
    });

    const { result } = renderSync([localTask], roSettings);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(jiraApi.updateIssue).not.toHaveBeenCalled();
    expect(result.current.jiraConflicts).toEqual([]);
    expect(result.current.currentTasks[0].taskName).toBe("remote name");
  });

  it("still pushes a locally-changed two-way (primary) task", async () => {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project in (LOP, OPS)");
    const remoteIssue = {
      key: "LOP-1",
      fields: {
        summary: "old name",
        updated: "2025-12-01T00:00:00", // remote unchanged
      },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "new name" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const localTask = makeTask({
      id: 1,
      jiraKey: "LOP-1",
      taskName: "new name",
      lastSyncedAt: "2026-01-01T00:00:00",
      localModifiedAt: "2026-05-01T00:00:00",
    });

    const { result } = renderSync([localTask], roSettings);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(jiraApi.updateIssue).toHaveBeenCalled();
  });
});

describe("useJiraSync — handleResolveConflicts", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Helper to set up a conflict in jiraConflicts state
  async function setupConflict(result: { current: ReturnType<ReturnType<typeof makeProbe>> }) {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: { summary: "Remote name", updated: "2026-05-10T00:00:00" },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({ taskName: "Remote name", status: "To Do" });
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue([
      { key: "taskName", localValue: "Local name", remoteValue: "Remote name" },
    ]);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);
  }

  /** A COMPLETE picks record. `ConflictResolution.picks` is a REQUIRED
   *  `Record<ConflictFieldKey, "local" | "remote">`, so every key must be
   *  present even though the merge loop only ever reads the keys that actually
   *  appear in `conflict.fields`. */
  function picksAll(
    overrides: Partial<Record<import("./jira-api").ConflictFieldKey, "local" | "remote">> = {},
  ): Record<import("./jira-api").ConflictFieldKey, "local" | "remote"> {
    return {
      taskName: "remote",
      assignee: "remote",
      assigneeEmail: "remote",
      dueDate: "remote",
      priority: "remote",
      labels: "remote",
      description: "remote",
      completedDate: "remote",
      ...overrides,
    };
  }

  /** Queue a conflict whose ONLY differing field is completedDate.
   *  ★★★ The existing setupConflict mocks a taskName-only diff, which is why
   *  this arm of the merge loop has never run: the loop iterates
   *  conflict.fields and only then reads picks[field.key], so a picks entry
   *  with no matching field is inert. Widening the diff mock is the whole point
   *  of this helper — a test that reuses setupConflict passes against the
   *  unfixed code. */
  async function setupCompletionConflict(
    result: { current: ReturnType<ReturnType<typeof makeProbe>> },
    remote: { status: TaskStatus; completedDate: string | undefined; done: boolean },
    localCompletedDate: string | undefined,
  ) {
    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    const remoteIssue = {
      key: "TEST-1",
      fields: { summary: "Remote name", updated: "2026-05-10T00:00:00" },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(remote.done);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      taskName: "Remote name",
      status: remote.status,
      completedDate: remote.completedDate,
    });
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue([
      { key: "completedDate", localValue: localCompletedDate, remoteValue: remote.completedDate },
    ]);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);
    // Guard: prove the diff really carries the completion field, so a future
    // edit to the mock cannot silently return this suite to the taskName-only
    // shape that made the arm unreachable.
    expect(result.current.jiraConflicts[0].fields.map((f) => f.key)).toContain("completedDate");
  }

  it("'keep local' resolution → task unchanged, updateIssue called with local value", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", taskName: "Local name",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupConflict(result);

    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "Local name" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: picksAll({ taskName: "local" }),
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
    await setupConflict(result);

    vi.clearAllMocks();

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: picksAll(),
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
    await setupConflict(result);

    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({});
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: picksAll({ taskName: "local" }),
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    expect(result.current.jiraConflicts).toEqual([]);
  });

  it("read-only project: a stale conflict resolution picking local does NOT push", async () => {
    // Seed the conflict while OPS is still two-way (readOnly:false), then flip the
    // live config to read-only to simulate a stale conflict queued before the flag
    // changed. The hook's settingsRef points at this same object, so the mutation
    // is visible at resolve time.
    const roSettings = {
      jira: {
        ...baseSettings.jira,
        projectKey: "LOP",
        projectName: "LOP Project",
        extraProjects: [{ key: "OPS", name: "Ops", readOnly: false }],
      },
    } as unknown as Settings;

    const localTask = makeTask({
      id: 1, jiraKey: "OPS-1", taskName: "Local name",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask], roSettings);

    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project in (LOP, OPS)");
    const remoteIssue = {
      key: "OPS-1",
      fields: { summary: "Remote name", updated: "2026-05-10T00:00:00" },
    } as unknown as JiraIssue;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({ taskName: "Remote name", status: "To Do" });
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue([
      { key: "taskName", localValue: "Local name", remoteValue: "Remote name" },
    ]);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);

    // Project is now read-only — the queued conflict is stale.
    roSettings.jira.extraProjects[0].readOnly = true;

    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "Local name" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1,
      jiraKey: "OPS-1",
      picks: picksAll({ taskName: "local" }),
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    expect(jiraApi.updateIssue).not.toHaveBeenCalled();  // read-only guard short-circuited the push
  });

  // ── The completedDate arm of the merge loop (open-followups §183) ──────────
  // `status` is not a ConflictFieldKey, so the loop can never write it: picking
  // a side for the completion DATE leaves the LOCAL status in place, splitting
  // the `status === "Done" ⟺ completedDate set` pair. The two remote-pick tests
  // below are RED until the fix writes both halves from the picked side.
  //
  // transitionIssueTo derivation — the guard is
  //   if (anyLocalPicked) { … if (completionChanged && merged.status === "Done" && !conflict.remoteDone) … }
  // so it needs FOUR things at once: a local pick anywhere in the diff, the
  // completion arm having run, a merged status of "Done", and a remote issue
  // that is NOT already done. Of the five cases in this block only (a)/pick-local
  // satisfies all four — the two pick-remote cases never enter the push block at
  // all, (b)/pick-local merges a status that stays "In Progress", and the SPLIT
  // row below (§227) merges a local pick with a completedDate but a status that
  // stays "In Progress". Exactly one transitions, as expected.

  it("conflict (a): local Done, issue reopened, pick remote → status follows Jira, pair consistent", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "Done", completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "In Progress", completedDate: undefined, done: false },
      "2026-04-01",
    );
    vi.clearAllMocks();

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: picksAll({ completedDate: "remote" }),
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.completedDate).toBeFalsy();
    expect(merged.status).toBe("In Progress");   // NOT left at the local "Done"
    // Nothing was picked local, so the push block is skipped entirely.
    expect(jiraApi.updateIssue).not.toHaveBeenCalled();
    expect(jiraApi.transitionIssueTo).not.toHaveBeenCalled();
  });

  it("conflict (b): local open, issue completed, pick remote → Jira's date, not today", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "In Progress",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "Done", completedDate: "2026-05-09", done: true },
      undefined,
    );
    vi.clearAllMocks();

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: picksAll({ completedDate: "remote" }),
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.completedDate).toBe("2026-05-09"); // Jira's resolution date
    expect(merged.status).toBe("Done");              // NOT left at the local "In Progress"
    expect(jiraApi.updateIssue).not.toHaveBeenCalled();
    expect(jiraApi.transitionIssueTo).not.toHaveBeenCalled();
  });

  it("conflict (a): pick local → the local pair survives intact", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "Done", completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "In Progress", completedDate: undefined, done: false },
      "2026-04-01",
    );
    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({});
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (jiraApi.transitionIssueTo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: picksAll({ completedDate: "local" }),
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.completedDate).toBe("2026-04-01");
    expect(merged.status).toBe("Done");
    // The ONLY case that satisfies the whole transition guard: a local pick, a
    // merged status of "Done", and a remote issue that is not already done.
    expect(jiraApi.updateIssue).toHaveBeenCalled();
    expect(jiraApi.transitionIssueTo).toHaveBeenCalledWith(
      expect.objectContaining({ siteUrl: "https://acme.atlassian.net" }),
      "TEST-1",
      "done",
    );
  });

  it("conflict (b): pick local → stays open, no date adopted", async () => {
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "In Progress",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "Done", completedDate: "2026-05-09", done: true },
      undefined,
    );
    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({});
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: picksAll({ completedDate: "local" }),
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.completedDate).toBeFalsy();
    expect(merged.status).toBe("In Progress");
    expect(jiraApi.updateIssue).toHaveBeenCalled();
    // Local pick, but the merged status is "In Progress" → guard fails.
    expect(jiraApi.transitionIssueTo).not.toHaveBeenCalled();
  });

  it("does not transition the issue when the merged row is not Done, even with a date", async () => {
    // A SPLIT local row: a completedDate beside a non-Done status. Nothing in
    // src writes this since 0.257.0, but an older build, a hand edit or a
    // third-party template can have stored it (open-followups §227).
    // ★ The fixture MUST be split. With a consistent Done+date row the old and
    //   new guards agree, and this test would pass against the unfixed code.
    const localTask = makeTask({
      id: 1, jiraKey: "TEST-1", status: "In Progress", completedDate: "2026-04-01",
      lastSyncedAt: "2026-01-01T00:00:00", localModifiedAt: "2026-05-01T00:00:00",
    });
    const { result } = renderSync([localTask]);
    await setupCompletionConflict(
      result,
      { status: "In Progress", completedDate: undefined, done: false },
      "2026-04-01",
    );
    vi.clearAllMocks();
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({});
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const resolution: import("./jira-conflicts-modal").ConflictResolution = {
      taskId: 1, jiraKey: "TEST-1", picks: picksAll({ completedDate: "local" }),
    };
    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    const merged = result.current.currentTasks[0];
    expect(merged.status).toBe("In Progress");
    expect(merged.completedDate).toBe("2026-04-01");
    // The field push still happens — only the completion TRANSITION is gated.
    expect(jiraApi.updateIssue).toHaveBeenCalled();
    expect(jiraApi.transitionIssueTo).not.toHaveBeenCalled();
  });
});

describe("useJiraSync — preflight, classified failures, flag sync", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("preflight expired: does not call searchAllIssues and shows info toast when tokenExpiresAt is in the past", async () => {
    const onJiraAuthResult = vi.fn<(ok: boolean) => void>();
    const expiredSettings = {
      jira: {
        ...baseSettings.jira,
        tokenExpiresAt: "2020-01-01",
      },
    } as unknown as Settings;

    const { result } = renderSync([], expiredSettings, {
      today: "2026-05-26",
      onJiraAuthResult,
    });
    await act(async () => { await result.current.handleJiraSync(); });

    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
    expect(jiraApi.searchAllIssues).not.toHaveBeenCalled();
    expect(onJiraAuthResult).not.toHaveBeenCalled();
  });

  it("401 → calls onJiraAuthResult(false) and shows info toast", async () => {
    const onJiraAuthResult = vi.fn<(ok: boolean) => void>();

    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new JiraApiError(401, {}),
    );
    (jiraApi.classifyJiraError as ReturnType<typeof vi.fn>).mockReturnValueOnce("auth");

    const { result } = renderSync([], baseSettings, { onJiraAuthResult });
    await act(async () => { await result.current.handleJiraSync(); });

    expect(onJiraAuthResult).toHaveBeenCalledWith(false);
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("success → calls onJiraAuthResult(true)", async () => {
    const onJiraAuthResult = vi.fn<(ok: boolean) => void>();

    (jiraApi.buildJql as ReturnType<typeof vi.fn>).mockReturnValueOnce("project = TEST");
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const { result } = renderSync([], baseSettings, { onJiraAuthResult });
    await act(async () => { await result.current.handleJiraSync(); });

    expect(onJiraAuthResult).toHaveBeenCalledWith(true);
  });
});
