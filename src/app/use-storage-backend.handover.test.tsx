// §4 §645 — every op that loads (or writes) on an instance of its own and then points the app at the
// target hands what that instance learned to the LIVE backend. Backends are FAIL CLOSED: an instance
// that never loaded or wrote refuses its first save with `SaveConflictError`, so a missing hand-over
// shows here as a refused save, and a missing `forceNextSave()` on a blind write as a failed op.
// ★ Nothing that decides a save is doubled: the storage facade, `LocalFileBackend`, `BrowserBackend`
//   (over fake-indexeddb) and the whole hook are REAL. Doubled is the ENVIRONMENT — the OS pickers,
//   the `FsHandle`s they return, `idb`'s file-handle slot (a handle is an object of functions, which a
//   real IndexedDB cannot clone) and the per-project handle store.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { BrowserBackend } from "./browser-backend";
import { addProject, emptyRegistry, saveRegistry } from "./projects-registry";
import type { FsHandle, StorageConfig, Workspace } from "./storage";
import { emptyWorkspace, workspaceToJson } from "./storage";
import { SaveConflictError } from "./storage-error";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

/** A file on the fake disk. Its revision (`lastModified:size`) moves on every write, through one
 *  monotonic counter so two writes in one millisecond still differ. `foreignWrite` is another program
 *  (or another window) changing the file under us. */
type FakeFile = FsHandle & { text: () => string; writes: number; foreignWrite: (text: string) => void; revision: () => string; onNextRead?: () => void };
function fakeFile(name: string, initial = "", opts: { unreadable?: boolean } = {}): FakeFile {
  let text = initial;
  let counter = 1000;
  const file: FakeFile = {
    name,
    writes: 0,
    queryPermission: async () => "granted" as PermissionState,
    requestPermission: async () => "granted" as PermissionState,
    getFile: async () => {
      const onRead = file.onNextRead;
      file.onNextRead = undefined;
      onRead?.();
      if (opts.unreadable) throw new DOMException("The file is locked by another program.", "NotReadableError");
      return { text: async () => text, lastModified: counter, size: text.length } as unknown as File;
    },
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

const EDIT = "EDITED-AFTER-THE-SWITCH";
const edited = { id: 91, taskName: EDIT } as unknown as Task;
const showToast = vi.fn();
const showSaveFilePicker = vi.fn<() => Promise<FsHandle>>();
const showOpenFilePicker = vi.fn<() => Promise<FsHandle[]>>();

function renderApp(initial: StorageConfig) {
  const onStorageOutcome = vi.fn();
  const hook = renderHook(() => {
    const [storageConfig, setStorageConfig] = useState(initial);
    const settings = useMemo(() => ({ storageConfig }) as unknown as Settings, [storageConfig]);
    const ops = useStorageBackend({
      settings, lang: "en-US" as Lang, hydrated: true, isPopout: false, showToast, showToastAction: vi.fn(),
      onRevealSavingPaused: vi.fn(), setStorageConfig, onStorageOutcome,
    });
    return { ops, workspace: useWorkspace() };
  }, { wrapper: TestProviders });
  const failures = () => onStorageOutcome.mock.calls.map(([err]) => err).filter((err) => err != null);
  return {
    hook,
    ops: () => hook.result.current.ops,
    conflicts: () => failures().filter((err) => err instanceof SaveConflictError).length,
    failures,
  };
}
type App = ReturnType<typeof renderApp>;

/** Lets the rebuild, the suppressed load and the suppressed save run settle. */
async function settle(ms = 50) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
async function booted(app: App) {
  await waitFor(() => expect(app.ops().loadPending).toBe(false));
  await settle();
}

/** Makes one edit and waits for its autosave to land (`saved()`) or to be reported as failed. */
async function editAndSave(app: App, saved: () => boolean | Promise<boolean>) {
  const before = app.failures().length;
  await act(async () => { app.hook.result.current.workspace.setTasks([edited]); });
  await waitFor(async () => expect((await saved()) || app.failures().length > before).toBe(true), { timeout: 4000 });
}

async function browserTasks(): Promise<string[]> {
  const probe = new BrowserBackend();
  return (await probe.load()).tasks.map((task) => task.taskName);
}

function registerProject(id: string, storageConfig: StorageConfig) {
  saveRegistry(addProject(emptyRegistry(), { id, name: `Project ${id}`, code: id.toUpperCase(), storageConfig }, false));
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.indexedDB = new IDBFactory();
  KV.clear();
  PROJECT_HANDLES.clear();
  localStorage.clear();
  Object.assign(window, { showSaveFilePicker, showOpenFilePicker });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.mocked(window.confirm).mockRestore();
  Reflect.deleteProperty(window, "showSaveFilePicker");
  Reflect.deleteProperty(window, "showOpenFilePicker");
});

describe("useStorageBackend — a switched or created project saves under the revision it was opened with (§4 §645)", () => {
  describe("switchToProject", () => {
    async function switchedToFile(duringSwitchLoad?: () => void) {
      const file = fakeFile("p.json", workspaceToJson(emptyWorkspace()));
      file.onNextRead = duringSwitchLoad; // the switch's own load is the first read of this file
      registerProject("p", { kind: "local-json" });
      PROJECT_HANDLES.set("p", file);
      const app = renderApp({ kind: "browser" });
      await booted(app);
      await act(async () => { await app.ops().switchToProject("p"); });
      await settle();
      return { app, file };
    }

    it("to a local file: the first save after the switch is written, with no conflict", async () => {
      const { app, file } = await switchedToFile();
      await editAndSave(app, () => file.text().includes(EDIT));
      expect(app.conflicts()).toBe(0);
      expect(file.text()).toContain(EDIT);
    });

    it("to a browser project: the first save after the switch is written, with no conflict", async () => {
      registerProject("b", { kind: "browser" });
      const app = renderApp({ kind: "local-json" }); // no file bound: the boot load fails, which is fine — the switch is what is tested
      await settle();
      await act(async () => { await app.ops().switchToProject("b"); });
      await settle();
      const before = app.conflicts();
      await editAndSave(app, async () => (await browserTasks()).includes(EDIT));
      expect(app.conflicts()).toBe(before);
      expect(await browserTasks()).toContain(EDIT);
    });

    it("a foreign write between the switch and the first save refuses that save", async () => {
      const { app, file } = await switchedToFile();
      file.foreignWrite("{\"someone\":\"else\"}");
      await editAndSave(app, () => file.text().includes(EDIT));
      expect(app.conflicts()).toBeGreaterThan(0);
      expect(file.text()).toBe("{\"someone\":\"else\"}");
    });

    it("§645: another tab re-pointing the shared handle slot does not redirect this window's save", async () => {
      const other = fakeFile("other-tab.json", workspaceToJson(emptyWorkspace()));
      // Another tab's own switch rewrites the ONE per-kind slot while this switch is loading, i.e.
      // before the live backend exists: a live instance that took its handle from the slot would bind
      // `other`, whose revision here equals `file`'s, so only the handle can tell them apart.
      const { app, file } = await switchedToFile(() => { KV.set("file-handle:local-json", other); });
      expect(KV.get("file-handle:local-json")).toBe(other);
      await editAndSave(app, () => file.text().includes(EDIT));
      expect(app.conflicts()).toBe(0);
      expect(file.text()).toContain(EDIT);
      expect(other.writes).toBe(0);
    });

    it("a peer's revision is adopted only from the revision the switched window holds", async () => {
      const { app, file } = await switchedToFile();
      const held = file.revision();
      file.foreignWrite(file.text() + " "); // the peer window's save
      const onRevision = vi.mocked(useRevisionSync).mock.calls.at(-1)![1];
      act(() => { onRevision(file.revision(), "not-what-this-window-holds"); });
      act(() => { onRevision(file.revision(), held); });
      await editAndSave(app, () => file.text().includes(EDIT));
      expect(app.conflicts()).toBe(0);
    });
  });

  it("loadProjectFromFile: the first save after opening the file is written, with no conflict", async () => {
    const file = fakeFile("opened.json", workspaceToJson(emptyWorkspace()));
    showOpenFilePicker.mockResolvedValue([file]);
    const app = renderApp({ kind: "browser" });
    await booted(app);
    await act(async () => { await app.ops().loadProjectFromFile(); });
    await settle();
    await editAndSave(app, () => file.text().includes(EDIT));
    expect(app.conflicts()).toBe(0);
    expect(file.text()).toContain(EDIT);
  });

  it("createProject: writes the new file blind, then saves the next edit into it", async () => {
    const file = fakeFile("new.json");
    showSaveFilePicker.mockResolvedValue(file);
    const app = renderApp({ kind: "browser" });
    await booted(app);
    await act(async () => { await app.ops().createProject({ name: "Fresh", code: "FR" } as never, "json"); });
    await settle();
    expect(file.text()).toContain("Fresh");
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "projectCreatedToast", "Fresh"));
    await editAndSave(app, () => file.text().includes(EDIT));
    expect(app.conflicts()).toBe(0);
  });

  it("createDemoProject: writes the demo blind, then saves the next edit into it", async () => {
    const demo: Workspace = { ...emptyWorkspace(), project: { name: "Demo", code: "DEMO" } as never, tasks: [{ id: 1, taskName: "Demo task" } as unknown as Task] };
    const app = renderApp({ kind: "local-json" });
    await settle();
    await act(async () => { await app.ops().createDemoProject(demo); });
    await settle();
    expect(await browserTasks()).toEqual(["Demo task"]);
    const before = app.conflicts();
    await editAndSave(app, async () => (await browserTasks()).includes(EDIT));
    expect(app.conflicts()).toBe(before);
  });

  it("onRequestStorageSwitch: converts into a never-loaded file, then saves the next edit into it", async () => {
    const file = fakeFile("converted.json");
    showSaveFilePicker.mockResolvedValue(file);
    const app = renderApp({ kind: "browser" });
    await booted(app);
    await act(async () => { await app.ops().onRequestStorageSwitch("local-json"); });
    await settle();
    expect(file.writes).toBe(1);
    expect(showToast).toHaveBeenCalledWith("info", t("en-US", "storageConvertedToast", t("en-US", "storageLocalJson")));
    await editAndSave(app, () => file.text().includes(EDIT));
    expect(app.conflicts()).toBe(0);
  });

  it("an ordinary pick of a file that cannot be READ is not bound or written, and says so", async () => {
    const current = fakeFile("current.json", workspaceToJson(emptyWorkspace()));
    KV.set("file-handle:local-json", current);
    const locked = fakeFile("locked.json", "", { unreadable: true });
    showSaveFilePicker.mockResolvedValue(locked);
    const app = renderApp({ kind: "local-json" });
    await booted(app);
    await act(async () => { await app.ops().onPickStorageFile(); });
    expect(KV.get("file-handle:local-json")).toBe(current); // not bound
    expect(locked.writes).toBe(0);
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "storageLoadFailed", String(new DOMException("The file is locked by another program.", "NotReadableError"))));
    expect(showToast).not.toHaveBeenCalledWith("error", expect.stringContaining(t("en-US", "storageSaveFailed", "")));
    await editAndSave(app, () => current.text().includes(EDIT)); // the app stays on the file it had
    expect(app.conflicts()).toBe(0);
  });
});
