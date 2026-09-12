import { renderHook, act, render, screen } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { isAuthResponseHash, useHashView } from "./use-hash-view";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";

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
    // ★★ Same non-colliding `features` list as the cold-load sibling below, and
    //    for the same reason: with the default (all modules) this test ALSO
    //    passed with `isAuthResponseHash`'s early return deleted, because
    //    "dashboard" is both the provider default and `blankView`.
    const features = ALL_MODULE_IDS.filter((m) => m !== "dashboard");
    const { result } = renderHook(
      () => { useHashView(true, features); return useWorkspaceTab(); },
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
    // ★★ THE `features` LIST IS WHAT MAKES THIS TEST NON-VACUOUS. With the
    //    default (all modules) it passed with `isAuthResponseHash`'s early
    //    return DELETED from `apply`, because the expected value collided with
    //    `blankView`: "dashboard" is both the provider's default AND where the
    //    cold rule routes an unrecognised hash, so the assertion could not tell
    //    "the MSAL guard returned" from "the cold rule routed home". Dropping
    //    `dashboard` moves `blankView` to "open-points", so the two paths now
    //    have different observable values and only the guard yields "dashboard".
    window.location.hash = "#code=abc&state=xyz";
    const features = ALL_MODULE_IDS.filter((m) => m !== "dashboard");
    const { result } = renderHook(
      () => { useHashView(true, features); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard");
    expect(window.location.hash).toBe("#code=abc&state=xyz");
  });

  it("does not re-apply the cold rule when the effect re-runs on a new features identity", () => {
    // The mount effect's deps include `features`, and the async settings load
    // commits a FRESH array for any user with a module disabled — so the effect
    // re-runs while the user is mid-session. `apply` is no longer idempotent
    // (a cold run discards a view-only hash), so without the cold-once ref that
    // re-run snaps the user off the view they had navigated to.
    window.location.hash = "";
    const { result, rerender } = renderHook(
      ({ features }: { features: readonly FeatureModuleId[] }) => {
        useHashView(true, features);
        return useWorkspaceTab();
      },
      { wrapper, initialProps: { features: [...ALL_MODULE_IDS] as readonly FeatureModuleId[] } },
    );
    expect(result.current.activeTab).toBe("dashboard");

    // The user navigates. A later hashchange is authoritative, view-only or not.
    // ★ Park on a NON-dashboard view: if the parked view were the cold target,
    //   the final assertion could not tell a warm re-apply from a cold one.
    act(() => {
      window.location.hash = "#raid";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.activeTab).toBe("raid");

    // Settings land with a genuinely DIFFERENT set, so the effect re-runs and
    // the user must STAY on raid.
    // ★ A new array of the SAME members would also re-run the effect, but
    //   `sameFeatureSet` (use-features-sync.ts) reuses the old array in that
    //   case, so the real app cannot produce it.
    // ★★ The dropped module is `knowledge`, deliberately NOT raid's: dropping
    //    the PARKED view's module would make `isViewEnabled` short-circuit
    //    `apply` before the cold flag is ever read, so the test would pass via
    //    that early return and survive the `apply(true)` mutant.
    const withoutKnowledge = ALL_MODULE_IDS.filter((m) => m !== "knowledge");
    rerender({ features: withoutKnowledge });
    expect(result.current.activeTab).toBe("raid");
  });

  it("re-arms the cold rule when the hook is disabled and re-enabled (classic round trip)", () => {
    // A ref that latched once for the hook's LIFETIME reintroduced the defect by
    // another route: modern → classic → modern. Both of this hook's effects are
    // off during the classic interlude, so nothing HERE maintains the hash and
    // it is residue by re-activation — which makes it a COLD load. It is not
    // frozen, though: `requestOpen` still writes item hashes during classic
    // (docs/open-followups.md §478). This test parks a VIEW-ONLY hash, so it
    // covers the Dashboard branch of re-entry and not the item-bearing one.
    // Latching once would instead honour that stale hash on the second
    // activation and yank the user off their current view.
    window.location.hash = "";
    // ★★ Hoisted, not inline — see the note on the first-EXECUTED-run test: an
    //    inline `features` array re-runs the effect every render and loops.
    const features = [...ALL_MODULE_IDS] as readonly FeatureModuleId[];
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        useHashView(enabled, features);
        return useWorkspaceTab();
      },
      { wrapper, initialProps: { enabled: true } },
    );
    expect(result.current.activeTab).toBe("dashboard");

    act(() => {
      window.location.hash = "#raid";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.activeTab).toBe("raid");

    rerender({ enabled: false }); // classic: both effects go quiet
    rerender({ enabled: true }); // back to modern — a fresh cold window
    expect(result.current.activeTab).toBe("dashboard");
  });

  it("applies the cold rule on the first EXECUTED run, not the first render", () => {
    // The effect returns early while disabled, so a Classic→Modern switch makes
    // the first EXECUTED run the cold load for that window. The ref must
    // therefore be set INSIDE the effect after apply, never during render.
    window.location.hash = "#raid";
    // ★★ HOIST `features` — do NOT build it inside the callback. It is an
    //    effect DEP, so an inline array is a new identity every render, which
    //    re-runs the effect on every render; once a cold apply actually CHANGES
    //    activeTab that becomes a render loop (measured: "Maximum update depth
    //    exceeded" from `apply`). The real call site passes `settings.features`,
    //    a stable reference between settings commits.
    const features = [...ALL_MODULE_IDS] as readonly FeatureModuleId[];
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        useHashView(enabled, features);
        return useWorkspaceTab();
      },
      { wrapper, initialProps: { enabled: false } },
    );
    expect(result.current.activeTab).toBe("dashboard");

    rerender({ enabled: true });
    // Cold: the view-only "#raid" is stale session residue, so we land home.
    expect(result.current.activeTab).toBe("dashboard");
  });
});
