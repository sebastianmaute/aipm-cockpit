// §491 — pins use-trend-snapshots.ts on its own: the recording gate
// (`trendsActive`), what it hands `useSnapshots` (active, cadence, project id,
// readiness, the capture context, the error bridge), `trends`, `actionTrends`
// and the dashboard model's snapshot gate. The workspace is the real
// WorkspaceProvider; `useSnapshots` is captured so no Turso call is made.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { defaultSettings, type Settings } from "./settings-types";
import type { UseSnapshotsArgs } from "./use-snapshots";
import type { SnapshotRecord } from "./snapshot";
import type { TursoConfig } from "./turso-config";
import { useTrendSnapshots, type TrendSnapshotsDeps } from "./use-trend-snapshots";

const captured = vi.hoisted(() => ({ args: null as UseSnapshotsArgs | null, records: [] as unknown[] }));
vi.mock("./use-snapshots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-snapshots")>()),
  useSnapshots: (args: UseSnapshotsArgs) => {
    captured.args = args;
    return { snapshots: captured.records, baseline: null, latest: null, busy: false, captureNow: async () => {}, rebaselineNow: async () => {}, refresh: async () => {} };
  },
}));
const dash = vi.hoisted(() => ({ gates: [] as unknown[] }));
vi.mock("./dashboard", async (importOriginal) => {
  const real = await importOriginal<typeof import("./dashboard")>();
  return {
    ...real,
    buildLiveDashboardInput: (...a: Parameters<typeof real.buildLiveDashboardInput>) => {
      dash.gates.push(a[2]);
      return real.buildLiveDashboardInput(...a);
    },
  };
});

function args(): UseSnapshotsArgs {
  if (!captured.args) throw new Error("useSnapshots was not called");
  return captured.args;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const CFG = { url: "https://db.example", authToken: "tok" } as unknown as TursoConfig;
const TURSO_SETTINGS: Settings = {
  ...defaultSettings,
  storageConfig: { kind: "turso" },
  features: [...defaultSettings.features, "trends"],
  snapshots: { enabled: true, cadence: "daily" },
} as Settings;

function makeDeps(over: Partial<TrendSnapshotsDeps> = {}): TrendSnapshotsDeps {
  return {
    settings: TURSO_SETTINGS,
    portfolioMode: "file",
    tursoConfig: CFG,
    isPopout: false,
    workspaceLoaded: true,
    tursoProjectId: null,
    holidaySet: new Set<string>(),
    today: "2026-06-02",
    activityLog: [],
    reportStorageOutcome: vi.fn(),
    showToast: vi.fn(),
    lang: "en-US",
    ...over,
  };
}

const run = (over: Partial<TrendSnapshotsDeps> = {}) =>
  renderHook(() => useTrendSnapshots(makeDeps(over)), { wrapper: Wrapper }).result.current;

beforeEach(() => {
  captured.args = null;
  captured.records = [];
  dash.gates.length = 0;
});

describe("useTrendSnapshots — the recording gate", () => {
  it("is active on Turso storage with a config, in the main window, recording and the module on", () => {
    expect(run().trendsActive).toBe(true);
    expect(args().active).toBe(true);
  });

  it("is active in Turso portfolio mode on non-Turso storage", () => {
    expect(run({ settings: { ...TURSO_SETTINGS, storageConfig: { kind: "browser" } } as Settings, portfolioMode: "turso" }).trendsActive).toBe(true);
  });

  it("is off on file storage in file portfolio mode", () => {
    expect(run({ settings: { ...TURSO_SETTINGS, storageConfig: { kind: "browser" } } as Settings }).trendsActive).toBe(false);
  });

  it("is off without a usable Turso config", () => {
    expect(run({ tursoConfig: null }).trendsActive).toBe(false);
  });

  it("is off in a popout", () => {
    expect(run({ isPopout: true }).trendsActive).toBe(false);
  });

  it("is off when recording is disabled", () => {
    expect(run({ settings: { ...TURSO_SETTINGS, snapshots: { enabled: false, cadence: "daily" } } as Settings }).trendsActive).toBe(false);
  });

  it("is off when the trends module is off", () => {
    expect(run({ settings: { ...TURSO_SETTINGS, features: TURSO_SETTINGS.features.filter((f) => f !== "trends") } }).trendsActive).toBe(false);
    expect(args().active).toBe(false);
  });

  it("falls back to the default snapshot settings when none are stored", () => {
    const r = run({ settings: { ...TURSO_SETTINGS, snapshots: undefined } as Settings });
    expect(r.trendsActive).toBe(true);
    expect(args().cadence).toBe("weekly");
  });
});

describe("useTrendSnapshots — the useSnapshots call", () => {
  it("passes the stored cadence and the workspace readiness", () => {
    run({ workspaceLoaded: false });
    expect(args().cadence).toBe("daily");
    expect(args().workspaceReady).toBe(false);
    expect(args().tursoConfig).toBe(CFG);
  });

  it("scopes to the tenant project only in Turso portfolio mode", () => {
    run({ portfolioMode: "turso", tursoProjectId: "p-9" });
    expect(args().projectId).toBe("p-9");
    run({ portfolioMode: "turso", tursoProjectId: null });
    expect(args().projectId).toBe("");
    run({ portfolioMode: "file", tursoProjectId: "p-9" });
    expect(args().projectId).toBe("");
  });

  it("bridges a capture error into the storage outcome", () => {
    const reportStorageOutcome = vi.fn();
    run({ reportStorageOutcome });
    const err = new Error("boom");
    args().onError?.(err);
    expect(reportStorageOutcome).toHaveBeenCalledWith(err);
  });

  it("hands the toast and language through", () => {
    const showToast = vi.fn();
    run({ showToast, lang: "de" });
    expect(args().showToast).toBe(showToast);
    expect(args().lang).toBe("de");
  });

  it("builds a capture context from the live workspace, without the snapshot list", () => {
    run();
    dash.gates.length = 0;
    const ctx = args().buildContext();
    expect(ctx.tasks).toEqual([]);
    expect(ctx.buckets).toEqual([]);
    expect(ctx.model).toBeDefined();
    expect(dash.gates).toEqual([null]);
  });
});

describe("useTrendSnapshots — derived values", () => {
  const RECORD = { capturedAt: "2026-06-01T00:00:00Z" } as unknown as SnapshotRecord;

  it("carries the gate on `trends`", () => {
    expect(run().trends.active).toBe(true);
    expect(run({ isPopout: true }).trends.active).toBe(false);
  });

  it("computes action trends only while recording", () => {
    // Two records a week apart with rising remaining cost read as a worsening budget.
    captured.records = [
      { capturedAt: "2026-05-25T00:00:00Z", remainingCost: 10, budgetRag: "" },
      { capturedAt: "2026-06-01T00:00:00Z", remainingCost: 20, budgetRag: "" },
    ];
    expect(run().actionTrends).toEqual({ budget: "worsening" });
    expect(run({ isPopout: true }).actionTrends).toBeUndefined();
  });

  it("feeds the dashboard model the recorded snapshots behind the same gate", () => {
    captured.records = [RECORD];
    run();
    expect(dash.gates.at(-1)).toEqual({ active: true, snapshots: [RECORD] });
    run({ isPopout: true });
    expect(dash.gates.at(-1)).toEqual({ active: false, snapshots: [RECORD] });
  });
});
