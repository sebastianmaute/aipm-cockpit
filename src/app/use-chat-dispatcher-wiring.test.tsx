// §491 — pins use-chat-dispatcher-wiring.ts on its own: what it hands
// `useChatDispatcher` (every forwarded field, the dashboard-model getter) and the
// two derived read-tool getters — the budget rollup's module gate and its
// argument order into `computeBudgetReport`, and the allocations getter's inputs.
// `useChatDispatcher`, `computeBudgetReport` and `makeAllocationsSnapshotGetter`
// are mocked to capture their arguments; the workspace is the real
// WorkspaceProvider, so the slices are the ones task-manager would read.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import type { ChatDispatcherArgs } from "./use-chat-dispatcher";
import { useChatDispatcherWiring, type ChatDispatcherWiringDeps } from "./use-chat-dispatcher-wiring";
import type { Settings } from "./settings-types";
import type { DashboardModel } from "./dashboard";
import type { ProjectClock } from "./timezone";
import type { Absence, BudgetBucket, FxRates, Resource, ResourcePlan, Role, Task } from "./types";

const captured = vi.hoisted(() => ({
  args: null as ChatDispatcherArgs | null,
  budgetCalls: [] as unknown[][],
  allocInputs: null as unknown,
}));
const DISPATCHER = vi.hoisted(() => ({ tag: "dispatcher" }));
const PROJECT = vi.hoisted(() => ({ tag: "project-rollup" }));
const ALLOC_GETTER = vi.hoisted(() => () => ({ tag: "alloc-snapshot" }));

vi.mock("./use-chat-dispatcher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-chat-dispatcher")>()),
  useChatDispatcher: (a: ChatDispatcherArgs) => {
    captured.args = a;
    return DISPATCHER;
  },
}));
vi.mock("./budget-report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./budget-report")>()),
  computeBudgetReport: (...a: unknown[]) => {
    captured.budgetCalls.push(a);
    return { project: PROJECT };
  },
}));
vi.mock("./alloc-plan/alloc-plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./alloc-plan/alloc-plan")>()),
  makeAllocationsSnapshotGetter: (inputs: unknown) => {
    captured.allocInputs = inputs;
    return ALLOC_GETTER;
  },
}));

function args(): ChatDispatcherArgs {
  if (!captured.args) throw new Error("useChatDispatcher was not called");
  return captured.args;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function mkTask(id: number): Task {
  return {
    id, taskName: `T${id}`, assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "",
    status: "To Do", priority: "Medium", blockers: "", description: "", createdDate: "2026-01-01",
  };
}

/** Gives every slice the getters read a DISTINCT marker, so a swapped argument
 *  cannot pass by two slices being the same empty default. */
function seed(ws: ReturnType<typeof useWorkspace>) {
  act(() => {
    ws.setTasks([mkTask(1)]);
    ws.setAbsences([{ id: 2 } as unknown as Absence]);
    ws.setResources([{ id: 3 } as unknown as Resource]);
    ws.setRoles([{ id: 4 } as unknown as Role]);
    ws.setPlan({ tag: "plan" } as unknown as ResourcePlan);
    ws.setBudgets([{ id: 5 } as unknown as BudgetBucket]);
    ws.setFxRates({ tag: "fx" } as unknown as FxRates);
  });
}

function mkSettings(features: string[]): Settings {
  return { features, resources: { workdayHours: 7.5 } } as unknown as Settings;
}

const HOLIDAYS: ReadonlySet<string> = new Set(["2026-12-25"]);
const MODEL = { tag: "dashboard-model" } as unknown as DashboardModel;
const CLOCK = { today: "2026-10-08" } as unknown as ProjectClock;

function makeDeps(over: Partial<ChatDispatcherWiringDeps> = {}): ChatDispatcherWiringDeps {
  return {
    settings: mkSettings(["budget"]),
    clock: CLOCK,
    onSettingsLoggedByAi: vi.fn(),
    setSelectedIds: vi.fn(),
    setSettings: vi.fn(),
    isReadOnly: false,
    currentView: "open-points",
    settingsProjectId: "proj-1",
    holidaySet: HOLIDAYS,
    logActivityAs: vi.fn(),
    allowDestructiveSave: vi.fn(),
    undo: { captureComposite: vi.fn() },
    dashboardModel: MODEL,
    ...over,
  };
}

function mount(over: Partial<ChatDispatcherWiringDeps> = {}) {
  const deps = makeDeps(over);
  const view = renderHook(() => ({ dispatcher: useChatDispatcherWiring(deps), ws: useWorkspace() }), { wrapper: Wrapper });
  return { ...view, deps };
}

beforeEach(() => {
  captured.args = null;
  captured.budgetCalls = [];
  captured.allocInputs = null;
});

describe("useChatDispatcherWiring — the useChatDispatcher args", () => {
  it("returns the dispatcher useChatDispatcher built", () => {
    const h = mount();
    expect(h.result.current.dispatcher).toBe(DISPATCHER);
  });

  it("forwards every deps field unchanged", () => {
    const h = mount();
    const d = h.deps;
    expect(args().settings).toBe(d.settings);
    expect(args().clock).toBe(d.clock);
    expect(args().onSettingsLoggedByAi).toBe(d.onSettingsLoggedByAi);
    expect(args().setSelectedIds).toBe(d.setSelectedIds);
    expect(args().setSettings).toBe(d.setSettings);
    expect(args().currentView).toBe("open-points");
    expect(args().settingsProjectId).toBe("proj-1");
    expect(args().holidaySet).toBe(HOLIDAYS);
    expect(args().logActivityAs).toBe(d.logActivityAs);
    expect(args().allowDestructiveSave).toBe(d.allowDestructiveSave);
    expect(args().undo).toBe(d.undo);
  });

  it("forwards isReadOnly in both states", () => {
    mount({ isReadOnly: false });
    expect(args().isReadOnly).toBe(false);
    mount({ isReadOnly: true });
    expect(args().isReadOnly).toBe(true);
  });

  it("hands the dashboard model through a getter", () => {
    mount();
    expect(args().getDashboardModel()).toBe(MODEL);
  });
});

describe("useChatDispatcherWiring — getBudgetRollup", () => {
  it("returns null without computing anything when the budget module is off", () => {
    mount({ settings: mkSettings(["raid"]) });
    expect(args().getBudgetRollup()).toBeNull();
    expect(captured.budgetCalls).toHaveLength(0);
  });

  it("returns the report's project rollup when the budget module is on", () => {
    mount();
    expect(args().getBudgetRollup()).toBe(PROJECT);
    expect(captured.budgetCalls).toHaveLength(1);
  });

  it("is not computed until the tool asks for it", () => {
    mount();
    expect(captured.budgetCalls).toHaveLength(0);
  });

  it("passes the live workspace slices in computeBudgetReport's order, tasks included", () => {
    const h = mount();
    seed(h.result.current.ws);
    args().getBudgetRollup();
    expect(captured.budgetCalls[0]).toEqual([
      [{ id: 5 }], { tag: "plan" }, [{ id: 4 }], [{ id: 3 }], 7.5, HOLIDAYS, [{ id: 2 }], [mkTask(1)], { tag: "fx" },
    ]);
  });
});

describe("useChatDispatcherWiring — getAllocationsSnapshot", () => {
  it("is the getter the factory built, from the workspace slices and settings", () => {
    const h = mount();
    seed(h.result.current.ws);
    expect(args().getAllocationsSnapshot).toBe(ALLOC_GETTER);
    expect(captured.allocInputs).toEqual({
      resources: [{ id: 3 }],
      plan: { tag: "plan" },
      absences: [{ id: 2 }],
      workdayHours: 7.5,
      holidaySet: HOLIDAYS,
    });
  });
});
