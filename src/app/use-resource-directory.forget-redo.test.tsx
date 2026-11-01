// §788 — Redo of a person delete is a real delete, so it sweeps the cross-project answers like the first delete did.
// Driven through the REAL undo stack: undo alone sweeps nothing, redo sweeps the ids it actually removed.
import { act, configure, renderHook } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useResourceDirectory } from "./use-resource-directory";
import { useUndoStack } from "./undo/use-undo-stack";
import type { Resource } from "./types";

const wrapper = ({ children }: { children: ReactNode }) => (
  <FiltersProvider><WorkspaceProvider>{children}</WorkspaceProvider></FiltersProvider>
);
const person = (id: number, extra: Partial<Resource> = {}): Resource =>
  ({ id, firstName: `P${id}`, lastName: "X", roleId: null, utilizationMode: "percent", utilization: {}, ...extra }) as Resource;

function render() {
  const onResourcesDeleted = vi.fn();
  const { result } = renderHook(() => {
    const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
    const directory = useResourceDirectory({
      lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), logUpdate: vi.fn(),
      captureComposite: undo.captureComposite, onResourcesDeleted,
    });
    return { undo, directory, ws: useWorkspace() };
  }, { wrapper });
  act(() => { result.current.ws.setResources([person(5), person(6), person(7)]); });
  // The microtask the redo report rides on.
  const flush = () => act(async () => { await Promise.resolve(); });
  return { result, onResourcesDeleted, flush };
}

describe("a redone person delete sweeps (§788)", () => {
  it("single delete: the delete sweeps, Undo sweeps nothing, Redo sweeps the same id", async () => {
    const { result, onResourcesDeleted, flush } = render();
    act(() => { result.current.directory.handleDeleteResource(6); });
    expect(onResourcesDeleted).toHaveBeenCalledTimes(1);
    expect(onResourcesDeleted).toHaveBeenLastCalledWith([6]);
    act(() => { result.current.undo.undo(); });
    await flush();
    expect(result.current.ws.resources.map((r) => r.id).sort()).toEqual([5, 6, 7]);
    expect(onResourcesDeleted).toHaveBeenCalledTimes(1); // undo called nothing
    act(() => { result.current.undo.redo(); });
    await flush();
    expect(result.current.ws.resources.map((r) => r.id).sort()).toEqual([5, 7]);
    expect(onResourcesDeleted).toHaveBeenCalledTimes(2);
    expect(onResourcesDeleted).toHaveBeenLastCalledWith([6]);
  });

  it("bulk delete: Redo sweeps every id it removed", async () => {
    const { result, onResourcesDeleted, flush } = render();
    act(() => { result.current.directory.handleBulkDeleteResources([5, 7]); });
    onResourcesDeleted.mockClear();
    act(() => { result.current.undo.undo(); });
    await flush();
    expect(onResourcesDeleted).not.toHaveBeenCalled();
    act(() => { result.current.undo.redo(); });
    await flush();
    expect(onResourcesDeleted).toHaveBeenCalledTimes(1);
    expect([...onResourcesDeleted.mock.calls[0][0]].sort()).toEqual([5, 7]);
  });

  it("a person edited since the Undo is kept by Redo, and is not swept", async () => {
    const { result, onResourcesDeleted, flush } = render();
    act(() => { result.current.directory.handleDeleteResource(6); });
    onResourcesDeleted.mockClear();
    act(() => { result.current.undo.undo(); });
    await flush();
    act(() => { result.current.ws.setResources((prev) => prev.map((r) => (r.id === 6 ? { ...r, firstName: "Renamed" } : r))); });
    act(() => { result.current.undo.redo(); });
    await flush();
    expect(result.current.ws.resources.map((r) => r.id).sort()).toEqual([5, 6, 7]); // Redo kept the edited person
    expect(onResourcesDeleted).not.toHaveBeenCalled();
  });
});

// ★★ SHAPE MATTERS (src/app/strictmode.meta.test.tsx): `reactStrictMode: true` leaves nothing between the root and StrictMode,
// so React really double-invokes the redo's state updater here. A composed <StrictMode> wrapper would be vacuous-but-green.
// The observable is the CALL COUNT of the report: it is idempotent downstream, so a double report is invisible in the data.
describe("a redo reports its removed ids once, although React double-invokes updaters (§788)", () => {
  beforeAll(() => configure({ reactStrictMode: true }));
  afterAll(() => configure({ reactStrictMode: false }));

  it("delete + undo + redo = exactly two reports", async () => {
    const { result, onResourcesDeleted, flush } = render();
    act(() => { result.current.directory.handleDeleteResource(6); });
    act(() => { result.current.undo.undo(); });
    await flush();
    act(() => { result.current.undo.redo(); });
    await flush();
    expect(result.current.ws.resources.map((r) => r.id).sort()).toEqual([5, 7]);
    expect(onResourcesDeleted).toHaveBeenCalledTimes(2);
  });
});
