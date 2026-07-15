import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { buildHash } from "./nav-config";

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceTabProvider>{children}</WorkspaceTabProvider>;
}

describe("pendingOpen", () => {
  it("requestOpen sets the active tab and pending target; clear resets it", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    act(() => result.current.requestOpen("raid", 42));
    expect(result.current.activeTab).toBe("raid");
    expect(result.current.pendingOpen).toEqual({ view: "raid", id: 42 });
    act(() => result.current.clearPendingOpen());
    expect(result.current.pendingOpen).toBeNull();
  });

  it("writes the deep-link hash via replaceState so it does not fire a re-entrant hashchange", () => {
    // Root cause of the stuck full-page editor: `location.hash = …` fires a
    // hashchange, useHashView re-invokes requestOpen, and the re-entrant
    // setActiveTab navigates away from the just-armed editor. replaceState
    // updates the URL without the self-triggered hashchange (mirrors useHashView's
    // own view->hash write).
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const hashChanged = vi.fn();
    window.addEventListener("hashchange", hashChanged);
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    act(() => result.current.requestOpen("open-points", 5));
    expect(window.location.hash).toBe(buildHash("open-points", 5));
    expect(replaceSpy).toHaveBeenCalled();
    window.removeEventListener("hashchange", hashChanged);
    replaceSpy.mockRestore();
  });
});

afterEach(() => {
  window.history.replaceState(null, "", " ");
});

describe("pendingChatSeed", () => {
  it("requestChat switches to the chat tab and stores the seed", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    act(() => result.current.requestChat("Summarize risks", true));
    expect(result.current.activeTab).toBe("chat");
    expect(result.current.pendingChatSeed).toEqual({ prompt: "Summarize risks", autoSend: true });
  });

  it("clearChatSeed nulls the seed", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    act(() => result.current.requestChat("Summarize risks", true));
    act(() => result.current.clearChatSeed());
    expect(result.current.pendingChatSeed).toBeNull();
  });
});

describe("WorkspaceTabContext", () => {
  it("default activeTab is 'dashboard' and isPopout is false", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    expect(result.current.activeTab).toBe("dashboard");
    expect(result.current.isPopout).toBe(false);
  });

  it("setActiveTab updates activeTab", () => {
    const { result } = renderHook(
      () => {
        const ctx = useWorkspaceTab();
        useLayoutEffect(() => {
          ctx.setActiveTab("reports");
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return ctx;
      },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("reports");
  });
});
