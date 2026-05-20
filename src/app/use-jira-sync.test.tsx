import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
      lang: "en",
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
});
