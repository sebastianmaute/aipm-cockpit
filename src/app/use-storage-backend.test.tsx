import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { Settings } from "./settings-types";
import type { Lang } from "./i18n";
import type { Task } from "./types";
import type { StorageConfig } from "./storage";
import { useStorageBackend } from "./use-storage-backend";
import { mintId, __resetMintStateForTests } from "./id-mint-session";
import { useBroadcastSync } from "./broadcast-sync";
import { useWorkspace } from "./workspace-context";
import { TestProviders } from "./test-providers";

// ── Storage mock ─────────────────────────────────────────────────────────────
vi.mock("./storage", () => ({
  createBackend: vi.fn(),
  emptyWorkspace: vi.fn(() => ({
    tasks: [], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [],
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
  })),
  StorageNotReadyError: class StorageNotReadyError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  StorageNotImplementedError: class StorageNotImplementedError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  openFileForBackend: vi.fn(),
  pickFileForBackend: vi.fn(),
  pickOpenFileAny: vi.fn(),
  formatFromFileName: vi.fn(() => "json"),
  requestWriteAccessForBackend: vi.fn(),
  setBackendFileHandle: vi.fn(() => null),
  getBackendFileHandle: vi.fn(() => null),
}));
import * as storageMod from "./storage";

// ── Per-project file-handle store mock (IDB-backed in prod) ───────────────────
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}));
import * as handlesMod from "./project-file-handles";

// projects-registry is a pure module backed by jsdom localStorage — use it for
// real so addProject / setCurrentProject / load+save round-trips behave as in prod.
import {
  addProject,
  emptyRegistry,
  loadRegistry,
  saveRegistry,
} from "./projects-registry";

// ── Broadcast-sync mock ───────────────────────────────────────────────────────
vi.mock("./broadcast-sync", () => ({
  useBroadcastSync: vi.fn(),
}));

// ── Turso portfolio mock (the portfolio-level project ops over the shared DB) ──
vi.mock("./turso-portfolio", () => ({
  createProject: vi.fn(async () => undefined),
  archiveProject: vi.fn(async () => undefined),
  restoreProject: vi.fn(async () => undefined),
  hardDeleteProject: vi.fn(async () => undefined),
}));
import * as tursoPortfolioMod from "./turso-portfolio";

// ── TursoBackend mock (per-project tenant-mode backend built directly in the hook) ──
// TursoLockTimeoutError must be exported by the mock too: storage-error.ts
// (used unmocked by the hook's save-failure path) instanceof-checks against
// whatever this module exports.
vi.mock("./turso-backend", () => ({
  TursoBackend: class {
    kind = "turso" as const;
    constructor(public config: unknown, public projectId: string) {}
    load = vi.fn().mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    save = vi.fn().mockResolvedValue(undefined);
    isReady = vi.fn().mockResolvedValue(true);
    describe = vi.fn().mockResolvedValue("Turso");
  },
  TursoLockTimeoutError: class TursoLockTimeoutError extends Error {
    constructor() {
      super("Turso write lock timed out");
      this.name = "TursoLockTimeoutError";
    }
  },
}));
import { TursoLockTimeoutError } from "./turso-backend";

// portfolio-mode is a pure module backed by jsdom localStorage — use it for real
// so saveCurrentTursoProjectId / loadCurrentTursoProjectId round-trip as in prod.
import { loadCurrentTursoProjectId, saveCurrentTursoProjectId, savePortfolioMode, loadPortfolioMode } from "./portfolio-mode";

// ── Mock backend ──────────────────────────────────────────────────────────────
const mockBackend = {
  load: vi.fn().mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] }),
  save: vi.fn().mockResolvedValue(undefined),
  isReady: vi.fn().mockResolvedValue(true),
  describe: vi.fn().mockResolvedValue("mock-file.json"),
};

// ── Fixtures ──────────────────────────────────────────────────────────────────
const showToast = vi.fn();

const setStorageConfigGlobal = vi.fn();

function makeArgs(overrides: Partial<Parameters<typeof useStorageBackend>[0]> = {}): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig: { kind: "browser" } } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    activityLog: [] as ActivityEntry[],
    setActivityLog: vi.fn(),
    showToast,
    setStorageConfig: setStorageConfigGlobal,
    ...overrides,
  };
}

// Composite probe so tests can also inspect workspace state
function makeProbe(args: Parameters<typeof useStorageBackend>[0]) {
  return function useProbe() {
    const backend = useStorageBackend(args);
    const { tasks, raid, absences, shifts, setTasks, changes, setChanges, project } = useWorkspace();
    return { ...backend, tasks, raid, absences, shifts, setTasks, changes, setChanges, project };
  };
}

function renderBackend(args = makeArgs()) {
  return renderHook(makeProbe(args), {
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("useStorageBackend — state initialisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("storageReady initialises to false", () => {
    const { result } = renderBackend(makeArgs({ hydrated: false }));
    expect(result.current.storageReady).toBe(false);
  });

  it("storageDescription initialises to null", () => {
    const { result } = renderBackend(makeArgs({ hydrated: false }));
    expect(result.current.storageDescription).toBeNull();
  });
});

describe("useStorageBackend — load effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("populates workspace from backend on mount", async () => {
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 1, taskName: "T1" }] as unknown as Task[],
      raid: [{ id: "r1" }] as unknown as Task[],
      absences: [],
      shifts: [],
    });
    mockBackend.isReady.mockResolvedValueOnce(true);
    mockBackend.describe.mockResolvedValueOnce("my-file.json");

    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(result.current.tasks.length).toBe(1);
    expect(result.current.raid.length).toBe(1);
    expect(result.current.storageReady).toBe(true);
    expect(result.current.storageDescription).toBe("my-file.json");
  });

  it("suppresses the next save after load", async () => {
    mockBackend.isReady.mockResolvedValueOnce(true);
    mockBackend.describe.mockResolvedValueOnce("f.json");

    renderBackend();
    await act(async () => { await Promise.resolve(); });

    // save must NOT have been called immediately after load
    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  it("shows error toast on StorageNotReadyError", async () => {
    const { StorageNotReadyError } = storageMod as unknown as Record<string, new (hint: string) => Error>;
    mockBackend.load.mockRejectedValueOnce(new StorageNotReadyError("no access"));
    mockBackend.isReady.mockResolvedValueOnce(false);
    mockBackend.describe.mockResolvedValueOnce(null);

    renderBackend(makeArgs({ settings: { storageConfig: { kind: "local-json" } } as unknown as Settings }));
    await act(async () => { await Promise.resolve(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(mockBackend.isReady).toHaveBeenCalled();
  });

  it("shows error toast on unknown load error", async () => {
    mockBackend.load.mockRejectedValueOnce(new Error("boom"));
    mockBackend.isReady.mockResolvedValueOnce(false);
    mockBackend.describe.mockResolvedValueOnce(null);

    renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("silently swallows StorageNotImplementedError without toast or state change", async () => {
    const { StorageNotImplementedError } = storageMod as unknown as Record<string, new (hint: string) => Error>;
    mockBackend.load.mockRejectedValueOnce(new StorageNotImplementedError("not implemented"));
    mockBackend.isReady.mockResolvedValueOnce(false);
    mockBackend.describe.mockResolvedValueOnce(null);

    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.storageReady).toBe(false);
    expect(result.current.storageDescription).toBeNull();
  });

  it("does not call backend.load when hydrated is false", async () => {
    renderBackend(makeArgs({ hydrated: false }));
    await act(async () => { await Promise.resolve(); });

    expect(mockBackend.load).not.toHaveBeenCalled();
  });
});

describe("useStorageBackend — save effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    mockBackend.load.mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Remove the instance-level visibilityState shadow set by dispatchHidden()
    // so later tests see jsdom's prototype getter ("visible") again.
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("calls backend.save after workspace changes (debounced 500ms)", async () => {
    const { result } = renderBackend();
    // Load completes → suppressNextSaveRef = true
    await act(async () => { await Promise.resolve(); });
    // First debounce cycle: suppress fires and clears
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    // Trigger a workspace change so the save effect re-runs
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    // Advance past debounce — save should fire now
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(mockBackend.save).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: expect.any(Array), raid: expect.any(Array) }),
    );
  });

  it("localizes the cross-tab lock-timeout save failure instead of toasting the raw English error", async () => {
    const { result } = renderBackend();
    // Load completes → suppressNextSaveRef = true; burn the first debounce cycle.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();
    mockBackend.save.mockRejectedValueOnce(new TursoLockTimeoutError());

    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(showToast).toHaveBeenCalledWith(
      "error",
      "Couldn't save: another tab is writing to this database and the wait timed out. Saving retries automatically.",
    );
  });

  it("skips save immediately after load (suppressNextSaveRef)", async () => {
    renderBackend();
    await act(async () => { await Promise.resolve(); });

    // The save effect fires once right after load but should be suppressed
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    // save should NOT have been called because suppressNextSaveRef was set by load
    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  it("does not call backend.save in popout mode (main window owns persistence)", async () => {
    const { result } = renderBackend(makeArgs({ isPopout: true }));
    // Load completes → suppressNextSaveRef = true
    await act(async () => { await Promise.resolve(); });
    // First debounce cycle
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    // Trigger a workspace change so the save effect re-runs
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    // Advance past debounce — a non-popout window would save here
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  // ── R5: flush-on-hide ────────────────────────────────────────────────────
  // Simulate the tab being hidden: jsdom's Document.prototype.visibilityState
  // getter returns "visible"; shadow it with an instance property (removed in
  // afterEach) and dispatch the event the hook listens for.
  function dispatchHidden() {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("flushes the pending debounced save immediately when the tab is hidden, without double-firing", async () => {
    const { result } = renderBackend();
    // Load completes → suppressNextSaveRef = true
    await act(async () => { await Promise.resolve(); });
    // First debounce cycle: suppress fires and clears
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    // Make a change, then hide the tab BEFORE the 500ms debounce elapses.
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { dispatchHidden(); await Promise.resolve(); });

    expect(mockBackend.save).toHaveBeenCalledTimes(1);
    expect(mockBackend.save).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: [expect.objectContaining({ id: 1 })] }),
    );

    // The cancelled debounce timer must NOT fire a second save.
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(mockBackend.save).toHaveBeenCalledTimes(1);
  });

  it("does not save on tab hide when no save is pending", async () => {
    renderBackend();
    await act(async () => { await Promise.resolve(); });
    // First debounce cycle: suppressed effect run registers no listeners.
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    await act(async () => { dispatchHidden(); await Promise.resolve(); });

    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  it("does not re-save on tab hide after the debounced save already fired", async () => {
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    // Change → debounced save fires normally.
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(mockBackend.save).toHaveBeenCalledTimes(1);

    // Hiding the tab afterwards must not save again (nothing pending).
    await act(async () => { dispatchHidden(); await Promise.resolve(); });
    expect(mockBackend.save).toHaveBeenCalledTimes(1);
  });

  it("does not flush on tab hide in popout mode (main window owns persistence)", async () => {
    const { result } = renderBackend(makeArgs({ isPopout: true }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { dispatchHidden(); await Promise.resolve(); });

    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  it("flushes the pending debounced save on pagehide", async () => {
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { window.dispatchEvent(new Event("pagehide")); await Promise.resolve(); });

    expect(mockBackend.save).toHaveBeenCalledTimes(1);
  });

  it("shows toast on save error", async () => {
    mockBackend.save.mockRejectedValue(new Error("disk full"));
    const { result } = renderBackend();
    // Load completes → suppressNextSaveRef = true
    await act(async () => { await Promise.resolve(); });
    // First debounce cycle: suppress fires and clears
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    // Trigger a workspace change so the save effect re-runs with suppress cleared
    await act(async () => {
      result.current.setTasks([{ id: 2, taskName: "T2" } as unknown as Task]);
    });
    // Advance past debounce — save fires and rejects → toast shown
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  // ── §72: the teardown race ──────────────────────────────────────────────────
  // The save effect fires `doSave()` fire-and-forget. Its .then/.catch call back
  // into the component. If the component unmounted while the save was in flight,
  // that callback runs `setState` on a dead tree — in CI's torn-down jsdom that
  // surfaces as `ReferenceError: window is not defined` from React's
  // resolveUpdatePriority, and Vitest exits 1 with every test passing.
  //
  // ★ This test pins the GUARD (no callback after unmount), not the crash. The
  //   crash needs environment teardown, which a unit test cannot stage — see
  //   docs/open-followups.md §72.
  it("does not report a save outcome after unmount (§72 teardown race)", async () => {
    const onStorageOutcome = vi.fn();
    let resolveSave!: () => void;
    const deferred = new Promise<void>((resolve) => { resolveSave = resolve; });

    const { result, unmount } = renderBackend(makeArgs({ onStorageOutcome }));

    // Burn the load + the suppressed first debounce cycle.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();
    onStorageOutcome.mockClear();

    // Next save hangs until we resolve it by hand.
    mockBackend.save.mockReturnValueOnce(deferred);
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(mockBackend.save).toHaveBeenCalledTimes(1);

    // Component goes away while the save is still in flight.
    unmount();

    // Now the save lands. Nothing may call back into the dead tree.
    await act(async () => { resolveSave(); await Promise.resolve(); });

    expect(onStorageOutcome).not.toHaveBeenCalled();
  });

  // ★★★ The guard above must be MOUNTED-scoped. If someone re-implements it with
  //     the load effect's per-run `cancelled` flag, THIS test fails: the save
  //     effect re-runs on every workspace edit, so an in-flight save whose effect
  //     run was superseded would stop reporting — and a genuine save FAILURE
  //     would be swallowed in production with no banner and no toast.
  it("still reports the outcome of a save superseded while in flight (§72: mounted-scoped, not per-run)", async () => {
    const onStorageOutcome = vi.fn();
    let resolveSave!: () => void;
    const deferred = new Promise<void>((resolve) => { resolveSave = resolve; });

    const { result } = renderBackend(makeArgs({ onStorageOutcome }));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();
    onStorageOutcome.mockClear();

    mockBackend.save.mockReturnValueOnce(deferred);
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(mockBackend.save).toHaveBeenCalledTimes(1);

    // A second edit supersedes the effect run that started the in-flight save.
    // The component is still mounted, so its outcome must still be reported.
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1 edited" } as unknown as Task]);
    });

    await act(async () => { resolveSave(); await Promise.resolve(); });

    expect(onStorageOutcome).toHaveBeenCalledWith(null);
  });

  // ★★★ `mountedRef.current = true` in the effect BODY (not just the cleanup) is
  //     load-bearing in dev and CANNOT be pinned here. A StrictMode-wrapped
  //     renderHook was tried and is VACUOUS: measured 2026-08-04, StrictMode in
  //     this suite invokes the effect ONCE (["mount"], no cleanup+remount), so
  //     deleting the re-set keeps all 63 tests green. See open-followups.md §72.
});

describe("useStorageBackend — handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    mockBackend.load.mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue("f.json");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("onPickStorageFile saves current workspace + refreshes status", async () => {
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve(undefined),
    );
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onPickStorageFile(); });

    expect(storageMod.pickFileForBackend).toHaveBeenCalledWith(mockBackend);
    expect(mockBackend.save).toHaveBeenCalled();
    expect(mockBackend.isReady).toHaveBeenCalled();
  });

  it("onGrantWriteAccess shows granted toast on success", async () => {
    (storageMod.requestWriteAccessForBackend as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve(true),
    );
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onGrantWriteAccess(); });

    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("onGrantWriteAccess shows denied toast when access not granted", async () => {
    (storageMod.requestWriteAccessForBackend as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve(false),
    );
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onGrantWriteAccess(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("onOpenStorageFile loads workspace on confirm", async () => {
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve(undefined),
    );
    // First call: mount load effect (returns empty workspace)
    mockBackend.load.mockResolvedValueOnce({ tasks: [], raid: [], absences: [], shifts: [] });
    // Second call: inside onOpenStorageFile (returns task with id 99)
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 99, taskName: "Loaded" }] as unknown as Task[],
      raid: [],
      absences: [],
      shifts: [],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onOpenStorageFile(); });
    // Flush React state updates from setTasks
    await act(async () => { await Promise.resolve(); });

    expect(storageMod.openFileForBackend).toHaveBeenCalledWith(mockBackend);
    expect(result.current.tasks[0]?.id).toBe(99);
  });
});

describe("useStorageBackend — broadcast send gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("passes canSend=true to every useBroadcastSync call in the main window", () => {
    renderBackend(makeArgs({ isPopout: false }));
    const calls = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(9);
    for (const call of calls) {
      expect(call[3]).toBe(true);
    }
  });

  it("passes canSend=false to every useBroadcastSync call in a popout", () => {
    renderBackend(makeArgs({ isPopout: true }));
    const calls = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(9);
    for (const call of calls) {
      expect(call[3]).toBe(false);
    }
  });
});

// ── Change Log persistence bridge (regression: changes must round-trip) ───────
// These exercise the REAL bridge wiring in useStorageBackend — the save effect's
// backend.save() payload, the load effect's setChanges, and the broadcast call.
// Without forwarding `changes` through that bridge the Change Log register
// vanished on reload; these tests fail without that wiring.
describe("useStorageBackend — Change Log persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    mockBackend.load.mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards `changes` to backend.save() (save→reload round-trip survives)", async () => {
    const { result } = renderBackend();
    // Load completes → suppressNextSaveRef = true
    await act(async () => { await Promise.resolve(); });
    // First debounce cycle: suppress fires and clears
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    // Add a change to the register, then let the debounced save fire
    await act(async () => {
      result.current.setChanges([{ id: 7, title: "Widen scope" } as never]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(mockBackend.save).toHaveBeenCalledWith(
      expect.objectContaining({ changes: [expect.objectContaining({ id: 7, title: "Widen scope" })] }),
    );
  });

  it("applies workspace.changes from backend.load() into workspace state", async () => {
    mockBackend.load.mockResolvedValueOnce({
      tasks: [], raid: [], absences: [], shifts: [],
      changes: [{ id: 42, title: "Loaded change" }],
    });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(result.current.changes).toHaveLength(1);
    expect(result.current.changes[0]?.id).toBe(42);
  });

  it("registers a `changes` broadcast-sync channel", () => {
    renderBackend();
    const kinds = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(kinds).toContain("changes");
  });
});

// ── helpers for onRequestStorageSwitch tests ─────────────────────────────────
function emptyWorkspace() {
  return {
    tasks: [], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [],
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
    budgets: [], fxRates: null,
  };
}

describe("useStorageBackend — onRequestStorageSwitch", () => {
  const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;
  // vitest 4 types a bare vi.fn() as Mock<Procedure | Constructable>, which is
  // not assignable to the hook's setStorageConfig prop. Type the mock to the
  // prop's signature so Mock<T> stays assignable to T.
  let setStorageConfig: ReturnType<typeof vi.fn<(config: StorageConfig) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setStorageConfig = vi.fn<(config: StorageConfig) => void>();
    // Default main backend (kind="browser")
    mockBackend.load.mockResolvedValue(emptyWorkspace());
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue("Browser");
    createBackendMock.mockReturnValue(mockBackend);
    // pickFileForBackend returns null (non-local backends in these tests)
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("confirm=true writes current workspace to new backend + commits config + shows info toast", async () => {
    const targetSave = vi.fn().mockResolvedValue(undefined);
    const targetBackend = {
      kind: "turso",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: targetSave,
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("Turso: x"),
    };
    // First call returns main backend (browser), subsequent call returns target
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValueOnce(targetBackend);

    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.onRequestStorageSwitch("turso");
    });

    expect(targetSave).toHaveBeenCalledTimes(1);
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "turso" });
    // success path must also fire the "converted" info toast
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("suppress-load: after a successful switch backend.load is NOT called when the load effect re-runs with the suppress flag set", async () => {
    const targetSave = vi.fn().mockResolvedValue(undefined);
    // A second backend that would be created once setStorageConfig triggers a
    // re-render and the backend memo rebuilds.
    const targetBackend = {
      kind: "turso",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: targetSave,
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("Turso: x"),
    };

    // First createBackend call → main (browser) backend
    // Second call → target backend (produced inside onRequestStorageSwitch)
    // Third call → new memo backend after setStorageConfig re-render
    createBackendMock
      .mockReturnValueOnce(mockBackend)   // initial memo
      .mockReturnValueOnce(targetBackend) // created inside onRequestStorageSwitch
      .mockReturnValueOnce(targetBackend); // memo rebuilds after setStorageConfig

    vi.spyOn(window, "confirm").mockReturnValue(true);

    // Use a mutable ref so the probe always sees the latest args, allowing
    // rerender() to pass a new storageConfig to the hook without needing a
    // new hook function reference.
    const argsRef = {
      current: makeArgs({ setStorageConfig }),
    };
    const { result, rerender } = renderHook(
      () => {
        const backend = useStorageBackend(argsRef.current);
        const { tasks, raid, absences, shifts, setTasks } = useWorkspace();
        return { ...backend, tasks, raid, absences, shifts, setTasks };
      },
      { wrapper: ({ children }) => <TestProviders>{children}</TestProviders> },
    );

    // Let initial load complete
    await act(async () => { await Promise.resolve(); });
    mockBackend.load.mockClear();
    targetBackend.load.mockClear();

    // Perform the switch — sets suppressNextLoadRef = true, then calls
    // setStorageConfig (our vi.fn mock).
    await act(async () => {
      await result.current.onRequestStorageSwitch("turso");
    });

    // Simulate the config-change re-render: update argsRef with the new
    // storageConfig so the backend memo invalidates and the load effect re-runs.
    argsRef.current = makeArgs({
      setStorageConfig,
      settings: { storageConfig: { kind: "turso" } } as unknown as Settings,
    });
    await act(async () => {
      rerender();
    });
    await act(async () => { await Promise.resolve(); });

    // The load effect ran with the new backend but suppressNextLoadRef was true,
    // so targetBackend.load must NOT have been called.
    expect(targetBackend.load).not.toHaveBeenCalled();
    // Status refresh DOES run (isReady/describe) to update storageReady/storageDescription.
    expect(targetBackend.isReady).toHaveBeenCalled();
  });

  it("confirm=false → no save, no config change", async () => {
    const targetSave = vi.fn().mockResolvedValue(undefined);
    const targetBackend = {
      kind: "turso",
      load: vi.fn(),
      save: targetSave,
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue(null),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValueOnce(targetBackend);

    vi.spyOn(window, "confirm").mockReturnValue(false);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.onRequestStorageSwitch("turso");
    });

    expect(setStorageConfig).not.toHaveBeenCalled();
    expect(targetSave).not.toHaveBeenCalled();
  });

  it("same kind → no-op (no confirm shown)", async () => {
    createBackendMock.mockReturnValue(mockBackend);

    const confirmSpy = vi.spyOn(window, "confirm");

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.onRequestStorageSwitch("browser");
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(setStorageConfig).not.toHaveBeenCalled();
  });

  it("write failure → no config change + error toast", async () => {
    const targetBackend = {
      kind: "turso",
      load: vi.fn(),
      save: vi.fn().mockRejectedValue(new Error("boom")),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue(null),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValueOnce(targetBackend);

    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.onRequestStorageSwitch("turso");
    });

    expect(setStorageConfig).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("onRequestStorageSwitch: unreachable Turso → storageUnreachable toast, no switch", async () => {
    const { StorageNotReadyError } = await import("./storage");
    createBackendMock.mockReturnValue({
      kind: "turso", load: vi.fn(),
      save: vi.fn().mockRejectedValue(new StorageNotReadyError("storage-unreachable")),
      isReady: vi.fn().mockResolvedValue(true), describe: vi.fn().mockResolvedValue(null),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      await result.current.onRequestStorageSwitch("turso");
    });
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("unreachable"));
    expect(setStorageConfig).not.toHaveBeenCalled();
  });

  it("warns (recording stops) and aborts when leaving Turso and the user cancels", async () => {
    const targetBackend = {
      kind: "browser",
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue(null),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValueOnce(targetBackend);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { result } = renderBackend(
      makeArgs({ setStorageConfig, settings: { storageConfig: { kind: "turso" } } as unknown as Settings }),
    );
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.onRequestStorageSwitch("browser");
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/recording/i));
    expect(setStorageConfig).not.toHaveBeenCalled();
  });

  it("proceeds with the switch when the user confirms leaving Turso", async () => {
    const targetBackend = {
      kind: "browser",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("Browser"),
    };
    // Use mockReturnValue (not Once) so the switch reaches a working backend
    // regardless of how many createBackend calls the mount/load effect consumes.
    createBackendMock.mockReturnValue(targetBackend);

    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderBackend(
      makeArgs({ setStorageConfig, settings: { storageConfig: { kind: "turso" } } as unknown as Settings }),
    );
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.onRequestStorageSwitch("browser");
    });

    expect(setStorageConfig).toHaveBeenCalledWith(expect.objectContaining({ kind: "browser" }));
  });

  it("uses the generic convert-confirm for a non-Turso source switch", async () => {
    const targetBackend = {
      kind: "local-json",
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue(null),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValueOnce(targetBackend);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { result } = renderBackend(
      makeArgs({ setStorageConfig, settings: { storageConfig: { kind: "browser" } } as unknown as Settings }),
    );
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.onRequestStorageSwitch("local-json");
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.not.stringMatching(/recording/i));
  });

  it("isPopout=true → no-op (no confirm shown, no config change)", async () => {
    createBackendMock.mockReturnValue(mockBackend);

    const confirmSpy = vi.spyOn(window, "confirm");

    const { result } = renderBackend(makeArgs({ isPopout: true, setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.onRequestStorageSwitch("turso");
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(setStorageConfig).not.toHaveBeenCalled();
  });
});

// ── Project switch / create / load-from-file (stateful flows) ─────────────────
// These cover the three multi-project functions that live in useStorageBackend.
// Fix-1 regression guard: createProject / loadProjectFromFile MUST flush the
// CURRENT backend before changing storageConfig (the config change cancels the
// pending debounced save), or in-window edits made within the 500ms debounce are
// silently lost.
describe("useStorageBackend — project flows", () => {
  const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;
  let setStorageConfig: ReturnType<typeof vi.fn<(config: StorageConfig) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    setStorageConfig = vi.fn<(config: StorageConfig) => void>();
    // Reset the registry between tests (real module, jsdom localStorage).
    saveRegistry(emptyRegistry());
    // Default main backend (kind="browser")
    mockBackend.load.mockResolvedValue(emptyWorkspace());
    mockBackend.save.mockResolvedValue(undefined);
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue("Browser");
    createBackendMock.mockReturnValue(mockBackend);
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (storageMod.requestWriteAccessForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (storageMod.setBackendFileHandle as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (storageMod.getBackendFileHandle as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (handlesMod.getHandle as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (handlesMod.saveHandle as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  // ── switchToProject ─────────────────────────────────────────────────────────
  it("switchToProject saves the outgoing project, injects the target handle before load, applies target data + points config at the target", async () => {
    // Register a target file project in the registry.
    const targetId = "target-1";
    const targetConfig: StorageConfig = { kind: "local-json" };
    saveRegistry(
      addProject(loadRegistry(), { id: targetId, name: "Target", code: "T", storageConfig: targetConfig }, false),
    );

    // Order log so we can assert handle-inject-before-load and save-before-config.
    const order: string[] = [];
    const handle = { name: "target.json" } as unknown as Parameters<typeof handlesMod.saveHandle>[1];
    (handlesMod.getHandle as ReturnType<typeof vi.fn>).mockResolvedValue(handle);

    const targetBackend = {
      kind: "local-json",
      load: vi.fn(() => { order.push("targetLoad"); return Promise.resolve({ ...emptyWorkspace(), tasks: [{ id: 555, taskName: "FromTarget" }] }); }),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("target.json"),
    };
    (storageMod.setBackendFileHandle as ReturnType<typeof vi.fn>).mockImplementation(() => { order.push("setHandle"); return null; });
    setStorageConfig.mockImplementation(() => { order.push("setConfig"); });

    // Main backend records its save (the outgoing flush).
    mockBackend.save.mockImplementation(() => { order.push("outgoingSave"); return Promise.resolve(undefined); });

    // First createBackend → main (browser) memo; backendFor(target) → targetBackend.
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValue(targetBackend);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.switchToProject(targetId); });
    await act(async () => { await Promise.resolve(); });

    // Outgoing project flushed to the CURRENT (main) backend.
    expect(mockBackend.save).toHaveBeenCalled();
    // Target handle injected BEFORE the target load.
    expect(storageMod.setBackendFileHandle).toHaveBeenCalledWith(targetBackend, handle);
    expect(order.indexOf("setHandle")).toBeLessThan(order.indexOf("targetLoad"));
    // Outgoing save happened before storageConfig was repointed.
    expect(order.indexOf("outgoingSave")).toBeLessThan(order.indexOf("setConfig"));
    // Target data applied + config repointed at the target.
    expect(result.current.tasks[0]?.id).toBe(555);
    expect(setStorageConfig).toHaveBeenCalledWith(targetConfig);
  });

  it("switchToProject is a no-op when the target id is the current project", async () => {
    const targetId = "current-proj";
    saveRegistry(
      addProject(emptyRegistry(), { id: targetId, name: "Cur", code: "C", storageConfig: { kind: "browser" } }, true),
    );
    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    await act(async () => { await result.current.switchToProject(targetId); });

    expect(setStorageConfig).not.toHaveBeenCalled();
    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  // ── createProject — Fix-1 regression guard ──────────────────────────────────
  it("createProject FLUSHES the current backend before switching storageConfig (Fix-1 regression guard)", async () => {
    const order: string[] = [];
    mockBackend.save.mockImplementation(() => { order.push("currentSave"); return Promise.resolve(undefined); });
    setStorageConfig.mockImplementation(() => { order.push("setConfig"); });

    const targetBackend = {
      kind: "local-json",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: vi.fn(() => { order.push("targetSave"); return Promise.resolve(undefined); }),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("new.json"),
    };
    // First createBackend → main memo; backendFor(newConfig) → targetBackend.
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValue(targetBackend);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    order.length = 0; // ignore any save during mount

    await act(async () => {
      await result.current.createProject({ name: "New Proj", code: "NP" } as never, "json");
    });
    await act(async () => { await Promise.resolve(); });

    // The CURRENT (outgoing) backend was flushed...
    expect(mockBackend.save).toHaveBeenCalled();
    // ...BEFORE storageConfig was repointed at the new project.
    expect(order.indexOf("currentSave")).toBeLessThan(order.indexOf("setConfig"));
    // ...and the outgoing flush used the current backend, distinct from the new
    //    target backend's write.
    expect(order.indexOf("currentSave")).toBeLessThan(order.indexOf("targetSave"));
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-json" });
  });

  it("createProject applies the new empty workspace + registers/selects it", async () => {
    const targetBackend = {
      kind: "local-json",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("new.json"),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValue(targetBackend);

    // Seed the current workspace with a task so we can prove it's cleared.
    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { result.current.setTasks([{ id: 1 } as unknown as Task]); });

    await act(async () => {
      await result.current.createProject({ name: "New Proj", code: "NP" } as never, "json");
    });
    await act(async () => { await Promise.resolve(); });

    // New empty workspace applied (task cleared).
    expect(result.current.tasks).toHaveLength(0);
    // Registered + selected in the registry.
    const reg = loadRegistry();
    expect(reg.projects.some((p) => p.name === "New Proj")).toBe(true);
    expect(reg.currentProjectId).not.toBeNull();
  });

  // ── createDemoProject — registers the demo as a REAL local project ──────────
  // Regression guard for the SP-F CRITICAL: the empty-state "Explore a demo
  // project" CTA must register a project (raise the registry count) so the
  // showEmptyState gate flips false and the views + tour overlay mount. An
  // apply-only path left the registry empty and the demo invisible.
  it("createDemoProject registers the supplied workspace as a real project (registry count rises) + applies its data, no file picker", async () => {
    const targetSave = vi.fn().mockResolvedValue(undefined);
    const targetBackend = {
      kind: "browser",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: targetSave,
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("Browser"),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValue(targetBackend);

    const sampleWs = {
      ...emptyWorkspace(),
      project: { name: "Demo PM", code: "DEMO" },
      tasks: [{ id: 1, taskName: "Sample task" } as unknown as Task],
    };

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.createDemoProject(sampleWs as never);
    });
    await act(async () => { await Promise.resolve(); });

    // Registry now holds exactly one project, derived from the sample meta…
    const reg = loadRegistry();
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0]?.name).toBe("Demo PM");
    expect(reg.currentProjectId).not.toBeNull();
    // …the sample data was applied into workspace state…
    expect(result.current.tasks[0]?.id).toBe(1);
    // …it was persisted to the browser/IDB backend (NO file picker)…
    expect(targetSave).toHaveBeenCalledWith(expect.objectContaining({ project: expect.objectContaining({ code: "DEMO" }) }));
    expect(storageMod.pickFileForBackend).not.toHaveBeenCalled();
    // …and the config was repointed at the frictionless browser backend.
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "browser" });
  });

  // In TURSO portfolio mode a local demo can't flip the Turso-branch empty-state
  // gate, so createDemoProject must durably persist (registry + settings + mode)
  // and switch the portfolio to file mode + reload. Hardened path: all writes land
  // BEFORE the reload, and it does NOT apply in place (the reload would discard it).
  it("createDemoProject in Turso mode persists registry+settings+file-mode and reloads (no in-place apply)", async () => {
    const targetBackend = {
      kind: "browser",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("Browser"),
    };
    createBackendMock.mockReturnValueOnce(mockBackend).mockReturnValue(targetBackend);
    savePortfolioMode("turso");

    const sampleWs = { ...emptyWorkspace(), project: { name: "Demo PM", code: "DEMO" } };

    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload: reloadSpy } });
    try {
      const { result } = renderBackend(makeArgs({ setStorageConfig }));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await result.current.createDemoProject(sampleWs as never); });
      await act(async () => { await Promise.resolve(); });

      // Durable writes landed BEFORE the reload: registry has the demo, portfolio
      // mode flipped to file, settings persisted the browser storageConfig.
      expect(loadRegistry().projects).toHaveLength(1);
      expect(loadPortfolioMode()).toBe("file");
      const persisted = JSON.parse(window.localStorage.getItem("aipm-cockpit:settings") ?? "{}");
      expect(persisted.storageConfig?.kind).toBe("browser");
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      // In-place apply skipped (reload discards it) — no success toast fired.
      expect(setStorageConfig).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
      savePortfolioMode("file");
    }
  });

  // ── R3: registry persistence failure must be surfaced ───────────────────────
  it("createProject surfaces a registry save failure as an error toast while still updating the in-memory registry", async () => {
    const onRegistryChange = vi.fn();
    const targetBackend = {
      kind: "local-json",
      load: vi.fn().mockResolvedValue(emptyWorkspace()),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("new.json"),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValue(targetBackend);

    const { result } = renderBackend(makeArgs({ setStorageConfig, onRegistryChange }));
    await act(async () => { await Promise.resolve(); });

    // Quota exhausted / storage disabled: every localStorage write throws.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    try {
      await act(async () => {
        await result.current.createProject({ name: "New Proj", code: "NP" } as never, "json");
      });
    } finally {
      setItemSpy.mockRestore();
    }

    // The observable in-memory registry copy still received the new project…
    expect(onRegistryChange).toHaveBeenCalledWith(
      expect.objectContaining({
        projects: [expect.objectContaining({ name: "New Proj" })],
      }),
    );
    // …and the persistence failure was surfaced to the user.
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("project list"));
  });

  // ── loadProjectFromFile — Fix-1 regression guard ────────────────────────────
  it("loadProjectFromFile FLUSHES the current backend before switching storageConfig (Fix-1 regression guard)", async () => {
    const order: string[] = [];
    mockBackend.save.mockImplementation(() => { order.push("currentSave"); return Promise.resolve(undefined); });
    setStorageConfig.mockImplementation(() => { order.push("setConfig"); });

    const targetBackend = {
      kind: "local-json",
      load: vi.fn().mockResolvedValue({ ...emptyWorkspace(), tasks: [{ id: 77, taskName: "Opened" }] }),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("opened.json"),
    };
    // openFileForBackend must return a promise so the function proceeds past its
    // early `if (!open) return` guard.
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(undefined));
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValue(targetBackend);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    order.length = 0;

    await act(async () => { await result.current.loadProjectFromFile("json"); });
    await act(async () => { await Promise.resolve(); });

    // Outgoing flush happened on the current backend before the config repoint.
    expect(mockBackend.save).toHaveBeenCalled();
    expect(order.indexOf("currentSave")).toBeLessThan(order.indexOf("setConfig"));
    // Loaded data applied + config repointed.
    expect(result.current.tasks[0]?.id).toBe(77);
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-json" });
  });

  it("loadProjectFromFile returns early (no flush, no config change) when the user cancels the file picker", async () => {
    // openFileForBackend returns null → user dismissed / non-file backend.
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const targetBackend = {
      kind: "local-json",
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue(null),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValue(targetBackend);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    await act(async () => { await result.current.loadProjectFromFile("json"); });

    // The flush DOES run (it's the first thing the function does, before the
    // picker), but the config must NOT change after an early return.
    expect(setStorageConfig).not.toHaveBeenCalled();
    expect(targetBackend.load).not.toHaveBeenCalled();
  });

  it("loadProjectFromFile() with no format auto-detects from the picked file extension (CSV)", async () => {
    const handle = { name: "exported.csv" };
    (storageMod.pickOpenFileAny as ReturnType<typeof vi.fn>).mockResolvedValue(handle);
    (storageMod.formatFromFileName as ReturnType<typeof vi.fn>).mockReturnValue("csv");
    (storageMod.setBackendFileHandle as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(undefined));
    (storageMod.requestWriteAccessForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(true));

    const targetBackend = {
      kind: "local-csv",
      load: vi.fn().mockResolvedValue({ ...emptyWorkspace(), tasks: [{ id: 88, taskName: "FromCsv" }] }),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("exported.csv"),
    };
    createBackendMock
      .mockReturnValueOnce(mockBackend)
      .mockReturnValue(targetBackend);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.loadProjectFromFile(); });
    await act(async () => { await Promise.resolve(); });

    // The any-format picker was used (not a per-format picker), the picked
    // handle was bound to the CSV backend, and the CSV config was applied.
    expect(storageMod.pickOpenFileAny).toHaveBeenCalled();
    expect(storageMod.formatFromFileName).toHaveBeenCalledWith("exported.csv");
    expect(storageMod.setBackendFileHandle).toHaveBeenCalledWith(targetBackend, handle);
    expect(storageMod.openFileForBackend).not.toHaveBeenCalled();
    expect(result.current.tasks[0]?.id).toBe(88);
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-csv" });
  });
});

// ── Turso portfolio (multi-tenant) flows ──────────────────────────────────────
// Exercises createTursoProject: it must call the portfolio create op with the
// supplied meta + a generated id, cache that id (loadCurrentTursoProjectId), and
// apply the new workspace (project meta surfaces in workspace state).
describe("useStorageBackend — Turso portfolio flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveCurrentTursoProjectId(null);
    mockBackend.load.mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    mockBackend.save.mockResolvedValue(undefined);
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue("Turso");
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  function tursoArgs() {
    return makeArgs({
      settings: {
        storageConfig: { kind: "turso" },
        integrations: { turso: { databaseUrl: "https://x.turso.io", authToken: "tok" } },
      } as unknown as Settings,
    });
  }

  it("createTursoProject calls the portfolio create op with the meta, caches the id, and applies the new project", async () => {
    const meta = { name: "Apollo", code: "AP" } as never;
    const { result } = renderBackend(tursoArgs());
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.createTursoProject(meta); });
    await act(async () => { await Promise.resolve(); });

    // (a) portfolio create called once with the supplied meta.
    const createMock = tursoPortfolioMod.createProject as ReturnType<typeof vi.fn>;
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ httpUrl: expect.any(String) }),
      meta,
      expect.any(String),
    );
    // (b) the generated id was cached for next-load selection.
    const cached = loadCurrentTursoProjectId();
    expect(cached).toBeTruthy();
    // The id passed to create is the same one that got cached.
    expect(createMock.mock.calls[0]?.[2]).toBe(cached);
    // (c) the new project meta was applied into workspace state.
    expect(result.current.project).toEqual(meta);
  });

  it("migrateCurrentProjectToTurso persists storageConfig.kind 'turso' so the workspace backend follows the portfolio (regression: snapshot 'Storage not ready')", async () => {
    // Start on a FILE/browser portfolio with a current project, Turso configured.
    const meta = { name: "Gemini", code: "GE" } as never;
    mockBackend.load.mockResolvedValue({ project: meta, tasks: [], raid: [], absences: [], shifts: [] });
    const args = makeArgs({
      settings: {
        storageConfig: { kind: "browser" },
        integrations: { turso: { databaseUrl: "https://x.turso.io", authToken: "tok" } },
      } as unknown as Settings,
    });

    // Stub reload — jsdom's is a no-op that warns; replace so we can assert it ran.
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    try {
      const { result } = renderBackend(args);
      await act(async () => { await Promise.resolve(); });

      await act(async () => { await result.current.migrateCurrentProjectToTurso(); });
      await act(async () => { await Promise.resolve(); });

      // Settings were persisted synchronously with the Turso backend kind BEFORE
      // the reload, so the post-reload backend memo builds a TursoBackend.
      const persisted = JSON.parse(window.localStorage.getItem("aipm-cockpit:settings") ?? "{}");
      expect(persisted.storageConfig?.kind).toBe("turso");
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});

describe("useStorageBackend — reloadCurrentProject data-loss guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("does NOT wipe a populated project when the backend load returns empty and the user declines", async () => {
    mockBackend.load.mockResolvedValueOnce({ tasks: [{ id: 1, taskName: "Keep me" }] as unknown as Task[], raid: [], absences: [], shifts: [] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); }); // mount load applies the 1 task
    expect(result.current.tasks).toHaveLength(1);
    mockBackend.load.mockResolvedValueOnce({ tasks: [], raid: [], absences: [], shifts: [] });
    await act(async () => { await result.current.reloadCurrentProject(); });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(result.current.tasks).toHaveLength(1); // content preserved — empty load NOT applied
  });

  it("applies the empty load when the user confirms", async () => {
    mockBackend.load.mockResolvedValueOnce({ tasks: [{ id: 1, taskName: "Bye" }] as unknown as Task[], raid: [], absences: [], shifts: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    mockBackend.load.mockResolvedValueOnce({ tasks: [], raid: [], absences: [], shifts: [] });
    await act(async () => { await result.current.reloadCurrentProject(); });
    expect(result.current.tasks).toHaveLength(0);
  });

  it("reloads without a confirm when the current workspace is already empty (recovery case)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); }); // mount empty (default)
    mockBackend.load.mockResolvedValueOnce({ tasks: [{ id: 9, taskName: "Recovered" }] as unknown as Task[], raid: [], absences: [], shifts: [] });
    await act(async () => { await result.current.reloadCurrentProject(); });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(result.current.tasks).toHaveLength(1);
  });

  it("shows a success toast when the reload applies", async () => {
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); }); // mount empty
    mockBackend.load.mockResolvedValueOnce({ tasks: [{ id: 5, taskName: "Fresh" }] as unknown as Task[], raid: [], absences: [], shifts: [] });
    await act(async () => { await result.current.reloadCurrentProject(); });
    expect(showToast).toHaveBeenCalledWith("success", expect.any(String));
  });

  it("shows an error toast and leaves data untouched when the reload throws", async () => {
    mockBackend.load.mockResolvedValueOnce({ tasks: [{ id: 1, taskName: "Keep me" }] as unknown as Task[], raid: [], absences: [], shifts: [] });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); }); // mount 1 task
    expect(result.current.tasks).toHaveLength(1);
    mockBackend.load.mockRejectedValueOnce(new Error("backend unreachable"));
    await act(async () => { await result.current.reloadCurrentProject(); });
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(result.current.tasks).toHaveLength(1); // unchanged on failure
  });
});

describe("useStorageBackend — id-minter high-water seeding on load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMintStateForTests();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("seeds the session minter on load so the next task mint clears the loaded max (RESET)", async () => {
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 1, taskName: "a" }, { id: 100, taskName: "b" }] as unknown as Task[],
      raid: [], absences: [], shifts: [],
    });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); }); // mount load applies + seeds
    expect(result.current.tasks).toHaveLength(2);
    // The load RESET the mark to the loaded max (100), so the next mint is 101.
    expect(mintId("task", result.current.tasks)).toBe(101);
  });

  it("a same-project reload NEVER frees a locally-deleted max id (RAISE)", async () => {
    // Load with max id 100 → mark reset to 100.
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 1, taskName: "a" }, { id: 100, taskName: "b" }] as unknown as Task[],
      raid: [], absences: [], shifts: [],
    });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    expect(mintId("task", result.current.tasks)).toBe(101); // advances mark to 101

    // A reload reflecting the deletion of task 100 (backend now returns max 99)
    // must RAISE (not reset): the freed id 100/101 can't be reused.
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 1, taskName: "a" }, { id: 99, taskName: "c" }] as unknown as Task[],
      raid: [], absences: [], shifts: [],
    });
    await act(async () => { await result.current.reloadCurrentProject(); });
    expect(result.current.tasks.some((t) => (t as { id: number }).id === 100)).toBe(false);
    expect(mintId("task", result.current.tasks)).toBeGreaterThanOrEqual(102);
  });

  it("onOpenStorageFile seeds the minter so the opened file's max task id can't be reused (RAISE)", async () => {
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve(undefined),
    );
    // Mount load: a small project (max task id 10) → mark reset to 10.
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 10, taskName: "small" }] as unknown as Task[],
      raid: [], absences: [], shifts: [],
    });
    // onOpenStorageFile: a DIFFERENT, larger file (max task id 500).
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 1, taskName: "a" }, { id: 500, taskName: "big" }] as unknown as Task[],
      raid: [], absences: [], shifts: [],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onOpenStorageFile(); });
    await act(async () => { await Promise.resolve(); });

    // The opened file's tasks are now live (max 500). Without seeding, the mark
    // would still be 10 → deleting task 500 would let the next create reuse 500.
    expect(mintId("task", result.current.tasks)).toBeGreaterThanOrEqual(501);
  });
});

describe("useStorageBackend — Layer 3 wipe guard (persistence choke point)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("refuses to persist a MULTI-collection simultaneous wipe (bug signature)", async () => {
    mockBackend.load.mockResolvedValueOnce({ tasks: [{ id: 1, taskName: "T" }] as unknown as Task[], changes: [{ id: 5 }] as unknown as never[], raid: [], absences: [], shifts: [] });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); }); // mount: 2 collections → prev=2
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    await act(async () => { result.current.setTasks([]); result.current.setChanges([]); }); // wipe both at once
    expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("blocked a sudden wipe"));
  });

  it("ALLOWS a single-collection clear (not the wipe signature)", async () => {
    mockBackend.load.mockResolvedValueOnce({ tasks: [{ id: 1, taskName: "T" }] as unknown as Task[], raid: [], absences: [], shifts: [] });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); }); // mount: 1 collection → prev=1
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    await act(async () => { result.current.setTasks([]); }); // clear the only collection
    expect(showToast).not.toHaveBeenCalledWith("info", expect.stringContaining("blocked a sudden wipe"));
  });
});

describe("useStorageBackend — Layer B mass-deletion guard", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, taskName: "T" })) as unknown as Task[];
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("refuses an unexplained mass deletion (big project → near-empty in one save)", async () => {
    mockBackend.load.mockResolvedValueOnce({ tasks: many, raid: [], absences: [], shifts: [] });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); }); // prev: 20 records
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]); }); // remove 19
    expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("blocked a sudden wipe"));
  });

  it("allowDestructiveSave() bypasses the guard for a confirmed bulk delete", async () => {
    mockBackend.load.mockResolvedValueOnce({ tasks: many, raid: [], absences: [], shifts: [] });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    await act(async () => { result.current.allowDestructiveSave(); result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]); });
    expect(showToast).not.toHaveBeenCalledWith("info", expect.stringContaining("blocked a sudden wipe"));
  });
});
