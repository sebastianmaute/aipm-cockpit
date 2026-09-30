// §645 (final review C1) — two main windows on LOCAL FILES, with the REAL `broadcast-sync` between them.
// Since §645 each window writes the file it is BOUND to, so two windows of one kind can be on two
// different files. Tab sync must then keep them apart: a window that applied the other's slices would
// save them into its own file on its next edit. `LocalFileBackend`, the storage facade and the whole
// hook are real; doubled are the OS file handles, `idb`'s handle slot, the per-project handle store
// and the BroadcastChannel (one bus for both windows, as one origin's pages share one channel).
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { RaidItem, Task } from "./types";

const { KV, PROJECT_HANDLES } = vi.hoisted(() => ({ KV: new Map<string, unknown>(), PROJECT_HANDLES: new Map<string, unknown>() }));
const isHandleKey = (key: string) => key.startsWith("file-handle:");
vi.mock("./idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idb")>();
  return {
    ...actual,
    idbGet: async (key: string) => (isHandleKey(key) ? KV.get(key) : actual.idbGet(key)),
    idbSet: async (key: string, value: unknown) => { if (isHandleKey(key)) KV.set(key, value); else await actual.idbSet(key, value); },
    idbDelete: async (key: string) => { if (isHandleKey(key)) KV.delete(key); else await actual.idbDelete(key); },
  };
});
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn(async (id: string) => PROJECT_HANDLES.get(id) ?? null),
  saveHandle: vi.fn(async (id: string, handle: unknown) => { PROJECT_HANDLES.set(id, handle); }),
  deleteHandle: vi.fn(async () => undefined),
}));
vi.mock("./diagnostics", async (importOriginal) => ({ ...(await importOriginal<typeof import("./diagnostics")>()), logDiag: vi.fn() }));

import { addProject, emptyRegistry, loadRegistry, saveRegistry } from "./projects-registry";
import type { FsHandle, StorageConfig } from "./storage";
import { emptyWorkspace, workspaceToJson } from "./storage";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

type FakeFile = FsHandle & { text: () => string; writes: number };
function fakeFile(name: string, initial: string): FakeFile {
  let text = initial;
  let counter = 1000;
  const file: FakeFile = {
    name,
    writes: 0,
    queryPermission: async () => "granted" as PermissionState,
    requestPermission: async () => "granted" as PermissionState,
    getFile: async () => ({ text: async () => text, lastModified: counter, size: text.length }) as unknown as File,
    createWritable: async () => ({
      write: async (data: string | Blob) => { text = String(data); },
      close: async () => { counter += 1; file.writes += 1; },
    }),
    text: () => text,
  };
  return file;
}

/** One origin's pages: every channel but the poster's gets a structured clone, a microtask later.
 *  ★ Both windows share one module graph, so `postRevision`'s per-PAGE id would make each drop the
 *  other's revision as its own echo; the bus gives each revision message a fresh id, as a second page
 *  would (the same device as use-storage-backend.mirror-race.test.tsx). */
function installBus() {
  const open = new Set<{ listeners: Set<(ev: MessageEvent) => void> }>();
  let revisionSender = 0;
  class BusChannel {
    listeners = new Set<(ev: MessageEvent) => void>();
    constructor(public name: string) { open.add(this); }
    postMessage(msg: { kind?: string }) {
      const sent = msg.kind === "__revision" ? { ...msg, clientId: `page-${++revisionSender}` } : msg;
      for (const channel of open) {
        if (channel === this) continue;
        const data = structuredClone(sent);
        queueMicrotask(() => { for (const l of channel.listeners) l({ data } as MessageEvent); });
      }
    }
    addEventListener(_type: string, cb: (ev: MessageEvent) => void) { this.listeners.add(cb); }
    removeEventListener(_type: string, cb: (ev: MessageEvent) => void) { this.listeners.delete(cb); }
    close() { open.delete(this); }
  }
  vi.stubGlobal("BroadcastChannel", BusChannel as unknown as typeof BroadcastChannel);
}

function openWindow() {
  const hook = renderHook(() => {
    const [storageConfig, setStorageConfig] = useState<StorageConfig>({ kind: "local-json" });
    const settings = useMemo(() => ({ storageConfig }) as unknown as Settings, [storageConfig]);
    const ops = useStorageBackend({
      settings, lang: "en-US" as Lang, hydrated: true, isPopout: false, showToast: vi.fn(), showToastAction: vi.fn(),
      onRevealSavingPaused: vi.fn(), setStorageConfig, onStorageOutcome: vi.fn(),
    });
    return { ops, workspace: useWorkspace() };
  }, { wrapper: TestProviders });
  return { hook, ops: () => hook.result.current.ops, taskNames: () => hook.result.current.workspace.tasks.map((x) => x.taskName) };
}
type Win = ReturnType<typeof openWindow>;

async function settle(ms = 50) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
const task = (id: number, taskName: string) => ({ id, taskName }) as unknown as Task;
const raidItem = (id: string, title: string) => ({ id, title }) as unknown as RaidItem;

let fileA: FakeFile;
let fileB: FakeFile;
const SLOT = "file-handle:local-json";
/** What a binder writes into the shared per-kind slot: the handle AND the binding it was bound for (§645 C1). */
const slot = (handle: FakeFile, binding: string) => ({ handle, binding });

/** Registry projects `a` and `b` are both local JSON files; `a` is current and its switch left the slot on `a.json`, so both windows boot bound to it. */
async function openTwoOnA(): Promise<{ w1: Win; w2: Win }> {
  fileA = fakeFile("a.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "A-TASK")] }));
  fileB = fakeFile("b.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "B-TASK")] }));
  KV.set(SLOT, slot(fileA, "a"));
  PROJECT_HANDLES.set("a", fileA);
  PROJECT_HANDLES.set("b", fileB);
  let registry = addProject(emptyRegistry(), { id: "a", name: "Project a", code: "A", storageConfig: { kind: "local-json" } }, true);
  registry = addProject(registry, { id: "b", name: "Project b", code: "B", storageConfig: { kind: "local-json" } }, false);
  saveRegistry(registry);
  const w1 = openWindow();
  const w2 = openWindow();
  await waitFor(() => expect(w1.ops().loadPending).toBe(false));
  await waitFor(() => expect(w2.ops().loadPending).toBe(false));
  await settle();
  expect(w1.taskNames()).toEqual(["A-TASK"]);
  expect(w2.taskNames()).toEqual(["A-TASK"]);
  return { w1, w2 };
}
async function switchTo(win: Win, id: string) {
  await act(async () => { await win.ops().switchToProject(id); });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.indexedDB = new IDBFactory();
  KV.clear();
  PROJECT_HANDLES.clear();
  localStorage.clear();
  installBus();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStorageBackend — local-file windows sync only with windows on the same file (§645)", () => {
  /** W1 edits, then W2 edits: W2 must not have applied W1's tasks, and b.json must not receive them. */
  async function expectKeptApart(w1: Win, w2: Win) {
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "A-TASK"), task(2, "A-EDIT")]); });
    await settle(900); // past the debounce: W1's save has run
    expect(w2.taskNames()).toEqual(["B-TASK"]); // not applied
    await act(async () => { w2.hook.result.current.workspace.setRaid([raidItem("r1", "B-EDIT")]); });
    await waitFor(() => expect(fileB.text()).toContain("B-EDIT"), { timeout: 4000 });
    await settle();
    expect(fileB.text()).toContain("B-TASK");
    expect(fileB.text()).not.toContain("A-EDIT"); // not saved into b.json either
  }

  it("a window that switched to another file neither applies the edit nor saves it into its own file", async () => {
    const { w1, w2 } = await openTwoOnA();
    await switchTo(w2, "b");
    expect(w2.taskNames()).toEqual(["B-TASK"]);
    await expectKeptApart(w1, w2);
  });

  // §659 (2) — another tab's switch writes the slot before it commits the registry. A window that boots in
  // between opens b.json while the registry still names `a`: its binding must come from the slot it opened.
  it("a window that booted on another file neither applies the edit nor saves it into its own file, even while the registry still names the first", async () => {
    const { w1, w2 } = await openTwoOnA();
    w2.hook.unmount();
    KV.set(SLOT, slot(fileB, "b")); // another tab's switch to b re-pointed the slot; its registry commit has not landed
    expect(loadRegistry().currentProjectId).toBe("a");
    const w3 = openWindow();
    await waitFor(() => expect(w3.ops().loadPending).toBe(false));
    await settle();
    expect(w3.taskNames()).toEqual(["B-TASK"]);
    await expectKeptApart(w1, w3);
    expect(fileA.text()).toContain("A-EDIT"); // W1 still writes its own file
  });

  it("two windows on the same file still mirror each other (positive control)", async () => {
    const { w1, w2 } = await openTwoOnA();
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "A-TASK"), task(2, "A-EDIT")]); });
    await settle();
    expect(w2.taskNames()).toEqual(["A-TASK", "A-EDIT"]);
  });

  it("a window that switched away and back mirrors the other window on that file again", async () => {
    const { w1, w2 } = await openTwoOnA();
    await switchTo(w2, "b");
    await switchTo(w2, "a");
    expect(w2.taskNames()).toEqual(["A-TASK"]);
    await act(async () => { w2.hook.result.current.workspace.setTasks([task(1, "A-TASK"), task(3, "BACK-ON-A")]); });
    await settle();
    expect(w1.taskNames()).toEqual(["A-TASK", "BACK-ON-A"]);
  });
  it("a window booted after another window's switch reads that project from the slot and mirrors it", async () => {
    const { w2 } = await openTwoOnA();
    await switchTo(w2, "b");
    const w4 = openWindow();
    await waitFor(() => expect(w4.ops().loadPending).toBe(false));
    await settle();
    expect(w4.taskNames()).toEqual(["B-TASK"]);
    await act(async () => { w2.hook.result.current.workspace.setTasks([task(1, "B-TASK"), task(7, "B-AFTER-SWITCH")]); });
    await settle();
    expect(w4.taskNames()).toEqual(["B-TASK", "B-AFTER-SWITCH"]);
  });

  // An old slot, written before the binding was stored with the handle, holds the bare handle: the kind alone.
  it("windows booted from an old slot with no binding fall back to the kind alone, and mirror each other", async () => {
    fileA = fakeFile("a.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "A-TASK")] }));
    KV.set(SLOT, fileA);
    const w1 = openWindow();
    const w2 = openWindow();
    await waitFor(() => expect(w1.ops().loadPending).toBe(false));
    await waitFor(() => expect(w2.ops().loadPending).toBe(false));
    await settle();
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "A-TASK"), task(2, "LEGACY-EDIT")]); });
    await settle();
    expect(w2.taskNames()).toEqual(["A-TASK", "LEGACY-EDIT"]);
  });
});

// Re-review RC1 and RI1 — a pick in Settings re-points the slot but not the registry. Every LATER load (a
// reload of the picking window, or a new window) must take its binding from the slot, i.e. the picked
// file's, never the registry's current project.
describe("useStorageBackend — a load after a pick binds the picked file, not the registry's project (§645)", () => {
  let fileX: FakeFile;
  /** W1 and W3 on `a`; W1 picks the new, empty file x.json in Settings. */
  async function pickedInW1() {
    const { w1, w2: w3 } = await openTwoOnA();
    fileX = fakeFile("x.json", "");
    vi.stubGlobal("showSaveFilePicker", vi.fn(async () => fileX));
    await act(async () => { await w1.ops().onPickStorageFile(); });
    await settle();
    await waitFor(() => expect(fileX.text()).toContain("A-TASK")); // the ordinary pick: bind, then write the live workspace
    expect(loadRegistry().currentProjectId).toBe("a"); // the registry never heard of the pick
    return { w1, w3 };
  }
  async function boot(): Promise<Win> {
    const w = openWindow();
    await waitFor(() => expect(w.ops().loadPending).toBe(false));
    await settle();
    return w;
  }

  it("a window booted after the pick does not mirror a window on the registry project's real file, and nothing reaches x.json from it", async () => {
    const { w1, w3 } = await pickedInW1();
    w1.hook.unmount(); // the picking window is reloaded
    const w2 = await boot();
    expect(w2.taskNames()).toEqual(["A-TASK"]); // x.json's copy
    await act(async () => { w3.hook.result.current.workspace.setTasks([task(1, "A-TASK"), task(5, "FROM-A-FILE")]); });
    await settle(900);
    expect(w2.taskNames()).toEqual(["A-TASK"]); // not applied
    await act(async () => { w2.hook.result.current.workspace.setRaid([raidItem("r1", "X-EDIT")]); });
    await waitFor(() => expect(fileX.text()).toContain("X-EDIT"), { timeout: 4000 });
    await settle();
    expect(fileX.text()).not.toContain("FROM-A-FILE");
  });

  it("a window booted after the pick mirrors the picking window, which is on the same file", async () => {
    const { w1 } = await pickedInW1();
    const w2 = await boot();
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "A-TASK"), task(6, "ON-X")]); });
    await settle();
    expect(w2.taskNames()).toEqual(["A-TASK", "ON-X"]);
  });
});
