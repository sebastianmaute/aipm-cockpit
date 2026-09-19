// Regression pins for open-followups §586: the save effect scheduled a debounced
// save of the still-EMPTY boot workspace before the first load had landed, and
// flush-on-hide fired it at once. On Turso that is `DELETE FROM` every table.
//
// ★★★ The rule under test: NO `backend.save()` — debounced, flushed on hide, or
// the pre-switch flush — until a load for THAT backend instance has SUCCEEDED.
// Every test here uses a load that is still PENDING (or has FAILED) at the
// moment a save would have fired; a load that lands inside the 500 ms debounce
// cancels the timer on its own and cannot tell a gated hook from an ungated one
// (test (d) is that control).
//
// ★ Lives in its own file for the same reason as the steering pins: the main
//   `use-storage-backend.test.tsx` is ~4900 lines and its module-level
//   `mockBackend` is shared state; these need per-test backends.
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
const STORED_B = { tasks: [{ id: 9, taskName: "Target" } as unknown as Task], raid: [], absences: [], shifts: [] };
const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };
const EDIT = [{ id: 1, taskName: "Stored" }, { id: 2, taskName: "Edited" }] as unknown as Task[];

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

const showToast = vi.fn();
const showToastAction = vi.fn();
/** The save-paused announcements: an ACTION toast whose action re-shows the sticky banner. */
function pausedToasts(key: "storageSavePausedLoadFailed" | "storageSavePausedEmptyLoad") {
  return showToastAction.mock.calls.filter((c) => c[1] === t("en-US", key));
}

function makeArgs(storageConfig: StorageConfig = { kind: "browser" }): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast,
    showToastAction,
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
  };
}

function useProbe(args: Parameters<typeof useStorageBackend>[0]) {
  const hook = useStorageBackend(args);
  const { tasks, setTasks } = useWorkspace();
  return { ...hook, tasks, setTasks };
}

function render(args = makeArgs()) {
  return renderHook((props: { args: Parameters<typeof useStorageBackend>[0] }) => useProbe(props.args), {
    initialProps: { args },
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
}

/** Advance the fake clock in small steps, EACH IN ITS OWN `act`. ★★ One `act`
 *  around a long advance defers every React commit to the end of it, so a load
 *  landing at 100 ms would not re-run the save effect (and clear its timer)
 *  before the 500 ms debounce fired — a harness-only save that no browser makes. */
async function advance(ms: number) {
  const STEP = 25;
  for (let done = 0; done < ms; done += STEP) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - done)); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

function hideTab() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("§586 — no save before a load for the current backend has succeeded", () => {
  it("(a) a slow load: nothing is saved while it is pending, and an edit after it lands saves normally", async () => {
    const backend = makeBackend(2000);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();

    await advance(600); // past the 500 ms debounce, load still pending
    expect(backend.save).not.toHaveBeenCalled();

    await advance(1500); // load lands at 2000
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    await advance(600);
    expect(backend.save).not.toHaveBeenCalled(); // the post-load save is suppressed, as before

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(backend.save.mock.calls[0][0].tasks.map((x: Task) => x.id)).toEqual([1, 2]);
  });

  it("(b) hiding the tab while the load is pending flushes nothing", async () => {
    const backend = makeBackend(2000);
    createBackendMock.mockReturnValue(backend);
    render();

    await advance(100);
    hideTab();
    await advance(0);
    expect(backend.save).not.toHaveBeenCalled();

    await advance(2500);
    expect(backend.save).not.toHaveBeenCalled();
  });

  it("(c) a FAILED load: no save ever — after an edit, a debounce or a hide — and saving-paused is announced once", async () => {
    const backend = makeBackend(100, "reject");
    createBackendMock.mockReturnValue(backend);
    const { result } = render();

    await advance(200); // load has rejected
    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    hideTab();
    await advance(0);
    await act(async () => { result.current.setTasks([...EDIT, { id: 3, taskName: "More" } as unknown as Task]); });
    await advance(600);

    expect(backend.save).not.toHaveBeenCalled();
    const paused = pausedToasts("storageSavePausedLoadFailed");
    expect(paused).toHaveLength(1);
    expect(paused[0][0]).toBe("error");
    expect(paused[0][2]).toMatchObject({ labelKey: "storageSavingPausedAction" });
    // ★ review I1: the toast is gone after 7 s; the pause must stay PUBLISHED for the sticky banner.
    await advance(8000);
    expect(result.current.loadPause).toBe("load-failed");
    expect(backend.save).not.toHaveBeenCalled();
  });

  it("(d) control: a fast load (100 ms) behaves exactly as before", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();

    await advance(700);
    expect(backend.save).not.toHaveBeenCalled();
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(pausedToasts("storageSavePausedLoadFailed")).toHaveLength(0);
    expect(result.current.loadPause).toBeNull();
  });

  it("(e) §587 — a REBUILT backend (e.g. a Turso URL/token edit) with a slow POPULATED load: nothing saved before its load, and the old workspace never", async () => {
    // The probe's worst case: before the fix B.save got A's project at ~500 ms, then B's load was
    // applied on top — the screen showed B while storage held A.
    const a = makeBackend(100);
    const b = makeBackend(2000, "resolve", STORED_B);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render();
    await advance(700); // A loaded; nothing pending

    // A settings-driven rebuild: new storageConfig identity → new backend memo, no op, no suppress.
    rerender({ args: makeArgs({ kind: "browser" }) });
    await advance(600);
    hideTab();
    await advance(0);
    expect(b.save).not.toHaveBeenCalled();

    Reflect.deleteProperty(document, "visibilityState");
    await advance(1500); // B's load lands
    await advance(600);
    expect(result.current.tasks.map((x) => x.id)).toEqual([9]);
    await act(async () => { result.current.setTasks([...result.current.tasks, { id: 10, taskName: "New" } as unknown as Task]); });
    await advance(600);

    expect(b.save).toHaveBeenCalledTimes(1);
    expect(b.save.mock.calls[0][0].tasks.map((x: Task) => x.id)).toEqual([9, 10]);
    const everSavedOld = b.save.mock.calls.some((c) => c[0].tasks.some((x: Task) => x.id === 1));
    expect(everSavedOld).toBe(false);
    expect(a.save).not.toHaveBeenCalled();
  });

  it("(f) the pre-switch flush does not write the unloaded workspace over the current project", async () => {
    saveRegistry(addProject(emptyRegistry(), { id: "target", name: "Target", code: "T", storageConfig: { kind: "browser" } }, false));
    const current = makeBackend(100, "reject");
    const target = makeBackend(0);
    createBackendMock.mockReturnValueOnce(current).mockReturnValue(target);
    const { result } = render();
    await advance(200); // current project's load failed

    await act(async () => {
      const p = result.current.switchToProject("target");
      await vi.advanceTimersByTimeAsync(10);
      await p;
    });

    expect(current.save).not.toHaveBeenCalled();
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]); // the target DID load
  });

  it("(g) picking a storage file after a failed load arms autosave — the backend now holds what is in memory", async () => {
    const backend = makeBackend(100, "reject");
    createBackendMock.mockReturnValue(backend);
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve());
    const { result } = render();
    await advance(200);

    await act(async () => { await result.current.onPickStorageFile(); });
    expect(backend.save).toHaveBeenCalledTimes(1); // the explicit write
    // ★ The gate opening re-runs the save effect once, which re-writes the same workspace: one
    //   redundant write, only on this failed-load path (a loaded backend is already open, so the
    //   state does not change and nothing re-runs). Counted relative for that reason.
    await advance(600);
    const before = backend.save.mock.calls.length;

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    expect(backend.save).toHaveBeenCalledTimes(before + 1);
    expect(backend.save.mock.calls[before][0].tasks.map((x: Task) => x.id)).toEqual([1, 2]);
  });
  it("(h) §587 — a rebuild onto an EMPTY target (100 ms load): the old project is never copied in, and the pause is announced", async () => {
    // ★★ The empty-load REFUSAL is reachable only when the load effect STARTED over populated scope
    //   (its `currentWorkspace` is that render's closure — an empty FIRST load simply applies), so a
    //   rebuild is the only way here. Before the fix the refusal left A's pending save running and
    //   B.save received A's project. The gate stays SHUT after a refusal, announced like a failure.
    const a = makeBackend(100);
    const b = makeBackend(100, "resolve", EMPTY);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render();
    await advance(700);

    rerender({ args: makeArgs({ kind: "browser" }) });
    await advance(700); // the empty load lands and is refused
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]); // kept on screen
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "storageKeptCurrentData"));

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    hideTab();
    await advance(0);
    await act(async () => { result.current.setTasks([...EDIT, { id: 3, taskName: "More" } as unknown as Task]); });
    await advance(600);

    expect(b.save).not.toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled();
    // ★ review I1: its OWN wording — "could not be loaded" is false here, the load came back empty.
    expect(pausedToasts("storageSavePausedLoadFailed")).toHaveLength(0);
    const paused = pausedToasts("storageSavePausedEmptyLoad");
    expect(paused).toHaveLength(1);
    expect(paused[0][2]).toMatchObject({ labelKey: "storageSavingPausedAction" });
    await advance(8000); // the toast has timed out; the pause is still published
    expect(result.current.loadPause).toBe("empty-refused");
    expect(b.save).not.toHaveBeenCalled();
  });

  it("(i) a project switch still loads-then-suppresses: the gate adds no write to the target", async () => {
    // ★★ Pins the gate sitting ABOVE the suppress branch. The switch stamps the OUTGOING backend
    //   (render scope), the re-render builds the target's memo instance with the gate closed, and
    //   the load effect's re-stamp opens it. Below the suppress branch, the closed run would spend
    //   the op's one-shot and the opening re-run would write the just-loaded workspace back.
    saveRegistry(addProject(emptyRegistry(), { id: "target", name: "Target", code: "T", storageConfig: { kind: "local-json" } }, false));
    (handles.getHandle as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "t.json" });
    const current = makeBackend(0);
    const built = makeBackend(0); // backendFor(target) — the instance the switch loads
    const memo = makeBackend(0); // the memo's own instance once storageConfig flips
    createBackendMock.mockReturnValueOnce(current).mockReturnValueOnce(built).mockReturnValue(memo);
    let rerenderWith: (cfg: StorageConfig) => void = () => {};
    const setStorageConfig = vi.fn((cfg: StorageConfig) => rerenderWith(cfg));
    const { result, rerender } = render({ ...makeArgs(), setStorageConfig });
    rerenderWith = (cfg) => rerender({ args: { ...makeArgs(cfg), setStorageConfig } });
    await advance(100);

    await act(async () => {
      const p = result.current.switchToProject("target");
      await vi.advanceTimersByTimeAsync(10);
      await p;
    });
    await advance(1200);

    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-json" });
    expect(memo.load).not.toHaveBeenCalled(); // the switch's suppressNextLoad was honoured
    expect(built.save).not.toHaveBeenCalled();
    expect(memo.save).not.toHaveBeenCalled();

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    expect(memo.save).toHaveBeenCalledTimes(1); // and the gate IS open on the target
  });
  it("(j) a storage-KIND switch keeps its conversion write, and the gate opening makes one post-switch save with no edit", async () => {
    // `onRequestStorageSwitch` writes the live workspace to the new kind through `guardedWrite` —
    // not the save effect, so the gate does not touch it — then arms suppressNextLoad (NOT
    // suppressNextSave) and flips the config. Before §586 the rebuilt save effect re-wrote the same
    // workspace 500 ms later; now the re-stamp opens the gate and the `savesAllowed` dep re-runs the
    // effect, so that one redundant write still happens WITHOUT waiting for an edit. Pinned here.
    const current = makeBackend(0);
    const converted = makeBackend(0); // built inside onRequestStorageSwitch
    const memo = makeBackend(0); // the memo's own instance once storageConfig flips
    createBackendMock.mockReturnValueOnce(current).mockReturnValueOnce(converted).mockReturnValue(memo);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let rerenderWith: (cfg: StorageConfig) => void = () => {};
    const setStorageConfig = vi.fn((cfg: StorageConfig) => rerenderWith(cfg));
    const { result, rerender } = render({ ...makeArgs(), setStorageConfig });
    rerenderWith = (cfg) => rerender({ args: { ...makeArgs(cfg), setStorageConfig } });
    await advance(100);

    await act(async () => { await result.current.onRequestStorageSwitch("local-json"); });
    expect(converted.save).toHaveBeenCalledTimes(1); // the deliberate conversion write
    expect(converted.save.mock.calls[0][0].tasks.map((x: Task) => x.id)).toEqual([1]);
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-json" });

    await advance(700);
    expect(memo.load).not.toHaveBeenCalled(); // suppressNextLoad honoured
    expect(memo.save).toHaveBeenCalledTimes(1); // the gate opened and the effect re-ran, no edit needed
    expect(memo.save.mock.calls[0][0].tasks.map((x: Task) => x.id)).toEqual([1]);
    expect(current.save).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
  // ── §586/§587 (user ruling): a storage-KIND switch with nothing loaded copies nothing ──
  // `onRequestStorageSwitch` normally copies the LIVE workspace into the new kind through
  // `guardedWrite`. Before any load of the current storage was applied, that workspace is the empty
  // boot one (or, after an empty-load refusal, the PREVIOUS target's project), so the switch goes
  // ahead WITHOUT the write: nothing is written anywhere, the new backend loads its own target, and
  // a notice says why nothing was copied. (j) above is the after-a-successful-load control: it
  // converts exactly as before.
  function renderSwitchable(first: FakeBackend, ...rest: FakeBackend[]) {
    let chain = createBackendMock.mockReturnValueOnce(first);
    for (const b of rest.slice(0, -1)) chain = chain.mockReturnValueOnce(b);
    chain.mockReturnValue(rest[rest.length - 1]);
    let rerenderWith: (cfg: StorageConfig) => void = () => {};
    const setStorageConfig = vi.fn((cfg: StorageConfig) => rerenderWith(cfg));
    const utils = render({ ...makeArgs(), setStorageConfig });
    rerenderWith = (cfg) => utils.rerender({ args: { ...makeArgs(cfg), setStorageConfig } });
    return { ...utils, setStorageConfig };
  }

  it("(k) a storage-kind switch after a FAILED load switches WITHOUT writing, and the new backend loads its data", async () => {
    const a = makeBackend(100, "reject");
    const b = makeBackend(100, "resolve", STORED_B); // the memo's instance for the new kind
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, setStorageConfig } = renderSwitchable(a, b);
    await advance(200); // A's load has failed

    await act(async () => { await result.current.onRequestStorageSwitch("local-json"); });
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-json" });
    expect(confirmSpy).not.toHaveBeenCalled(); // no "convert N tasks?" — nothing is converted
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "storageSwitchedWithoutCopy", t("en-US", "storageLocalJson")));

    await advance(900);
    expect(b.load).toHaveBeenCalledTimes(1); // NOT suppressed: the new backend loads its own target
    expect(result.current.tasks.map((x) => x.id)).toEqual([9]);
    expect(a.save).not.toHaveBeenCalled();
    expect(b.save).not.toHaveBeenCalled();
    expect(result.current.loadPause).toBeNull();
    confirmSpy.mockRestore();
  });

  it("(l) a storage-kind switch after an EMPTY-load refusal switches WITHOUT writing, and the new backend loads its data", async () => {
    const a = makeBackend(100);
    const b = makeBackend(100, "resolve", EMPTY);
    const c = makeBackend(100, "resolve", STORED_B); // the memo's instance for the new kind
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, rerender, setStorageConfig } = renderSwitchable(a, b, c);
    await advance(700);
    rerender({ args: { ...makeArgs({ kind: "browser" }), setStorageConfig } });
    await advance(700); // B's empty load is refused; A's project stays on screen
    expect(result.current.loadPause).toBe("empty-refused");

    await act(async () => { await result.current.onRequestStorageSwitch("local-json"); });
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-json" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "storageSwitchedWithoutCopy", t("en-US", "storageLocalJson")));

    await advance(900);
    expect(c.load).toHaveBeenCalledTimes(1);
    expect(result.current.tasks.map((x) => x.id)).toEqual([9]);
    // A's project reached no backend: not the refused one, not the new one.
    expect(a.save).not.toHaveBeenCalled();
    expect(b.save).not.toHaveBeenCalled();
    expect(c.save).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // ── review M4: the gate under StrictMode ───────────────────────────────────
  // ★★★ `reactStrictMode: true`, NOT a StrictMode inside the wrapper: RTL then renders
  // `<StrictMode><Wrapper>…`, the shape that really double-invokes on mount
  // (src/app/strictmode.meta.test.tsx). The double invoke is ASSERTED (two `load()` calls), so the
  // test cannot go vacuous-but-green if the harness stops double-invoking.
  // The StrictMode-only hazard: mount runs the load effect, cancels it, and runs it again. Here the
  // CANCELLED first run's load fails late, after the live second run's load was applied. The gate
  // must ignore it (no pause, no load-failure toast), and saving must work.
  it("(m) StrictMode: a cancelled first-run load failing late neither pauses saving nor reports a failure", async () => {
    const backend = makeBackend(0);
    backend.load
      .mockImplementationOnce(() => new Promise((_, reject) => { setTimeout(() => reject(new Error("stale boom")), 300); }))
      .mockImplementationOnce(() => new Promise((resolve) => { setTimeout(() => resolve(STORED), 100); }));
    createBackendMock.mockReturnValue(backend);
    const { result } = renderHook((props: { args: Parameters<typeof useStorageBackend>[0] }) => useProbe(props.args), {
      initialProps: { args: makeArgs() },
      wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
      reactStrictMode: true,
    });

    await advance(700); // live load applied at 100, the stale one rejects at 300
    expect(backend.load).toHaveBeenCalledTimes(2); // StrictMode really double-invoked
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(result.current.loadPause).toBeNull();
    expect(showToast).not.toHaveBeenCalledWith("error", expect.stringContaining("stale boom"));

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(pausedToasts("storageSavePausedLoadFailed")).toHaveLength(0);
  });
});
