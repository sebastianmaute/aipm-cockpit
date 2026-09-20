// §548 — every op that awaits and then REPLACES the workspace holds `loadPending` for its WHOLE duration
// (`holdDuring`). ONE table, all nine ops, two tests per op: "in flight → resolved" and "in flight →
// threw". Each row parks the op on its FIRST awaited step behind a gate the test controls, and
// `touched()` proves the op really is parked there before `loadPending` is read, so a row cannot pass
// because its op finished early.
// ★ The Turso mocks copy use-storage-backend.test.tsx's convention: `./turso-portfolio` replaced
//   wholesale; `./turso-pipeline` spread from the actual module with only `testTursoConnection` stubbed
//   (the §408 connection probe); a `TursoBackend` class whose `load` reads a hoisted seam.
// ★★ "Threw": eight of the nine ops CATCH their own errors and report them through `showToast`; only
//   `onOpenStorageFile` rethrows by itself (its picker `await` sits outside its `try`). So the throw test
//   rejects the gate AND makes `showToast` throw, which turns every row's error path into a genuine
//   rejection of the op, and asserts that (plan ruling 12).
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { Task } from "./types";

const seam = vi.hoisted(() => ({ tursoLoad: null as null | (() => Promise<unknown>) }));

vi.mock("./storage", () => ({
  createBackend: vi.fn(),
  StorageNotReadyError: class StorageNotReadyError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  StorageNotImplementedError: class StorageNotImplementedError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  openFileForBackend: vi.fn(() => null),
  loadFromHandleForBackend: vi.fn(() => null),
  pickFileForBackend: vi.fn(() => null),
  pickFileHandleForBackend: vi.fn(() => null),
  pickOpenFileAny: vi.fn(),
  formatFromFileName: vi.fn(() => "json"),
  requestWriteAccessForBackend: vi.fn(() => null),
  setBackendFileHandle: vi.fn(() => null),
  getBackendFileHandle: vi.fn(() => null),
}));
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));
vi.mock("./turso-portfolio", () => ({
  createProject: vi.fn(async () => undefined),
  archiveProject: vi.fn(async () => undefined),
  restoreProject: vi.fn(async () => undefined),
  hardDeleteProject: vi.fn(async () => undefined),
}));
vi.mock("./turso-pipeline", async (importActual) => ({
  ...(await importActual<typeof import("./turso-pipeline")>()),
  testTursoConnection: vi.fn(async () => {}),
}));
vi.mock("./turso-backend", () => ({
  TursoBackend: class {
    kind = "turso" as const;
    lastImportDroppedRows: number | undefined = undefined;
    lastImportUnterminatedQuote: boolean | undefined = undefined;
    constructor(public config: unknown, public projectId: string) {}
    load = vi.fn(() => (seam.tursoLoad ? seam.tursoLoad() : Promise.resolve({ tasks: [], raid: [], absences: [], shifts: [] })));
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

import * as storageMod from "./storage";
import * as tursoPortfolio from "./turso-portfolio";
import { testTursoConnection } from "./turso-pipeline";
import { addProject, emptyRegistry, saveRegistry } from "./projects-registry";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;

// `project` is set so `migrateCurrentProjectToTurso` has a project to migrate.
const STORED = {
  project: { name: "Current", code: "CUR" },
  tasks: [{ id: 1, taskName: "Stored" } as unknown as Task], raid: [], absences: [], shifts: [],
};
const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };

type FakeBackend = {
  kind: string;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  isReady: ReturnType<typeof vi.fn>;
  describe: ReturnType<typeof vi.fn>;
};
function makeBackend(): FakeBackend {
  return {
    kind: "browser",
    load: vi.fn(async () => STORED),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

const showToast = vi.fn();
type Args = Parameters<typeof useStorageBackend>[0];
function makeArgs(): Args {
  return {
    settings: {
      storageConfig: { kind: "browser" },
      integrations: { turso: { enabled: true, databaseUrl: "https://x.turso.io", authToken: "tok" } },
    } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast,
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
  };
}

/** A gate the op's first awaited step waits on. `touched()` = the op has reached it. */
type Gate = { wait: () => Promise<unknown>; touched: () => boolean; resolve: (v: unknown) => void; reject: (e: unknown) => void };
function makeGate(): Gate {
  let resolve: (v: unknown) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  let hit = false;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { wait: () => { hit = true; return promise; }, touched: () => hit, resolve, reject };
}

type Hook = ReturnType<typeof useStorageBackend>;
type Backends = { current: FakeBackend; target: FakeBackend };
type Row = { op: string; arm: (g: Gate, b: Backends) => void; value: unknown; call: (h: Hook) => Promise<void> };

// One row per op wrapped by `holdDuring`. `arm` parks the op on its FIRST awaited step; `value` is what
// that step resolves with in the "resolved" test.
const ROWS: Row[] = [
  { op: "reloadCurrentProject", arm: (g, b) => { b.current.load.mockImplementationOnce(g.wait); }, value: STORED,
    call: (h) => h.reloadCurrentProject() },
  { op: "switchToProject", arm: (g, b) => { b.target.load.mockImplementationOnce(g.wait); }, value: STORED,
    call: (h) => h.switchToProject("target") },
  { op: "createProject", arm: (g) => { vi.mocked(storageMod.pickFileForBackend).mockImplementationOnce(g.wait as never); }, value: undefined,
    call: (h) => h.createProject({ name: "New", code: "NEW" } as never, "json") },
  { op: "loadProjectFromFile", arm: (g) => { vi.mocked(storageMod.pickOpenFileAny).mockImplementationOnce(g.wait as never); }, value: { name: "picked.json" },
    call: (h) => h.loadProjectFromFile() },
  { op: "createDemoProject", arm: (g, b) => { b.target.save.mockImplementationOnce(g.wait); }, value: undefined,
    call: (h) => h.createDemoProject(STORED as never) },
  { op: "onOpenStorageFile", arm: (g) => { vi.mocked(storageMod.openFileForBackend).mockImplementationOnce(g.wait as never); }, value: { name: "picked.json" },
    call: (h) => h.onOpenStorageFile() },
  { op: "switchToTursoProject", arm: (g) => { seam.tursoLoad = g.wait; }, value: EMPTY,
    call: (h) => h.switchToTursoProject("turso-p2") },
  { op: "createTursoProject", arm: (g) => { vi.mocked(tursoPortfolio.createProject).mockImplementationOnce(g.wait as never); }, value: undefined,
    call: (h) => h.createTursoProject({ name: "T", code: "T" } as never) },
  { op: "migrateCurrentProjectToTurso", arm: (g) => { vi.mocked(testTursoConnection).mockImplementationOnce(g.wait as never); }, value: undefined,
    call: (h) => h.migrateCurrentProjectToTurso() },
];

const originalLocation = window.location;
beforeEach(() => {
  vi.clearAllMocks();
  showToast.mockReset(); // ★ reset, not clear: the throw test installs an IMPLEMENTATION
  seam.tursoLoad = null;
  localStorage.clear();
  saveRegistry(addProject(emptyRegistry(), { id: "target", name: "Target", code: "T", storageConfig: { kind: "browser" } }, false));
  // `migrateCurrentProjectToTurso` ends in `window.location.reload()`; jsdom's is a no-op that warns.
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload: vi.fn() } });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

async function startHeld(row: Row) {
  const b: Backends = { current: makeBackend(), target: makeBackend() };
  createBackendMock.mockReturnValueOnce(b.current).mockReturnValue(b.target);
  // ★ ONE args object for the whole render: a fresh `makeArgs()` per render hands the backend memo a new
  //   `storageConfig` identity each time, so `b.current` is replaced by `b.target` after the first
  //   re-render and the reload row's gate (armed on `b.current`) is never reached.
  const args = makeArgs();
  const hook = renderHook(() => useStorageBackend(args), {
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
  await waitFor(() => expect(hook.result.current.loadPending).toBe(false)); // the first load has settled
  const g = makeGate();
  row.arm(g, b);
  let op: Promise<void> = Promise.resolve();
  act(() => { op = row.call(hook.result.current); });
  const settled = op.then(() => "fulfilled" as const, () => "rejected" as const);
  await waitFor(() => expect(g.touched()).toBe(true)); // control: the op is parked on its first await
  return { result: hook.result, g, settled, b };
}

describe.each(ROWS)("§548 — $op holds loadPending for its whole duration", (row) => {
  it("is true while the op is in flight, and false after it RESOLVES", async () => {
    const { result, g, settled } = await startHeld(row);
    expect(result.current.loadPending).toBe(true);
    let outcome = "";
    await act(async () => { g.resolve(row.value); outcome = await settled; });
    expect(outcome).toBe("fulfilled");
    await waitFor(() => expect(result.current.loadPending).toBe(false));
  });

  it("is false after the op THROWS", async () => {
    const { result, g, settled } = await startHeld(row);
    expect(result.current.loadPending).toBe(true);
    showToast.mockImplementation(() => { throw new Error("toast boom"); });
    let outcome = "";
    await act(async () => { g.reject(new Error("seam boom")); outcome = await settled; });
    expect(outcome).toBe("rejected"); // control: the op really threw
    await waitFor(() => expect(result.current.loadPending).toBe(false));
  });
});

// Fix batch F1 item 5 — the storageConfig-flip hand-off (`swapsInFlight` → `settledBackend`) is pinned
// for `switchToProject` in use-storage-backend.load-pending.test.tsx (d): after the op applies and
// re-points the config identity, the load effect on the REBUILT memo instance must take the SUPPRESS
// branch (the op already put the right workspace in scope), never a real second load. Same pin here for
// the two Turso ops, which re-point `tursoProjectId` instead of `storageConfig` but rebuild the SAME
// (browser-kind) memo either way, via the ROWS table's own gate/backends.
describe.each(ROWS.filter((r) => r.op === "switchToTursoProject" || r.op === "createTursoProject"))(
  "§548 — $op: the suppressed load re-stamps it for the memo's new instance",
  (row) => {
    it("never calls the rebuilt memo's own load — the op's re-stamp suppresses it", async () => {
      const { result, g, settled, b } = await startHeld(row);
      await act(async () => { g.resolve(row.value); await settled; });
      await waitFor(() => expect(b.target.isReady).toHaveBeenCalled()); // control: the suppress branch ran
      expect(b.target.load).not.toHaveBeenCalled(); // the op's own re-stamp, not a real second load
      await waitFor(() => expect(result.current.loadPending).toBe(false));
    });
  },
);
