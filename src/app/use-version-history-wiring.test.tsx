// §491 step 10 — pins use-version-history-wiring.ts on its own: what it hands
// `useVersionHistory` (config, project id, the enabled predicate, idle window,
// retention, activity logger), the capture payload, the restore fan-out (the
// SECOND load funnel), the error bridge and the notify-ref hand-off. The
// workspace is the real WorkspaceProvider, so a restore round-trips through
// the actual context state. task-manager.version-history-wiring.test.tsx and
// task-manager.restore-backfill.test.tsx still pin the same wiring through the
// mounted component.
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { emptyWorkspace, type Workspace } from "./workspace";
import { diffWorkspaces } from "./version-diff";
import { DEFAULT_VERSION_RETENTION } from "./version-history";
import type { UseVersionHistoryArgs } from "./use-version-history";
import * as store from "./version-store";
import { changeKey } from "./version-restore";
import { useVersionHistoryWiring, type VersionHistoryWiringDeps } from "./use-version-history-wiring";
import type { Milestone, Stakeholder, Task } from "./types";
import type { CalendarEvent } from "./calendar-event";
import type { TursoConfig } from "./turso-config";

const captured = vi.hoisted(() => ({ args: null as UseVersionHistoryArgs | null }));
const stable = vi.hoisted(() => ({
  versions: [],
  busy: false,
  active: false,
  notifySaved: () => {},
  captureNow: async () => {},
  loadDiff: async () => [],
  restore: async () => false,
  remove: async () => false,
  refresh: async () => {},
}));
// Real implementations; spied per test where a test runs the REAL `useVersionHistory` (the §502 end-to-end pin).
vi.mock("./version-store", { spy: true });
vi.mock("./use-version-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-version-history")>()),
  useVersionHistory: (args: UseVersionHistoryArgs) => {
    captured.args = args;
    return stable;
  },
}));

function args(): UseVersionHistoryArgs {
  if (!captured.args) throw new Error("useVersionHistory was not called");
  return captured.args;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function mkTask(id: number, over: Partial<Task> = {}): Task {
  return {
    id, taskName: `T${id}`, assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "",
    status: "To Do", priority: "Medium", blockers: "", description: "", createdDate: "2026-01-01",
    ...over,
  };
}

const CFG = { url: "https://db.example", authToken: "tok" } as unknown as TursoConfig;
const STAKEHOLDER = { id: 7, name: "Ada" } as unknown as Stakeholder;
const EVENT = { id: 3, title: "Standup", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 15 } as CalendarEvent;

function makeDeps(over: Partial<VersionHistoryWiringDeps> = {}): VersionHistoryWiringDeps {
  return {
    stakeholders: [STAKEHOLDER],
    calendarEvents: [EVENT],
    tursoConfig: CFG,
    tursoProjectId: "p-1",
    storageKind: "turso",
    features: ["history"],
    versionHistoryRetention: undefined,
    workdayHours: 8,
    isPopout: false,
    logActivityUser: vi.fn(),
    reportStorageOutcome: vi.fn(),
    versionNotifyRef: { current: () => {} },
    ...over,
  };
}

function mount(over: Partial<VersionHistoryWiringDeps> = {}) {
  const deps = makeDeps(over);
  const view = renderHook(() => ({ wiring: useVersionHistoryWiring(deps), ws: useWorkspace() }), { wrapper: Wrapper });
  return { ...view, deps };
}

beforeEach(() => {
  captured.args = null;
});

describe("useVersionHistoryWiring — the useVersionHistory args", () => {
  it("passes the config, the project id, the idle window and the activity logger, and returns the hook's result", () => {
    const h = mount();
    expect(args().config).toBe(CFG);
    expect(args().projectId).toBe("p-1");
    expect(args().idleMs).toBe(180_000);
    expect(args().logActivity).toBe(h.deps.logActivityUser);
    expect(h.result.current.wiring).toBe(stable);
  });

  it("maps a null project id to an empty string", () => {
    mount({ tursoProjectId: null });
    expect(args().projectId).toBe("");
  });

  it("uses the default retention unless settings carry one", () => {
    mount();
    expect(args().retention).toBe(DEFAULT_VERSION_RETENTION);
    mount({ versionHistoryRetention: 7 });
    expect(args().retention).toBe(7);
  });

  it("is enabled only on Turso storage, in the main window, with the history module on", () => {
    mount();
    expect(args().enabled).toBe(true);
    mount({ storageKind: "browser" });
    expect(args().enabled).toBe(false);
    mount({ isPopout: true });
    expect(args().enabled).toBe(false);
    mount({ features: ["changes"] });
    expect(args().enabled).toBe(false);
  });
});

describe("useVersionHistoryWiring — capture, restore, error, notify", () => {
  it("captures the workspace slices plus the two deps-field slices", () => {
    mount();
    const payload = JSON.parse(args().getPayload()) as Workspace;
    expect(payload.stakeholders).toEqual([STAKEHOLDER]);
    expect(payload.calendarEvents).toEqual([EVENT]);
    expect(payload.tasks).toEqual([]);
  });

  it("recaptures a context slice that changes", () => {
    const h = mount();
    act(() => { h.result.current.ws.setTasks([mkTask(1)]); });
    const payload = JSON.parse(args().getPayload()) as Workspace;
    expect(payload.tasks.map((t) => t.id)).toEqual([1]);
  });

  it("fans a restored workspace into the context and drops dangling dependencies", () => {
    const h = mount();
    const restored: Workspace = {
      ...emptyWorkspace(),
      tasks: [mkTask(1, { dependencies: [{ taskId: 99, type: "FS" }] }), mkTask(2)],
      milestones: [{ id: 4, name: "M", date: "2026-07-01" } as Milestone],
      stakeholders: [STAKEHOLDER],
    };
    act(() => { args().applyWorkspace?.(restored); });
    expect(h.result.current.ws.tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(h.result.current.ws.tasks[0].dependencies ?? []).toEqual([]);
    expect(h.result.current.ws.milestones.map((m) => m.id)).toEqual([4]);
  });

  it("reports a version error to the storage-status bridge", () => {
    const h = mount();
    const err = new Error("boom");
    args().onError?.(err);
    expect(h.deps.reportStorageOutcome).toHaveBeenCalledWith(err);
  });

  it("hands useVersionHistory's notifySaved to the save-success bridge", () => {
    const h = mount();
    expect(h.deps.versionNotifyRef.current).toBe(stable.notifySaved);
  });
});

// §476 pre-merge ruling — a restore never changes the currency: the wiring hands `useVersionHistory` a
// `prepareVersion` that pins the LIVE `plan.currency` and converts the version's money by the LIVE
// `baselineHistory` (day roles re-derived with the settings' workday hours), and the fan-out itself
// neither appends a history entry nor logs a currency row.
describe("useVersionHistoryWiring — a restore converts version money and keeps the currency", () => {
  const T_VERSION = "2026-10-14T08:00:00.000Z";
  const SWITCH = { from: "2026-10-14", at: "2026-10-14T09:00:00.000Z", currency: "GBP" as const, perPrevious: 0.85 };
  function afterGbpSwitch(over: Partial<VersionHistoryWiringDeps> = {}) {
    const h = mount(over);
    act(() => {
      h.result.current.ws.setPlan((p) => ({ ...p, currency: "GBP" }));
      h.result.current.ws.setBaselineHistory([SWITCH]);
    });
    return h;
  }
  const dayRole = { id: 3, disciplineId: 1, gradeId: 1, rateBasis: "day" as const, internalRateDay: 800, externalRateDay: 1000, internalRate: 80, externalRate: 100 };
  it("prepareVersion pins the live currency and converts by the live history, day rates over the settings' workday", () => {
    const h = afterGbpSwitch({ workdayHours: 10 });
    const version: Workspace = { ...emptyWorkspace(), plan: { ...h.result.current.ws.plan, currency: "EUR" }, roles: [dayRole] };
    const out = args().prepareVersion?.(version, T_VERSION, false);
    expect(out?.plan.currency).toBe("GBP");
    expect(out?.roles[0]).toMatchObject({ internalRateDay: 680, externalRateDay: 850, internalRate: 68, externalRate: 85 });
  });
  it("the fan-out appends no history entry and logs nothing", () => {
    const h = afterGbpSwitch();
    const before = h.result.current.ws.baselineHistory;
    act(() => { args().applyWorkspace?.({ ...emptyWorkspace(), plan: { ...h.result.current.ws.plan } }); });
    expect(h.result.current.ws.baselineHistory).toBe(before);
    expect(h.deps.logActivityUser).not.toHaveBeenCalled();
  });
});

// §502 — the simulation switch is a viewing choice. `prepareVersion` pins it on the version for compares, but
// ONLY when the version carries overrides: an unstamped capture's `undefined` is what lets the blind-capture
// guard skip the slice, and a pinned `{forecast}` would make it look like a real (empty) override set.
describe("useVersionHistoryWiring — prepareVersion and the simulation switch (§502)", () => {
  const ON = { forecast: { showSimulation: true } };
  const TZ = { timezone: { timezone: "Europe/Berlin" } };
  // The end-to-end test spies the version store; restoring in afterEach also runs when an assertion fails.
  afterEach(() => {
    vi.restoreAllMocks();
  });
  function withLiveSwitchOn() {
    const h = mount();
    act(() => { h.result.current.ws.setSettingsOverrides({ ...TZ, ...ON }); });
    return h;
  }

  it("leaves an UNSTAMPED capture's absent settingsOverrides absent, so the blind-capture guard still sees it", () => {
    withLiveSwitchOn();
    const out = args().prepareVersion?.({ ...emptyWorkspace(), settingsOverrides: undefined }, null, false);
    expect(out?.settingsOverrides).toBeUndefined();
  });

  it("pins the live switch on a version that has overrides, so a compare shows no switch row", () => {
    const h = withLiveSwitchOn();
    const version = args().prepareVersion?.({ ...emptyWorkspace(), settingsOverrides: TZ }, null, true);
    expect(version?.settingsOverrides).toEqual({ ...TZ, ...ON });
    const now: Workspace = { ...emptyWorkspace(), settingsOverrides: h.result.current.ws.settingsOverrides };
    expect(diffWorkspaces(version as Workspace, now).filter((c) => c.collection === "settingsOverrides")).toEqual([]);
  });

  // Final-review finding: a STAMPED capture speaks for the slice, so its absence means "no overrides" — and
  // without the pin a compare against it offered a no-op switch row (the restore pins it back anyway).
  it("pins the switch on a STAMPED capture without overrides, so a compare shows no switch row", () => {
    const h = mount();
    act(() => { h.result.current.ws.setSettingsOverrides(ON); });
    const version = args().prepareVersion?.({ ...emptyWorkspace(), settingsOverrides: undefined }, null, true);
    expect(version?.settingsOverrides).toEqual(ON);
    const now: Workspace = { ...emptyWorkspace(), settingsOverrides: h.result.current.ws.settingsOverrides };
    const rows = diffWorkspaces(version as Workspace, now, { olderSpeaksForEmptySlices: true });
    expect(rows.filter((c) => c.collection === "settingsOverrides")).toEqual([]);
  });

  // End to end: the REAL wiring `prepareVersion`, `getPayload` and `applyWorkspace` driving the REAL
  // `useVersionHistory` restore of an UNSTAMPED capture. Pinning the switch onto its absent overrides
  // would make the blind slice look like a real (switch-only) set, and the restore would blank the timezone.
  it("a real restore of an unstamped capture keeps the timezone override and the switch", async () => {
    const h = withLiveSwitchOn();
    const real = await vi.importActual<typeof import("./use-version-history")>("./use-version-history");
    const unstamped = JSON.stringify({ ...emptyWorkspace(), tasks: [mkTask(1)], settingsOverrides: undefined }, null, 2);
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(unstamped);
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    const wired = args();
    const engine = renderHook(() => real.useVersionHistory(wired));
    let ok = false;
    await act(async () => {
      ok = await engine.result.current.restore("v1", { [changeKey("tasks", 1)]: "all", [changeKey("settingsOverrides", null)]: "all" }, "l");
    });
    // Positive control: the restore really ran and fanned its workspace into the context.
    expect(ok).toBe(true);
    expect(h.result.current.ws.tasks.map((t) => t.id)).toEqual([1]);
    expect(h.result.current.ws.settingsOverrides).toEqual({ ...TZ, ...ON });
  });
});

describe("useVersionHistoryWiring — forecast scenarios in capture and restore (§502)", () => {
  const A = { id: 1, name: "Add one person", changes: [] };
  const B = { id: 2, name: "Cut scope", changes: [] };
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The REAL `useVersionHistory` over the wiring's own args, as the §502 switch test above does. */
  async function mountEngine(capture: string, live: readonly (typeof A)[]) {
    const h = mount();
    act(() => { h.result.current.ws.setForecastScenarios(live); });
    const real = await vi.importActual<typeof import("./use-version-history")>("./use-version-history");
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(capture);
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    const wired = args();
    const engine = renderHook(() => real.useVersionHistory(wired));
    return { h, engine };
  }

  const capturePayload = (format: number | null, over: Record<string, unknown> = {}) =>
    JSON.stringify({ ...(format === null ? {} : { captureFormat: format }), ...emptyWorkspace(), tasks: [mkTask(1)], ...over }, null, 2);

  const SELECT_ALL = {
    [changeKey("tasks", 1)]: "all" as const,
    [changeKey("forecastScenarios", 1)]: "all" as const,
    [changeKey("forecastScenarios", 2)]: "all" as const,
  };

  it("the capture payload carries the scenarios", () => {
    const h = mount();
    act(() => { h.result.current.ws.setForecastScenarios([A, B]); });
    expect((JSON.parse(args().getPayload()) as Workspace).forecastScenarios).toEqual([A, B]);
  });

  it("a restored workspace fans its scenarios into the context", () => {
    const h = mount();
    act(() => { args().applyWorkspace?.({ ...emptyWorkspace(), forecastScenarios: [A] }); });
    expect(h.result.current.ws.forecastScenarios).toEqual([A]);
  });

  it.each([[2], [null]])(
    "a capture at format %s (null = unstamped) without scenarios shows no scenario row and a restore keeps both live scenarios",
    async (format) => {
      const { h, engine } = await mountEngine(capturePayload(format), [A, B]);
      let changes: Awaited<ReturnType<typeof engine.result.current.loadDiff>> = [];
      await act(async () => { changes = await engine.result.current.loadDiff("v1", "now"); });
      // Positive control: the diff ran and sees the task the capture holds.
      expect(changes.some((c) => c.collection === "tasks")).toBe(true);
      expect(changes.filter((c) => c.collection === "forecastScenarios")).toEqual([]);
      let ok = false;
      await act(async () => { ok = await engine.result.current.restore("v1", SELECT_ALL, "l"); });
      expect(ok).toBe(true);
      expect(h.result.current.ws.tasks.map((t) => t.id)).toEqual([1]);
      expect(h.result.current.ws.forecastScenarios).toEqual([A, B]);
    },
  );

  it("a format-3 capture speaks for scenarios: the row shows the one added since, and restoring it removes it", async () => {
    const { h, engine } = await mountEngine(capturePayload(3, { forecastScenarios: [A] }), [A, B]);
    let changes: Awaited<ReturnType<typeof engine.result.current.loadDiff>> = [];
    await act(async () => { changes = await engine.result.current.loadDiff("v1", "now"); });
    expect(changes.filter((c) => c.collection === "forecastScenarios").map((c) => [c.recordId, c.type, c.recordLabel]))
      .toEqual([[2, "added", "Cut scope"]]);
    let ok = false;
    await act(async () => { ok = await engine.result.current.restore("v1", { [changeKey("forecastScenarios", 2)]: "all" }, "l"); });
    expect(ok).toBe(true);
    expect(h.result.current.ws.forecastScenarios).toEqual([A]);
  });
});
