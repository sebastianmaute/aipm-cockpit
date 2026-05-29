import { renderHook, act } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { useHashView } from "./use-hash-view";

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceTabProvider>{children}</WorkspaceTabProvider>;
}

afterEach(() => {
  window.location.hash = "";
});

describe("useHashView", () => {
  it("selects open-points when no hash present", () => {
    window.location.hash = "";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("open-points");
  });

  it("selects the view named by the initial hash", () => {
    window.location.hash = "#gantt";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("gantt");
  });

  it("falls back to open-points on an unknown hash", () => {
    window.location.hash = "#nope";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("open-points");
  });

  it("writes the hash when the view changes", () => {
    window.location.hash = "";
    const { result } = renderHook(
      () => {
        useHashView();
        const ctx = useWorkspaceTab();
        useLayoutEffect(() => { ctx.setActiveTab("raid"); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);
        return ctx;
      },
      { wrapper },
    );
    // Flush the write useEffect that responds to the setActiveTab("raid") above.
    act(() => {});
    expect(window.location.hash).toBe("#raid");
  });

  it("removes the hashchange listener on unmount", () => {
    window.location.hash = "";
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useHashView(), { wrapper });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("hashchange", expect.any(Function));
    removeSpy.mockRestore();
  });
});
