// §4 — a save refused as stale (`SaveConflictError`) pauses saving, and the edits made while the
// pause holds stay in the unload journal (§629). The storage facade, `LocalFileBackend`,
// `BrowserBackend` (over fake-indexeddb) and the whole hook are REAL; doubled are the OS file handle,
// `idb`'s file-handle slot and the per-project handle store — the same split as
// use-storage-backend.handover.test.tsx, whose `fakeFile` this copies.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Settings } from "./settings-types";
import type { Task } from "./types";

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
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn(), useRevisionSync: vi.fn(), postRevision: vi.fn() }));
vi.mock("./diagnostics", async (importOriginal) => ({ ...(await importOriginal<typeof import("./diagnostics")>()), logDiag: vi.fn() }));

import { useRevisionSync } from "./broadcast-sync";
import { addProject, emptyRegistry, loadRegistry, saveRegistry } from "./projects-registry";
import type { FsHandle, StorageConfig } from "./storage";
import { emptyWorkspace, workspaceToJson } from "./storage";
import { SaveConflictError } from "./storage-error";
import { TestProviders } from "./test-providers";
import { UNLOAD_JOURNAL_PREFIX, type UnloadJournal } from "./unload-journal";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

type FakeFile = FsHandle & { text: () => string; writes: number; foreignWrite: (text: string) => void; revision: () => string };
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
    foreignWrite: (next: string) => { text = next; counter += 1; },
    revision: () => `${counter}:${text.length}`,
  };
  return file;
}

const task = (id: number, taskName: string) => ({ id, taskName }) as unknown as Task;
const showToast = vi.fn();
const showToastAction = vi.fn();

function renderApp(initial: StorageConfig) {
  const onStorageOutcome = vi.fn();
  const hook = renderHook(() => {
    const [storageConfig, setStorageConfig] = useState(initial);
    const settings = useMemo(() => ({ storageConfig }) as unknown as Settings, [storageConfig]);
    const ops = useStorageBackend({
      settings, lang: "en-US" as Lang, hydrated: true, isPopout: false, showToast, showToastAction,
      onRevealSavingPaused: vi.fn(), setStorageConfig, onStorageOutcome,
    });
    return { ops, workspace: useWorkspace() };
  }, { wrapper: TestProviders });
  return {
    hook,
    ops: () => hook.result.current.ops,
    conflicts: () => onStorageOutcome.mock.calls.filter(([err]) => err instanceof SaveConflictError).length,
  };
}
type App = ReturnType<typeof renderApp>;

async function settle(ms = 50) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
async function edit(app: App, tasks: Task[]) {
  await act(async () => { app.hook.result.current.workspace.setTasks(tasks); });
}

/** Every journal record in localStorage, by key. */
function journals(): Array<{ key: string; journal: UnloadJournal }> {
  const out: Array<{ key: string; journal: UnloadJournal }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith(UNLOAD_JOURNAL_PREFIX)) out.push({ key, journal: JSON.parse(localStorage.getItem(key)!) as UnloadJournal });
  }
  return out;
}

/** Boots on a bound local file, lets a peer write it, then makes one edit whose autosave meets the peer's revision. */
async function pausedOnConflict() {
  const file = fakeFile("p.json", workspaceToJson(emptyWorkspace()));
  KV.set("file-handle:local-json", file);
  const app = renderApp({ kind: "local-json" });
  await waitFor(() => expect(app.ops().loadPending).toBe(false));
  await settle();
  const held = file.revision();
  file.foreignWrite(workspaceToJson({ ...emptyWorkspace(), tasks: [task(7, "PEER")] })); // the other tab's save
  await edit(app, [task(1, "FIRST")]);
  await waitFor(() => expect(app.conflicts()).toBe(1), { timeout: 4000 });
  await settle();
  return { app, file, held };
}

const pauseToasts = () => showToastAction.mock.calls.filter(([, text]) => text === t("en-US", "storageSavePausedConflict")).length;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.indexedDB = new IDBFactory();
  KV.clear();
  PROJECT_HANDLES.clear();
  localStorage.clear();
});

describe("useStorageBackend — a stale save pauses saving and keeps the edits journalled (§4)", () => {
  it("a refused save sets the conflict pause, shuts the gate and toasts once", async () => {
    const { app, file } = await pausedOnConflict();
    expect(app.ops().conflictPause).toBe(true);
    expect(app.ops().loadPause).toBe("conflict");
    expect(pauseToasts()).toBe(1);
    await edit(app, [task(1, "FIRST"), task(2, "SECOND")]);
    await settle(900); // past the debounce: a save would have run and been refused again
    expect(app.conflicts()).toBe(1);
    expect(file.writes).toBe(0);
    expect(file.text()).toContain("PEER");
    expect(pauseToasts()).toBe(1);
    expect(showToast).not.toHaveBeenCalledWith("error", expect.stringContaining(t("en-US", "storageSaveFailed", "")));
  });

  it("while paused, pagehide journals the LIVE workspace, not the refused outgoing one", async () => {
    const { app } = await pausedOnConflict();
    await edit(app, [task(2, "SECOND")]);
    await settle(900);
    expect(app.conflicts()).toBe(1); // no save carried SECOND: only the pause's own journalling can
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    const written = journals();
    expect(written).toHaveLength(1);
    expect(written[0].journal.workspace).toContain("SECOND");
    expect(written[0].journal.workspace).not.toContain("FIRST");
  });

  it("a peer's revision adopted while paused does not lift the pause", async () => {
    const { app, file, held } = await pausedOnConflict();
    const onRevision = vi.mocked(useRevisionSync).mock.calls.at(-1)![1];
    act(() => { onRevision(file.revision(), held); }); // the late message about the very write that refused ours
    await edit(app, [task(3, "THIRD")]);
    await settle(900);
    expect(app.ops().conflictPause).toBe(true);
    expect(app.conflicts()).toBe(1);
    expect(file.writes).toBe(0);
  });

  it("switching away while already paused: the flush writes nothing, the journal is written at once, and a toast says so", async () => {
    const { app, file } = await pausedOnConflict();
    saveRegistry(addProject(emptyRegistry(), { id: "b", name: "Project b", code: "B", storageConfig: { kind: "browser" } }, false));
    await edit(app, [task(2, "PAUSED-EDIT")]);
    await act(async () => { await app.ops().switchToProject("b"); });
    await settle();
    expect(loadRegistry().currentProjectId).toBe("b");
    expect(file.writes).toBe(0);
    expect(app.conflicts()).toBe(1);
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "storageConflictNotSavedOnSwitch"));
    expect(journals().some(({ journal }) => journal.workspace.includes("PAUSED-EDIT"))).toBe(true);
  });

  describe("the record kept on a switch away from a paused project (fix round 1)", () => {
    /** Registry project `p` (a bound local file) is current, `b` is browser storage. Boots on `p`, lets a
     *  peer write it, pauses on the next save, edits once more and switches to `b`. */
    async function keptThenSwitched() {
      const file = fakeFile("p.json", workspaceToJson(emptyWorkspace()));
      KV.set("file-handle:local-json", file);
      PROJECT_HANDLES.set("p", file);
      let registry = addProject(emptyRegistry(), { id: "p", name: "Project p", code: "P", storageConfig: { kind: "local-json" } }, true);
      registry = addProject(registry, { id: "b", name: "Project b", code: "B", storageConfig: { kind: "browser" } }, false);
      saveRegistry(registry);
      const app = renderApp({ kind: "local-json" });
      await waitFor(() => expect(app.ops().loadPending).toBe(false));
      await settle();
      file.foreignWrite(workspaceToJson({ ...emptyWorkspace(), tasks: [task(7, "PEER")] }));
      await edit(app, [task(1, "FIRST")]);
      await waitFor(() => expect(app.conflicts()).toBe(1), { timeout: 4000 });
      await settle();
      await edit(app, [task(2, "KEPT-EDIT")]);
      await settle();
      await act(async () => { await app.ops().switchToProject("b"); });
      await settle();
      const kept = journals().find(({ key }) => key === `${UNLOAD_JOURNAL_PREFIX}p`)!.journal;
      expect(kept.workspace).toContain("KEPT-EDIT");
      return { app, file, kept };
    }
    async function switchBackToP(app: App) {
      await act(async () => { await app.ops().switchToProject("p"); });
      await settle();
      expect(app.hook.result.current.workspace.tasks.map((x) => x.taskName)).toEqual(["PEER"]);
    }
    const storedP = () => journals().find(({ key }) => key === `${UNLOAD_JOURNAL_PREFIX}p`)?.journal ?? null;

    it("is listed as an unsaved version in this tab too", async () => {
      const { app } = await keptThenSwitched();
      expect(app.ops().otherJournals.others.map((o) => o.journal.projectKey)).toContain("p");
    });

    it("switching back and closing the tab does not re-base it onto the peer's version, and the next open asks instead of applying", async () => {
      const { app, kept } = await keptThenSwitched();
      await switchBackToP(app);
      act(() => { window.dispatchEvent(new Event("pagehide")); });
      expect(storedP()?.baseFingerprint).toBe(kept.baseFingerprint);
      app.hook.unmount();
      const next = renderApp({ kind: "local-json" });
      await waitFor(() => expect(next.ops().loadPending).toBe(false));
      await settle();
      expect(next.ops().unloadJournalConflict).toBe(true);
      expect(next.hook.result.current.workspace.tasks.map((x) => x.taskName)).toEqual(["PEER"]);
    });

    it("a later confirmed save in this tab does not clear it", async () => {
      const { app, file } = await keptThenSwitched();
      await switchBackToP(app);
      await edit(app, [task(7, "PEER"), task(3, "AFTER-RETURN")]);
      await waitFor(() => expect(file.text()).toContain("AFTER-RETURN"), { timeout: 4000 });
      await settle();
      expect(storedP()?.workspace).toContain("KEPT-EDIT");
    });
  });

  it("a conflict in the pre-switch flush: the switch happens, the journal keeps the outgoing edits, and a toast says so", async () => {
    saveRegistry(addProject(emptyRegistry(), { id: "b", name: "Project b", code: "B", storageConfig: { kind: "browser" } }, false));
    const file = fakeFile("p.json", workspaceToJson(emptyWorkspace()));
    KV.set("file-handle:local-json", file);
    const app = renderApp({ kind: "local-json" });
    await waitFor(() => expect(app.ops().loadPending).toBe(false));
    await settle();
    file.foreignWrite(workspaceToJson({ ...emptyWorkspace(), tasks: [task(7, "PEER")] }));
    await edit(app, [task(1, "OUTGOING-EDIT")]); // still inside the debounce: only the flush can write it
    await act(async () => { await app.ops().switchToProject("b"); });
    await settle();
    expect(loadRegistry().currentProjectId).toBe("b");
    expect(file.writes).toBe(0);
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "storageConflictNotSavedOnSwitch"));
    expect(journals().some(({ journal }) => journal.workspace.includes("OUTGOING-EDIT"))).toBe(true);
    expect(app.ops().conflictPause).toBe(false); // the pause belongs to the project left behind
  });
});
