import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { Settings } from "./settings-types";
import type { Lang } from "./i18n";
import type { Task } from "./types";
import type { ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";
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

// ── Diagnostics mock (only the §72 teardown test asserts on it) ───────────────
vi.mock("./diagnostics", () => ({
  logDiag: vi.fn(),
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
    const { tasks, raid, absences, shifts, setTasks, changes, setChanges, project, documents, setDocuments, documentVersions, setDocumentVersions } = useWorkspace();
    return { ...backend, tasks, raid, absences, shifts, setTasks, changes, setChanges, project, documents, setDocuments, documentVersions, setDocumentVersions };
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

  it("persists a DOCUMENTS-ONLY change — the autosave deps-array guard", async () => {
    // ★★★ This is the `documents`-in-the-deps-array regression, and the ONLY
    // shape that catches it: the save effect's dependency array is what decides
    // whether a change re-triggers a save. Omit `documents` there and saves
    // still fire for every other slice, so a test that also touches tasks
    // passes while a documents-only edit is silently LOST on reload.
    // Nothing but `documents` may be mutated below — that is the whole point.
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    await act(async () => {
      result.current.setDocuments([
        {
          id: 1,
          title: "Status report",
          blocks: [],
          createdAt: "2026-08-06T00:00:00.000Z",
          updatedAt: "2026-08-06T00:00:00.000Z",
        },
      ]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(mockBackend.save).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [expect.objectContaining({ id: 1, title: "Status report" })],
      }),
    );
  });

  it("restores documents from a loaded workspace", async () => {
    // The other half of the round trip: a document present in the backend's
    // workspace has to reach React state, or the pane renders its empty state
    // over a project that does have documents.
    mockBackend.load.mockResolvedValue({
      tasks: [], raid: [], absences: [], shifts: [],
      documents: [
        {
          id: 7,
          title: "Loaded doc",
          blocks: [],
          createdAt: "2026-08-06T00:00:00.000Z",
          updatedAt: "2026-08-06T00:00:00.000Z",
        },
      ],
    });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.documents).toEqual([
      expect.objectContaining({ id: 7, title: "Loaded doc" }),
    ]);
  });

  it("defaults documents to [] when the loaded workspace has none", async () => {
    // ★ The context state is NON-optional so the panel's functional setter can
    // spread `prev`. A load path that passed `undefined` through would make
    // `setDocuments(prev => [...prev, x])` throw on the first create.
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.documents).toEqual([]);
  });

  // ── documentVersions ───────────────────────────────────────────────────────
  // `documentVersions` is a meta-blob slice like `documents`, implemented in the
  // model and all six write paths but — until this wiring — never loaded or
  // saved, so a reload silently dropped every document's version history.
  //
  // ★★ Every fixture below carries `source: "ai"` and `op: "restored"`. The
  // sanitizer's fallbacks are "user" and "update" and the context state
  // initialises to `[]`, so neither value can be invented downstream: an
  // assertion that sees them proves real data crossed the wiring rather than
  // passing against a default.
  const AI_RESTORED_VERSION: DocVersion = {
    id: 11,
    documentId: 7,
    title: "Loaded doc — before image",
    blocks: [],
    savedAt: "2026-08-06T00:00:00.000Z",
    source: "ai",
    op: "restored",
  };

  it("persists a DOCUMENT-VERSIONS-ONLY change — the autosave deps-array guard", async () => {
    // Same shape (and same reason) as the documents-only test above: the deps
    // array is what decides whether a change re-triggers a save, so nothing but
    // `documentVersions` may be mutated here. This one assertion covers BOTH
    // failure modes — omitted from the deps array, no save fires at all;
    // omitted from the save literal, the payload lacks the key.
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    await act(async () => { result.current.setDocumentVersions([AI_RESTORED_VERSION]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(mockBackend.save).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersions: [expect.objectContaining({ id: 11, documentId: 7, source: "ai", op: "restored" })],
      }),
    );
  });

  it("restores documentVersions from a loaded workspace", async () => {
    // The other half of the round trip. Without it a reload keeps the documents
    // but drops their history — and because `deletedDocumentVersions` derives
    // tombstones from the two slices together, a half-loaded pair also renders a
    // wrong deleted-documents list.
    mockBackend.load.mockResolvedValue({
      tasks: [], raid: [], absences: [], shifts: [],
      documentVersions: [AI_RESTORED_VERSION],
    });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.documentVersions).toEqual([
      expect.objectContaining({ id: 11, documentId: 7, source: "ai", op: "restored" }),
    ]);
  });

  it("defaults documentVersions to [] when the loaded workspace has none", async () => {
    // ★ Non-optional in context for the same reason `documents` is: the mutation
    // engine spreads `prev`, which would throw on `undefined`.
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.documentVersions).toEqual([]);
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

  // §72 residual: `refreshBackendStatus`'s own setters are guarded too.
  //
  // The guard's PURPOSE — stopping a post-teardown `setStorageReady` from
  // throwing — is not stageable here: React 19 discards a post-unmount
  // setState silently, and the throw needs a torn-down jsdom.
  //
  // ★★★ READ THIS BEFORE TRUSTING IT. This test pins the `logDiag`-outside-
  //   the-guard decision and NOTHING ELSE. Deleting all three
  //   `if (!mountedRef.current) return;` lines from `refreshBackendStatus`
  //   leaves it GREEN — verified by running that mutation. An earlier
  //   version of this comment claimed the test "demonstrates the guard is live
  //   in this catch path": true of the one-time experiment (moving the logDiag
  //   call below the guard DOES fail it, which can only happen if the guard
  //   fired), false of the shipped artifact, which never re-runs it.
  //   So: nothing in this suite stops someone deleting the guard and
  //   reintroducing §72's unhandled rejection with every gate green.
  it("still records a status failure that lands after unmount (§72)", async () => {
    const { logDiag } = await import("./diagnostics");
    let rejectReady!: (err: Error) => void;
    mockBackend.isReady.mockReturnValueOnce(new Promise<boolean>((_, reject) => { rejectReady = reject; }));

    const { unmount } = renderBackend(makeArgs());
    await act(async () => { await Promise.resolve(); });

    unmount();
    await act(async () => {
      rejectReady(new Error("backend gone"));
      await Promise.resolve();
    });

    expect(logDiag).toHaveBeenCalledWith(
      "warn",
      "storage.statusCheckFailed",
      expect.objectContaining({ message: "backend gone" }),
    );
  });

  // ★★ `mountedRef.current = true` in the effect BODY (not just the cleanup) is
  //    load-bearing in dev, and it IS pinned — see the "StrictMode mount re-set
  //    (§72)" describe at the end of this file.
  //    ★★★ This comment previously said the opposite: that a StrictMode-wrapped
  //    renderHook had been tried and was VACUOUS, measured 2026-08-04 as
  //    ["mount"] with no cleanup+remount. That observation is REPRODUCIBLE —
  //    a StrictMode composed inside a wrapper function does single-invoke a
  //    child mounted in the same commit — but the CONCLUSION drawn from it
  //    (that the behaviour could not be pinned) was wrong. (Which shape the
  //    2026-08-04 run used was never recovered.) The guard below uses RTL's
  //    `reactStrictMode: true`, which leaves nothing between the root and
  //    StrictMode, and it dies when the re-set is deleted. The shape rule and
  //    its edges are pinned in strictmode.meta.test.tsx; see open-followups
  //    §85.
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

// ── Documents broadcast sync (cross-tab data loss) ───────────────────────────
// The save effect writes the WHOLE workspace on any slice change. A tab that
// never hears about another tab's document create keeps its own stale (empty)
// `documents` and writes it back over the other tab's work on its next save.
// Registering the channel is what stops that, so the assertion below is that an
// incoming `documents` message actually LANDS IN STATE — not merely that some
// channel was registered.
describe("useStorageBackend — documents broadcast sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("applies an incoming `documents` broadcast into workspace state", () => {
    const { result } = renderBackend();
    // Control: the slice starts empty, so the assertion below cannot pass by accident.
    expect(result.current.documents).toHaveLength(0);

    const call = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => c[0] === "documents");
    if (!call) throw new Error("no `documents` channel is registered with useBroadcastSync");

    // c[2] is `applyIncoming` — the setter the real hook calls on a message from
    // another tab. Driving it directly proves the registered setter is wired to
    // the live `documents` state and not, say, a stub or the wrong slice.
    const applyIncoming = call[2] as (next: readonly ProjectDocument[]) => void;
    act(() => {
      applyIncoming([{ id: 5, title: "Kickoff deck" } as ProjectDocument]);
    });

    expect(result.current.documents.map((d) => d.title)).toEqual(["Kickoff deck"]);
  });

  it("applies an incoming `documentVersions` broadcast into workspace state", () => {
    // ★★ The two slices MUST share the cross-tab channel set. `documents` alone
    // is not enough: `deletedDocumentVersions(versions, documents)` reports a
    // version whose documentId is absent from `documents` as a DELETED document,
    // so a tab that heard about a document delete but not the matching version
    // (or the reverse) renders a wrong deleted-documents list.
    const { result } = renderBackend();
    // Control: the slice starts empty, so the assertion below cannot pass by accident.
    expect(result.current.documentVersions).toHaveLength(0);

    const call = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => c[0] === "documentVersions");
    if (!call) throw new Error("no `documentVersions` channel is registered with useBroadcastSync");

    // c[2] is `applyIncoming` — driving it directly proves the registered setter
    // is wired to the live `documentVersions` state, not a stub or the wrong slice.
    const applyIncoming = call[2] as (next: readonly DocVersion[]) => void;
    act(() => {
      applyIncoming([{ id: 11, documentId: 7, title: "Kickoff deck v1", blocks: [], savedAt: "2026-08-06T00:00:00.000Z", source: "ai", op: "restored" }]);
    });

    expect(result.current.documentVersions.map((v) => v.title)).toEqual(["Kickoff deck v1"]);
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
    // ★★★ `clearAllMocks` does NOT drain a `mockReturnValueOnce` queue — it is
    //     `mockClear`, which only wipes calls/instances/results. `createBackend`
    //     is a MODULE-LEVEL mock shared by every test in this file, and THREE
    //     tests in this describe queue two values while deliberately consuming
    //     only one — the early return under test IS the assertion, so the
    //     second queued value is left over: "confirm=false → no save, no
    //     config change", "warns (recording stops) and aborts when leaving
    //     Turso and the user cancels", and "uses the generic convert-confirm
    //     for a non-Turso source switch". Under `--sequence.shuffle
    //     --sequence.seed=1` one such leftover became the next test's FIRST
    //     createBackend() result, shifting the whole queue by one: the switch
    //     target came back as the main backend and `targetSave` was never
    //     called. `mockReset` drains the queue; the mockReturnValue below
    //     re-establishes the default. NOT `vi.resetAllMocks()` — that resets
    //     every mock in the module back to its bare `vi.fn()`, wiping the
    //     module-scope `mockBackend.*` implementations (and the TursoBackend
    //     mock methods) that several other describes in this file rely on
    //     without re-establishing. See open-followups §75.
    // ★★ SCOPE: this drains `createBackend` ONLY. The rule stated above is
    //     general, but the remedy here is not — `mockBackend` is a
    //     module-level const that is never rebuilt, and other describes in
    //     this file queue once-values on `mockBackend.load` / `isReady` /
    //     `describe` / `save` with no drain at all. Those are latent, not
    //     known-live (the suite passes shuffled at seeds 1/2/3/7), but do not
    //     read this block as "the once-queue class is handled file-wide."
    createBackendMock.mockReset();
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
    // ★ Drain `createBackend`'s once-queue on the way OUT too. The `beforeEach`
    //   drain above only fires at the START of each test in THIS describe, so
    //   it makes intra-describe ordering safe but does nothing for whichever
    //   test `--sequence.shuffle` schedules LAST here. A leftover once-value
    //   from that test would then survive into whichever describe runs next —
    //   that describe's own `beforeEach` sets its default with
    //   `.mockReturnValue(mockBackend)`, but a plain default does NOT out-rank
    //   a queued once-value (vitest's dispatcher shifts the once-queue first),
    //   so its first `createBackend()` call would silently receive the
    //   leftover instead of `mockBackend`. See open-followups §75.
    createBackendMock.mockReset();
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

// ── §103: the truncated-load save guard ──────────────────────────────────────
// An over-cap load truncates the documents array; the next AUTOMATIC save then
// commits that loss permanently on all six write paths, because the excess
// documents are still in the source file. The guard pauses saving until the user
// resolves it, and `allowTruncatedSave` is the only way out — the user cannot get
// under the cap by editing, since the excess entries were never loaded.
describe("useStorageBackend — §103 truncated-load guard", () => {
  // A LOCAL backend per test: `lastLoadTruncation` is a plain PROPERTY, so
  // vi.clearAllMocks() would not reset it on the shared `mockBackend` and a
  // truncating fixture would leak into every later test — which the shuffled-seed
  // gate would surface as an unrelated failure somewhere else in the file.
  // Assigned inside `load()` so the read order (load, then report) is real.
  function makeTruncBackend(truncation?: { entries: number; blocks: number }) {
    const b = {
      load: vi.fn(async () => {
        b.lastLoadTruncation = truncation;
        return { tasks: [], raid: [], absences: [], shifts: [] };
      }),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue(null),
      lastLoadTruncation: undefined as { entries: number; blocks: number } | undefined,
    };
    return b;
  }

  function useTruncBackend(truncation?: { entries: number; blocks: number }) {
    const b = makeTruncBackend(truncation);
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(b);
    return b;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it("toasts and raises the flag when the load truncated ENTRIES", async () => {
    useTruncBackend({ entries: 5, blocks: 0 });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("5 document entries could not be opened"));
    expect(result.current.loadWasTruncated).toBe(true);
  });

  it("does neither when the load reported no truncation", async () => {
    useTruncBackend({ entries: 0, blocks: 0 });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(showToast).not.toHaveBeenCalledWith("error", expect.stringContaining("could not be opened"));
    expect(result.current.loadWasTruncated).toBe(false);
  });

  it("a BLOCKS-only truncation toasts the blocks string, never '0 document entries'", async () => {
    // ★★★ The shape this design was corrected for. `entries` and `blocks` are
    // independent counts; interpolating the entries count unconditionally reports
    // "0 document entries could not be opened" over a real blocks-only loss.
    useTruncBackend({ entries: 0, blocks: 7 });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    // ★ "stored documents", not "stored document versions": live documents feed
    // this same counter now (a >MAX_BLOCKS_PER_DOC document loaded truncated
    // with nothing recorded until §103's fix), so the old wording was false.
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("7 blocks in stored documents could not be opened"));
    expect(showToast).not.toHaveBeenCalledWith("error", expect.stringContaining("document entries"));
    expect(result.current.loadWasTruncated).toBe(true);
  });

  it("refuses an AUTOMATIC save while the load is unresolved", async () => {
    const backend = useTruncBackend({ entries: 5, blocks: 0 });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    backend.save.mockClear();

    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(backend.save).not.toHaveBeenCalled();
    // Sticky: the refusal does not consume the flag, so every later autosave is
    // refused too until the user acts.
    expect(result.current.loadWasTruncated).toBe(true);
  });

  it("allowTruncatedSave() lets the pending edit through — the escape, not just an unlock", async () => {
    // ★★★ This is the test separating a guard from a permanent save LOCKOUT.
    // The refusal above is only correct if this path actually WRITES.
    const backend = useTruncBackend({ entries: 5, blocks: 0 });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    backend.save.mockClear();

    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    // Control — without this the assertion below could pass on a guard that
    // never engaged at all.
    expect(backend.save).not.toHaveBeenCalled();

    await act(async () => { result.current.allowTruncatedSave(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(backend.save).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: [expect.objectContaining({ id: 1, taskName: "T1" })] }),
    );
    expect(result.current.loadWasTruncated).toBe(false);
  });

  // ── the one-shot destructive bypass must not outlive a truncation refusal ──
  // ★★★ EVERY OTHER EARLY RETURN IN THE SAVE EFFECT IS ONE-SHOT BOUNDED; THIS
  // ONE IS NOT. `allowDestructiveRef` is armed by an explicit bulk op to let the
  // NEXT save past the Layer-B mass-deletion guard, and the consume sits BELOW
  // the truncation return — so a bypass armed while the banner is up is never
  // spent and stays armed across an unbounded number of later edits. The
  // scenario: truncated load → clear-all arms the bypass → save refused → work
  // continues → an accidental bulk delete → "Save anyway" → the hour-old bypass
  // waves the unrelated mass deletion straight through.
  const manyTasks = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, taskName: "T" })) as unknown as Task[];

  function useLoadedTruncBackend() {
    const b = {
      load: vi.fn(async () => {
        b.lastLoadTruncation = { entries: 5, blocks: 0 };
        return { tasks: manyTasks, raid: [], absences: [], shifts: [] };
      }),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue(null),
      lastLoadTruncation: undefined as { entries: number; blocks: number } | undefined,
    };
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(b);
    return b;
  }

  it("does not carry a destructive bypass armed during the refusal into the eventual 'save anyway'", async () => {
    const backend = useLoadedTruncBackend();
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });   // 20 records → baseline 20
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    backend.save.mockClear();

    // The explicit bulk op: arm the bypass, then delete 19 of 20. The save is
    // refused by the truncation guard, so nothing is persisted and the Layer-B
    // baseline stays at 20.
    await act(async () => {
      result.current.allowDestructiveSave();
      result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(backend.save).not.toHaveBeenCalled(); // control: the refusal really engaged

    // Later, the user resolves the banner. The pending state is still a 19-of-20
    // deletion, and Layer B must now judge it on its own merits.
    await act(async () => { result.current.allowTruncatedSave(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(backend.save).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("blocked a sudden wipe"));
  });

  it("still honours a bypass armed AFTER the truncation is resolved", async () => {
    // ★★★ THE CONTROL THAT MAKES THE TEST ABOVE MEAN SOMETHING. Without it,
    // "save was not called" is equally satisfied by a guard that refuses every
    // mass deletion unconditionally — which would break the confirmed clear-all
    // this bypass exists for. Same fixture, same deletion; only the ORDER of
    // arming differs, and that alone must flip the outcome.
    const backend = useLoadedTruncBackend();
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    backend.save.mockClear();

    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(backend.save).not.toHaveBeenCalled();

    await act(async () => {
      result.current.allowTruncatedSave();
      result.current.allowDestructiveSave();
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(backend.save).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: [expect.objectContaining({ id: 1, taskName: "T" })] }),
    );
  });
});

// ── §103: the guard must reach EVERY load and EVERY flush ────────────────────
// ★★★ THE SEAM IS THE WHOLE POINT OF THIS BLOCK. The guard shipped correct in
// itself and wired into ONE of six loads and ONE of seven writes, so a user who
// switched project both missed the warning AND committed the loss the banner
// says is paused. Every test here drives the REAL `useStorageBackend`, so it
// pins the deps-object wiring into `useFileProjectOps` / `useTursoProjectOps`
// that a test against either ops hook alone cannot see.
describe("useStorageBackend — §103 truncation reaches every load/flush path", () => {
  const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;
  let setStorageConfig: ReturnType<typeof vi.fn<(config: StorageConfig) => void>>;

  // A backend that publishes `lastLoadTruncation` from INSIDE load(), so the
  // read order (load, then report) is the real one. Local per test —
  // `lastLoadTruncation` is a plain property that vi.clearAllMocks() would not
  // reset on a shared object, and a truncating fixture leaking into a later test
  // surfaces under the shuffled-seed gate as an unrelated failure.
  function makeBackend(truncation?: { entries: number; blocks: number }, ws?: object) {
    const b = {
      kind: "browser",
      load: vi.fn(async () => { b.lastLoadTruncation = truncation; return ws ?? emptyWorkspace(); }),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("f.json"),
      lastLoadTruncation: undefined as { entries: number; blocks: number } | undefined,
    };
    return b;
  }

  /** Register a switch TARGET in the registry (browser-kind → no file handle). */
  function registerTarget(id: string): void {
    saveRegistry(addProject(loadRegistry(), { id, name: "Target", code: "T", storageConfig: { kind: "browser" } }, false));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setStorageConfig = vi.fn<(config: StorageConfig) => void>();
    saveRegistry(emptyRegistry());
    saveCurrentTursoProjectId(null);
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (storageMod.requestWriteAccessForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (storageMod.setBackendFileHandle as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (handlesMod.getHandle as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (handlesMod.saveHandle as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  // ── LOAD PATHS: each one must REPORT ───────────────────────────────────────

  it("switchToProject reports the TARGET's truncation", async () => {
    const main = makeBackend();            // clean mount — the flag starts down
    const target = makeBackend({ entries: 4, blocks: 0 });
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(target);
    registerTarget("t-1");

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loadWasTruncated).toBe(false); // control: not already raised

    await act(async () => { await result.current.switchToProject("t-1"); });

    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("4 document entries could not be opened"));
    expect(result.current.loadWasTruncated).toBe(true);
  });

  it("loadProjectFromFile reports the opened file's truncation", async () => {
    const main = makeBackend();
    const opened = makeBackend({ entries: 9, blocks: 0 });
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(opened);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(true));

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loadWasTruncated).toBe(false);

    await act(async () => { await result.current.loadProjectFromFile("json"); });

    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("9 document entries could not be opened"));
    expect(result.current.loadWasTruncated).toBe(true);
  });

  it("reloadCurrentProject reports the re-read's truncation", async () => {
    // Clean first read, truncated on the RE-read — so the flag can only come
    // from the reload, not from the mount.
    const b = makeBackend();
    createBackendMock.mockReturnValue(b);
    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loadWasTruncated).toBe(false);

    b.load.mockImplementationOnce(async () => { b.lastLoadTruncation = { entries: 3, blocks: 0 }; return emptyWorkspace(); });
    await act(async () => { await result.current.reloadCurrentProject(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("3 document entries could not be opened"));
    expect(result.current.loadWasTruncated).toBe(true);
  });

  // ── CRITICAL 3: a CLEAN load must LOWER the flag ───────────────────────────

  it("a clean load LOWERS the flag — one over-cap project must not poison the session", async () => {
    // The backends already hold this invariant (`browser-backend.ts` resets
    // `lastLoadTruncation` before any early return, because a stale value is
    // worse than zero); the consumer used to keep the raised flag forever, so a
    // healthy project's saves stayed blocked under a banner asserting ITS
    // documents could not be opened.
    const truncated = makeBackend({ entries: 12, blocks: 0 });
    const clean = makeBackend();
    createBackendMock.mockReturnValueOnce(truncated).mockReturnValue(clean);
    registerTarget("healthy");

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loadWasTruncated).toBe(true); // control: really raised

    await act(async () => { await result.current.switchToProject("healthy"); });

    expect(result.current.loadWasTruncated).toBe(false);
  });

  it("reloadCurrentProject also lowers it — the recovery click a user would actually try", async () => {
    const b = makeBackend({ entries: 12, blocks: 0 });
    createBackendMock.mockReturnValue(b);
    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loadWasTruncated).toBe(true);

    b.load.mockImplementationOnce(async () => { b.lastLoadTruncation = { entries: 0, blocks: 0 }; return emptyWorkspace(); });
    await act(async () => { await result.current.reloadCurrentProject(); });

    expect(result.current.loadWasTruncated).toBe(false);
  });

  // ── WRITE PATHS: each best-effort flush must SKIP while unresolved ─────────

  it("switchToProject SKIPS the pre-switch flush while the load is unresolved", async () => {
    // ★★★ The worst case in the report: the banner says saving is paused, the
    // user switches project to get away from it, and the switch's own flush
    // commits the exact loss.
    const main = makeBackend({ entries: 7, blocks: 0 });
    const target = makeBackend();
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(target);
    registerTarget("t-2");

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    main.save.mockClear();

    await act(async () => { await result.current.switchToProject("t-2"); });

    expect(main.save).not.toHaveBeenCalled();
    // …and the switch still completed (a skip must not strand the user).
    expect(target.load).toHaveBeenCalled();
    expect(setStorageConfig).toHaveBeenCalled();
  });

  it("loadProjectFromFile SKIPS its flush while the load is unresolved", async () => {
    const main = makeBackend({ entries: 7, blocks: 0 });
    const opened = makeBackend();
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(opened);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(true));

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    main.save.mockClear();

    await act(async () => { await result.current.loadProjectFromFile("json"); });

    expect(main.save).not.toHaveBeenCalled();
    expect(opened.load).toHaveBeenCalled();
  });

  it("createProject SKIPS its flush of the outgoing project", async () => {
    const main = makeBackend({ entries: 7, blocks: 0 });
    const created = makeBackend();
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(created);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    main.save.mockClear();

    await act(async () => { await result.current.createProject({ name: "New", code: "N" } as never, "json"); });

    expect(main.save).not.toHaveBeenCalled();
    // The NEW project's own write is untouched: it persists a workspace built
    // from scratch to a DIFFERENT backend and cannot overwrite the source the
    // truncated documents are still sitting in.
    expect(created.save).toHaveBeenCalled();
    // ★★★ THE KILL LINE FOR `clearForFreshWorkspace`. The flag was TRUE a moment
    // ago (the outgoing flush above was skipped because of it), and the new
    // project is built rather than loaded — so no `reportFor` ever runs for it,
    // and `suppressNextLoadRef` swallows the load its storageConfig change
    // triggers. Without the clear, this brand-new project inherits the OLD one's
    // pause: every edit to it is silently refused and the banner reports the old
    // project's counts against a project with no documents at all.
    expect(result.current.loadWasTruncated).toBe(false);
  });

  it("createDemoProject SKIPS its flush of the outgoing project", async () => {
    const main = makeBackend({ entries: 7, blocks: 0 });
    const demo = makeBackend();
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(demo);

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    main.save.mockClear();

    await act(async () => { await result.current.createDemoProject(emptyWorkspace() as never); });

    expect(main.save).not.toHaveBeenCalled();
    expect(demo.save).toHaveBeenCalled();
    // ★ Kill line for THIS path's `clearForFreshWorkspace`. Three mechanically
    // identical one-liners is not a reason to pin only one of them — that is how
    // two of the three end up deletable on a green board.
    expect(result.current.loadWasTruncated).toBe(false);
  });

  it("switchToTursoProject SKIPS its flush, and the clean target load lowers the flag", async () => {
    // Covers the OTHER deps object: `truncationOps` reaching `useTursoProjectOps`
    // at all. Both halves ride the same object, so a missing dep fails here.
    const main = makeBackend({ entries: 7, blocks: 0 });
    createBackendMock.mockReturnValue(main);
    const { result } = renderBackend(makeArgs({
      setStorageConfig,
      settings: {
        storageConfig: { kind: "turso" },
        integrations: { turso: { databaseUrl: "https://x.turso.io", authToken: "tok" } },
      } as unknown as Settings,
    }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.loadWasTruncated).toBe(true);
    main.save.mockClear();

    await act(async () => { await result.current.switchToTursoProject("turso-p2"); });

    expect(main.save).not.toHaveBeenCalled();
    // The mocked TursoBackend publishes no truncation → a clean load → flag down.
    expect(result.current.loadWasTruncated).toBe(false);
  });

  it("a skipped flush is NOT reported as a flush FAILURE (Turso surfaces those with a toast)", async () => {
    const main = makeBackend({ entries: 7, blocks: 0 });
    createBackendMock.mockReturnValue(main);
    const { result } = renderBackend(makeArgs({
      setStorageConfig,
      settings: {
        storageConfig: { kind: "turso" },
        integrations: { turso: { databaseUrl: "https://x.turso.io", authToken: "tok" } },
      } as unknown as Settings,
    }));
    await act(async () => { await Promise.resolve(); });
    showToast.mockClear();

    await act(async () => { await result.current.switchToTursoProject("turso-p3"); });

    // ★★★ ASSERT THE REAL STRING. This read `stringContaining("could not be
    // saved")` and could not fail: no string in `i18n.ts` contains that phrase
    // (`storageSwitchFlushFailed` is "Recent changes may not have been saved
    // before switching projects", and `storageSaveFailedBanner` uses the
    // contraction "couldn't"). It sat exactly where a reader assumes coverage.
    // The skip is deliberate, not an error: the source still holds the documents.
    expect(showToast).not.toHaveBeenCalledWith("error", expect.stringContaining("may not have been saved"));
    // ★ POSITIVE CONTROL — without it "no error toast" is equally satisfied by a
    // switch that never ran at all.
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  // ── EXPLICIT user writes: REFUSE LOUDLY, never skip silently ───────────────

  it("onPickStorageFile REFUSES the write, says why, and does NOT report success", async () => {
    // ★★ The asymmetry with the flushes above is deliberate. A pre-switch flush
    // is housekeeping nobody asked for, so a silent skip costs the user nothing
    // they can see. THIS is a click: silence would leave them believing the file
    // they just picked holds their project.
    const b = makeBackend({ entries: 8, blocks: 0 });
    createBackendMock.mockReturnValue(b);
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(true));

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    b.save.mockClear();
    showToast.mockClear();

    await act(async () => { await result.current.onPickStorageFile(); });

    expect(b.save).not.toHaveBeenCalled();
    // Loud: the refusal restates the counts…
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("8 document entries could not be opened"));
    // …and NOTHING claims the store was switched.
    expect(showToast).not.toHaveBeenCalledWith("info", expect.any(String));
    // ★★★ THE KILL LINE FOR THE PRE-CHECK, and without it this test cannot tell
    // the fix from the bug. `pickFileForBackend` runs on the ACTIVE backend and
    // its side effects are irreversible — it creates the file on disk and
    // persists the new handle — so refusing only at the write left the app
    // pointed at a new EMPTY file with the original unreferenced. Delete the
    // `refuseWrite` pre-check and the `guardedWrite` backstop still refuses,
    // through the SAME implementation, so every assertion above stays green and
    // the toast is byte-identical. Only this one changes.
    expect(storageMod.pickFileForBackend).not.toHaveBeenCalled();
  });

  it("onRequestStorageSwitch REFUSES, and critically does NOT repoint the app at the short copy", async () => {
    // The conversion writes to a DIFFERENT backend, so the source survives —
    // but `setStorageConfig` would then make the truncated copy the live store
    // and orphan the intact original. The early return is the load-bearing part.
    const main = makeBackend({ entries: 8, blocks: 0 });
    const target = makeBackend();
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(target);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { result } = renderBackend(makeArgs({ setStorageConfig }));
      await act(async () => { await Promise.resolve(); });
      setStorageConfig.mockClear();
      showToast.mockClear();

      await act(async () => { await result.current.onRequestStorageSwitch("local-json"); });

      expect(target.save).not.toHaveBeenCalled();
      expect(setStorageConfig).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("8 document entries could not be opened"));
      expect(showToast).not.toHaveBeenCalledWith("info", expect.any(String));
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("both explicit writes go through once the user has resolved it", async () => {
    // Control for the two refusals: they must be a pause, not a dead end.
    const b = makeBackend({ entries: 8, blocks: 0 });
    createBackendMock.mockReturnValue(b);
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(true));

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    b.save.mockClear();
    await act(async () => { result.current.allowTruncatedSave(); });

    await act(async () => { await result.current.onPickStorageFile(); });

    expect(b.save).toHaveBeenCalled();
  });

  it("after allowTruncatedSave() the flush is no longer skipped", async () => {
    // The mirror of every skip above: a guard that never re-opens is a lockout.
    const main = makeBackend({ entries: 7, blocks: 0 });
    const target = makeBackend();
    createBackendMock.mockReturnValueOnce(main).mockReturnValue(target);
    registerTarget("t-3");

    const { result } = renderBackend(makeArgs({ setStorageConfig }));
    await act(async () => { await Promise.resolve(); });
    main.save.mockClear();
    await act(async () => { result.current.allowTruncatedSave(); });

    await act(async () => { await result.current.switchToProject("t-3"); });

    expect(main.save).toHaveBeenCalled();
  });
});

// ★★★ THE SEAM, NOT THE UNITS. `useSnapshots` has its own test proving it honours
// a `workspaceReady` prop it is handed directly — but that test would keep
// passing if this hook never published the flag, or published it too early.
// Snapshot capture is permanently destructive when it fires against an unloaded
// workspace (it claims the bucket with null KPIs and no retry ever follows), so
// the wiring is the part that has to be pinned.
describe("useStorageBackend — workspaceLoaded (snapshot-capture gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  // ★ The assertion is AFTER a flushed tick on purpose. Asserting synchronously
  // would pass with any mock at all — it would only be restating the `useState`
  // literal, and would not catch a setter moved to the top of the load effect.
  // With the load pinned in flight, this pins the property that matters: the
  // flag stays false for as long as the workspace has not landed.
  it("stays false while a load is still in flight", async () => {
    mockBackend.load.mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.workspaceLoaded).toBe(false);
  });

  it("flips true once a load has been applied to workspace state", async () => {
    mockBackend.load.mockResolvedValue({
      ...storageMod.emptyWorkspace(),
      tasks: [{ id: 1, taskName: "Real" }],
    });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.workspaceLoaded).toBe(true);
    // Control: it is true BECAUSE data landed, not merely because time passed.
    expect(result.current.tasks).toHaveLength(1);
  });

  it("stays false when the load fails — a failed load must not license a capture", async () => {
    mockBackend.load.mockRejectedValue(new Error("turso down"));
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.workspaceLoaded).toBe(false);
  });

  it("back-fills task resource FKs through the load funnel", async () => {
    // The v9 FK migration lives in jsonToWorkspace, which the CSV/Markdown/Turso
    // backends never reach — so the funnel is the only place this can happen for
    // them. Proving the pure helper works is not proving it is CALLED.
    mockBackend.load.mockResolvedValue({
      ...storageMod.emptyWorkspace(),
      resources: [{ id: 42, firstName: "Dennis", lastName: "Kurschner", email: "" }],
      tasks: [{ id: 1, taskName: "T", assignee: "dennis kurschner", assigneeEmail: "" }],
    });
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    expect((result.current.tasks[0] as { resourceId?: number }).resourceId).toBe(42);
  });
});

describe("useStorageBackend — StrictMode mount re-set (§72)", () => {
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

  it("still emits a save outcome after StrictMode's remount", async () => {
    // StrictMode mounts → unmounts → remounts. Without `mountedRef.current =
    // true` in the mount effect BODY, the flag is false for the rest of the
    // session and emitOutcome / emitToast / emitRegistryChange /
    // emitStorageConfig all return early — §72's dev-only total-suppression
    // failure mode.
    //
    // Delete `mountedRef.current = true` from use-storage-backend.ts and this
    // fails: onStorageOutcome is never called. Verified by running that
    // mutation.
    //
    // ★★★ The `reactStrictMode: true` OPTION is load-bearing here — do not
    //     "simplify" it to `wrapper: ({children}) => <StrictMode>…`. RTL's
    //     option renders `<StrictMode><Wrapper>…</Wrapper></StrictMode>`,
    //     leaving nothing between the root and StrictMode; composing
    //     StrictMode inside the wrapper instead puts a fiber above it on the
    //     same branch and, on a mount commit, silences the double invoke
    //     entirely. Measured 2026-08-05: that shape stayed green with the
    //     pinned line deleted — i.e. the guard becomes VACUOUS and looks
    //     identical. The full rule, the React-internals reason and every
    //     measured edge live in ONE place: `src/app/strictmode.meta.test.tsx`.
    //     That shape is also the likely source of the 2026-08-04 "StrictMode
    //     single-invokes here" observation — which reproduces; it is its
    //     CONCLUSION ("therefore untestable") that this test refutes.
    const onStorageOutcome = vi.fn();
    const { result } = renderHook(makeProbe(makeArgs({ onStorageOutcome })), {
      wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
      reactStrictMode: true,
    });

    // Let the load settle, then burn the first debounce cycle (the load sets
    // suppressNextSaveRef, which that cycle clears).
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    onStorageOutcome.mockClear();

    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    // `null` (not merely "called") is what says the save SUCCEEDED — an error
    // outcome reaches the same callback.
    expect(onStorageOutcome).toHaveBeenCalledWith(null);
  });
});
