// §788 — an AI delete of a person reports the removal so their cross-project answers go with them.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { __resetMintStateForTests } from "./id-mint-session";
import type { Resource } from "./types";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useUndoStack } from "./undo/use-undo-stack";

const res = (id: number, firstName: string): Resource =>
  ({ id, firstName, lastName: "Bennett", roleId: null, utilizationMode: "percent", utilization: {} }) as Resource;

function render(over: Parameters<typeof makeDispatcherArgs>[0] = {}) {
  __resetMintStateForTests();
  return renderHook(() => useChatDispatcher(makeDispatcherArgs(over)), {
    wrapper: dispatcherWrapperWith({ resources: [res(1, "Ada"), res(2, "Grace")] }),
  });
}

describe("useChatDispatcher deleteResource reports the removal (§788)", () => {
  test("a delete that removed someone reports exactly that id", () => {
    const onResourcesDeleted = vi.fn();
    const { result } = render({ onResourcesDeleted });
    let removed = false;
    act(() => { removed = result.current.deleteResource(2); });
    expect(removed).toBe(true);
    expect(onResourcesDeleted).toHaveBeenCalledTimes(1);
    expect(onResourcesDeleted).toHaveBeenCalledWith([2]);
  });

  test("an unknown id removes nobody and reports nothing", () => {
    const onResourcesDeleted = vi.fn();
    const { result } = render({ onResourcesDeleted });
    let removed = true;
    act(() => { removed = result.current.deleteResource(999); });
    expect(removed).toBe(false);
    expect(onResourcesDeleted).not.toHaveBeenCalled();
  });

  test("a read-only dispatcher (popout) refuses and reports nothing", () => {
    const onResourcesDeleted = vi.fn();
    const { result } = render({ onResourcesDeleted, isReadOnly: true });
    expect(() => result.current.deleteResource(1)).toThrow();
    expect(onResourcesDeleted).not.toHaveBeenCalled();
  });

  test("works without the callback", () => {
    const { result } = render();
    expect(() => { act(() => { result.current.deleteResource(1); }); }).not.toThrow();
  });
});

describe("useChatDispatcher deleteResource during the load hold (§788)", () => {
  // The hold covers a project swap, a same-project Reload and a backend rebuild; task-manager's reader is
  // `isSwapInFlight() || loadPendingRef.current` (source-pinned in use-cross-project-app.test.ts).
  test("is refused while the load hold is on: nobody is removed and nothing is reported", () => {
    const onResourcesDeleted = vi.fn();
    const { result } = render({ onResourcesDeleted, isLoadHeld: () => true });
    expect(() => result.current.deleteResource(2)).toThrow();
    expect(result.current.listResources().map((r) => r.id)).toEqual([1, 2]);
    expect(onResourcesDeleted).not.toHaveBeenCalled();
  });

  test("goes through when the hold is off (a cross-project reload is not the hold)", () => {
    const onResourcesDeleted = vi.fn();
    const { result } = render({ onResourcesDeleted, isLoadHeld: () => false });
    act(() => { result.current.deleteResource(2); });
    expect(onResourcesDeleted).toHaveBeenCalledWith([2]);
  });
});

describe("a redone AI person delete sweeps (§788)", () => {
  test("the delete sweeps, Undo sweeps nothing, Redo sweeps the same id", async () => {
    __resetMintStateForTests();
    const onResourcesDeleted = vi.fn();
    const { result } = renderHook(
      () => {
        const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
        const dispatcher = useChatDispatcher(makeDispatcherArgs({ undo, onResourcesDeleted }));
        return { undo, dispatcher };
      },
      { wrapper: dispatcherWrapperWith({ resources: [res(1, "Ada"), res(2, "Grace")] }) },
    );
    act(() => { result.current.dispatcher.deleteResource(2); });
    expect(onResourcesDeleted).toHaveBeenLastCalledWith([2]);
    onResourcesDeleted.mockClear();
    act(() => { result.current.undo.undo(); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.dispatcher.listResources().map((r) => r.id).sort()).toEqual([1, 2]);
    expect(onResourcesDeleted).not.toHaveBeenCalled();
    act(() => { result.current.undo.redo(); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.dispatcher.listResources().map((r) => r.id)).toEqual([1]);
    expect(onResourcesDeleted).toHaveBeenCalledTimes(1);
    expect(onResourcesDeleted).toHaveBeenCalledWith([2]);
  });
});
