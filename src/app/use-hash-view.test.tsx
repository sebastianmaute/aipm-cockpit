import { renderHook, act, render, screen } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { isAuthResponseHash, useHashView } from "./use-hash-view";

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceTabProvider>{children}</WorkspaceTabProvider>;
}

afterEach(() => {
  window.location.hash = "";
});

describe("useHashView", () => {
  it("lands on the Dashboard home when no hash is present", () => {
    window.location.hash = "";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard");
  });

  it("selects the view named by the initial hash", () => {
    window.location.hash = "#gantt";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("gantt");
  });

  it("detects MSAL auth-response fragments (and only those)", () => {
    expect(isAuthResponseHash("#code=abc&state=xyz")).toBe(true);
    expect(isAuthResponseHash("#error=access_denied")).toBe(true);
    expect(isAuthResponseHash("#state=foo")).toBe(true);
    expect(isAuthResponseHash("#id_token=jwt")).toBe(true);
    expect(isAuthResponseHash("#raid/123")).toBe(false);
    expect(isAuthResponseHash("#open-points")).toBe(false);
    expect(isAuthResponseHash("")).toBe(false);
    expect(isAuthResponseHash("#")).toBe(false);
  });

  it("does NOT route or clobber an MSAL auth-response fragment (popup can close)", () => {
    window.location.hash = "#code=abc&state=xyz";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    // Stays on the default view (no routing) and leaves the fragment intact so
    // handleRedirectPromise can read it, broadcast, and close the popup.
    expect(result.current.activeTab).toBe("dashboard");
    expect(window.location.hash).toBe("#code=abc&state=xyz");
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
    renderHook(
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

  it("writes the hash via replaceState, not location.hash assignment", () => {
    // Regression: assigning location.hash fires `hashchange`, which the hook's
    // own listener handles by calling setActiveTab — a feedback loop that pegged
    // the main thread (blank page, no error). replaceState updates the URL
    // without re-entering the listener. See the hook doc comment.
    window.location.hash = "";
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    renderHook(
      () => {
        useHashView();
        const ctx = useWorkspaceTab();
        useLayoutEffect(() => { ctx.setActiveTab("raid"); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);
        return ctx;
      },
      { wrapper },
    );
    act(() => {});
    expect(replaceSpy).toHaveBeenCalledWith(null, "", "#raid");
    expect(window.location.hash).toBe("#raid");
    replaceSpy.mockRestore();
  });

  it("does nothing when disabled", () => {
    window.location.hash = "";
    const { result } = renderHook(
      () => { useHashView(false); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard");
  });

  it("removes the hashchange listener on unmount", () => {
    window.location.hash = "";
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useHashView(), { wrapper });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("hashchange", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("removes the popstate listener on unmount", () => {
    window.location.hash = "";
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useHashView(), { wrapper });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("re-derives the view on popstate (browser back/forward via mouse/keyboard nav)", () => {
    // Regression: a back/forward that changes the URL fragment via history
    // traversal (pushState/replaceState do NOT fire `hashchange` per spec)
    // left activeTab stale with only a hashchange listener wired up — the
    // modern shell then rendered a stale/blank branch until F5. Handling
    // popstate re-runs the same idempotent apply() that hashchange already
    // uses, re-deriving the view from the current location.hash.
    window.location.hash = "#gantt";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("gantt");

    act(() => {
      window.history.pushState(null, "", "#raid");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.activeTab).toBe("raid");
  });

  it("opens a deep-linked RAID item from #raid/123 on mount", () => {
    window.location.hash = "#raid/123";
    const seen: Array<{ view: string; id: number } | null> = [];
    function Probe() {
      useHashView(true);
      const { activeTab, pendingOpen } = useWorkspaceTab();
      seen.push(pendingOpen);
      return <span data-testid="tab">{activeTab}</span>;
    }
    render(<WorkspaceTabProvider><Probe /></WorkspaceTabProvider>);
    expect(screen.getByTestId("tab")).toHaveTextContent("raid");
    expect(seen.at(-1)).toEqual({ view: "raid", id: 123 });
  });

  it("ignores a hash pointing at a disabled-module view", () => {
    window.location.hash = "#raid/123";
    // features list excludes "raid" — the hook must not navigate to it
    const features: import("./feature-modules").FeatureModuleId[] = [];
    const seen: Array<string> = [];
    function Probe() {
      useHashView(true, features);
      const { activeTab } = useWorkspaceTab();
      seen.push(activeTab);
      return <span data-testid="tab">{activeTab}</span>;
    }
    render(<WorkspaceTabProvider><Probe /></WorkspaceTabProvider>);
    // activeTab must never have been set to "raid"
    expect(seen.every((t) => t !== "raid")).toBe(true);
    // pendingOpen must not contain a raid deep-link
    const { result } = renderHook(
      () => { useHashView(true, features); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).not.toBe("raid");
    expect(result.current.pendingOpen).toBeNull();
  });

  it("navigates to a view when its module is enabled", () => {
    window.location.hash = "#raid/123";
    const features: import("./feature-modules").FeatureModuleId[] = ["raid"];
    const seen: Array<{ view: string; id: number } | null> = [];
    function Probe() {
      useHashView(true, features);
      const { activeTab, pendingOpen } = useWorkspaceTab();
      seen.push(pendingOpen);
      return <span data-testid="tab2">{activeTab}</span>;
    }
    render(<WorkspaceTabProvider><Probe /></WorkspaceTabProvider>);
    expect(screen.getByTestId("tab2")).toHaveTextContent("raid");
    expect(seen.at(-1)).toEqual({ view: "raid", id: 123 });
  });
});
