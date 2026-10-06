// §491 step 10 — pins the `useVersionHistoryWiring` CALL SITE in task-manager.tsx.
// use-version-history-wiring.test.tsx hands the hook its deps by hand, so only a
// mounted TaskManager can show which values reach it. Each field is pinned by
// identity against the hook it comes from (pass-through mocks capture both
// sides), or by the value a seeded setting gives it.
//
// ★ `versionNotifyRef` is pinned by BEHAVIOUR rather than identity: the ref is
// local to task-manager, so the test reports a storage success through the
// backend's own bridge and asserts that `notifySaved` ran. A fresh ref handed
// to the hook would be filled while task-manager's own stayed a no-op.
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { ALL_MODULE_IDS } from "./feature-modules";
import type { VersionHistoryWiringDeps } from "./use-version-history-wiring";

const seen = vi.hoisted(() => ({
  backendOutcome: null as ((err: unknown | null) => void) | null,
  stakeholders: null as unknown,
  calendarEvents: null as unknown,
  deps: null as VersionHistoryWiringDeps | null,
  notifySaved: null as ReturnType<typeof vi.fn> | null,
}));

vi.mock("./use-version-history", async (importOriginal) => {
  const { vi: v } = await import("vitest");
  seen.notifySaved = v.fn();
  // ONE stable result object, as in task-manager.version-history-wiring.test.tsx.
  const stable = {
    versions: [], busy: false, active: false,
    notifySaved: seen.notifySaved,
    captureNow: async () => {}, loadDiff: async () => [], restore: async () => false,
    remove: async () => false, refresh: async () => {},
  };
  return {
    ...(await importOriginal<typeof import("./use-version-history")>()),
    useVersionHistory: () => stable,
  };
});
vi.mock("./use-storage-backend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-storage-backend")>();
  return {
    ...mod,
    useStorageBackend: (args: Parameters<typeof mod.useStorageBackend>[0]) => {
      seen.backendOutcome = args.onStorageOutcome ?? null;
      return mod.useStorageBackend(args);
    },
  };
});
vi.mock("./use-stakeholders", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-stakeholders")>();
  return {
    ...mod,
    useStakeholders: (...a: Parameters<typeof mod.useStakeholders>) => {
      const r = mod.useStakeholders(...a);
      seen.stakeholders = r.stakeholders;
      return r;
    },
  };
});
vi.mock("./use-resource-planner", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-resource-planner")>();
  return {
    ...mod,
    useResourcePlanner: (...a: Parameters<typeof mod.useResourcePlanner>) => {
      const r = mod.useResourcePlanner(...a);
      seen.calendarEvents = r.calendarEvents;
      return r;
    },
  };
});
vi.mock("./use-version-history-wiring", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-version-history-wiring")>();
  return {
    ...mod,
    useVersionHistoryWiring: (deps: VersionHistoryWiringDeps) => {
      seen.deps = deps;
      return mod.useVersionHistoryWiring(deps);
    },
  };
});

import TaskManager from "./task-manager";

function deps(): VersionHistoryWiringDeps {
  if (!seen.deps) throw new Error("useVersionHistoryWiring was not called");
  return seen.deps;
}

beforeEach(() => {
  __resetMintStateForTests();
  window.localStorage.clear();
  seen.backendOutcome = null;
  seen.stakeholders = null;
  seen.calendarEvents = null;
  seen.deps = null;
  seen.notifySaved?.mockClear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
  // Turso as the storage backend and a retention, so the three settings-derived
  // fields each carry a value a hard-coded one would not.
  window.localStorage.setItem(
    "aipm-cockpit:settings",
    JSON.stringify({ storageConfig: { kind: "turso" }, versionHistoryRetention: 200 }),
  );
});

describe("task-manager → useVersionHistoryWiring call site", () => {
  it("hands the hook the live stakeholders, calendar events, storage bridge and settings", async () => {
    render(<TaskManager />);
    // Heavy mount; wait for the settings to land rather than the first render's defaults.
    await vi.waitFor(() => expect(deps().storageKind).toBe("turso"), { timeout: 30000 });
    expect(deps().stakeholders).toBe(seen.stakeholders);
    expect(deps().calendarEvents).toBe(seen.calendarEvents);
    expect(deps().reportStorageOutcome).toBe(seen.backendOutcome);
    expect(deps().versionHistoryRetention).toBe(200);
    expect(deps().features).toEqual([...ALL_MODULE_IDS]);
  }, 45000);

  it("a storage success reported through the backend's bridge reaches notifySaved", async () => {
    render(<TaskManager />);
    await vi.waitFor(() => expect(seen.backendOutcome).toBeTypeOf("function"), { timeout: 30000 });
    seen.notifySaved?.mockClear();
    act(() => { seen.backendOutcome?.(null); });
    expect(seen.notifySaved).toHaveBeenCalled();
  }, 45000);
});
