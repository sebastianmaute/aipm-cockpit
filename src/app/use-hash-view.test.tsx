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

  it("rewrites the hash to the current view when the deep link targets a disabled module", () => {
    // Fix round 1, mutant-4 gap: a mutant that arms pendingApplyRef BEFORE the
    // disabled-target bail (rather than after) leaves this hash stale forever
    // — "#raid/123" would point at a view the user cannot reach. The sibling
    // test above never asserts the hash, so it could not catch that.
    window.location.hash = "#raid/123";
    const features: import("./feature-modules").FeatureModuleId[] = []; // raid is not enabled
    const { result } = renderHook(
      () => { useHashView(true, features); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard"); // positive observable
    expect(window.location.hash).toBe("#dashboard");
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

  it("rewrites a cold view-only stale hash to the current view in the URL", () => {
    // Fix round 1, Critical (§478 re-opened): arming pendingApplyRef even when
    // setActiveTab(view) is a no-op (view === activeTab, as it is for the
    // stale-residue target here) starves the passive effect of the run it
    // needs to normalise the hash. Pre-fix this left "#budget" in the URL for
    // the rest of the session, and a later warm re-apply (e.g. a fresh
    // `features` identity from the async settings load) would then read that
    // stale hash back and misroute the user onto Budget.
    window.location.hash = "#budget";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard"); // positive observable
    expect(window.location.hash).toBe("#dashboard");
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

  it("does not leave the flag armed after a warm re-apply whose target already matches activeTab", () => {
    // Fix round 1, Important: a warm apply whose target equals activeTab also
    // armed the flag pre-fix. setActiveTab is then a no-op (same value), so no
    // second passive-effect run ever consumes the flag — it stays armed and
    // swallows the hash write for the NEXT genuine view change.
    window.location.hash = "";
    const { result, rerender } = renderHook(
      ({ features }: { features: readonly FeatureModuleId[] }) => {
        useHashView(true, features);
        return useWorkspaceTab();
      },
      { wrapper, initialProps: { features: [...ALL_MODULE_IDS] as readonly FeatureModuleId[] } },
    );
    expect(result.current.activeTab).toBe("dashboard");

    // A features re-run whose resolved target ("dashboard", the hash is still
    // blank) already equals activeTab: a warm apply, not a navigation.
    const withoutKnowledge = ALL_MODULE_IDS.filter((m) => m !== "knowledge");
    rerender({ features: withoutKnowledge });
    expect(result.current.activeTab).toBe("dashboard");

    // A genuine view change afterwards must still write the hash.
    act(() => { result.current.setActiveTab("raid"); });
    expect(window.location.hash).toBe("#raid");
  });

  // MIGRATED (§478): this test used to be "re-arms the cold rule when the hook is
  // disabled and re-enabled" and asserted option (b) — a hash parked on `#raid`
  // resolved to the Dashboard after `enabled` false → true. Option (c) was
  // chosen instead: a layout switch is NOT a navigation, so the user stays put.
  it("keeps the current view on a layout re-entry (classic round trip) and rewrites the hash to it", () => {
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

    // ★ Park on a NON-dashboard view: the Dashboard is the cold target, so a
    //   re-entry that wrongly went cold would be indistinguishable otherwise.
    act(() => {
      window.location.hash = "#raid";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.activeTab).toBe("raid");

    rerender({ enabled: false }); // classic: both effects go quiet
    // The user keeps navigating in classic, which writes no hash — so the URL
    // still says `#raid` while they are on Gantt.
    act(() => { result.current.setActiveTab("gantt"); });
    expect(window.location.hash).toBe("#raid");

    rerender({ enabled: true }); // back to modern — a re-entry, not a navigation
    expect(result.current.activeTab).toBe("gantt");
    expect(result.current.pendingOpen).toBeNull();
    expect(window.location.hash).toBe("#gantt");
  });

  it("does not reopen an item-bearing hash left by requestOpen during classic, even on the same base view", () => {
    // `requestOpen` writes `#<view>/<id>` in every non-popout layout, so an item
    // opened from global search while in classic leaves a real-looking deep link
    // behind. A re-entry must not honour it, and — because the user is still on
    // that item's BASE view — the ordinary base-view comparison would keep the
    // stale `/123`; the re-entry writes the bare view itself.
    window.location.hash = "";
    const features = [...ALL_MODULE_IDS] as readonly FeatureModuleId[];
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        useHashView(enabled, features);
        return useWorkspaceTab();
      },
      { wrapper, initialProps: { enabled: true } },
    );
    expect(result.current.activeTab).toBe("dashboard");

    rerender({ enabled: false });
    act(() => { result.current.requestOpen("raid", 123); });
    expect(window.location.hash).toBe("#raid/123");
    // The editor consumed the request, as the real panel does.
    act(() => { result.current.clearPendingOpen(); });
    expect(result.current.pendingOpen).toBeNull();

    rerender({ enabled: true });
    expect(result.current.activeTab).toBe("raid");
    expect(result.current.pendingOpen).toBeNull(); // requestOpen was NOT re-invoked
    expect(window.location.hash).toBe("#raid");
  });

  it("keeps back/forward authoritative after a layout re-entry", () => {
    window.location.hash = "";
    const features = [...ALL_MODULE_IDS] as readonly FeatureModuleId[];
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        useHashView(enabled, features);
        return useWorkspaceTab();
      },
      { wrapper, initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    rerender({ enabled: true });
    act(() => {
      window.location.hash = "#gantt";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.activeTab).toBe("gantt");
  });

  it("is cold on the first enabled window even when the page loaded disabled and the cold target is not the default tab", () => {
    // ★★ This is no longer a defensive case. Since §536, task-manager.tsx
    //    passes `hydrated && layout === "modern"`, so EVERY page load starts
    //    this hook disabled and enables it once settings resolve. This test
    //    pins the whole app's startup path, not an edge case.
    // Sibling of the first-EXECUTED-run test below, which cannot tell "cold"
    // from "re-entry" on its own: its cold target (Dashboard) is also the
    // provider's default tab, and a re-entry keeps the default tab. Dropping the
    // dashboard module moves the cold target to open-points, so only a genuine
    // cold apply can land there.
    window.location.hash = "#raid";
    const features = ALL_MODULE_IDS.filter((m) => m !== "dashboard");
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        useHashView(enabled, features);
        return useWorkspaceTab();
      },
      { wrapper, initialProps: { enabled: false } },
    );
    expect(result.current.activeTab).toBe("dashboard");
    rerender({ enabled: true });
    expect(result.current.activeTab).toBe("open-points");
  });

  it("does not treat StrictMode's mount → unmount → mount as a layout re-entry", () => {
    // A re-entry rewrites the URL to the bare view, which would strip the `/<id>`
    // from a genuine deep link on the very first load in dev (StrictMode).
    // ★★ The deep link targets the provider's DEFAULT view on purpose. For any
    //    other view the cold apply changes `activeTab`, and a PRE-EXISTING race
    //    (identical in the pre-§478 hook, measured) then loses the deep link
    //    under StrictMode by a different route: the first passive view→hash
    //    write still sees the old tab and replaces the hash with `#dashboard`,
    //    which the remount's warm apply reads back. That would make this test
    //    assert the race instead of the property it exists for.
    window.location.hash = "#dashboard/5";
    const addSpy = vi.spyOn(window, "addEventListener");
    const features = [...ALL_MODULE_IDS] as readonly FeatureModuleId[];
    const { result } = renderHook(
      () => { useHashView(true, features); return useWorkspaceTab(); },
      { wrapper, reactStrictMode: true },
    );
    // Positive observable: the layout effect really was double-invoked here
    // (see strictmode.meta.test.tsx), otherwise this test is vacuous.
    expect(addSpy.mock.calls.filter(([type]) => type === "hashchange")).toHaveLength(2);
    addSpy.mockRestore();
    expect(result.current.activeTab).toBe("dashboard");
    expect(result.current.pendingOpen).toEqual({ view: "dashboard", id: 5 });
    expect(window.location.hash).toBe("#dashboard/5");
  });

  it("keeps the item id in the URL when a cold deep link routes to another view", () => {
    // §535: the layout effect's cold apply sees "#raid/123" and calls
    // setActiveTab("raid"), but React has not committed that yet — the passive
    // view→hash effect used to run in the SAME commit with activeTab still
    // "dashboard", see a mismatch, and rewrite the URL to "#dashboard",
    // destroying the deep link before the tab change even lands.
    window.location.hash = "#raid/123";
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("raid");
    expect(result.current.pendingOpen).toEqual({ view: "raid", id: 123 });
    // The bug wrote "#dashboard" here, then "#raid", losing /123.
    const urls = replaceSpy.mock.calls.map((call) => String(call[2]));
    expect(urls).not.toContain("#dashboard");
    expect(window.location.hash).toBe("#raid/123");
    replaceSpy.mockRestore();
  });

  it("does not treat StrictMode's double invoke as a reason to drop a cold deep link", () => {
    window.location.hash = "#raid/123";
    const addSpy = vi.spyOn(window, "addEventListener");
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper, reactStrictMode: true },
    );
    // Positive observable: the layout effect really was double-invoked here
    // (see strictmode.meta.test.tsx), otherwise this test is vacuous.
    expect(addSpy.mock.calls.filter(([type]) => type === "hashchange")).toHaveLength(2);
    addSpy.mockRestore();
    expect(result.current.activeTab).toBe("raid");
    expect(window.location.hash).toBe("#raid/123");
  });

  it("still rewrites the hash on a normal view change after the cold apply", () => {
    // Anti-vacuity guard: a fix that suppressed the passive write forever
    // (rather than one-shot) would pass the two tests above but fail this one.
    window.location.hash = "#raid/123";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("raid");
    act(() => { result.current.setActiveTab("budget"); });
    expect(window.location.hash).toBe("#budget");
  });

  it("clears the pending flag when a second apply in the same batch supersedes the first", () => {
    // Independent review: `apply` used to ARM `pendingApplyRef` but never CLEAR
    // it — `if (view !== activeTabRef.current) pendingApplyRef.current = view`.
    // Two synchronous applies inside ONE React batch (two hashchange dispatches,
    // or a listener-driven apply plus an effect-driven one) can therefore leave
    // the flag armed for a view nobody is navigating to: the first arms "raid",
    // the second resolves to the tab already active and does NOT disarm it.
    // `activeTabRef` is maintained by a LAYOUT EFFECT, so inside the batch it
    // still reads the pre-batch tab — which is what makes the second apply take
    // the `===` branch. `setActiveTab` then collapses to the current value, so
    // no re-render is scheduled and the passive effect never runs to consume
    // the flag, and the stale "raid" swallows the NEXT genuine navigation's
    // hash write exactly once.
    // Kills the mutant that restores the `if (...)` form of that assignment.
    window.location.hash = "";
    const { result } = renderHook(
      () => { useHashView(); return useWorkspaceTab(); },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("dashboard"); // premise: the pre-batch tab

    act(() => {
      // Arms the flag for "raid" (≠ the current "dashboard").
      window.location.hash = "#raid";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      // Supersedes it with the tab that is ALREADY active, so the arming
      // condition is false. Post-fix this assigns null; pre-fix it left "raid".
      window.location.hash = "#dashboard";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    // Positive observable that the batch really was a no-op for the tab —
    // otherwise a re-render would have run the passive effect and consumed the
    // flag, and this test would pass for a reason that has nothing to do with
    // the assignment under test.
    expect(result.current.activeTab).toBe("dashboard");

    // The NEXT genuine navigation must still get its hash write.
    act(() => { result.current.setActiveTab("budget"); });
    expect(window.location.hash).toBe("#budget");
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

  // ★★★ §536, §595 — task-manager.tsx gates this hook on `hydrated &&
  //    settings.layout === "modern"`, not bare `settings.layout === "modern"`.
  //    use-settings.ts seeds `defaultSettings` (layout "modern") synchronously
  //    and only flips `hydrated` once the persisted settings resolve, so
  //    without that gate the cold apply fires on the FIRST executed run for
  //    EVERY user, against default settings: a classic user gets routed
  //    before the layout flips (§536), and the cold rule judges the hash
  //    against defaultSettings.features and never revisits it (§595). The
  //    tests below model that boundary as a disabled→enabled transition,
  //    matching how the real call site behaves across hydration.
  it("honours an item-bearing hash across the hydration boundary, once enabled", () => {
    window.location.hash = "#raid/123";
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => { useHashView(enabled); return useWorkspaceTab(); },
      { wrapper, initialProps: { enabled: false } },
    );
    // Pre-hydration: the stored layout is not yet known, so nothing runs.
    expect(result.current.activeTab).toBe("dashboard");
    expect(result.current.pendingOpen).toBeNull();
    expect(window.location.hash).toBe("#raid/123");

    rerender({ enabled: true }); // hydration resolves: modern
    expect(result.current.activeTab).toBe("raid");
    expect(result.current.pendingOpen).toEqual({ view: "raid", id: 123 });
  });

  it("never routes for a user whose hydrated layout stays classic", () => {
    window.location.hash = "#raid";
    // Cold target must differ from WorkspaceTabProvider's own default
    // ("dashboard") or the activeTab assertion below is true whether or not
    // the cold rule ran — see the sibling tests above for the same fixture.
    const features = ALL_MODULE_IDS.filter((m) => m !== "dashboard");
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => { useHashView(enabled, features); return useWorkspaceTab(); },
      { wrapper, initialProps: { enabled: false } },
    );
    rerender({ enabled: false }); // hydration resolves: classic — still disabled
    expect(result.current.activeTab).toBe("dashboard");
    expect(window.location.hash).toBe("#raid");
  });

  it("judges the cold rule against the features it is enabled with, not the ones it started disabled with", () => {
    // §595 — and a BLANK hash cannot pin this: a blank hash self-heals under a
    // later WARM re-apply (blankView is recomputed against whatever `features`
    // the effect re-runs with, cold or not), so it cannot tell "judged the
    // hydrated features" from "judged the defaults, then healed on the next
    // run". A view-only, NON-blank hash does NOT self-heal, which is exactly
    // what makes the real bug permanent: an ungated call site's cold apply
    // (render 1, DEFAULT features — dashboard still on) treats "#raid" as
    // stale residue and resolves blankView to "dashboard", rewriting the URL
    // to "#dashboard". The next run is WARM (not cold), so when the real
    // (dashboard-disabled) features arrive it reads "#dashboard" back,
    // finds `isViewEnabled("dashboard", features)` false, and returns without
    // fixing anything — the user is stranded on a disabled view permanently.
    // Gating the whole hook on `hydrated` means the ONE cold apply it ever
    // runs already sees the real features, so it never takes that wrong first
    // step.
    window.location.hash = "#raid";
    const { result, rerender } = renderHook(
      ({ enabled, features }: { enabled: boolean; features: readonly FeatureModuleId[] }) => {
        useHashView(enabled, features);
        return useWorkspaceTab();
      },
      { wrapper, initialProps: { enabled: false, features: [...ALL_MODULE_IDS] as readonly FeatureModuleId[] } },
    );
    const withoutDashboard = ALL_MODULE_IDS.filter((m) => m !== "dashboard");
    rerender({ enabled: true, features: withoutDashboard }); // first enabled run, real features
    // Positive observable: a real, reachable view — never the disabled module.
    expect(result.current.activeTab).not.toBe("dashboard");
    expect(result.current.activeTab).toBe("open-points");
  });

  it("honours a hash the user edited during the pre-hydration window", () => {
    window.location.hash = "#raid/123";
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => { useHashView(enabled); return useWorkspaceTab(); },
      { wrapper, initialProps: { enabled: false } },
    );
    // Pre-hydration: nothing has routed yet, on the ORIGINAL hash — without
    // this a "delete the hook's disabled branch" mutant would warm-reapply
    // from #raid/123 to #budget/7 on the very next hashchange/rerun and pass
    // this test regardless of whether anything was ever actually gated.
    expect(result.current.activeTab).toBe("dashboard");
    expect(result.current.pendingOpen).toBeNull();
    expect(window.location.hash).toBe("#raid/123");

    window.location.hash = "#budget/7"; // user edits the URL during load
    rerender({ enabled: true });
    expect(result.current.activeTab).toBe("budget");
    expect(result.current.pendingOpen).toEqual({ view: "budget", id: 7 });
  });

  it("leaves an MSAL auth-response fragment untouched across the hydration boundary", () => {
    // Same non-colliding features list as the cold-load MSAL test above, and
    // for the same reason: with the default (all modules) this would pass
    // even with isAuthResponseHash's early return deleted, because
    // "dashboard" is both the provider default and blankView.
    window.location.hash = "#code=abc&state=xyz";
    const features = ALL_MODULE_IDS.filter((m) => m !== "dashboard");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => { useHashView(enabled, features); return useWorkspaceTab(); },
      { wrapper, initialProps: { enabled: false } },
    );
    rerender({ enabled: true });
    expect(result.current.activeTab).toBe("dashboard");
    expect(window.location.hash).toBe("#code=abc&state=xyz");
    expect(replaceSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it("stays inert across the hydration boundary in a popout", () => {
    // Order matters: replaceState replaces the WHOLE URL, so setting the
    // popout query param first (before the hash) avoids clobbering it.
    window.history.replaceState(null, "", "/?popout=budget");
    window.location.hash = "#raid/123";
    try {
      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => { useHashView(enabled); return useWorkspaceTab(); },
        { wrapper, initialProps: { enabled: false } },
      );
      expect(result.current.activeTab).toBe("budget"); // the popout's own tab
      expect(result.current.pendingOpen).toBeNull();
      expect(window.location.hash).toBe("#raid/123");

      rerender({ enabled: true });
      expect(result.current.activeTab).toBe("budget");
      expect(result.current.pendingOpen).toBeNull();
      expect(window.location.hash).toBe("#raid/123");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("does not rewrite a #safe fragment before safe mode can read it", () => {
    // safe-mode.ts reads the fragment at module load, before any effect runs.
    // The load-bearing claim is the pre-hydration assertion below: the window
    // during which safe-mode.ts must see "#safe" untouched. Once enabled,
    // "safe" is an unrecognised slug (slugToView falls back to "open-points",
    // nav-config.ts), so the cold rule's stale-residue substitution applies
    // exactly as it does for any other view-only hash (see the sibling
    // "falls back to a valid view on an unknown hash" test) and resolves to
    // the Dashboard — a real, pinned value, not merely "something non-empty".
    window.location.hash = "#safe";
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => { useHashView(enabled); return useWorkspaceTab(); },
      { wrapper, initialProps: { enabled: false } },
    );
    expect(window.location.hash).toBe("#safe");

    rerender({ enabled: true });
    // ★★ CONSEQUENCE, recorded rather than asserted: this rewrite makes the
    //    escape hatch SINGLE-USE. Once hydration replaces "#safe" with
    //    "#dashboard" the fragment is gone from the URL, so a second reload no
    //    longer enters safe mode and the user has to retype "#safe" — which is
    //    exactly when they are least able to (the reason they are in safe mode
    //    at all). Pre-existing and deliberate, NOT introduced by the hydration
    //    gate: the pre-branch cold apply rewrote it on render 1 just the same.
    //    Noted here so the rewrite is not read as free.
    expect(window.location.hash).toBe("#dashboard");
  });
});
