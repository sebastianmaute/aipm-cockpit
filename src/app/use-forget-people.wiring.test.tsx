// §788 — the delete → sweep seam as ONE composition, in task-manager's order and with the store mocked:
// useForgetPeopleBridge → useUndoStack → useResourcePlanner (reports through the bridge) → useCrossProjectApp (binds it).
// task-manager's own props are pinned by the source scan in use-cross-project-app.test.ts; everything below it is real.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Resource, ResourcePlan } from "./types";
import type { TursoConfig } from "./turso-config";
import type { Lang } from "./i18n";

vi.mock("./person-links-store", () => ({
  loadPersonLinks: vi.fn(async () => []),
  savePersonLink: vi.fn(async () => undefined),
  deletePersonLink: vi.fn(async () => undefined),
  deletePersonLinksFor: vi.fn(async () => undefined),
}));
vi.mock("./turso-backend", () => ({ TursoBackend: class {} }));

import { deletePersonLinksFor } from "./person-links-store";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useUndoStack } from "./undo/use-undo-stack";
import { useResourcePlanner } from "./use-resource-planner";
import { useCrossProjectApp, useForgetPeopleBridge } from "./use-cross-project-app";
import type { StorageConfig } from "./storage-config-kind";

const CONFIG = { httpUrl: "https://x.turso.io", authToken: "t" } as TursoConfig;
const PLAN: ResourcePlan = { startDate: "2026-11-02", endDate: "2026-11-29", granularity: "week", currency: "EUR" };
const person = (id: number): Resource =>
  ({ id, firstName: `P${id}`, lastName: "X", roleId: null, utilizationMode: "percent", utilization: {} }) as Resource;

const wrapper = ({ children }: { children: ReactNode }) => (
  <FiltersProvider><WorkspaceProvider>{children}</WorkspaceProvider></FiltersProvider>
);

function compose(storageKind: StorageConfig["kind"] = "turso") {
  const view = renderHook((props: { storageKind: StorageConfig["kind"] }) => {
    const forgetBridge = useForgetPeopleBridge();
    const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
    const planner = useResourcePlanner({
      lang: "en-US" as Lang, today: "2026-11-02", logActivity: vi.fn(), showToast: vi.fn(), workdayHours: 8,
      holidaySet: new Set<string>(), captureFieldRows: vi.fn(),
      captureComposite: undo.captureComposite, onResourcesDeleted: forgetBridge.notify,
    });
    const ws = useWorkspace();
    const crossProject = useCrossProjectApp({
      tursoConfig: CONFIG, portfolioMode: "turso", tursoProjects: [{ id: "p-here", meta: { name: "Here" } }],
      currentProjectId: "p-here", resources: ws.resources, plan: PLAN, workdayHours: 8, holidaySet: new Set(),
      loadPending: false, getScopeEpoch: () => 0, lang: "en-US", showToast: vi.fn(), forgetBridge,
      storageKind: props.storageKind,
    });
    return { undo, planner, ws, crossProject };
  }, { wrapper, initialProps: { storageKind } });
  act(() => { view.result.current.ws.setResources([person(5), person(6), person(7)]); });
  const flush = () => act(async () => { await Promise.resolve(); });
  return { view, flush };
}

beforeEach(() => vi.mocked(deletePersonLinksFor).mockReset().mockResolvedValue(undefined));

describe("planner → bridge → people hook, as task-manager composes them (§788)", () => {
  it("a delete sweeps the project's id, Undo sweeps nothing, Redo sweeps again", async () => {
    const { view, flush } = compose();
    act(() => { view.result.current.planner.handleDeleteResource(6); });
    await flush();
    expect(deletePersonLinksFor).toHaveBeenCalledTimes(1);
    expect(deletePersonLinksFor).toHaveBeenLastCalledWith(CONFIG, "p-here", [6]);
    act(() => { view.result.current.undo.undo(); });
    await flush();
    expect(deletePersonLinksFor).toHaveBeenCalledTimes(1);
    act(() => { view.result.current.undo.redo(); });
    await flush();
    expect(deletePersonLinksFor).toHaveBeenCalledTimes(2);
    expect(deletePersonLinksFor).toHaveBeenLastCalledWith(CONFIG, "p-here", [6]);
  });

  it("a bulk delete sweeps every removed id in one call", async () => {
    const { view, flush } = compose();
    act(() => { view.result.current.planner.handleBulkDeleteResources([5, 7, 404]); });
    await flush();
    expect(deletePersonLinksFor).toHaveBeenCalledTimes(1);
    expect([...vi.mocked(deletePersonLinksFor).mock.calls[0][2]].sort()).toEqual([5, 7]);
  });

  it("with a non-Turso live storage kind a delete and a redo sweep nothing", async () => {
    const { view, flush } = compose("browser");
    act(() => { view.result.current.planner.handleDeleteResource(6); });
    act(() => { view.result.current.undo.undo(); });
    act(() => { view.result.current.undo.redo(); });
    await flush();
    expect(view.result.current.ws.resources.map((r) => r.id).sort()).toEqual([5, 7]);
    expect(deletePersonLinksFor).not.toHaveBeenCalled();
  });

  it("switching the live kind back to Turso makes the next delete sweep", async () => {
    const { view, flush } = compose("browser");
    view.rerender({ storageKind: "turso" });
    act(() => { view.result.current.planner.handleDeleteResource(5); });
    await flush();
    expect(deletePersonLinksFor).toHaveBeenCalledWith(CONFIG, "p-here", [5]);
  });
});
