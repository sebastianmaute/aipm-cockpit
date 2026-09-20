// Probe for open-followups §590 — filed from reading code, never reproduced.
//
// ★★★ THE CLAIM: after a load has FAILED, the live workspace is the empty boot one. "Pick storage
// file" (`onPickStorageFile`, use-storage-file-ops.ts) then binds whatever file the user chooses to
// the ACTIVE backend and writes that empty workspace straight into it — so a user whose file handle
// or permission was lost, who reaches for the picker and points it at their own project file,
// destroys the project they were trying to recover.
//
// ★★★ WHY THIS HARNESS AND NOT THE ONE EVERY SIBLING USES. Every other `use-storage-backend.*`
// suite does `vi.mock("./storage")`, which replaces the WHOLE facade — `pickFileForBackend` becomes
// a stub returning `null`, `onPickStorageFile` returns at `if (!promise) return;`, and no
// `LocalFileBackend` is ever constructed. In that harness the only thing a test can observe is
// whether a mock was called; the FILE, which is the entire subject of §590, does not exist. A cold
// audit of this task's originally-planned tests found five negative assertions that passed with the
// whole fix reverted, four of them traceable to exactly that fixture.
//
// So this file mocks almost nothing: the storage facade, `LocalFileBackend`, the JSON codec and the
// whole of `useStorageBackend` are REAL. Three things are doubled, and each of them is the
// environment rather than the app — `window.showSaveFilePicker`, the `FsHandle` objects it hands
// back (views onto `DISK`, an in-memory Map standing in for the file system), and `idb`'s key-value
// store (`KV`). The observable is therefore the FILE'S BYTES, and a test that never reached the
// picker cannot satisfy it by accident.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { FsHandle, StorageConfig } from "./storage";
import { jsonToWorkspace, workspaceToJson } from "./storage";
import { taskRec, ws } from "../test/workspace-records";

/** `LocalFileBackend` persists its picked handle through `idb`'s kv helpers, and
 *  a real IndexedDB cannot hold ours: every value is structured-cloned, and a
 *  stand-in `FsHandle` is an object of FUNCTIONS, so `fake-indexeddb` answers
 *  `DataCloneError`. (A browser's own `FileSystemFileHandle` IS serializable —
 *  this is a limit of the double, not of the app.) So the kv store alone is
 *  swapped for a Map; every other `idb` export stays real.
 *  ★ It also makes the BIND directly observable: `KV` holding
 *  `file-handle:local-json` is exactly "the active backend now points at the
 *  picked file", which is the §590 root.
 *  ★★ `vi.hoisted` is required, not stylistic — `vi.mock` is hoisted above every
 *  import, and the factory would otherwise read `KV` before its `const` ran. */
const { KV } = vi.hoisted(() => ({ KV: new Map<string, unknown>() }));
vi.mock("./idb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idb")>()),
  idbGet: vi.fn(async (key: string) => KV.get(key)),
  idbSet: vi.fn(async (key: string, value: unknown) => { KV.set(key, value); }),
  idbDelete: vi.fn(async (key: string) => { KV.delete(key); }),
}));
// Cross-tab plumbing and the per-project handle store: neither is on any path
// this file exercises, and both open real browser stores jsdom has no use for.
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}));

import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

/** The in-memory "disk": file name → its bytes. Every `FsHandle` below is a view
 *  onto one entry, so a write reaching the file system is observable here as a
 *  content change — which is the whole of §590. */
const DISK = new Map<string, string>();

/** The kv key `LocalFileBackend` binds its handle under (`file-handle:${kind}`).
 *  Derived from the KIND, not the instance — so it really is the ACTIVE slot. */
const HANDLE_KEY = "file-handle:local-json";

/** An `FsHandle` (see fs-access.ts) backed by `DISK`. Permission is always
 *  granted: this file is about what the app CHOOSES to write, never about the
 *  browser refusing it. */
function handleFor(name: string): FsHandle {
  return {
    name,
    queryPermission: async () => "granted" as PermissionState,
    requestPermission: async () => "granted" as PermissionState,
    getFile: async () => ({ text: async () => DISK.get(name) ?? "" }) as unknown as File,
    createWritable: async () => ({
      write: async (data: string | Blob) => { DISK.set(name, String(data)); },
      close: async () => {},
    }),
  };
}

const showSaveFilePicker = vi.fn<() => Promise<FsHandle>>();
const showToast = vi.fn();
const showToastAction = vi.fn();

const PROJECT_FILE = "existing-project.json";

/** The bytes of a file that ALREADY HOLDS a real project — two tasks, written by
 *  the app's own serializer so the app's own parser can read them back. */
function populatedProjectBytes(): string {
  return workspaceToJson(ws({ tasks: [taskRec(1, "Old"), taskRec(2, "Old")] }));
}

function makeArgs(storageConfig: StorageConfig): Parameters<typeof useStorageBackend>[0] {
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
  const { tasks } = useWorkspace();
  return { ...hook, tasks };
}

beforeEach(() => {
  vi.clearAllMocks();
  DISK.clear();
  KV.clear();
  localStorage.clear();
  (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;
});

afterEach(() => {
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
});

/** The shared arrangement: a real project sits in `PROJECT_FILE`; the app boots
 *  on a `local-json` backend with NO handle bound, so its first load FAILS
 *  exactly as it does for a user whose handle or permission was lost; the user
 *  then opens the picker and chooses that same project file.
 *
 *  ★ Every precondition is ASSERTED, not assumed — "the file was not
 *  overwritten" is satisfied for free by a run that never reached the picker, or
 *  whose fixture was never parseable to begin with. */
async function setupPickOntoPopulatedFile() {
  DISK.set(PROJECT_FILE, populatedProjectBytes());
  // PRECONDITION 1 — the bytes really are a project THIS APP can read. Without
  // this the probe could pass because the fixture was junk.
  expect(jsonToWorkspace(DISK.get(PROJECT_FILE) as string).tasks).toHaveLength(2);

  showSaveFilePicker.mockResolvedValue(handleFor(PROJECT_FILE));

  // ★★ ONE `args` object for the whole render lifetime, built OUTSIDE the render
  //   callback. `backend` is a `useMemo` keyed on `args.settings.storageConfig`
  //   IDENTITY, so calling `makeArgs()` inside the callback mints a fresh config
  //   every render, rebuilds the backend, re-runs the load effect and re-renders
  //   — an endless rebuild loop in which `loadPause` is permanently null (it is
  //   published only for an instance that is STILL the live one) and
  //   `loadPending` permanently true. Measured, not theorised: the first cut of
  //   this helper did exactly that, and its dump showed the "storageNotReady"
  //   toast firing dozens of times inside 300 ms.
  const args = makeArgs({ kind: "local-json" } as StorageConfig);
  const { result } = renderHook(() => useProbe(args), {
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });

  // PRECONDITION 2 — the mount load really FAILED (no handle is bound yet), so
  // the §586 save gate is shut and the live workspace is the empty boot one.
  // This is the state §590 is about; without it the pick is an ordinary
  // "save as" and there is nothing wrong with overwriting.
  await waitFor(() => expect(result.current.loadPause).toBe("load-failed"));
  expect(result.current.tasks).toHaveLength(0);
  expect(KV.has(HANDLE_KEY)).toBe(false);

  await act(async () => { await result.current.onPickStorageFile(); });

  // PRECONDITION 3 — the scenario RAN. The op reached the OS picker rather than
  // returning early, so every assertion below is about a real decision.
  expect(showSaveFilePicker).toHaveBeenCalledTimes(1);

  return { result };
}

describe("§590 — Pick storage file must not overwrite a project after a failed load", () => {
  // ★ THE PROBE. RED against today's tree: `pickFileForBackend` binds the picked
  // handle to the active backend and `guardedWrite` then saves the live (empty)
  // workspace into it, so both tasks are gone. The fix reads the file first and
  // commits nothing until the user has said to.
  it("leaves the picked file's existing project intact", async () => {
    await setupPickOntoPopulatedFile();
    expect(jsonToWorkspace(DISK.get(PROJECT_FILE) as string).tasks).toHaveLength(2);
  });
});
