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
import { keptProjectKey, UNLOAD_JOURNAL_PREFIX, type UnloadJournal } from "./unload-journal";
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
  // §4 — a refused save raises the conflict pause and never reaches `onStorageOutcome`: count each time the pause is RAISED.
  const pause = { raised: 0, last: false };
  const hook = renderHook(() => {
    const [storageConfig, setStorageConfig] = useState(initial);
    const settings = useMemo(() => ({ storageConfig }) as unknown as Settings, [storageConfig]);
    const ops = useStorageBackend({
      settings, lang: "en-US" as Lang, hydrated: true, isPopout: false, showToast, showToastAction,
      onRevealSavingPaused: vi.fn(), setStorageConfig, onStorageOutcome,
    });
    if (ops.conflictPause && !pause.last) pause.raised += 1;
    pause.last = ops.conflictPause;
    return { ops, workspace: useWorkspace(), setStorageConfig };
  }, { wrapper: TestProviders });
  return {
    hook,
    ops: () => hook.result.current.ops,
    conflicts: () => pause.raised,
    /** Every refused save reported as a generic storage failure — §4: none may be. */
    conflictOutcomes: () => onStorageOutcome.mock.calls.filter(([err]) => err instanceof SaveConflictError).length,
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
    expect(app.conflictOutcomes()).toBe(0); // the pause is the whole report: no generic storage-error banner beside it
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

  describe("the record kept on a switch away from a paused project (fix rounds 1 and 2)", () => {
    const KEPT_P = `${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p")}`;
    const OWN_P = `${UNLOAD_JOURNAL_PREFIX}p`;
    const stored = (key: string) => journals().find((j) => j.key === key)?.journal ?? null;
    /** A peer writes `p`, then an edit's save meets it and pauses. */
    async function pauseOnP(app: App, file: FakeFile, tasks: Task[], conflictsAfter: number) {
      file.foreignWrite(workspaceToJson({ ...emptyWorkspace(), tasks: [task(7, "PEER")] }));
      await edit(app, tasks);
      await waitFor(() => expect(app.conflicts()).toBe(conflictsAfter), { timeout: 4000 });
      await settle();
    }
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
      await pauseOnP(app, file, [task(1, "FIRST")], 1);
      await edit(app, [task(2, "KEPT-EDIT")]);
      await settle();
      await act(async () => { await app.ops().switchToProject("b"); });
      await settle();
      const kept = stored(KEPT_P)!;
      expect(kept.workspace).toContain("KEPT-EDIT");
      expect(stored(OWN_P)).toBeNull(); // the kept slot, not the project's own
      return { app, file, kept };
    }
    async function switchBackToP(app: App) {
      await act(async () => { await app.ops().switchToProject("p"); });
      await settle();
      expect(app.hook.result.current.workspace.tasks.map((x) => x.taskName)).toEqual(["PEER"]);
    }

    it("is listed as an unsaved version in this tab too", async () => {
      const { app } = await keptThenSwitched();
      expect(app.ops().otherJournals.others.map((o) => o.journal.projectKey)).toContain(keptProjectKey("p"));
    });

    it("switching back and closing the tab leaves it exactly as kept, and the next open neither applies it nor raises the restore notice", async () => {
      const { app, kept } = await keptThenSwitched();
      await switchBackToP(app);
      act(() => { window.dispatchEvent(new Event("pagehide")); });
      expect(stored(KEPT_P)).toEqual(kept);
      app.hook.unmount();
      const next = renderApp({ kind: "local-json" });
      await waitFor(() => expect(next.ops().loadPending).toBe(false));
      await settle();
      expect(next.ops().unloadJournalConflict).toBe(false); // the notice reads only the own slot
      expect(next.hook.result.current.workspace.tasks.map((x) => x.taskName)).toEqual(["PEER"]);
      expect(next.ops().otherJournals.others.map((o) => o.journal.projectKey)).toContain(keptProjectKey("p"));
    });

    it("a later confirmed save in this tab does not clear it", async () => {
      const { app, file, kept } = await keptThenSwitched();
      await switchBackToP(app);
      await edit(app, [task(7, "PEER"), task(3, "AFTER-RETURN")]);
      await waitFor(() => expect(file.text()).toContain("AFTER-RETURN"), { timeout: 4000 });
      await settle();
      expect(stored(KEPT_P)).toEqual(kept);
    });

    it("after a Discard of it, a save in flight at pagehide is journalled in the own slot", async () => {
      const { app } = await keptThenSwitched();
      await switchBackToP(app);
      const entry = app.ops().otherJournals.others.find((o) => o.journal.projectKey === keptProjectKey("p"))!;
      act(() => { app.ops().otherJournals.discard(entry); });
      expect(stored(KEPT_P)).toBeNull();
      await edit(app, [task(7, "PEER"), task(4, "IN-FLIGHT")]);
      act(() => { window.dispatchEvent(new Event("pagehide")); }); // flushes the pending save while hiding: journalled as it starts
      expect(stored(OWN_P)?.workspace).toContain("IN-FLIGHT");
      await settle(); // (its confirmation then clears it, as §629 does for any save that lands)
    });

    it("a second pause on p after returning: pagehide journals the post-return edits in the own slot, and the kept record stays", async () => {
      const { app, file, kept } = await keptThenSwitched();
      await switchBackToP(app);
      await pauseOnP(app, file, [task(7, "PEER"), task(5, "SECOND-PAUSE")], 2);
      await edit(app, [task(7, "PEER"), task(5, "SECOND-PAUSE"), task(6, "POST-RETURN")]);
      await settle();
      act(() => { window.dispatchEvent(new Event("pagehide")); });
      expect(stored(OWN_P)?.workspace).toContain("POST-RETURN");
      expect(stored(KEPT_P)).toEqual(kept);
    });

    /** The kept record, then a return to `p`, a second pause there and a second switch away. */
    async function keptTwice() {
      const { app, file, kept } = await keptThenSwitched();
      await switchBackToP(app);
      await pauseOnP(app, file, [task(7, "PEER"), task(8, "SECOND-KEEP")], 2);
      await act(async () => { await app.ops().switchToProject("b"); });
      await settle();
      const numbered = journals().filter((j) => j.key.startsWith(`${KEPT_P}:`));
      return { app, file, kept, second: numbered[0] };
    }

    it("a second paused switch away does not replace the unresolved kept record: the newer edits get a kept slot of their own", async () => {
      const { kept, second } = await keptTwice();
      expect(journals().filter((j) => j.key.startsWith(`${KEPT_P}:`))).toHaveLength(1);
      expect(stored(KEPT_P)).toEqual(kept);
      expect(second.journal.workspace).toContain("SECOND-KEEP");
      expect(stored(OWN_P)?.workspace ?? "").not.toContain("SECOND-KEEP");
    });

    it("both kept versions survive a return and a confirmed save", async () => {
      const { app, file, kept } = await keptTwice();
      await switchBackToP(app);
      await edit(app, [task(7, "PEER"), task(9, "AFTER-SECOND-RETURN")]);
      await waitFor(() => expect(file.text()).toContain("AFTER-SECOND-RETURN"), { timeout: 4000 });
      await settle();
      expect(stored(KEPT_P)).toEqual(kept);
      expect(journals().some((j) => j.journal.workspace.includes("SECOND-KEEP"))).toBe(true);
    });

    it("both kept versions survive a return and Reload project", async () => {
      const { app, kept } = await keptTwice();
      await switchBackToP(app);
      await act(async () => { await app.ops().reloadCurrentProject(); });
      await settle();
      expect(stored(KEPT_P)).toEqual(kept);
      expect(journals().some((j) => j.journal.workspace.includes("SECOND-KEEP"))).toBe(true);
    });

    it("the list shows both kept versions, each under its project's name", async () => {
      const { app, second } = await keptTwice();
      const listed = app.ops().otherJournals.others.filter((o) => o.journal.projectKey.startsWith(keptProjectKey("p")));
      expect(listed.map((o) => o.journal.projectKey).sort()).toEqual([keptProjectKey("p"), second.key.slice(UNLOAD_JOURNAL_PREFIX.length)].sort());
      expect(listed.map((o) => o.label)).toEqual(["Project p", "Project p"]);
    });
  });

  it("C1: a stale save whose backend a settings rebuild replaced is kept, and nothing ordinary is re-based onto the new load", async () => {
    const file = fakeFile("p.json", workspaceToJson(emptyWorkspace()));
    KV.set("file-handle:local-json", file);
    const app = renderApp({ kind: "local-json" });
    await waitFor(() => expect(app.ops().loadPending).toBe(false));
    await settle();
    file.foreignWrite(workspaceToJson({ ...emptyWorkspace(), tasks: [task(7, "PEER")] }));
    await edit(app, [task(1, "REBUILD-EDIT")]); // inside the debounce: the rebuild's cleanup flush writes it
    await act(async () => { app.hook.result.current.setStorageConfig({ kind: "local-json" }); }); // a new identity: the backend is rebuilt
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", t("en-US", "storageConflictNotSavedOnRebuild")), { timeout: 4000 }); // the old instance was refused: no pause can hold it (nothing reaches `onStorageOutcome` either)
    await settle(200);
    expect(app.hook.result.current.workspace.tasks.map((x) => x.taskName)).toEqual(["PEER"]); // the new backend's load
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    const byKey = new Map(journals().map((j) => [j.key, j.journal]));
    expect(byKey.get(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("browser")}`)?.workspace).toContain("REBUILD-EDIT");
    expect(byKey.get(`${UNLOAD_JOURNAL_PREFIX}browser`)?.workspace ?? "").not.toContain("REBUILD-EDIT");
    expect(showToast).not.toHaveBeenCalledWith("error", t("en-US", "storageConflictNotSavedOnSwitch")); // §4 — nothing was switched: a rebuild says so in its own words
    expect(app.conflictOutcomes()).toBe(0);
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
    expect(showToast.mock.calls.filter(([, text]) => text === t("en-US", "storageConflictNotSavedOnSwitch"))).toHaveLength(1); // the op's cleanup flush meets the conflict too: kept and toasted once
  });
});
