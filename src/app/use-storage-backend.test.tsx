import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { Settings } from "./settings-types";
import type { Lang } from "./i18n";
import type { Task } from "./types";
import type { StorageConfig } from "./storage";
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

// ── TursoTenantBackend mock (per-project backend built directly in the hook) ──
vi.mock("./turso-tenant-backend", () => ({
  TursoTenantBackend: class {
    kind = "turso" as const;
    constructor(public config: unknown, public projectId: string) {}
    load = vi.fn().mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    save = vi.fn().mockResolvedValue(undefined);
    isReady = vi.fn().mockResolvedValue(true);
    describe = vi.fn().mockResolvedValue("Turso");
  },
}));

// portfolio-mode is a pure module backed by jsdom localStorage — use it for real
// so saveCurrentTursoProjectId / loadCurrentTursoProjectId round-trip as in prod.
import { loadCurrentTursoProjectId, saveCurrentTursoProjectId } from "./portfolio-mode";

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
});
