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

describe("WorkspaceTabContext", () => {
  it("default activeTab is 'chat' and isPopout is false", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    expect(result.current.activeTab).toBe("chat");
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
