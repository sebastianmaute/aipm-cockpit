// §657 — the save job's mirrored-only skip and the unload journal (§629). Two main windows on ONE
// storage with the REAL `broadcast-sync` between them, as in use-storage-backend.mirror-race.test.tsx,
// whose harness this reuses. The shape: B's save of B's own edit is in flight when A's part reaches B,
// so B's autosave re-runs with B's edit still unsaved and a second save is due. Once the first has
// landed, that second snapshot's only news is A's part, which A saves: the job skips it
// (`mirrorLedger.isMirroredOnly`) and drops its unconfirmed journal entry (`noteSaveRefused(..., null)`).
// What §657 says must hold, pinned here:
//   1. the skipped job's unconfirmed entry is gone from memory, so a later pagehide writes nothing;
//   2. an entry already WRITTEN while the page was hiding stays in localStorage;
//   3. on the next load, that entry's peer part comes back when storage does not hold it yet (the
//      base still matches), and the entry clears silently once the peer's own save has landed.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "./settings-types";
import type { Lang } from "./i18n";
import type { StorageConfig, Workspace } from "./storage";
import { SaveConflictError } from "./storage-error";
import { readUnloadJournal } from "./unload-journal";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";
import { jsonToWorkspace } from "./workspace";
import { TestProviders } from "./test-providers";
import { raidRec, taskRec } from "../test/workspace-records";

vi.mock("./storage", () => ({
  createBackend: vi.fn(),
  emptyWorkspace: vi.fn(() => ({ tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [], grades: [] })),
  StorageNotReadyError: class StorageNotReadyError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  StorageNotImplementedError: class StorageNotImplementedError extends Error {},
  openFileForBackend: vi.fn(),
  loadFromHandleForBackend: vi.fn(),
  pickFileForBackend: vi.fn(),
  pickFileHandleForBackend: vi.fn(),
  pickOpenFileAny: vi.fn(),
  formatFromFileName: vi.fn(() => "json"),
  requestWriteAccessForBackend: vi.fn(),
  setBackendFileHandle: vi.fn(() => null),
  getBackendFileHandle: vi.fn(() => null),
}));
import * as storageMod from "./storage";
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));

const LATENCY_MS = 300;
/** No registry project and a browser backend: every window here journals under this key. */
const JOURNAL_KEY = "browser";

type Store = { rev: number; workspace: Workspace };
let store: Store;

/** A window's backend over `store`, enforcing the revision it last loaded, wrote or adopted (mirror-race). */
function makeBackend() {
  let held: number | null = null;
  return {
    load: vi.fn(async () => { held = store.rev; return structuredClone(store.workspace); }),
    save: vi.fn(async (ws: Workspace) => {
      const expected = held;
      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
      if (expected !== store.rev) throw new SaveConflictError("browser");
      store.rev += 1;
      store.workspace = ws;
      held = store.rev;
    }),
    isReady: vi.fn(async () => true),
    describe: vi.fn(async () => "shared store"),
    revision: () => (held === null ? null : String(held)),
    adoptRevision: (revision: string) => { held = Number(revision); },
  };
}

/** One origin's windows, as in mirror-race: each revision message gets a fresh page id (the windows share
 *  one module graph), slice messages carry a per-channel window id so the §656 tie-break can fire, and
 *  while `bus.hold` names a kind its deliveries wait for `bus.release()`. */
type Held = { deliver: () => void };
const bus = {
  opening: 0,
  hold: false as boolean | string,
  held: [] as Held[],
  release() { const due = this.held.splice(0); for (const h of due) h.deliver(); },
};
function installBus() {
  bus.hold = false;
  bus.held = [];
  bus.opening = 0;
  const open = new Set<{ listeners: Set<(ev: MessageEvent) => void>; owner: number }>();
  let revisionSender = 0;
  class BusChannel {
    listeners = new Set<(ev: MessageEvent) => void>();
    owner = bus.opening;
    constructor(public name: string) { open.add(this); }
    postMessage(msg: { kind?: string; clientId?: string; windowId?: string }) {
      const sent = msg.kind === "__revision" ? { ...msg, clientId: `page-${++revisionSender}` } : msg;
      for (const channel of open) {
        if (channel === this) continue;
        const data = structuredClone(sent);
        if (sent.kind !== "__revision" && this.owner !== channel.owner) data.windowId = this.owner < channel.owner ? "" : "￿";
        const deliver = () => { for (const l of channel.listeners) l({ data } as MessageEvent); };
        if (bus.hold === true || bus.hold === sent.kind) bus.held.push({ deliver });
        else queueMicrotask(deliver);
      }
    }
    addEventListener(_type: string, cb: (ev: MessageEvent) => void) { this.listeners.add(cb); }
    removeEventListener(_type: string, cb: (ev: MessageEvent) => void) { this.listeners.delete(cb); }
    close() { open.delete(this); }
  }
  vi.stubGlobal("BroadcastChannel", BusChannel as unknown as typeof BroadcastChannel);
}

const backendFor = new Map<StorageConfig, ReturnType<typeof makeBackend>>();

function openWindow(reactStrictMode: boolean) {
  const backend = makeBackend();
  const storageConfig = { kind: "browser" } as StorageConfig;
  backendFor.set(storageConfig, backend);
  const args: Parameters<typeof useStorageBackend>[0] = {
    settings: { storageConfig } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
    onStorageOutcome: vi.fn(),
  };
  const pause = { raised: 0, last: false };
  bus.opening += 1;
  const hook = renderHook(() => {
    const { conflictPause } = useStorageBackend(args);
    if (conflictPause && !pause.last) pause.raised += 1;
    pause.last = conflictPause;
    return useWorkspace();
  }, {
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
    reactStrictMode, // ★ the option, not a StrictMode inside the wrapper (strictmode.meta.test.tsx)
  });
  return { backend, hook, conflicts: () => pause.raised };
}

/** Runs fake time forward with every microtask (channel delivery, save promises) in between. */
async function run(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** The journal record stored under the project's own key, decoded — or null. */
function storedJournal(): Workspace | null {
  const rec = readUnloadJournal(JOURNAL_KEY);
  return rec === null ? null : jsonToWorkspace(rec.workspace);
}

/** `document.visibilityState` reads "hidden" until the returned function is called. No event is
 *  dispatched, so no flush-on-hide runs: only a save that STARTS meanwhile is journalled at once. */
function hideDocument(): () => void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  return () => { delete (document as unknown as { visibilityState?: unknown }).visibilityState; };
}

describe.each([false, true])("useStorageBackend — a skipped mirrored-only save job and the unload journal (§657), reactStrictMode=%s", (strict) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    installBus();
    store = { rev: 1, workspace: { tasks: [], raid: [], absences: [], shifts: [] } as unknown as Workspace };
    backendFor.clear();
    vi.mocked(storageMod.createBackend).mockImplementation(((config: StorageConfig) => backendFor.get(config)) as unknown as typeof storageMod.createBackend);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Opens A and B, then plays the §657 shape up to the moment B's second save is due (t = 1100):
   *  t=0 B edits tasks → B saves 500 → 800 · t=550 A edits raid (held from B) → A saves 1050 → 1350 ·
   *  t=600 A's raid reaches B, so B's autosave re-runs with B's tasks still unsaved → due at 1100.
   *  `onDue` runs just before t=1100, i.e. after A's save started and before B's second one does. */
  async function playUntilSecondSave(onDue?: () => void) {
    const a = openWindow(strict);
    const b = openWindow(strict);
    await run(0);
    await run(1000); // both loads applied, their suppressed runs spent
    let now = 0;
    const until = async (at: number) => { await run(at - now); now = at; };
    await act(async () => { b.hook.result.current.setTasks([taskRec(1, "from B")]); });
    bus.hold = "raid";
    await until(550);
    await act(async () => { a.hook.result.current.setRaid([raidRec(1, "from A")]); });
    await until(600);
    expect(b.backend.save).toHaveBeenCalledTimes(1); // B's own save is in flight
    bus.hold = false;
    await act(async () => { bus.release(); });
    expect(b.hook.result.current.raid.map((r) => r.title)).toEqual(["Risk from A"]); // B mirrored A's part
    await until(1075);
    expect(a.backend.save).toHaveBeenCalledTimes(1); // A's save of its own part has started
    onDue?.();
    await until(1110);
    return { a, b, until };
  }

  it("the skipped job writes nothing and drops its unconfirmed entry, so a later pagehide journals nothing", async () => {
    const { a, b, until } = await playUntilSecondSave();
    expect(b.backend.save).toHaveBeenCalledTimes(1); // the second job was skipped, not written
    await until(2000); // A's save has landed and B adopted its revision
    expect(a.backend.save).toHaveBeenCalledTimes(1);
    expect(b.backend.save).toHaveBeenCalledTimes(1);
    expect(a.conflicts() + b.conflicts()).toBe(0);
    expect(store.workspace.tasks.map((x) => x.taskName)).toEqual(["Task from B"]);
    expect(store.workspace.raid.map((x) => x.title)).toEqual(["Risk from A"]);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(readUnloadJournal(JOURNAL_KEY)).toBeNull(); // kept, the skipped snapshot would be journalled here
  });

  it("an entry written while hiding stays, and the next load brings its peer part back while storage lacks it", async () => {
    let show = (): void => {};
    const { b, until } = await playUntilSecondSave(() => { show = hideDocument(); });
    show();
    expect(b.backend.save).toHaveBeenCalledTimes(1); // skipped
    const kept = storedJournal(); // written as the job's save STARTED (hidden), before the job skipped it
    expect(kept?.tasks.map((x) => x.taskName)).toEqual(["Task from B"]);
    expect(kept?.raid.map((x) => x.title)).toEqual(["Risk from A"]);
    expect(store.workspace.raid).toEqual([]); // A's save has not landed yet
    b.hook.unmount(); // B's page goes away; the next load is a fresh window on the same storage
    const next = openWindow(strict);
    await run(0);
    await until(1200);
    expect(store.workspace.raid).toEqual([]); // still not stored: the raid below came from the journal
    expect(next.hook.result.current.tasks.map((x) => x.taskName)).toEqual(["Task from B"]);
    expect(next.hook.result.current.raid.map((x) => x.title)).toEqual(["Risk from A"]);
  });

  it("an entry written while hiding clears silently on the next load once the peer's save has landed", async () => {
    let show = (): void => {};
    const { a, b, until } = await playUntilSecondSave(() => { show = hideDocument(); });
    show();
    expect(storedJournal()?.raid.map((x) => x.title)).toEqual(["Risk from A"]);
    b.hook.unmount();
    await until(2000);
    expect(a.backend.save).toHaveBeenCalledTimes(1);
    expect(store.workspace.raid.map((x) => x.title)).toEqual(["Risk from A"]); // A saved its own part
    expect(storedJournal()?.raid.map((x) => x.title)).toEqual(["Risk from A"]); // A's confirmation did not clear B's later record
    const next = openWindow(strict);
    await run(0);
    await run(100);
    expect(next.hook.result.current.raid.map((x) => x.title)).toEqual(["Risk from A"]);
    expect(readUnloadJournal(JOURNAL_KEY)).toBeNull(); // its content IS what was loaded: cleared, nothing applied
  });
});
