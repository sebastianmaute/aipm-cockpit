// Regression pins for open-followups §548's SIGNAL. `loadPending` drives the render hold in
// task-manager: while it is true the main window shows PanelSkeleton instead of the app, so no edit
// can start inside the window a landing load would overwrite.
// ★★★ It is deliberately NOT `workspaceLoaded`. That gate stays shut after a FAILED load and after
//   the empty-load REFUSAL (§77), which is right for snapshot capture and saving and wrong here: a hold
//   keyed on it would lock the app for the session after one load error. So EVERY terminal branch of
//   the load effect settles this one, and (b) and (c) pin exactly that difference.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageConfig } from "./storage";
import type { Task } from "./types";

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
  loadFromHandleForBackend: vi.fn(),
  pickFileForBackend: vi.fn(() => null),
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

import * as storageMod from "./storage";
import * as handles from "./project-file-handles";
import { addProject, emptyRegistry, saveRegistry } from "./projects-registry";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;

const STORED = { tasks: [{ id: 1, taskName: "Stored" } as unknown as Task], raid: [], absences: [], shifts: [] };
const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };

type FakeBackend = {
  kind: string;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  isReady: ReturnType<typeof vi.fn>;
  describe: ReturnType<typeof vi.fn>;
};

/** A backend whose load settles after `ms` on the (fake) clock. */
function makeBackend(ms: number, outcome: "resolve" | "reject" = "resolve", stored: object = STORED): FakeBackend {
  return {
    kind: "browser",
    load: vi.fn(() => new Promise((resolve, reject) => {
      setTimeout(() => (outcome === "resolve" ? resolve(stored) : reject(new Error("load boom"))), ms);
    })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

// Module-level so a test can assert on them (Task 4 adds the SharePoint-timeout test here and reads both).
const showToast = vi.fn();
const onStorageOutcome = vi.fn();

type Args = Parameters<typeof useStorageBackend>[0];
function makeArgs(storageConfig: StorageConfig = { kind: "browser" }, hydrated = true): Args {
  return {
    settings: { storageConfig } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated,
    isPopout: false,
    showToast,
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
    onStorageOutcome,
  };
}

function useProbe(args: Args) {
  const hook = useStorageBackend(args);
  const { tasks } = useWorkspace();
  return { ...hook, tasks };
}

function render(args = makeArgs()) {
  return renderHook((props: { args: Args }) => useProbe(props.args), {
    initialProps: { args },
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
}

/** Advance the fake clock in small steps, each in its own `act` (see the load-gate file for why). */
async function advance(ms: number) {
  const STEP = 25;
  for (let done = 0; done < ms; done += STEP) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - done)); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("§548 — loadPending", () => {
  it("(a) is true while the first load is in flight and false once it is applied", async () => {
    const backend = makeBackend(1000);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(100);
    expect(backend.load).toHaveBeenCalledTimes(1); // control: the load really started
    expect(result.current.loadPending).toBe(true);

    await advance(1000);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]); // control: it dropped BECAUSE data landed
    expect(result.current.loadPending).toBe(false);
  });

  it("(b) a FAILED load releases it, unlike workspaceLoaded, which stays false", async () => {
    const backend = makeBackend(100, "reject");
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(300);
    expect(result.current.loadPause).toBe("load-failed"); // control: the catch ran
    expect(result.current.workspaceLoaded).toBe(false);
    expect(result.current.loadPending).toBe(false);
  });

  it("(c) a REBUILT backend raises it again, and an EMPTY-load refusal releases it", async () => {
    const a = makeBackend(100);
    const b = makeBackend(500, "resolve", EMPTY);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render();
    await advance(300);
    expect(result.current.loadPending).toBe(false);

    rerender({ args: makeArgs({ kind: "browser" }) }); // new config identity → new backend instance
    await advance(100);
    expect(b.load).toHaveBeenCalledTimes(1);
    expect(result.current.loadPending).toBe(true); // a rebuilt backend starts unsettled

    await advance(600);
    expect(result.current.loadPause).toBe("empty-refused"); // control: the refusal branch ran
    expect(result.current.workspaceLoaded).toBe(false);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(result.current.loadPending).toBe(false);
  });

  it("(d) is true while switchToProject awaits, and the suppressed load re-stamps it for the memo's new instance", async () => {
    saveRegistry(addProject(emptyRegistry(), { id: "target", name: "Target", code: "T", storageConfig: { kind: "local-json" } }, false));
    (handles.getHandle as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "t.json" });
    const current = makeBackend(0);
    const built = makeBackend(500); // backendFor(target) — the instance the switch loads
    const memo = makeBackend(0); // the memo's own instance once storageConfig flips
    createBackendMock.mockReturnValueOnce(current).mockReturnValueOnce(built).mockReturnValue(memo);
    let rerenderWith: (cfg: StorageConfig) => void = () => {};
    const setStorageConfig = vi.fn((cfg: StorageConfig) => rerenderWith(cfg));
    const { result, rerender } = render({ ...makeArgs(), setStorageConfig });
    rerenderWith = (cfg) => rerender({ args: { ...makeArgs(cfg), setStorageConfig } });
    await advance(100);
    expect(result.current.loadPending).toBe(false);

    let op: Promise<void> = Promise.resolve();
    act(() => { op = result.current.switchToProject("target"); });
    await advance(100);
    expect(result.current.loadPending).toBe(true); // the op is awaiting the target's load

    await advance(600);
    await act(async () => { await op; });
    await advance(100);
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-json" });
    expect(memo.load).not.toHaveBeenCalled(); // control: the SUPPRESS branch ran, not a load
    expect(result.current.loadPending).toBe(false);
  });

  // The nine held ops (in flight / resolved / threw) are pinned in use-storage-backend.hold-ops.test.tsx.

  it("(f) is TRUE before hydration (no load has even started), and settles once hydration runs the load", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result, rerender } = render(makeArgs({ kind: "browser" }, false));
    await advance(300);
    expect(backend.load).not.toHaveBeenCalled(); // control: the load effect really waits for hydration
    expect(result.current.loadPending).toBe(true);

    rerender({ args: makeArgs({ kind: "browser" }, true) });
    await advance(300);
    expect(backend.load).toHaveBeenCalledTimes(1);
    expect(result.current.loadPending).toBe(false);
  });

  // ★ (f) alone cannot pin the `!args.hydrated` term: before hydration `settledBackend` is still null,
  //   so the identity term already reads true. This drives the one path that settles the backend WITHOUT
  //   the load effect — an op applying a workspace — and shows hydration still holds.
  it("(f2) stays TRUE before hydration even after an op has applied a workspace for this backend", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render(makeArgs({ kind: "browser" }, false));
    await advance(100);

    let op: Promise<void> = Promise.resolve();
    act(() => { op = result.current.reloadCurrentProject(); });
    await advance(300);
    await act(async () => { await op; });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]); // control: applyWorkspace ran and settled this backend
    expect(result.current.loadPending).toBe(true);
  });
});
