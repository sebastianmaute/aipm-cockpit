// §788 — an AI delete of a person reports the removal so their cross-project answers go with them.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { __resetMintStateForTests } from "./id-mint-session";
import type { Resource } from "./types";
import { useChatDispatcher } from "./use-chat-dispatcher";

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
