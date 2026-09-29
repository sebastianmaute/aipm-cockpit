// §4 — two main windows on ONE storage, with the REAL `broadcast-sync` between them (the sibling
// suites mock it) and one shared fake store whose save takes real latency and ENFORCES the revision:
// a save checked against a revision the store no longer holds throws `SaveConflictError`, as the
// file, IndexedDB and SharePoint backends do. The instant mock saves elsewhere cannot show the race
// this pins: a window that merely MIRRORS a peer's edit must not autosave it, or both windows write
// the same content from the same revision and one of them is refused.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "./settings-types";
import type { Lang } from "./i18n";
import type { RaidItem, Task } from "./types";
import type { StorageConfig, Workspace } from "./storage";
import { SaveConflictError } from "./storage-error";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";
import { TestProviders } from "./test-providers";

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

/** How long a save takes to reach the store: a real-latency backend (Turso, SharePoint). */
const LATENCY_MS = 300;

/** The one storage both windows write. `rev` is what a conditional write is checked against. */
type Store = { rev: number; workspace: Workspace };
let store: Store;

/** A window's backend instance over `store`: it holds the revision it last loaded, wrote or adopted. */
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

/** One origin's windows: every channel but the poster's gets a structured clone, a microtask later.
 *  ★ `postRevision` tags its message with a per-PAGE id, and both windows here share one module
 *  graph, so B would drop A's revision as its own echo. The bus gives each revision message a fresh
 *  id, as a second page would; the poster then hears its own too, which it cannot adopt (it no longer
 *  holds the base its save was checked against). Slice messages already carry a per-hook id.
 *  While `bus.hold` is set, deliveries wait for `bus.release()`, which runs them all in one go.
 *  `heldPosts(kind)` counts the POSTS waiting, not their per-channel deliveries. */
type Held = { sent: { kind?: string }; deliver: () => void };
const bus = {
  hold: false,
  held: [] as Held[],
  release() { const due = this.held.splice(0); for (const h of due) h.deliver(); },
  heldPosts(kind: string) { return new Set(this.held.filter((h) => h.sent.kind === kind).map((h) => h.sent)).size; },
};
function installBus() {
  bus.hold = false;
  bus.held = [];
  const open = new Set<{ listeners: Set<(ev: MessageEvent) => void> }>();
  let revisionSender = 0;
  class BusChannel {
    listeners = new Set<(ev: MessageEvent) => void>();
    constructor(public name: string) { open.add(this); }
    postMessage(msg: { kind?: string; clientId?: string }) {
      const sent = msg.kind === "__revision" ? { ...msg, clientId: `page-${++revisionSender}` } : msg;
      for (const channel of open) {
        if (channel === this) continue;
        const data = structuredClone(sent);
        const deliver = () => { for (const l of channel.listeners) l({ data } as MessageEvent); };
        if (bus.hold) bus.held.push({ sent, deliver });
        else queueMicrotask(deliver);
      }
    }
    addEventListener(_type: string, cb: (ev: MessageEvent) => void) { this.listeners.add(cb); }
    removeEventListener(_type: string, cb: (ev: MessageEvent) => void) { this.listeners.delete(cb); }
    close() { open.delete(this); }
  }
  vi.stubGlobal("BroadcastChannel", BusChannel as unknown as typeof BroadcastChannel);
}

function openWindow(reactStrictMode: boolean) {
  const backend = makeBackend();
  const storageConfig = { kind: "browser" } as StorageConfig;
  backendFor.set(storageConfig, backend);
  const onStorageOutcome = vi.fn();
  const args: Parameters<typeof useStorageBackend>[0] = {
    settings: { storageConfig } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
    onStorageOutcome,
  };
  const hook = renderHook(() => { useStorageBackend(args); return useWorkspace(); }, {
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
    reactStrictMode, // ★ the option, not a StrictMode inside the wrapper (strictmode.meta.test.tsx)
  });
  const conflicts = () => onStorageOutcome.mock.calls.filter(([err]) => err instanceof SaveConflictError).length;
  return { backend, hook, conflicts };
}

const backendFor = new Map<StorageConfig, ReturnType<typeof makeBackend>>();

/** Runs fake time forward with every microtask (channel delivery, save promises) in between. */
async function run(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

const task = (id: number, taskName: string) => ({ id, taskName }) as unknown as Task;
const raidItem = (id: string, title: string) => ({ id, title }) as unknown as RaidItem;

describe.each([false, true])("useStorageBackend — a mirrored edit is saved once, by its writer (§4), reactStrictMode=%s", (strict) => {
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

  async function openBoth() {
    const a = openWindow(strict);
    const b = openWindow(strict);
    await run(0);
    await run(1000); // both loads applied, their suppressed runs spent
    expect(a.backend.load).toHaveBeenCalledTimes(strict ? 2 : 1); // StrictMode re-runs the load effect; its first run is cancelled
    expect(b.backend.load).toHaveBeenCalledTimes(strict ? 2 : 1);
    return { a, b };
  }

  it("neither window pauses when one edits and the other only mirrors it", async () => {
    const { a, b } = await openBoth();
    await act(async () => { a.hook.result.current.setTasks([task(1, "from A")]); });
    await run(0);
    expect(b.hook.result.current.tasks.map((x) => x.taskName)).toEqual(["from A"]); // B really mirrored it
    await run(500 + LATENCY_MS + 100);
    expect(a.conflicts()).toBe(0);
    expect(b.conflicts()).toBe(0);
    expect(store.workspace.tasks.map((x) => x.taskName)).toEqual(["from A"]);
    expect(b.backend.save).not.toHaveBeenCalled();
  });

  it("the mirroring window adopts the writer's revision, so its own later edit saves without a pause", async () => {
    const { a, b } = await openBoth();
    await act(async () => { a.hook.result.current.setTasks([task(1, "from A")]); });
    await run(500 + LATENCY_MS + 100);
    expect(b.backend.revision()).toBe("2"); // adopted from A's {2, base 1}
    await act(async () => { b.hook.result.current.setRaid([raidItem("r1", "from B")]); });
    await run(500 + LATENCY_MS + 100);
    expect(a.conflicts()).toBe(0);
    expect(b.conflicts()).toBe(0);
    expect(store.rev).toBe(3);
    expect(store.workspace.tasks.map((x) => x.taskName)).toEqual(["from A"]);
    expect(store.workspace.raid.map((x) => x.title)).toEqual(["from B"]);
  });

  // A genuine concurrent edit: B's own change is still in its debounce when A's slice arrives. B's save
  // must still happen — it may be refused as a conflict, which is the guard working — never be dropped.
  it("still saves the mirroring window's own pending edit when a peer's slice arrives", async () => {
    const { a, b } = await openBoth();
    await act(async () => { b.hook.result.current.setRaid([raidItem("r1", "from B")]); });
    await run(100);
    await act(async () => { a.hook.result.current.setTasks([task(1, "from A")]); });
    await run(0);
    await run(500 + LATENCY_MS + 500);
    const bSaved = b.backend.save.mock.calls.map(([ws]) => ws.raid.map((x) => x.title));
    expect(bSaved).toContainEqual(["from B"]);
  });

  // Both windows change the SAME part within one delivery: each then shows the other's value. Neither
  // copy may be left to the other window to save — at least one writes, and a refusal is reported.
  it("a crossing edit to one part in both windows is saved or reported, never dropped by both", async () => {
    const { a, b } = await openBoth();
    await act(async () => {
      a.hook.result.current.setTasks([task(1, "from A")]);
      b.hook.result.current.setTasks([task(2, "from B")]);
    });
    await run(0);
    expect(a.hook.result.current.tasks.map((x) => x.taskName)).toEqual(["from B"]); // they really crossed
    expect(b.hook.result.current.tasks.map((x) => x.taskName)).toEqual(["from A"]);
    await run(500 + LATENCY_MS + 500);
    expect(a.backend.save.mock.calls.length + b.backend.save.mock.calls.length).toBeGreaterThan(0);
    expect(store.rev > 1 || a.conflicts() + b.conflicts() > 0).toBe(true);
  });

  // After a mirror, putting a part back to EXACTLY the value this window last saved is its own change:
  // storage holds the peer's value there now, so the run must write (or be refused), not skip.
  it("restoring the last-saved value of a mirrored part saves it", async () => {
    const { a, b } = await openBoth();
    const savedTasks = b.hook.result.current.tasks; // what B loaded, and so last "saved"
    await act(async () => {
      a.hook.result.current.setTasks([task(1, "from A")]);
      a.hook.result.current.setRaid([raidItem("r1", "from A")]);
    });
    await run(500 + LATENCY_MS + 100); // A saves; B mirrors both parts and adopts A's revision
    expect(b.backend.save).not.toHaveBeenCalled();
    await act(async () => { b.hook.result.current.setTasks(savedTasks); });
    await run(500 + LATENCY_MS + 100);
    expect(b.backend.save.mock.calls.length + b.conflicts()).toBeGreaterThan(0);
    expect(store.workspace.tasks).toEqual([]);
  });

  // Two peer values of one part reaching B before B renders: the first is applied eagerly, the second
  // in render — where StrictMode runs the updater twice. Both runs must judge it mirrored.
  it("a peer's consecutive edits of one part, applied in one render, stay mirrored", async () => {
    const { a, b } = await openBoth();
    bus.hold = true;
    await act(async () => { a.hook.result.current.setTasks([task(1, "A1")]); });
    await act(async () => { a.hook.result.current.setTasks([task(1, "A2")]); });
    bus.hold = false;
    expect(bus.heldPosts("tasks")).toBe(2); // both of A's tasks messages are waiting for B
    await act(async () => { bus.release(); });
    expect(b.hook.result.current.tasks.map((x) => x.taskName)).toEqual(["A2"]);
    await run(500 + LATENCY_MS + 100);
    expect(b.backend.save).not.toHaveBeenCalled();
    expect(a.conflicts() + b.conflicts()).toBe(0);
    expect(store.workspace.tasks.map((x) => x.taskName)).toEqual(["A2"]);
  });

  // B puts a part back to the reference of an OLDER peer value; a newer peer value then crosses that
  // own edit before it saves. It is an own edit, so B must save it or report the conflict.
  it("an own edit back to an older peer value, crossed by a newer one, is saved or reported", async () => {
    const { a, b } = await openBoth();
    await act(async () => { a.hook.result.current.setTasks([task(1, "A1")]); });
    await run(0);
    const olderPeerValue = b.hook.result.current.tasks;
    expect(olderPeerValue.map((x) => x.taskName)).toEqual(["A1"]);
    await act(async () => { a.hook.result.current.setTasks([task(1, "A2")]); });
    await run(500 + LATENCY_MS + 100); // A saves A2; B mirrors it and adopts
    expect(b.backend.save).not.toHaveBeenCalled();
    await act(async () => { b.hook.result.current.setTasks(olderPeerValue); });
    await act(async () => { a.hook.result.current.setTasks([task(1, "A3")]); });
    await run(0);
    await run(500 + LATENCY_MS + 500);
    expect(b.backend.save.mock.calls.length + b.conflicts()).toBeGreaterThan(0);
  });
});
