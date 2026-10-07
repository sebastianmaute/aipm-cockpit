// §491 step 11 — pins the `buildTaskEditorChrome` CALL SITE in task-manager.tsx.
// task-editor-actions.test.tsx hands the builder its deps by hand, and no other
// task-manager test reads the editor footer slots, so only a mounted TaskManager
// can show which values reach it. Each field is pinned by identity against the
// hook it comes from (pass-through mocks capture both sides), or by the value a
// seeded setting or an opened task gives it.
//
// ★ `useJiraSync` is overridden to report `jiraSyncing: true` and a marker sync
// handler, because at rest the real one reports `false` — the same value a
// hard-coded `jiraSyncing: false` would pass.
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import type { TaskEditorChromeDeps } from "./task-editor-actions";
import type { Task } from "./types";

const seen = vi.hoisted(() => ({
  deps: null as unknown,
  rows: null as null | Record<string, unknown>,
  create: null as null | { handleAddRaidFromEditor: unknown; editorBuffer: { pendingRaid: unknown }; linkedTaskOpen: boolean },
  isPopout: null as unknown,
  setTasks: null as null | ((t: Task[]) => void),
  setEditingId: null as null | ((id: number | null) => void),
  jiraSync: (async () => {}) as () => Promise<void>,
}));

vi.mock("./task-editor-actions", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./task-editor-actions")>();
  return {
    ...mod,
    buildTaskEditorChrome: (deps: TaskEditorChromeDeps) => {
      seen.deps = deps;
      return mod.buildTaskEditorChrome(deps);
    },
  };
});
vi.mock("./use-task-row-handlers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-task-row-handlers")>();
  return {
    ...mod,
    useTaskRowHandlers: (...a: Parameters<typeof mod.useTaskRowHandlers>) => {
      const r = mod.useTaskRowHandlers(...a);
      seen.rows = r as unknown as Record<string, unknown>;
      return r;
    },
  };
});
vi.mock("./use-task-editor-create", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-task-editor-create")>();
  return {
    ...mod,
    useTaskEditorCreate: (...a: Parameters<typeof mod.useTaskEditorCreate>) => {
      const r = mod.useTaskEditorCreate(...a);
      seen.create = r as unknown as NonNullable<typeof seen.create>;
      return r;
    },
  };
});
vi.mock("./use-jira-sync", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-jira-sync")>();
  return {
    ...mod,
    useJiraSync: (...a: Parameters<typeof mod.useJiraSync>) => ({
      ...mod.useJiraSync(...a),
      jiraSyncing: true,
      handleJiraSync: seen.jiraSync,
    }),
  };
});
vi.mock("./workspace-tab-context", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./workspace-tab-context")>();
  return {
    ...mod,
    useWorkspaceTab: () => {
      const r = mod.useWorkspaceTab();
      seen.isPopout = r.isPopout;
      return r;
    },
  };
});
vi.mock("./workspace-context", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./workspace-context")>();
  return {
    ...mod,
    useWorkspace: () => {
      const ws = mod.useWorkspace();
      seen.setTasks = ws.setTasks as unknown as (t: Task[]) => void;
      return ws;
    },
  };
});
vi.mock("./task-form-context", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./task-form-context")>();
  return {
    ...mod,
    useTaskForm: () => {
      const r = mod.useTaskForm();
      seen.setEditingId = r.setEditingId as unknown as (id: number | null) => void;
      return r;
    },
  };
});

import TaskManager from "./task-manager";

const JIRA_TASK = {
  id: 4242, taskName: "Linked", assignee: "", assigneeEmail: "", dueDate: "2030-12-31",
  lastUpdateDate: "2030-01-01", status: "To Do", priority: "Medium", blockers: "", description: "",
  jiraKey: "MARK-1",
} as Task;

function deps(): TaskEditorChromeDeps {
  if (!seen.deps) throw new Error("buildTaskEditorChrome was not called");
  return seen.deps as TaskEditorChromeDeps;
}

beforeEach(() => {
  __resetMintStateForTests();
  window.localStorage.clear();
  seen.deps = null;
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
  window.localStorage.setItem(
    "aipm-cockpit:settings",
    JSON.stringify({ language: "de", jira: { enabled: true, projectKey: "MARK" } }),
  );
});

describe("task-manager → buildTaskEditorChrome call site", () => {
  it("hands the builder the open task, the row handlers, the editor-create wiring and the Jira state", async () => {
    render(<TaskManager />);
    await vi.waitFor(() => expect(deps().lang).toBe("de"), { timeout: 30000 });
    // Before a task is opened there is nothing to edit.
    expect(deps().editingTask).toBeNull();
    expect(deps().editingIsJiraLinked).toBe(false);

    act(() => { seen.setTasks!([JIRA_TASK]); });
    act(() => { seen.setEditingId!(JIRA_TASK.id); });
    await vi.waitFor(() => expect(deps().editingTask?.id).toBe(JIRA_TASK.id), { timeout: 10000 });

    const d = deps();
    expect(d.editingIsJiraLinked).toBe(true);
    expect(d.isPopout).toBe(false);
    expect(d.isPopout).toBe(seen.isPopout);
    expect(d.jira.projectKey).toBe("MARK");
    expect(d.jira.enabled).toBe(true);
    expect(d.jiraSyncing).toBe(true);
    expect(d.handleJiraSync).toBe(seen.jiraSync);
    expect(d.onSendInquiry).toBe(seen.rows!.onSendInquiry);
    expect(d.onPushToJira).toBe(seen.rows!.onPushToJira);
    expect(d.onDelete).toBe(seen.rows!.onDelete);
    expect(d.onAddRaid).toBe(seen.create!.handleAddRaidFromEditor);
    expect(d.pendingRaid).toBe(seen.create!.editorBuffer.pendingRaid);

    expect(seen.create!.linkedTaskOpen).toBe(false);
    act(() => { d.onNewLinkedTask(); });
    await vi.waitFor(() => expect(seen.create!.linkedTaskOpen).toBe(true));
  }, 45000);
});
