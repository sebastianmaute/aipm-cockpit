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
import { t } from "./i18n";
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

import * as storageMod from "./storage";
import * as handles from "./project-file-handles";
import { addProject, emptyRegistry, saveRegistry } from "./projects-registry";
import { TestProviders } from "./test-providers";
import { isScopeStale } from "./scope-epoch";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";
import { SharePointBackend } from "./sharepoint-backend";

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

  it("(e) isSwapInFlight is true SYNCHRONOUSLY with the call, before any render or effect", async () => {
    // ★★★ §596 — THE POINT OF THIS TEST IS THE WORD *SYNCHRONOUSLY*, and it is
    //  the only reason `isSwapInFlight` exists beside `loadPending` at all. Its
    //  consumer is `chat-panel.tsx`'s UNMOUNT CLEANUP, and the §548 teardown
    //  happens in the very commit this call triggers: React flushes every passive
    //  DESTROY before any passive CREATE, so a ref that an effect copies
    //  `loadPending` into has NOT been written when the dying subtree asks. It
    //  would read the pre-swap `false` and the turn would not be cancelled.
    //  `holdDuring` therefore moves a ref in the same statement pair as the
    //  setter, exactly as `bumpScopeEpoch` does. Delete that `+= 1` and the
    //  in-act read below goes false.
    // ★★ THE REF MOVES FOR `"changes-scope"` OPS ONLY, which is why this test uses
    //  `switchToProject` and (e2) beside it uses a same-scope op. Read the pair:
    //  alone, this one passes against arming every held op — the B1 regression.
    saveRegistry(addProject(emptyRegistry(), { id: "target", name: "Target", code: "T", storageConfig: { kind: "local-json" } }, false));
    (handles.getHandle as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "t.json" });
    const current = makeBackend(0);
    const built = makeBackend(500);
    const memo = makeBackend(0);
    createBackendMock.mockReturnValueOnce(current).mockReturnValueOnce(built).mockReturnValue(memo);
    let rerenderWith: (cfg: StorageConfig) => void = () => {};
    const setStorageConfig = vi.fn((cfg: StorageConfig) => rerenderWith(cfg));
    const { result, rerender } = render({ ...makeArgs(), setStorageConfig });
    rerenderWith = (cfg) => rerender({ args: { ...makeArgs(cfg), setStorageConfig } });
    await advance(100);
    // Two-way pin: false BEFORE, or "true during" is true for some other reason.
    expect(result.current.isSwapInFlight()).toBe(false);

    let duringInvoke = false;
    let op: Promise<void> = Promise.resolve();
    act(() => {
      op = result.current.switchToProject("target");
      // Read INSIDE act and immediately after the call: no re-render has been
      // committed and no effect has run. This is the instant the chat panel's
      // cleanup asks the question.
      duringInvoke = result.current.isSwapInFlight();
    });
    expect(duringInvoke).toBe(true);
    expect(result.current.loadPending).toBe(true); // control: the hold really is up

    await advance(600);
    await act(async () => { await op; });
    await advance(100);
    // Released in the op's `finally`, so a thrown op cannot strand it true.
    expect(result.current.isSwapInFlight()).toBe(false);
  });

  it("(e2) a SAME-SCOPE hold raises loadPending but does NOT arm isSwapInFlight", async () => {
    // ★★★ THE OTHER HALF OF (e), AND A COMPOSITION REGRESSION THIS PAIR EXISTS TO STOP
    //  COMING BACK. §590 put `onPickStorageFile` under the hold; §596 made an
    //  unmount-under-hold cancel the in-flight AI turn. Each is correct alone —
    //  composed, a plain Save-As, a cancelled OS file dialog and this same-project
    //  reload each silently killed the turn the user had just asked for, and the
    //  "stopped" note lands on an unmounted panel so they are not even told.
    // ★★ A SINGLE-SIDED VERSION OF THIS PAIR IS HOW BOTH PREVIOUS INSTANCES SHIPPED:
    //  (e) alone passes against arming EVERY op, and this one alone passes against
    //  arming NONE. Neither is the claim; the pair is.
    // OBSERVABLE: `isSwapInFlight()` read inside `act`, exactly where the chat
    //  panel's cleanup reads it. `loadPending` beside it is the control that the
    //  hold really is up — without it, "false" could just mean nothing happened.
    const backend = makeBackend(300);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(400);
    expect(result.current.isSwapInFlight()).toBe(false);

    let duringInvoke = true;
    let op: Promise<void> = Promise.resolve();
    act(() => {
      op = result.current.reloadCurrentProject();
      duringInvoke = result.current.isSwapInFlight();
    });
    expect(result.current.loadPending).toBe(true); // control: the hold IS up…
    expect(duringInvoke).toBe(false); // …and the turn is still not cancelled.

    await advance(400);
    await act(async () => { await op; });
    await advance(100);
    expect(backend.load).toHaveBeenCalledTimes(2); // control: the reload really re-loaded
    expect(result.current.isSwapInFlight()).toBe(false);
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

  // §548 + ruling 10 — the hold must lift when a SharePoint load hangs: the Graph read times out at
  // LOAD_TIMEOUT_MS, the load effect's catch settles it, saving pauses and the failure is reported (the
  // outcome that raises the storage banner, and the storageLoadFailed toast).
  it("(g) a SharePoint load that never answers settles at 10 s: loadPending drops and the failure is reported", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    })));
    const sp = new SharePointBackend(
      { kind: "sp-json", hostname: "contoso.sharepoint.com", sitePath: "/sites/pm", itemPath: "/a.json" },
      async () => "token",
    );
    createBackendMock.mockReturnValue(sp);
    const { result } = render(makeArgs({ kind: "sp-json", hostname: "contoso.sharepoint.com", sitePath: "/sites/pm", itemPath: "/a.json" }));
    await advance(9_900);
    expect(result.current.loadPending).toBe(true); // control: still waiting on Graph

    await advance(200);
    expect(result.current.loadPending).toBe(false);
    expect(result.current.loadPause).toBe("load-failed");
    expect(onStorageOutcome).toHaveBeenCalledWith(expect.objectContaining({ message: "SharePoint did not respond within 10 s. Try again later." }));
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "storageLoadFailed", "Error: SharePoint did not respond within 10 s. Try again later."));
  });
});

// §548 (F7) — the SCOPE EPOCH, the companion signal `loadPending` cannot supply: a Graph/AI call that
// started before a swap and resolves AFTER it finished sees `loadPending === false` again, so only a
// changed epoch tells it the workspace it would write into is no longer the one it read from.
// ★★★ THE PREDICATE IS NARROW (round 1). The first cut bumped on every false→true transition of
//   `loadPending`, which also fires when the PROJECT never changed — a same-target reload, a held op
//   the user cancelled, a same-target rebuild — and dropped in-flight results that would have landed
//   in the RIGHT project. These tests assert through `isScopeStale`, the very predicate every writer
//   calls, so they pin what a writer would actually DO, not just the number.
describe("§548 — getScopeEpoch: transitions that must NOT move it", () => {
  it("(h) the first load, a settled load and a SAME-TARGET rebuild all leave an in-flight write landing", async () => {
    const a = makeBackend(100);
    const b = makeBackend(100);
    createBackendMock.mockReturnValue(a);
    const { result, rerender } = render(makeArgs({ kind: "browser" }, false));
    const read = result.current.getScopeEpoch;
    const started = read(); // what a writer captures before its first await
    expect(started).toBe(0); // pre-hydration is pending, but nothing can have been in flight yet

    rerender({ args: makeArgs({ kind: "browser" }, true) }); // same instance → the first load, not a rebuild
    await advance(300);
    expect(a.load).toHaveBeenCalledTimes(1); // control: the first load really ran
    expect(result.current.loadPending).toBe(false);
    expect(isScopeStale(read, started)).toBe(false);

    createBackendMock.mockReturnValue(b);
    rerender({ args: makeArgs({ kind: "browser" }, true) }); // new config identity → REBUILT backend…
    await advance(50);
    expect(result.current.loadPending).toBe(true); // control: the rebuild really raised the hold…
    await advance(300);
    expect(b.load).toHaveBeenCalledTimes(1); // …and really re-loaded
    expect(result.current.loadPending).toBe(false);
    // …but onto the SAME target, so §591 merged rather than replaced: the project never changed.
    expect(isScopeStale(read, started)).toBe(false);
  });

  it("(h2) a SAME-TARGET reloadCurrentProject leaves an in-flight write landing", async () => {
    const backend = makeBackend(300);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(400);
    const read = result.current.getScopeEpoch;
    const started = read();
    expect(result.current.loadPending).toBe(false);

    let op: Promise<void> = Promise.resolve();
    act(() => { op = result.current.reloadCurrentProject(); });
    await advance(100);
    expect(result.current.loadPending).toBe(true); // control: holdDuring really raised the hold
    await advance(400);
    await act(async () => { await op; });
    await advance(100);
    expect(backend.load).toHaveBeenCalledTimes(2); // control: the reload really re-loaded
    expect(result.current.loadPending).toBe(false);
    expect(isScopeStale(read, started)).toBe(false);
    // Stable identity: a consumer mirrors this into a `[]`-dep ref and must not re-subscribe.
    expect(result.current.getScopeEpoch).toBe(read);
  });

  it("(h3) a held op the user CANCELLED at the OS file picker leaves an in-flight write landing", async () => {
    const backend = makeBackend(0);
    createBackendMock.mockReturnValue(backend);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null); // the picker was dismissed
    const { result } = render();
    await advance(100);
    const read = result.current.getScopeEpoch;
    const started = read();

    let op: Promise<void> = Promise.resolve();
    act(() => { op = result.current.onOpenStorageFile(); });
    await advance(50);
    await act(async () => { await op; });
    await advance(50);
    expect(storageMod.openFileForBackend).toHaveBeenCalled(); // control: the op really ran
    expect(result.current.loadPending).toBe(false); // …and the hold it raised is released
    expect(isScopeStale(read, started)).toBe(false); // nothing was applied, so nothing may be dropped
  });
});

describe("§548 — getScopeEpoch: transitions that MUST move it", () => {
  it("(i) a load that REPLACES (a different storage target) makes an in-flight write stale", async () => {
    const a = makeBackend(100);
    const b = makeBackend(100);
    createBackendMock.mockReturnValue(a);
    const { result, rerender } = render(makeArgs({ kind: "browser" }, true));
    await advance(300);
    const read = result.current.getScopeEpoch;
    const started = read();
    expect(result.current.loadPending).toBe(false);
    expect(isScopeStale(read, started)).toBe(false);

    createBackendMock.mockReturnValue(b);
    rerender({ args: makeArgs({ kind: "local-json" }, true) }); // a DIFFERENT storageTargetKey
    await advance(300);
    expect(b.load).toHaveBeenCalledTimes(1); // control: the new target really loaded
    expect(result.current.loadPending).toBe(false);
    expect(isScopeStale(read, started)).toBe(true);
  });

  it("(i2) a held op that applies ANOTHER project's workspace makes an in-flight write stale", async () => {
    saveRegistry(addProject(emptyRegistry(), { id: "target", name: "Target", code: "T", storageConfig: { kind: "local-json" } }, false));
    (handles.getHandle as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "t.json" });
    const current = makeBackend(0);
    const built = makeBackend(200); // backendFor(target) — the instance the switch loads
    const memo = makeBackend(0);
    createBackendMock.mockReturnValueOnce(current).mockReturnValueOnce(built).mockReturnValue(memo);
    let rerenderWith: (cfg: StorageConfig) => void = () => {};
    const setStorageConfig = vi.fn((cfg: StorageConfig) => rerenderWith(cfg));
    const { result, rerender } = render({ ...makeArgs(), setStorageConfig });
    rerenderWith = (cfg) => rerender({ args: { ...makeArgs(cfg), setStorageConfig } });
    await advance(100);
    const read = result.current.getScopeEpoch;
    const started = read();
    expect(isScopeStale(read, started)).toBe(false);

    let op: Promise<void> = Promise.resolve();
    act(() => { op = result.current.switchToProject("target"); });
    await advance(400);
    await act(async () => { await op; });
    await advance(100);
    expect(built.load).toHaveBeenCalledTimes(1); // control: the target really loaded
    // ★ `storageTargetKey` keys every local-* kind on the KIND alone (§591 ruling 3), so the load
    //   effect's replace rule cannot see this switch — only clause (b), `applyWorkspaceForOp`, can.
    expect(isScopeStale(read, started)).toBe(true);
  });

  // The picker path replaces tasks+raid through RAW setters, never `applyWorkspace`, so neither clause
  // (a) (the local-* target key does not move — §591 ruling 3) nor `applyWorkspaceForOp` can see it.
  it("(i3) onOpenStorageFile's ACCEPT branch makes an in-flight write stale", async () => {
    const backend = makeBackend(0);
    createBackendMock.mockReturnValue(backend);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve({ name: "other.json" }));
    (storageMod.loadFromHandleForBackend as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve({ tasks: [{ id: 9, taskName: "From the other file" } as unknown as Task], raid: [] }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { result } = render();
      await advance(100);
      const read = result.current.getScopeEpoch;
      const started = read();
      expect(isScopeStale(read, started)).toBe(false);

      let op: Promise<void> = Promise.resolve();
      act(() => { op = result.current.onOpenStorageFile(); });
      await advance(100);
      await act(async () => { await op; });
      await advance(50);
      expect(result.current.tasks.map((x) => x.id)).toEqual([9]); // control: the other file really landed
      expect(isScopeStale(read, started)).toBe(true);
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
