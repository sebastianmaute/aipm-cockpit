import { renderHook, act, render, screen } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { isAuthResponseHash, useHashView } from "./use-hash-view";
import { ALL_MODULE_IDS } from "./feature-modules";

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

  // MIGRATED: this asserted that a bare "#gantt" selects Gantt on mount, which
  // a cold load now treats as stale session residue. The surviving claim — an
  // ITEM-bearing initial hash selects its view — is pinned here at a second
  // slug, and for the Dashboard-vs-deep-link split see the cold-load tests below.
  it("selects the view named by an item-bearing initial hash", () => {
    window.location.hash = "#gantt/7";
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

  // MIGRATED: the claim (an unknown hash never strands the user on a dead view)
  // is intact; WHICH view it lands on was the stale detail. A cold load stops at
  // the stale-residue gate before slugToView's fallback matters, so it goes to
  // the Dashboard; slugToView's open-points fallback is still what a LATER
  // navigation to an unknown slug resolves to, and both are pinned here.
  it("falls back to a valid view on an unknown hash", () => {
    window.location.hash = "#nope";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard");

    act(() => {
      window.location.hash = "#nope-either";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
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
    // MIGRATED: the starting hash is item-bearing so the cold load still honours
    // it (a bare "#gantt" is now treated as stale residue and lands on the
    // Dashboard). The popstate claim this test exists for is unchanged.
    window.location.hash = "#gantt/7";
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

  it("treats a view-only hash as stale on a cold load and lands on the Dashboard", () => {
    window.location.hash = "#raid";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard");
    expect(result.current.pendingOpen).toBeNull();
  });

  it("honours an item-bearing deep link on a cold load", () => {
    window.location.hash = "#raid/123";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("raid");
    expect(result.current.pendingOpen).toEqual({ view: "raid", id: 123 });
  });

  it("keeps the hash authoritative after mount, so back/forward still work", () => {
    window.location.hash = "";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard");
    // A LATER navigation is not a cold load: the hash wins, view-only or not.
    act(() => {
      window.location.hash = "#raid";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.activeTab).toBe("raid");
  });

  it("lands on open-points on a cold load when the dashboard module is disabled", () => {
    // Exercises the COLD branch's blankView fallback, which is unreachable
    // today: a non-blank hash never consults blankView, so this asserts NEW
    // behaviour and fails pre-fix. It is not a pre-existing regression guard.
    window.location.hash = "#raid";
    const features = ALL_MODULE_IDS.filter((m) => m !== "dashboard");
    const { result } = renderHook(
      () => { useHashView(true, features); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("open-points");
  });

  it("leaves an MSAL auth-response fragment untouched on a cold load", () => {
    window.location.hash = "#code=abc&state=xyz";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard");
    expect(window.location.hash).toBe("#code=abc&state=xyz");
  });
});
