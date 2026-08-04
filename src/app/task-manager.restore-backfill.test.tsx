// Pins the SECOND load funnel: a version-history RESTORE must run the task
// resource-FK backfill, exactly as the storage load path does.
//
// ★★★ WHY THIS FILE EXISTS. `backfillTaskResourceFks` repairs tasks that carry
// an assignee STRING but no FK — the shape that rendered one person as two
// swimlanes. `use-storage-backend.test.tsx` pins the funnel in `applyWorkspace`,
// and it is the funnel everyone thinks of. But `task-manager.tsx`
// `applyRestoredWorkspace` is a SECOND, independent funnel, and until this file
// was written it had NO test of any kind: deleting the backfill call there and
// leaving a bare `setTasks(w.tasks ?? [])` kept the entire suite green while a
// Turso version restore silently reverted a project's task FKs to the broken
// pre-repair shape. Any future third funnel needs the same treatment.
//
// ★ The assertion is on the workspace CONTEXT's task list, not on a spy: it
// proves the repaired rows actually reached render scope, not merely that a
// function was called.
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import type { Task } from "./types";
import type { Workspace } from "./workspace";

let applyRestored: ((w: Workspace) => void) | null = null;

// Capture the callback task-manager hands the version-history hook. This is the
// only way in — `applyRestoredWorkspace` is not exported, and mounting the real
// restore flow would need a Turso backend.
vi.mock("./use-version-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-version-history")>()),
  useVersionHistory: (args: { applyWorkspace: (w: Workspace) => void }) => {
    applyRestored = args.applyWorkspace;
    return {
      versions: [], busy: false, notifySaved: () => {},
      captureNow: async () => {}, loadDiff: async () => [],
      restore: async () => true, remove: async () => true, refresh: async () => {},
    };
  },
}));

// Probe standing in for the heavy pane: reports each task's id and FK straight
// out of the workspace context.
vi.mock("./workspace-section", async (importOriginal) => {
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...(await importOriginal<typeof import("./workspace-section")>()),
    WorkspaceSection: () => {
      const ws = useWorkspace();
      return (
        <div data-testid="ws-fks">
          {ws.tasks.map((t) => `${t.id}:${t.resourceId ?? "none"}`).join(",")}
        </div>
      );
    },
  };
});

import TaskManager from "./task-manager";

const makeTask = (over: Partial<Task>): Task => ({
  id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-03-01",
  lastUpdateDate: "2026-02-01", priority: "Medium", status: "To Do",
  blockers: "", description: "", ...over,
} as Task);

const restored = (): Workspace => ({
  project: { id: "p1", name: "Seed", code: "SEED" },
  resources: [{
    id: 42, firstName: "Dennis", lastName: "Kurschner", roleId: null,
    utilizationMode: "percent", utilization: {},
  }],
  // Case- and whitespace-variant on purpose: only the normalising matcher links
  // it, so a raw-string comparison would leave the FK unset and fail here.
  tasks: [makeTask({ id: 1, assignee: "  dennis   KURSCHNER " })],
} as unknown as Workspace);

beforeEach(() => {
  __resetMintStateForTests();
  applyRestored = null;
  window.localStorage.clear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
});

describe("task-manager → applyRestoredWorkspace", () => {
  it("backfills task resource FKs on a version restore, not only on load", async () => {
    render(<TaskManager />);
    await screen.findByTestId("ws-fks", undefined, { timeout: 40000 });
    await waitFor(() => expect(applyRestored).not.toBeNull(), { timeout: 40000 });

    act(() => applyRestored!(restored()));

    // 42, not "none": the restore path ran the repair.
    await waitFor(
      () => expect(screen.getByTestId("ws-fks")).toHaveTextContent("1:42"),
      { timeout: 40000 },
    );
  }, 45000);
});
