// §491 step 10 — pins use-version-history-wiring.ts on its own: what it hands
// `useVersionHistory` (config, project id, the enabled predicate, idle window,
// retention, activity logger), the capture payload, the restore fan-out (the
// SECOND load funnel), the error bridge and the notify-ref hand-off. The
// workspace is the real WorkspaceProvider, so a restore round-trips through
// the actual context state. task-manager.version-history-wiring.test.tsx and
// task-manager.restore-backfill.test.tsx still pin the same wiring through the
// mounted component.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { emptyWorkspace, type Workspace } from "./workspace";
import { DEFAULT_VERSION_RETENTION } from "./version-history";
import type { UseVersionHistoryArgs } from "./use-version-history";
import { useVersionHistoryWiring, type VersionHistoryWiringDeps } from "./use-version-history-wiring";
import type { Milestone, Stakeholder, Task } from "./types";
import type { CalendarEvent } from "./calendar-event";
import type { TursoConfig } from "./turso-config";

const captured = vi.hoisted(() => ({ args: null as UseVersionHistoryArgs | null }));
const stable = vi.hoisted(() => ({
  versions: [],
  busy: false,
  active: false,
  notifySaved: () => {},
  captureNow: async () => {},
  loadDiff: async () => [],
  restore: async () => false,
  remove: async () => false,
  refresh: async () => {},
}));
vi.mock("./use-version-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-version-history")>()),
  useVersionHistory: (args: UseVersionHistoryArgs) => {
    captured.args = args;
    return stable;
  },
}));

function args(): UseVersionHistoryArgs {
  if (!captured.args) throw new Error("useVersionHistory was not called");
  return captured.args;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function mkTask(id: number, over: Partial<Task> = {}): Task {
  return {
    id, taskName: `T${id}`, assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "",
    status: "To Do", priority: "Medium", blockers: "", description: "", createdDate: "2026-01-01",
    ...over,
  };
}

const CFG = { url: "https://db.example", authToken: "tok" } as unknown as TursoConfig;
const STAKEHOLDER = { id: 7, name: "Ada" } as unknown as Stakeholder;
const EVENT = { id: 3, title: "Standup", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 15 } as CalendarEvent;

function makeDeps(over: Partial<VersionHistoryWiringDeps> = {}): VersionHistoryWiringDeps {
  return {
    stakeholders: [STAKEHOLDER],
    calendarEvents: [EVENT],
    tursoConfig: CFG,
    tursoProjectId: "p-1",
    storageKind: "turso",
    features: ["history"],
    versionHistoryRetention: undefined,
    isPopout: false,
    logActivityUser: vi.fn(),
    reportStorageOutcome: vi.fn(),
    versionNotifyRef: { current: () => {} },
    ...over,
  };
}

function mount(over: Partial<VersionHistoryWiringDeps> = {}) {
  const deps = makeDeps(over);
  const view = renderHook(() => ({ wiring: useVersionHistoryWiring(deps), ws: useWorkspace() }), { wrapper: Wrapper });
  return { ...view, deps };
}

beforeEach(() => {
  captured.args = null;
});

describe("useVersionHistoryWiring — the useVersionHistory args", () => {
  it("passes the config, the project id, the idle window and the activity logger, and returns the hook's result", () => {
    const h = mount();
    expect(args().config).toBe(CFG);
    expect(args().projectId).toBe("p-1");
    expect(args().idleMs).toBe(180_000);
    expect(args().logActivity).toBe(h.deps.logActivityUser);
    expect(h.result.current.wiring).toBe(stable);
  });

  it("maps a null project id to an empty string", () => {
    mount({ tursoProjectId: null });
    expect(args().projectId).toBe("");
  });

  it("uses the default retention unless settings carry one", () => {
    mount();
    expect(args().retention).toBe(DEFAULT_VERSION_RETENTION);
    mount({ versionHistoryRetention: 7 });
    expect(args().retention).toBe(7);
  });

  it("is enabled only on Turso storage, in the main window, with the history module on", () => {
    mount();
    expect(args().enabled).toBe(true);
    mount({ storageKind: "browser" });
    expect(args().enabled).toBe(false);
    mount({ isPopout: true });
    expect(args().enabled).toBe(false);
    mount({ features: ["changes"] });
    expect(args().enabled).toBe(false);
  });
});

describe("useVersionHistoryWiring — capture, restore, error, notify", () => {
  it("captures the workspace slices plus the two deps-field slices", () => {
    mount();
    const payload = JSON.parse(args().getPayload()) as Workspace;
    expect(payload.stakeholders).toEqual([STAKEHOLDER]);
    expect(payload.calendarEvents).toEqual([EVENT]);
    expect(payload.tasks).toEqual([]);
  });

  it("recaptures a context slice that changes", () => {
    const h = mount();
    act(() => { h.result.current.ws.setTasks([mkTask(1)]); });
    const payload = JSON.parse(args().getPayload()) as Workspace;
    expect(payload.tasks.map((t) => t.id)).toEqual([1]);
  });

  it("fans a restored workspace into the context and drops dangling dependencies", () => {
    const h = mount();
    const restored: Workspace = {
      ...emptyWorkspace(),
      tasks: [mkTask(1, { dependencies: [{ taskId: 99, type: "FS" }] }), mkTask(2)],
      milestones: [{ id: 4, name: "M", date: "2026-07-01" } as Milestone],
      stakeholders: [STAKEHOLDER],
    };
    act(() => { args().applyWorkspace?.(restored); });
    expect(h.result.current.ws.tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(h.result.current.ws.tasks[0].dependencies ?? []).toEqual([]);
    expect(h.result.current.ws.milestones.map((m) => m.id)).toEqual([4]);
  });

  it("reports a version error to the storage-status bridge", () => {
    const h = mount();
    const err = new Error("boom");
    args().onError?.(err);
    expect(h.deps.reportStorageOutcome).toHaveBeenCalledWith(err);
  });

  it("hands useVersionHistory's notifySaved to the save-success bridge", () => {
    const h = mount();
    expect(h.deps.versionNotifyRef.current).toBe(stable.notifySaved);
  });
});
