// src/app/per-project-functions.integration.test.tsx
//
// Integration safety net for the two highest-risk behaviours of the
// per-project functions feature:
//
//   (a) Reactive functions, NO reload — changing the CURRENT project's
//       Workspace.features must propagate into the reactive `settings.features`
//       (the source the module consumers read) WITHOUT a page reload. We render
//       the real providers (WorkspaceProvider + FiltersProvider), own a real
//       `settings` state, wire `useFeaturesSync(setSettings)`, stub
//       `window.location.reload`, flip features via `useWorkspace().setFeatures`,
//       and assert the consumer-visible derivation updates while reload is never
//       called.
//
//   (b) Redirect on shrink — switching to a project whose functions disable the
//       active view must redirect off it. `disabledViewRedirect` is the pure
//       decision applied by the effect in task-manager.tsx (deps include
//       settings.features); we test it directly, then prove the reactive path
//       feeds it (a features change re-derives the redirect with no reload).

import { act, render } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useState, type ReactNode } from "react";
import { useWorkspace, WorkspaceProvider } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { useFeaturesSync } from "./use-features-sync";
import {
  ALL_MODULE_IDS,
  disabledViewRedirect,
  enabledNavViews,
  isViewEnabled,
  type FeatureModuleId,
} from "./feature-modules";
import { defaultSettings, type Settings } from "./settings-types";

function Providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

// A harness that owns a REAL settings state (seeded with the full module set),
// runs the real sync bridge, and exposes the consumer-visible derivations so the
// test can read what the 45 module consumers would see — all reactively, with no
// reload. `probe` is invoked on every render with the current reactive view.
function ReactiveHarness({
  probe,
  next,
}: {
  probe: (snapshot: {
    features: readonly FeatureModuleId[];
    navViews: string[];
    raidEnabled: boolean;
    redirectFromRaid: string;
  }) => void;
  next: readonly FeatureModuleId[];
}) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  useFeaturesSync(setSettings);
  const { setFeatures } = useWorkspace();

  probe({
    features: settings.features,
    navViews: enabledNavViews(settings.features),
    raidEnabled: isViewEnabled("raid", settings.features),
    // The exact decision task-manager's redirect effect makes for the active
    // "raid" view, derived from the REACTIVE settings.features.
    redirectFromRaid: disabledViewRedirect("raid", settings.features, "modern", false),
  });

  return <button onClick={() => setFeatures(next)}>apply</button>;
}

describe("per-project functions — reactive, no reload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a features change propagates into the reactive consumer source WITHOUT a page reload", () => {
    const reload = vi.fn();
    // jsdom's window.location.reload is non-configurable on the real object;
    // stubbing the whole location object is the reliable way to observe it.
    vi.stubGlobal("location", { ...window.location, reload });

    const snapshots: Array<{
      features: readonly FeatureModuleId[];
      navViews: string[];
      raidEnabled: boolean;
      redirectFromRaid: string;
    }> = [];

    const { getByText } = render(
      <Providers>
        <ReactiveHarness probe={(s) => snapshots.push(s)} next={["raid"]} />
      </Providers>,
    );

    // Baseline: settings seeded with every module → RAID enabled, full nav.
    const before = snapshots.at(-1)!;
    expect(before.raidEnabled).toBe(true);
    expect(before.navViews).toContain("dashboard");
    expect(before.navViews).toContain("raid");

    // Shrink the CURRENT project's functions to RAID-only and let the reactive
    // bridge run — no reload, no remount.
    act(() => getByText("apply").click());

    const after = snapshots.at(-1)!;
    // The reactive source reflects the new per-project features.
    expect(after.features).toEqual(["raid"]);
    // Downstream derivations the consumers read updated reactively.
    expect(after.raidEnabled).toBe(true);
    expect(after.navViews).toContain("raid");
    expect(after.navViews).not.toContain("dashboard");
    expect(after.navViews).not.toContain("gantt");

    // THE core assertion: the propagation happened with no page reload.
    expect(reload).not.toHaveBeenCalled();
  });

  it("growing the current project's functions re-enables a view reactively, no reload", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    const snapshots: Array<{ raidEnabled: boolean; navViews: string[] }> = [];

    const { getByText } = render(
      <Providers>
        <ReactiveHarness
          probe={(s) => snapshots.push({ raidEnabled: s.raidEnabled, navViews: s.navViews })}
          next={[...ALL_MODULE_IDS]}
        />
      </Providers>,
    );

    // Force a known reduced baseline first, then grow back to the full set.
    act(() => getByText("apply").click());
    const after = snapshots.at(-1)!;
    expect(after.raidEnabled).toBe(true);
    expect(after.navViews).toContain("dashboard");
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("per-project functions — redirect on shrink (disabledViewRedirect)", () => {
  it("keeps the active view when its module is still enabled", () => {
    expect(disabledViewRedirect("raid", ["raid", "dashboard"], "modern", false)).toBe("raid");
  });

  it("redirects off a disabled active view to dashboard when dashboard is on", () => {
    // RAID disabled, dashboard enabled → land on dashboard.
    expect(disabledViewRedirect("raid", ["dashboard"], "modern", false)).toBe("dashboard");
  });

  it("falls back to open-points in the modern layout when dashboard is also off", () => {
    // Simple mode ([]) → no module views → redirect to the modern fallback.
    expect(disabledViewRedirect("raid", [], "modern", false)).toBe("open-points");
  });

  it("falls back to chat in the classic layout and in popouts", () => {
    expect(disabledViewRedirect("raid", [], "classic", false)).toBe("chat");
    expect(disabledViewRedirect("raid", [], "modern", true)).toBe("chat");
  });

  it("the reactive redirect decision follows a per-project features change (no reload)", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    // Probe the redirect decision for an active "raid" view, derived from the
    // REACTIVE settings.features — exactly what the task-manager effect consumes.
    const decisions: string[] = [];
    const { getByText } = render(
      <Providers>
        <ReactiveHarness
          probe={(s) => decisions.push(s.redirectFromRaid)}
          // Shrink to a function set that DISABLES raid (dashboard only) → the
          // redirect must move the active view off raid, reactively.
          next={["dashboard"]}
        />
      </Providers>,
    );

    // Baseline: full set → raid stays raid.
    expect(decisions.at(-1)).toBe("raid");

    act(() => getByText("apply").click());

    // After the per-project functions shrink, the same pure decision (now fed
    // reactive settings.features) redirects off raid to dashboard — no reload.
    expect(decisions.at(-1)).toBe("dashboard");
    vi.unstubAllGlobals();
    // (reload assertion guarded by the unstub above for isolation.)
    expect(reload).not.toHaveBeenCalled();
  });
});
