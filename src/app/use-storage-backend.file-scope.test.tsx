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

type FakeFile = FsHandle & { text: () => string; writes: number; permission: PermissionState };
function fakeFile(name: string, initial: string): FakeFile {
  let text = initial;
  let counter = 1000;
  const file: FakeFile = {
    name,
    writes: 0,
    permission: "granted",
    queryPermission: async () => file.permission,
    requestPermission: async () => file.permission,
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
    return { ops, workspace: useWorkspace(), setStorageConfig };
  }, { wrapper: TestProviders });
  return { hook, ops: () => hook.result.current.ops, taskNames: () => hook.result.current.workspace.tasks.map((x) => x.taskName), paused: () => hook.result.current.ops.conflictPause };
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

  // Re-review 3 RI3 — an old slot (or one written by a tab still on old code) holds the bare handle. The first
  // window that reads it upgrades it to a record, so a window booted after it reads the same binding and the
  // two mirror, rather than each isolating and pausing the other on every alternating save.
  it("(c) a bare-handle slot is upgraded by the first window that boots on it, and a later window on it mirrors that one", async () => {
    fileA = fakeFile("a.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "A-TASK")] }));
    KV.set(SLOT, fileA);
    const w1 = openWindow();
    await waitFor(() => expect(w1.ops().loadPending).toBe(false));
    await settle();
    expect(KV.get(SLOT)).toEqual({ handle: fileA, binding: expect.stringMatching(/^picked:/) });
    const w2 = openWindow();
    await waitFor(() => expect(w2.ops().loadPending).toBe(false));
    await settle();
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "A-TASK"), task(2, "LEGACY-EDIT")]); });
    await settle();
    expect(w2.taskNames()).toEqual(["A-TASK", "LEGACY-EDIT"]);
    await settle(900);
    expect(w1.paused()).toBe(false);
    expect(w2.paused()).toBe(false);
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

// Re-review 2 RI2 — a window whose first load FAILS (a local file's permission is not granted after a
// browser restart) learns its binding only when it recovers. Its binding must come from the file it
// recovers onto, and until then it must not share the kind-only scope with other such windows.
describe("useStorageBackend — a window that recovers from a failed load binds the file it recovers onto (§645)", () => {
  async function bootFailed(file: FakeFile, binding: string): Promise<Win> {
    KV.set(SLOT, slot(file, binding));
    const w = openWindow();
    await waitFor(() => expect(w.ops().loadPause).toBe("load-failed"));
    await settle();
    return w;
  }
  async function recover(w: Win) {
    await act(async () => { await w.ops().reloadCurrentProject(); });
    await settle();
    expect(w.ops().loadPause).toBeNull();
  }

  it("(a) two windows on different files, both recovered by Reload project: neither mirrors the other, and nothing crosses files", async () => {
    const fileX = fakeFile("x.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "X-TASK")] }));
    const fileY = fakeFile("y.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "Y-TASK")] }));
    fileX.permission = "prompt";
    fileY.permission = "prompt";
    const w1 = await bootFailed(fileX, "x");
    const w2 = await bootFailed(fileY, "y"); // another tab switched the slot to y before this window opened
    fileX.permission = "granted";
    fileY.permission = "granted";
    await recover(w1);
    await recover(w2);
    expect(w1.taskNames()).toEqual(["X-TASK"]);
    expect(w2.taskNames()).toEqual(["Y-TASK"]);
    await act(async () => { w2.hook.result.current.workspace.setTasks([task(1, "Y-TASK"), task(2, "FROM-Y")]); });
    await settle(900);
    expect(w1.taskNames()).toEqual(["X-TASK"]); // not applied
    await act(async () => { w1.hook.result.current.workspace.setRaid([raidItem("r1", "X-EDIT")]); });
    await waitFor(() => expect(fileX.text()).toContain("X-EDIT"), { timeout: 4000 });
    await settle();
    expect(fileX.text()).not.toContain("FROM-Y");
  });

  it("(b) two windows on the same file, both recovered by Reload project, mirror each other again", async () => {
    const fileX = fakeFile("x.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "X-TASK")] }));
    fileX.permission = "prompt";
    const w1 = await bootFailed(fileX, "x");
    const w2 = await bootFailed(fileX, "x");
    fileX.permission = "granted";
    await recover(w1);
    await recover(w2);
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "X-TASK"), task(3, "SHARED")]); });
    await settle();
    expect(w2.taskNames()).toEqual(["X-TASK", "SHARED"]);
  });
  // Re-review 4 RI4 — a window whose load FAILED shows content that is not the file's (the boot workspace, or
  // the previous project), so it must not share the file's key: not until an applied load gives it the binding.
  it("(d) a window whose load failed neither applies its same-file peer's edit nor has its own edit applied there", async () => {
    const fileX = fakeFile("x.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "X-TASK")] }));
    KV.set(SLOT, slot(fileX, "x"));
    const w1 = openWindow();
    await waitFor(() => expect(w1.ops().loadPending).toBe(false));
    await settle();
    fileX.permission = "prompt"; // a later window opens after the browser forgot the permission
    const w2 = await bootFailed(fileX, "x");
    fileX.permission = "granted";
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "X-TASK"), task(4, "FROM-LOADED")]); });
    await settle();
    expect(w2.taskNames()).toEqual([]); // not applied
    await act(async () => { w2.hook.result.current.workspace.setTasks([task(8, "FROM-FAILED")]); });
    await settle();
    expect(w1.taskNames()).toEqual(["X-TASK", "FROM-LOADED"]); // not applied either
    await recover(w2); // an APPLIED load gives the binding: from here on they mirror
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "X-TASK"), task(4, "FROM-LOADED"), task(5, "AFTER-RELOAD")]); });
    await settle();
    expect(w2.taskNames()).toEqual(["X-TASK", "FROM-LOADED", "AFTER-RELOAD"]);
  });

  it("(e) two windows that booted with no file bound and recovered onto the same file by Reload project mirror each other", async () => {
    const w1 = openWindow();
    const w2 = openWindow();
    await waitFor(() => expect(w1.ops().loadPause).toBe("load-failed")); // nothing in the slot: no handle to open
    await waitFor(() => expect(w2.ops().loadPause).toBe("load-failed"));
    const fileX = fakeFile("x.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "X-TASK")] }));
    KV.set(SLOT, slot(fileX, "x")); // another tab bound x meanwhile
    await recover(w1);
    await recover(w2);
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "X-TASK"), task(5, "AFTER-RECOVERY")]); });
    await settle();
    expect(w2.taskNames()).toEqual(["X-TASK", "AFTER-RECOVERY"]);
  });
  // Re-review 4 RI4 — the grant loads nothing: the window still shows content that is not the file's.
  it("(f) a window granted access to the slot's file after a failed boot stays apart from that file's window until Reload project", async () => {
    const w1 = openWindow();
    await waitFor(() => expect(w1.ops().loadPause).toBe("load-failed"));
    const fileX = fakeFile("x.json", workspaceToJson({ ...emptyWorkspace(), tasks: [task(1, "X-TASK")] }));
    KV.set(SLOT, slot(fileX, "x"));
    const w2 = openWindow();
    await waitFor(() => expect(w2.ops().loadPending).toBe(false));
    await settle();
    await act(async () => { await w1.ops().onGrantWriteAccess(); }); // binds the slot's handle to W1's instance, loads nothing
    await settle();
    await act(async () => { w2.hook.result.current.workspace.setTasks([task(1, "X-TASK"), task(6, "AFTER-GRANT")]); });
    await settle();
    expect(w1.taskNames()).toEqual([]); // not applied
    await recover(w1);
    await act(async () => { w2.hook.result.current.workspace.setTasks([task(1, "X-TASK"), task(6, "AFTER-GRANT"), task(7, "AFTER-RELOAD")]); });
    await settle();
    expect(w1.taskNames()).toEqual(["X-TASK", "AFTER-GRANT", "AFTER-RELOAD"]);
  });
});
// Re-review 3 m-a — a load that comes back EMPTY over a populated screen is refused: the window keeps the
// PREVIOUS content (gate shut). Its binding must not become the refused file's, or its edits to that
// previous content would mirror into windows on the refused file and be saved there.
describe("useStorageBackend — a refused empty load isolates the window (§645)", () => {
  it("the kept previous content neither mirrors into a window on the refused file nor reaches that file", async () => {
    const { w1 } = await openTwoOnA();
    const fileE = fakeFile("e.json", workspaceToJson(emptyWorkspace()));
    KV.set(SLOT, slot(fileE, "e"));
    const w2 = openWindow(); // on the empty file
    await waitFor(() => expect(w2.ops().loadPending).toBe(false));
    await settle();
    await act(async () => { w1.hook.result.current.setStorageConfig({ kind: "local-json" }); }); // a rebuild: the new instance opens e.json
    await waitFor(() => expect(w1.ops().loadPause).toBe("empty-refused"));
    await settle();
    expect(w1.taskNames()).toEqual(["A-TASK"]); // the previous content is kept
    await act(async () => { w1.hook.result.current.workspace.setTasks([task(1, "A-TASK"), task(9, "KEPT-EDIT")]); });
    await settle();
    expect(w2.taskNames()).toEqual([]); // not mirrored
    await act(async () => { w2.hook.result.current.workspace.setRaid([raidItem("r1", "E-EDIT")]); });
    await waitFor(() => expect(fileE.text()).toContain("E-EDIT"), { timeout: 4000 });
    await settle();
    expect(fileE.text()).not.toContain("A-TASK");
    expect(fileE.text()).not.toContain("KEPT-EDIT");
  });
});
