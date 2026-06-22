import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";

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
