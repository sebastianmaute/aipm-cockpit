import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { Settings } from "./settings-menu";
import type { Lang } from "./i18n";
import type { Task } from "./types";
import { useStorageBackend } from "./use-storage-backend";
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
  requestWriteAccessForBackend: vi.fn(),
}));
import * as storageMod from "./storage";

// ── Broadcast-sync mock ───────────────────────────────────────────────────────
vi.mock("./broadcast-sync", () => ({
  useBroadcastSync: vi.fn(),
}));

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
    const { tasks, raid, absences, shifts, setTasks } = useWorkspace();
    return { ...backend, tasks, raid, absences, shifts, setTasks };
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
  let setStorageConfig: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setStorageConfig = vi.fn();
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
    // FIX 6a: success path must also fire the "converted" info toast
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
});
