// §629 — the unload journal's WRITE and CLEAR wiring (use-unload-journal.ts plus
// the thin calls in use-storage-backend.ts's `doSave`). The restore on load is
// not tested here.
//
// Two layers:
//   1. `useStorageBackend` with a fake backend whose save promise the test
//      settles by hand — (a) to (g) from the task brief.
//   2. `useUnloadJournal` on its own — the popout guard (unreachable through the
//      storage hook, whose save effect returns for a popout before `doSave`
//      exists) and the ordering rulings.
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
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn(), useRevisionSync: vi.fn(), postRevision: vi.fn() }));
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));
// A pass-through spy: every fingerprint the hook computes is counted (fix round 1, M1).
vi.mock("./unload-journal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./unload-journal")>();
  return { ...actual, fingerprintWorkspace: vi.fn(actual.fingerprintWorkspace) };
});

import * as storageMod from "./storage";
import { TestProviders } from "./test-providers";
import { fingerprintWorkspace, keptProjectKey, UNLOAD_JOURNAL_PREFIX, type UnloadJournal } from "./unload-journal";
import { addProject, emptyRegistry, saveRegistry } from "./projects-registry";
import { useStorageBackend } from "./use-storage-backend";
import { UNLOAD_JOURNAL_TAB_ID, useUnloadJournal } from "./use-unload-journal";
import { emptyWorkspace, jsonToWorkspace, type Workspace } from "./workspace";
import { useWorkspace } from "./workspace-context";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;
const fingerprintSpy = fingerprintWorkspace as unknown as ReturnType<typeof vi.fn>;

// No registry entry and kind "browser" → projectKey "browser".
const JOURNAL_KEY = `${UNLOAD_JOURNAL_PREFIX}browser`;

const STORED = { tasks: [{ id: 1, taskName: "Stored" } as unknown as Task], raid: [], absences: [], shifts: [] };
const EDIT = [{ id: 1, taskName: "Stored" }, { id: 2, taskName: "Edited" }] as unknown as Task[];
const EDIT_2 = [...EDIT, { id: 3, taskName: "More" }] as unknown as Task[];

type Settle = { resolve: () => void; reject: (err: unknown) => void };

/** A backend whose load lands after `loadMs`, and whose saves stay pending until the test
 *  settles them through `saves` — or resolve at once with `autoSave`. */
function makeBackend(loadMs: number, loadOutcome: "resolve" | "reject" = "resolve", stored: object = STORED, autoSave = false) {
  const saves: Settle[] = [];
  return {
    saves,
    kind: "browser",
    load: vi.fn(() => new Promise((resolve, reject) => {
      setTimeout(() => (loadOutcome === "resolve" ? resolve(stored) : reject(new Error("load boom"))), loadMs);
    })),
    save: vi.fn(() => (autoSave ? Promise.resolve() : new Promise<void>((resolve, reject) => { saves.push({ resolve, reject }); }))),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

function makeArgs(isPopout = false, storageConfig: StorageConfig = { kind: "browser" }): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout,
    showToast: vi.fn(),
    showToastAction: vi.fn(),
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

/** Small steps, each in its own `act` — see the same helper in use-storage-backend.load-gate.test.tsx. */
async function advance(ms: number) {
  const STEP = 25;
  for (let done = 0; done < ms; done += STEP) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - done)); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

function pageHide() {
  window.dispatchEvent(new Event("pagehide"));
}

function tabSwitch() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function readJournal(key = JOURNAL_KEY): UnloadJournal | null {
  const raw = localStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as UnloadJournal);
}

function journalKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k !== null && k.startsWith(UNLOAD_JOURNAL_PREFIX)) keys.push(k);
  }
  return keys;
}

function journalTaskIds(key = JOURNAL_KEY): number[] {
  const rec = readJournal(key);
  if (rec === null) throw new Error(`no journal at ${key}`);
  return jsonToWorkspace(rec.workspace).tasks.map((x) => x.id as number);
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

describe("§629 — the storage hook writes the unload journal and clears it on a confirmed save", () => {
  it("(a) an edit, then pagehide while its save is still scheduled: the journal holds the edited workspace", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(200); // loaded

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(100); // inside the 500 ms debounce
    expect(backend.save).not.toHaveBeenCalled();
    expect(readJournal()).toBeNull();

    await act(async () => { pageHide(); });
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(journalTaskIds()).toEqual([1, 2]);
    const rec = readJournal()!;
    expect(rec.tabId).toBe(UNLOAD_JOURNAL_TAB_ID);
    // R2 — the base is the state the backend RETURNED on load.
    expect(rec.baseFingerprint).toBe(fingerprintWorkspace(STORED as unknown as Workspace));
  });

  it("(b) a save fired while visible and still unconfirmed, then pagehide: the journal holds that outgoing workspace", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(200);

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600); // the debounce fired the save; it has not confirmed
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(readJournal()).toBeNull(); // visible: no journal at save time

    await act(async () => { pageHide(); });
    expect(journalTaskIds()).toEqual([1, 2]);
  });

  it("(c) the save confirms: the journal is cleared and the base rolls forward to the confirmed workspace", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(200);

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    await act(async () => { pageHide(); });
    expect(readJournal()).not.toBeNull();

    await act(async () => { backend.saves[0].resolve(); });
    await advance(0);
    expect(readJournal()).toBeNull();

    // The next journal carries the CONFIRMED workspace as its base, not the loaded one.
    await act(async () => { result.current.setTasks(EDIT_2); });
    await advance(0); // pageHiding is still true from the pagehide above: the save starts at once
    expect(backend.save).toHaveBeenCalledTimes(2);
    expect(journalTaskIds()).toEqual([1, 2, 3]);
    const confirmed = (backend.save.mock.calls[0] as unknown as [Workspace])[0];
    expect(readJournal()!.baseFingerprint).toBe(fingerprintWorkspace(confirmed));
    expect(readJournal()!.baseFingerprint).not.toBe(fingerprintWorkspace(STORED as unknown as Workspace));
  });

  it("(d) the save rejects: the journal stays", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(200);

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    await act(async () => { pageHide(); });
    expect(readJournal()).not.toBeNull();

    await act(async () => { backend.saves[0].reject(new Error("save boom")); });
    await advance(0);
    expect(journalTaskIds()).toEqual([1, 2]);
  });

  it("(e) a popout: no journal, ever — not on pagehide, not on a hidden tab", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render(makeArgs(true));
    await advance(200);

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(100);
    await act(async () => { tabSwitch(); pageHide(); });
    await advance(600);
    expect(backend.save).not.toHaveBeenCalled();
    expect(journalKeys()).toEqual([]);
  });

  it("(f) saves not allowed — a load still pending, or a FAILED load: no journal", async () => {
    const pending = makeBackend(5000);
    createBackendMock.mockReturnValue(pending);
    const first = render();
    await advance(100);
    await act(async () => { first.result.current.setTasks(EDIT); });
    await act(async () => { pageHide(); });
    await advance(600);
    expect(pending.save).not.toHaveBeenCalled();
    expect(readJournal()).toBeNull();
    first.unmount();
    window.dispatchEvent(new Event("pageshow"));

    const failed = makeBackend(100, "reject");
    createBackendMock.mockReturnValue(failed);
    const second = render();
    await advance(200); // load has rejected: the gate stays shut
    await act(async () => { second.result.current.setTasks(EDIT); });
    await advance(100);
    await act(async () => { tabSwitch(); pageHide(); });
    await advance(600);
    expect(failed.save).not.toHaveBeenCalled();
    expect(readJournal()).toBeNull();
  });

  it("(g) a plain tab switch with no save pending writes no journal (§185 — and commits no draft)", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(200);

    // An edit whose save fired and CONFIRMED — nothing is pending.
    await act(async () => { result.current.setTasks(EDIT); });
    await advance(600);
    await act(async () => { backend.saves[0].resolve(); });
    await advance(0);

    await act(async () => { tabSwitch(); });
    await advance(600);
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(readJournal()).toBeNull();
  });

  it("a save FLUSHED by a tab switch (debounce pending) is journaled at once, and cleared when it confirms", async () => {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(200);

    await act(async () => { result.current.setTasks(EDIT); });
    await advance(100);
    await act(async () => { tabSwitch(); });
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(journalTaskIds()).toEqual([1, 2]);

    await act(async () => { backend.saves[0].resolve(); });
    await advance(0);
    expect(readJournal()).toBeNull();
  });

  it("I1 — after a project SWITCH (op), the journal lands under the TARGET's key with the target's loaded state as base", async () => {
    // The op applies B's workspace BEFORE it flips the storage config (§77 order), so the key in
    // scope at apply time is still A's. The base must still come out as {B, B's state}.
    const STORED_B = { tasks: [{ id: 9, taskName: "Target" } as unknown as Task], raid: [], absences: [], shifts: [] };
    const reg = addProject(addProject(emptyRegistry(), { id: "pa", name: "A", code: "A", storageConfig: { kind: "browser" } }, true),
      { id: "pb", name: "B", code: "B", storageConfig: { kind: "browser" } }, false);
    saveRegistry(reg);
    const current = makeBackend(0, "resolve", STORED, true); // A — its pre-switch flush must resolve
    const built = makeBackend(0, "resolve", STORED_B); // backendFor(B): the instance the switch loads
    const memo = makeBackend(0, "resolve", STORED_B); // the memo's own instance once the config flips
    createBackendMock.mockReturnValueOnce(current).mockReturnValueOnce(built).mockReturnValue(memo);
    let rerenderWith: (cfg: StorageConfig) => void = () => {};
    const setStorageConfig = vi.fn((cfg: StorageConfig) => rerenderWith(cfg));
    const { result, rerender } = render({ ...makeArgs(), setStorageConfig });
    rerenderWith = (cfg) => rerender({ args: { ...makeArgs(false, cfg), setStorageConfig } });
    await advance(100);

    await act(async () => {
      const p = result.current.switchToProject("pb");
      await vi.advanceTimersByTimeAsync(10);
      await p;
    });
    await advance(600);
    expect(memo.load).not.toHaveBeenCalled(); // the op's suppress branch ran
    expect(result.current.tasks.map((x) => x.id)).toEqual([9]);

    await act(async () => { result.current.setTasks([...result.current.tasks, { id: 10, taskName: "New" } as unknown as Task]); });
    await advance(600);
    expect(memo.save).toHaveBeenCalledTimes(1); // fired, unconfirmed
    await act(async () => { pageHide(); });

    const keyB = `${UNLOAD_JOURNAL_PREFIX}pb`;
    expect(journalTaskIds(keyB)).toEqual([9, 10]);
    expect(readJournal(keyB)!.baseFingerprint).toBe(fingerprintWorkspace(STORED_B as unknown as Workspace));
    expect(readJournal(`${UNLOAD_JOURNAL_PREFIX}pa`)).toBeNull();
    expect(journalKeys()).toEqual([keyB]);
  });
});

describe("§629 — useUnloadJournal on its own", () => {
  const WS_1: Workspace = { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "One" } as unknown as Task] };
  const WS_2: Workspace = { ...emptyWorkspace(), tasks: [{ id: 2, taskName: "Two" } as unknown as Task] };
  const KEY = `${UNLOAD_JOURNAL_PREFIX}p1`;
  const KEPT_KEY = `${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1")}`;
  const EXTRA: Workspace = { ...emptyWorkspace(), tasks: [{ id: 3, taskName: "Three" } as unknown as Task] };

  function renderJournal(isPopout = false) {
    return renderHook(() => useUnloadJournal({ projectKey: "p1", enabled: true, isPopout }));
  }

  it("(e) a popout never writes — a start while hidden, then pagehide, leaves no key", () => {
    const { result } = renderJournal(true);
    tabSwitch();
    act(() => { result.current.noteSaveStarted(WS_1); });
    pageHide();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("savedAt is strictly increasing even when the clock does not move", () => {
    const { result } = renderJournal();
    const a = result.current.noteSaveStarted(WS_1);
    const b = result.current.noteSaveStarted(WS_2);
    expect(b).toBeGreaterThan(a);
  });

  it("an OLDER save confirming late neither rolls the base back nor drops the newer unconfirmed entry", () => {
    const { result } = renderJournal();
    result.current.setBase(WS_1, "p1");
    const older = result.current.noteSaveStarted(WS_1);
    const newer = result.current.noteSaveStarted(WS_2);

    result.current.noteSaveConfirmed(older, WS_1);
    pageHide();
    expect(journalTaskIds(KEY)).toEqual([2]); // the newer one is still unconfirmed

    result.current.noteSaveConfirmed(newer, WS_2);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.baseFingerprint()).toBe(fingerprintWorkspace(WS_2));
  });

  it("a newer confirm followed by a late older confirm keeps the NEWER base", () => {
    const { result } = renderJournal();
    const older = result.current.noteSaveStarted(WS_1);
    const newer = result.current.noteSaveStarted(WS_2);
    result.current.noteSaveConfirmed(newer, WS_2);
    result.current.noteSaveConfirmed(older, WS_1);
    expect(result.current.baseFingerprint()).toBe(fingerprintWorkspace(WS_2));
  });

  it("a save started BEFORE a load was applied does not replace that load's base when it confirms", () => {
    const { result } = renderJournal();
    const before = result.current.noteSaveStarted(WS_1);
    result.current.setBase(WS_2, "p1"); // e.g. a reload landing while that save is in flight
    result.current.noteSaveConfirmed(before, WS_1);
    expect(result.current.baseFingerprint()).toBe(fingerprintWorkspace(WS_2));
  });

  it("R1 — a confirmed save never clears a journal another page load left", () => {
    const { result } = renderJournal();
    const foreign: UnloadJournal = { v: 1, projectKey: "p1", tabId: "an-earlier-page", savedAt: 1, baseFingerprint: "x", workspace: "{}" };
    localStorage.setItem(KEY, JSON.stringify(foreign));
    const at = result.current.noteSaveStarted(WS_1);
    result.current.noteSaveConfirmed(at, WS_1);
    expect(readJournal(KEY)).toEqual(foreign);
  });

  it("M1 — over the cap, the base fingerprint is never computed", () => {
    const huge: Workspace = { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "x".repeat(1_600_000) } as unknown as Task] };
    const { result } = renderJournal();
    result.current.setBase(WS_1, "p1"); // the idle warm-up has NOT run: no timer was advanced
    fingerprintSpy.mockClear();
    tabSwitch();
    result.current.noteSaveStarted(huge);
    pageHide();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(fingerprintSpy).not.toHaveBeenCalled();
  });

  it("M1 — once the idle warm-up ran, a pagehide write does not recompute the fingerprint", async () => {
    const expected = fingerprintWorkspace(WS_1);
    const { result } = renderJournal();
    result.current.setBase(WS_1, "p1");
    fingerprintSpy.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); }); // the warm-up
    expect(fingerprintSpy).toHaveBeenCalledTimes(1);
    fingerprintSpy.mockClear();
    result.current.noteSaveStarted(WS_2);
    pageHide();
    expect(readJournal(KEY)!.baseFingerprint).toBe(expected);
    expect(fingerprintSpy).not.toHaveBeenCalled();
  });

  it("M1 — a stale warm-up never overwrites a NEWER base", () => {
    // ★ A stubbed requestIdleCallback whose callbacks the test runs ONE at a time: with the timer
    //   fallback both warm-ups share a due time and fire together, and WS_2's own warm-up would
    //   then mask a stale write by WS_1's. In a browser an event can land between the two.
    const idle: Array<() => void> = [];
    Object.defineProperty(window, "requestIdleCallback", {
      value: (cb: IdleRequestCallback) => idle.push(() => cb({ didTimeout: false, timeRemaining: () => 50 })),
      configurable: true,
    });
    try {
      const { result } = renderJournal();
      result.current.setBase(WS_1, "p1");
      result.current.setBase(WS_2, "p1"); // replaces the base before WS_1's warm-up runs
      expect(idle).toHaveLength(2);
      idle[0](); // WS_1's warm-up alone
      expect(result.current.baseFingerprint()).toBe(fingerprintWorkspace(WS_2));
    } finally {
      Reflect.deleteProperty(window, "requestIdleCallback");
    }
  });

  it("M3 — a lazily computed fingerprint is kept: a second read does not recompute", () => {
    const { result } = renderJournal();
    result.current.setBase(WS_1, "p1"); // no timer advanced: no warm-up
    fingerprintSpy.mockClear();
    result.current.baseFingerprint();
    result.current.baseFingerprint();
    expect(fingerprintSpy).toHaveBeenCalledTimes(1);
  });

  it("I1 — a held op base is keyed only when adopted, and only under the key it is adopted with", () => {
    const { result } = renderJournal();
    result.current.setBase(WS_1, "p1");
    result.current.holdBase(WS_2);
    expect(result.current.baseFingerprint()).toBe(""); // R7 (Task 3): the hold drops the live base — no pair stands
    result.current.adoptHeldBase("p2");
    expect(result.current.baseFingerprint()).toBe(""); // p1 has no base now; the held one went to p2
  });

  it("§4 followLive — the live workspace replaces the refused outgoing one, and pagehide writes it", () => {
    const { result } = renderJournal();
    act(() => { result.current.noteSaveStarted(WS_1); });
    act(() => { result.current.followLive(WS_2); });
    expect(localStorage.getItem(KEY)).toBeNull(); // visible: nothing written yet
    pageHide();
    expect(jsonToWorkspace(readJournal(KEY)!.workspace).tasks.map((x) => x.id)).toEqual([2]);
  });

  it("§4 followLive(ws, true) writes at once into the KEPT slot, never the project's own", () => {
    const { result } = renderJournal();
    result.current.setBase(WS_1, "p1");
    act(() => { result.current.followLive(WS_2, true); });
    expect(jsonToWorkspace(readJournal(KEPT_KEY)!.workspace).tasks.map((x) => x.id)).toEqual([2]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("§4 ordinary journalling of the key stays on beside a kept record: confirmations, unconfirmed saves and pagehide use the own slot only", () => {
    const { result } = renderJournal();
    act(() => { result.current.followLive(WS_2, true); });
    const kept = readJournal(KEPT_KEY)!;
    const confirmed = result.current.noteSaveStarted(WS_1);
    result.current.noteSaveConfirmed(confirmed, WS_1);
    expect(readJournal(KEPT_KEY)).toEqual(kept);
    result.current.noteSaveStarted(EXTRA); // started, never confirmed
    pageHide();
    expect(jsonToWorkspace(readJournal(KEY)!.workspace).tasks.map((x) => x.id)).toEqual([3]);
    expect(readJournal(KEPT_KEY)).toEqual(kept);
    result.current.dropUnconfirmed("p1"); // "Reload project"
    expect(readJournal(KEPT_KEY)).toEqual(kept);
  });

  it("§4 followLive(ws, true) consumes the pause's live entry: pagehide does not also write it to the own slot", () => {
    const { result } = renderJournal();
    act(() => { result.current.followLive(WS_1); }); // the pause's live entry…
    act(() => { result.current.followLive(WS_2, true); }); // …then the switch away keeps the newest
    pageHide();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("§4 a second keep never replaces the kept record the user has not resolved: it gets a numbered kept slot, never the own one", () => {
    const { result } = renderJournal();
    act(() => { result.current.followLive(WS_1, true); });
    const kept = readJournal(KEPT_KEY)!;
    act(() => { result.current.followLive(WS_2, true); });
    expect(readJournal(KEPT_KEY)).toEqual(kept);
    expect(localStorage.getItem(KEY)).toBeNull();
    const numbered = journalKeys().filter((k) => k.startsWith(`${KEPT_KEY}:`));
    expect(numbered).toHaveLength(1);
    expect(jsonToWorkspace(readJournal(numbered[0])!.workspace).tasks.map((x) => x.id)).toEqual([2]);
  });

  it("§4 noteSaveRefused — a stale save whose backend was replaced goes to the kept slot, under the key it was started for, and leaves no entry", () => {
    const { result } = renderJournal();
    const at = result.current.noteSaveStarted(WS_2);
    act(() => { result.current.noteSaveRefused(at, WS_2); });
    expect(jsonToWorkspace(readJournal(KEPT_KEY)!.workspace).tasks.map((x) => x.id)).toEqual([2]);
    result.current.setBase(WS_1, "p1"); // the new backend's load
    pageHide();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("§4 a live entry is dropped when its key's base moves by setBase: pagehide writes nothing", () => {
    const { result } = renderJournal();
    act(() => { result.current.followLive(WS_2); });
    result.current.setBase(WS_1, "p1");
    pageHide();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("§4 a live entry is dropped when its key's base moves by adoptHeldBase: pagehide writes nothing", () => {
    const { result } = renderJournal();
    act(() => { result.current.followLive(WS_2); });
    result.current.holdBase(WS_1);
    result.current.adoptHeldBase("p1");
    pageHide();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("§4 followLive never writes from a popout", () => {
    const { result } = renderJournal(true);
    act(() => { result.current.followLive(WS_2, true); });
    pageHide();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(KEPT_KEY)).toBeNull();
  });

  it("setBase stores the fingerprint of the workspace it is given", () => {
    const { result } = renderJournal();
    expect(result.current.baseFingerprint()).toBe("");
    result.current.setBase(WS_1, "p1");
    expect(result.current.baseFingerprint()).toBe(fingerprintWorkspace(WS_1));
  });
});
