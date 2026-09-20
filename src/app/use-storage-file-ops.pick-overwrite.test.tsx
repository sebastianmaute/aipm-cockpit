// open-followups §590 — "Pick storage file" must not overwrite a real project after a failed load.
//
// ★★★ THE DEFECT, which this file REPRODUCED before it pinned the fix: after a load has FAILED the
// live workspace is the empty boot one. `onPickStorageFile` (use-storage-file-ops.ts) then bound
// whatever file the user chose to the ACTIVE backend and wrote that empty workspace straight into
// it — so a user whose file handle or permission was lost, who reached for the picker and pointed it
// at their own project file, destroyed the project they were trying to recover. The probe below
// ("leaves the picked file's existing project intact") was red on the unfixed tree with
// `expected [] to have a length of 2 but got +0`.
//
// ★★★ WHY THIS HARNESS AND NOT THE ONE EVERY SIBLING USES. Every other `use-storage-backend.*`
// suite replaces the WHOLE `./storage` facade, which makes the picker a stub returning `null`:
// `onPickStorageFile` returns at `if (!promise) return;`, no `LocalFileBackend` is ever constructed,
// and the only thing a test can observe is whether a mock was called. The FILE, which is the entire
// subject of §590, does not exist in that harness. A cold audit of this task's originally-planned
// tests found five negative assertions that passed with the whole fix reverted, four of them
// traceable to exactly that fixture.
//
// So this file replaces almost nothing: the storage facade, `LocalFileBackend`, the JSON codec and
// the whole of `useStorageBackend` are REAL. Three things are doubled, and each is the ENVIRONMENT
// rather than the app — `window.showSaveFilePicker`, the `FsHandle` objects it hands back (views
// onto `DISK`, an in-memory Map standing in for the file system), and `idb`'s key-value store
// (`KV`). The observable is therefore the FILE'S BYTES, and a test that never reached the picker
// cannot satisfy it by accident.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Settings } from "./settings-types";
import type { FsHandle, StorageConfig } from "./storage";
import { jsonToWorkspace, StorageNotReadyError, workspaceToJson } from "./storage";
import type { Task } from "./types";
import { taskRec, ws } from "../test/workspace-records";

/** `LocalFileBackend` persists its picked handle through `idb`'s kv helpers, and a real IndexedDB
 *  cannot hold ours: every value is structured-cloned, and a stand-in `FsHandle` is an object of
 *  FUNCTIONS, so `fake-indexeddb` answers `DataCloneError`. (A browser's own
 *  `FileSystemFileHandle` IS serializable — this is a limit of the double, not of the app.) So the
 *  kv store alone is swapped for a Map; every other `idb` export stays real.
 *  ★ `DataCloneError` and `FileSystemFileHandle` are a DOM exception name and a browser interface,
 *  not repo symbols — `src:symbols:check` lists both as unresolved, correctly, and they stay.
 *  ★ It also makes the BIND directly observable: `KV` holding `file-handle:local-json` is exactly
 *  "the active backend now points at the picked file", which is §590's root — the old pick did that
 *  before anything could be read.
 *  ★★ `vi.hoisted` is required, not stylistic: `vi.mock` is hoisted above every import, so the
 *  factory would otherwise read `KV` before its `const` had run. */
const { KV } = vi.hoisted(() => ({ KV: new Map<string, unknown>() }));
vi.mock("./idb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idb")>()),
  idbGet: vi.fn(async (key: string) => KV.get(key)),
  idbSet: vi.fn(async (key: string, value: unknown) => { KV.set(key, value); }),
  idbDelete: vi.fn(async (key: string) => { KV.delete(key); }),
}));
// Cross-tab plumbing and the per-project handle store: neither is on any path this file exercises,
// and both reach for browser stores jsdom has no use for.
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}));

import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

/** The in-memory "disk": file name → its bytes. Every `FsHandle` below is a view onto one entry, so
 *  a write reaching the file system is observable here as a content change — the whole of §590. */
const DISK = new Map<string, string>();

/** The kv key `LocalFileBackend` binds its handle under (`file-handle:${kind}`). Derived from the
 *  KIND, not the instance — so it really is the ACTIVE slot. */
const HANDLE_KEY = "file-handle:local-json";

/** An `FsHandle` (see fs-access.ts) backed by `DISK`. Permission is always granted: this file is
 *  about what the app CHOOSES to write, never about the browser refusing it. */
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

const PICKED_FILE = "picked.json";
const LIVE_TASK = { ...taskRec(77, "New"), taskName: "The user's own work" } as Task;

/** The bytes of a file that ALREADY HOLDS a real project — two tasks, written by the app's own
 *  serializer so the app's own parser can read them back. */
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

/** What the picked file holds, what the user answers, what the app already holds, and whether the
 *  OS dialog is dismissed. Every test below varies exactly one of these. */
interface Scenario {
  /** Bytes already sitting in the file the user picks. `""` is what a browser leaves behind when the
   *  user types a NEW name — `showSaveFilePicker` creates the file. */
  fileBytes: string;
  /** The confirm answer, when the app asks. Tests that expect no question assert `confirmSpy` was
   *  never called, so this value is unreachable for them. */
  confirmAnswer?: boolean;
  /** Seeded into the LIVE workspace. Empty (the default) is the post-failed-load state §590 is
   *  about: the app holds nothing, so there is nothing to lose by loading the file instead. */
  liveTasks?: Task[];
  /** Dismiss the OS dialog — `pickSaveFile` PROPAGATES the picker's `AbortError`. */
  cancelPicker?: boolean;
  /** Fail the picker with something that is NOT a cancel. Takes precedence over `cancelPicker`. */
  pickerError?: unknown;
}

/** Held at module scope so `afterEach` can restore exactly this spy and nothing else. Typed by the
 *  one method that is needed here — `vi.spyOn<Window & typeof globalThis, "confirm">` does not
 *  typecheck against jsdom's Window keys, and the tests read the spy through `setupPick`'s return
 *  value, which keeps vitest's own inferred type. */
let confirmSpy: { mockRestore: () => void } | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  DISK.clear();
  KV.clear();
  localStorage.clear();
  (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;
});

afterEach(() => {
  // ★★ Restore the ONE spy, never `vi.restoreAllMocks()`. Restore resets a mock's IMPLEMENTATION,
  //   and the `./project-file-handles` and `./idb` factories above install theirs once at mock time
  //   — a blanket restore would silently hand the next test a `getHandle` that returns `undefined`
  //   instead of a promise, and an `idbSet` that stores nothing. (`vi.clearAllMocks()` in
  //   `beforeEach` is safe by contrast: it clears CALLS only.)
  confirmSpy?.mockRestore();
  confirmSpy = null;
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
});

/** The shared arrangement every `it` below runs, so they cannot drift apart — only the ASSERTION
 *  after it differs. The app boots on a `local-json` backend with NO handle bound, so its first load
 *  FAILS exactly as it does for a user whose handle or permission was lost; the user then opens the
 *  picker and chooses `PICKED_FILE`.
 *
 *  ★ Every precondition is ASSERTED, not assumed — "the file was not overwritten" and "the app did
 *  not ask" are both satisfied for free by a run that never reached the picker, or whose fixture was
 *  never parseable to begin with. */
async function setupPick(scenario: Scenario) {
  DISK.set(PICKED_FILE, scenario.fileBytes);

  if (scenario.pickerError !== undefined) {
    showSaveFilePicker.mockRejectedValue(scenario.pickerError);
  } else if (scenario.cancelPicker) {
    showSaveFilePicker.mockRejectedValue(new DOMException("The user aborted a request.", "AbortError"));
  } else {
    showSaveFilePicker.mockResolvedValue(handleFor(PICKED_FILE));
  }
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(scenario.confirmAnswer ?? false);
  confirmSpy = confirm;

  // ★★ ONE `args` object for the whole render lifetime, built OUTSIDE the render callback.
  //   `backend` is a `useMemo` keyed on `args.settings.storageConfig` IDENTITY, so calling
  //   `makeArgs()` inside the callback mints a fresh config every render, rebuilds the backend,
  //   re-runs the load effect and re-renders — an endless rebuild loop in which `loadPause` is
  //   permanently null (it is published only for an instance that is STILL the live one) and
  //   `loadPending` permanently true. Measured, not theorised: the first cut of this helper did
  //   exactly that, and its dump showed the "storageNotReady" toast firing dozens of times in 300 ms.
  const args = makeArgs({ kind: "local-json" } as StorageConfig);
  const { result } = renderHook(() => useProbe(args), {
    wrapper: ({ children }) => <TestProviders tasks={scenario.liveTasks ?? []}>{children}</TestProviders>,
  });

  // PRECONDITION 1 — the mount load really FAILED (no handle is bound yet), so the §586 save gate is
  // shut and nothing has re-pointed the backend. This is the state §590 is about; without it the
  // pick is an ordinary "save as" and there is nothing wrong with overwriting.
  await waitFor(() => expect(result.current.loadPause).toBe("load-failed"));
  expect(KV.has(HANDLE_KEY)).toBe(false);
  // PRECONDITION 2 — the app holds exactly what the scenario said, so both halves of the offer's
  // condition are set up deliberately rather than by accident.
  expect(result.current.tasks.map((x) => x.id)).toEqual((scenario.liveTasks ?? []).map((x) => x.id));

  showToast.mockClear();
  await act(async () => { await result.current.onPickStorageFile(); });

  // PRECONDITION 3 — the scenario RAN. The op reached the OS picker rather than returning early, so
  // every negative assertion below is about a real decision.
  expect(showSaveFilePicker).toHaveBeenCalledTimes(1);

  return { result, confirmSpy: confirm };
}

/** The tasks currently in the picked file, read back through the app's own parser. */
function tasksInFile(): readonly Task[] {
  return jsonToWorkspace(DISK.get(PICKED_FILE) as string).tasks;
}

const POPULATED = () => ({ fileBytes: populatedProjectBytes() });

describe("§590 — the picked file already holds a project and the app is empty", () => {
  // ★ THE PROBE, and the one assertion this task exists for. RED on the unfixed tree with
  //   `expected [] to have a length of 2 but got +0`.
  //   KILLED BY: deleting the offer block (mutation-measured).
  //   ★★ NOT killed by ignoring `window.confirm`'s ANSWER (`window.confirm(...)` with the
  //   `if (!…) return` dropped) — predicted as a killer and measured as a survivor. Treating a
  //   decline as an accept takes the LOAD branch, and loading does not write, so the file survives
  //   either way. The test that dies there is "binds nothing when the user declines". Recorded
  //   because a mutant predicted-and-not-run is how a test's evidence gets overstated.
  it("leaves the picked file's existing project intact", async () => {
    await setupPick({ ...POPULATED(), confirmAnswer: false });
    expect(tasksInFile()).toHaveLength(2);
  });

  // ★ THE OFFER ITSELF — the positive observable that the new branch was ENTERED, rather than the
  //   file merely surviving for some other reason. Asserted on the real message, so a branch that
  //   fired with the wrong file or an unrelated prompt does not pass.
  //   KILLED BY: disabling the offer block (the confirm is then never called); and
  //   `authoredRecordCount` → `workspaceRecordCount` inside `readPickedProject`, which makes the
  //   message name 13 records instead of 3. Both measured.
  //   ★★ AN EARLIER REVISION OF THIS LINE NAMED A MUTANT AGAINST AN `isWorkspaceEmpty` CONJUNCT THE
  //   SHIPPED CONDITION DOES NOT CONTAIN. That is worse than a vague recipe: the obvious way to
  //   "make the recipe work" is to reintroduce the very predicate that counts auto-seeded reference
  //   data — see `authoredRecordCount`'s docstring — which breaks the sibling test below.
  it("asks before overwriting, naming the file and what it holds", async () => {
    const { confirmSpy } = await setupPick({ ...POPULATED(), confirmAnswer: false });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // ★★ THREE, not two, and the discrepancy is the fixture telling the truth: decoding the file
    //   runs the migration chain, which derives a `resources` row from the two tasks' assignee
    //   string (`migrateWorkspaceV5`). 2 tasks + 1 resource = 3 authored records. The 4 disciplines
    //   and 6 grades the same chain seeds are NOT counted — that is the whole reason
    //   `authoredRecordCount` exists rather than `workspaceRecordCount`, which reports 13 here.
    expect(confirmSpy).toHaveBeenCalledWith(t("en-US", "storagePickFileHasProject", PICKED_FILE, 3));
  });

  // ★★★ THE §590 ROOT, stated directly. The OLD pick `idbSet` the handle onto the ACTIVE backend
  //   BEFORE the caller could ask anything — so a decline still left the app pointed at the user's
  //   project file, and the next debounced save would have finished the job the refused write
  //   started. Commit-on-accept means a decline leaves nothing to undo.
  //   KILLED BY: moving `setBackendFileHandle` above the offer; restoring `pickFileForBackend` here.
  it("binds nothing when the user declines", async () => {
    await setupPick({ ...POPULATED(), confirmAnswer: false });
    expect(KV.has(HANDLE_KEY)).toBe(false);
  });

  // ★ THE ACCEPT BRANCH. Three separate things have to happen and each is its own `it` below; this
  //   one is the data: the file's project is what the app now holds.
  //   KILLED BY: deleting `deps.applyPickedWorkspace(existing.workspace)`.
  it("loads the file's project into the app when the user accepts", async () => {
    const { result } = await setupPick({ ...POPULATED(), confirmAnswer: true });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
  });

  // ★ …and the file is still the file — accepting LOADS, it does not write back.
  //   KILLED BY: falling through to the `guardedWrite` branch after an accept (dropping the `return`
  //   at the end of the offer block).
  it("writes nothing back to the file when the user accepts", async () => {
    await setupPick({ ...POPULATED(), confirmAnswer: true });
    expect(tasksInFile()).toHaveLength(2);
  });

  // ★ …and the accept is what finally binds the handle AND re-opens the §586 save gate, so the next
  //   edit is persisted. `loadPause` turning null is that gate observed passing something through
  //   rather than a value read off it — `applyWorkspaceForOp` ends in `allowSavesTo(backend)`.
  //   KILLED BY: deleting `await setBackendFileHandle(deps.backend, picked)` from the accept branch
  //   (binding half); deleting `deps.applyPickedWorkspace(...)` (gate half).
  it("commits the pick and re-opens the save gate when the user accepts", async () => {
    const { result } = await setupPick({ ...POPULATED(), confirmAnswer: true });
    expect(KV.get(HANDLE_KEY)).toMatchObject({ name: PICKED_FILE });
    await waitFor(() => expect(result.current.loadPause).toBeNull());
  });
});

describe("§590 — the cases that must NOT be interrupted", () => {
  // ★ Review Focus item 3, first half. `showSaveFilePicker` CREATES the file when the user types a
  //   new name, so a zero-byte file is the COMMON path for a first-time local user, not an edge
  //   case — and Pick is the only way such a user can create a file at all. Offering to "load" that
  //   nothing would strand them.
  //   ★★ The observable is that the file gained a parseable workspace, NOT that it "changed": the
  //   live workspace is empty here too, so the bytes written are the empty workspace. `""` and
  //   `workspaceToJson(empty)` are both "no tasks", which is why the assertion is on the write
  //   HAPPENING (`DISK` now parses) rather than on a task count that reads 0 either way.
  //   KILLED BY: `existing.records > 0` → `existing.records >= 0` (measured).
  it("writes normally, without asking, when the picked file is empty", async () => {
    const { confirmSpy } = await setupPick({ fileBytes: "" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(DISK.get(PICKED_FILE)).not.toBe("");
    expect(tasksInFile()).toHaveLength(0); // it parses — i.e. the app wrote a workspace here
    expect(KV.has(HANDLE_KEY)).toBe(true);
  });

  // ★ Review Focus item 3, second half: a throw and a zero-record parse are both "not a project".
  //   KILLED BY: deleting `readPickedProject`'s `try`/`catch` (the parse error then escapes to the
  //   op's own catch, the write never happens and the file keeps its junk).
  it("writes normally, without asking, when the picked file is unparseable", async () => {
    const junk = "this is not a workspace at all {{{";
    const { confirmSpy } = await setupPick({ fileBytes: junk });
    expect(confirmSpy).not.toHaveBeenCalled();
    // ★★ ON THE BYTES, not on `tasksInFile()`. Mutation-measured: with `readPickedProject`'s
    //   `catch` deleted the write never happens and the junk stays on disk — yet a task-count
    //   assertion still reads 0, because `jsonToWorkspace` is LENIENT outside `{strict:true}` and
    //   turns junk into an empty workspace rather than throwing. The only thing that separates
    //   "wrote" from "did not write" here is the file no longer being what it was.
    expect(DISK.get(PICKED_FILE)).not.toBe(junk);
    expect(tasksInFile()).toHaveLength(0);
    expect(KV.has(HANDLE_KEY)).toBe(true);
  });

  // ★★★ THE CASE THAT BROKE THE FIRST CUT, and the most likely repeat in real use: the user's load
  //   failed, they picked a NEW file, the app wrote its empty workspace into it — and later, after
  //   another failed load, they pick that same file again. Its bytes are a VALID workspace holding
  //   nothing, but decoding it runs the migration chain, which seeds 4 disciplines and 6 grades. On
  //   `isWorkspaceEmpty` (and on `workspaceRecordCount`) that reads as "already holds a project with
  //   10 records" and the offer fired over nothing. `authoredRecordCount` subtracts the reference
  //   trio, so it reads 0.
  //   KILLED BY: `authoredRecordCount` → `workspaceRecordCount` in `readPickedProject`; and
  //   `existing.records > 0` → `>= 0`. Both measured. ★ It is ALSO what would go red if the decode
  //   chain ever started seeding `roles` as well — `authoredRecordCount` deliberately does NOT
  //   subtract that one, because the measurement says it is not seeded.
  it("writes normally, without asking, when the picked file holds only seeded reference data", async () => {
    const { confirmSpy } = await setupPick({ fileBytes: workspaceToJson(ws({})) });
    expect(confirmSpy).not.toHaveBeenCalled();
    // ★ No byte assertion here, unlike its two siblings, and deliberately: the file's bytes and the
    //   bytes the app writes over them are both "a workspace with no records", so they may be equal
    //   and a `not.toBe` would be testing the serializer's whitespace. The bind is the write's
    //   witness on this one, and `confirmSpy` above is what the test is actually about.
    expect(KV.has(HANDLE_KEY)).toBe(true);
  });

  // ★★★ THE SECOND CONJUNCT, and it is not implied by the first. The picked file holds a project
  //   AND so does the app — that is an ordinary "save as" over an old file, and the user's own work
  //   is what must win. Offering to LOAD here would be the destructive answer: it would replace the
  //   work they are trying to save.
  //   KILLED BY: dropping `authoredRecordCount(deps.currentWorkspace()) === 0` from the condition
  //   (measured).
  it("overwrites without asking when the app holds the user's own project", async () => {
    const { confirmSpy } = await setupPick({ ...POPULATED(), liveTasks: [LIVE_TASK] });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(tasksInFile().map((x) => x.id)).toEqual([77]);
  });
});

describe("§588 — the two windows §590 changed", () => {
  // ★★★ GUARD 1'S ONLY REMAINING UNIQUE EFFECT, and the reason this test had to be written: §590
  //   put guard 2 ABOVE `guardedWrite`, which is where all three hazards guard 1's own comment
  //   claims for itself live (the wrong-target write, the spent one-shot, the refusal toast). So
  //   guard 2 now subsumes every one of them, and guard 1 disabled ALONE leaves this file and
  //   use-storage-backend.superseded-gate.test.tsx at 23/23 GREEN — measured, and the reason the
  //   comment in use-storage-file-ops.ts no longer claims a kill it cannot produce.
  //   What guard 1 still uniquely prevents is the READ: `loadFromHandleForBackend` against an
  //   instance nobody is on, which spends a file read on a dead backend and resets and republishes
  //   ITS import diagnostics (`resetLoadDiagnostics` plus the `finally` in
  //   `LocalFileBackend.loadFrom`). Harmless today, because nothing on this path calls
  //   `truncationOps.reportFor`. That is the whole of its remaining value, and it is worth a line
  //   of code — but it must be SAID, not implied by a comment describing hazards a sibling covers.
  //   KILLED BY: deleting the `stage: "picker"` guard (`readStarted` is then called once).
  it("does not even read the picked file when a rebuild lands while the picker is open", async () => {
    DISK.set(PICKED_FILE, populatedProjectBytes());
    let releasePicker: (handle: FsHandle) => void = () => {};
    const readStarted = vi.fn();
    showSaveFilePicker.mockImplementation(() => new Promise<FsHandle>((resolve) => { releasePicker = resolve; }));
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { result, rerender } = renderHook(
      (props: { args: Parameters<typeof useStorageBackend>[0] }) => useProbe(props.args),
      {
        wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
        initialProps: { args: makeArgs({ kind: "local-json" } as StorageConfig) },
      },
    );
    await waitFor(() => expect(result.current.loadPause).toBe("load-failed"));

    let pick!: Promise<void>;
    act(() => { pick = result.current.onPickStorageFile(); });
    // ★ PRECONDITION, ASSERTED: the op is parked ON the OS dialog, not returned early. Without this
    //   "the file was never read" passes for an op that never started.
    await waitFor(() => expect(showSaveFilePicker).toHaveBeenCalledTimes(1));

    rerender({ args: makeArgs({ kind: "browser" } as StorageConfig) });
    await act(async () => {
      releasePicker({
        ...handleFor(PICKED_FILE),
        getFile: async () => {
          readStarted();
          return ({ text: async () => DISK.get(PICKED_FILE) ?? "" }) as unknown as File;
        },
      });
      await pick;
    });

    expect(readStarted).not.toHaveBeenCalled(); // ★ the discriminating one — guard 2 cannot produce it
    expect(KV.has(HANDLE_KEY)).toBe(false);
    expect(tasksInFile()).toHaveLength(2);
  });

  // ★★★ READING THE PICKED FILE IS A NEW AWAIT, so guard 1 (after the picker) can no longer see as
  //   far as the first commit and a third guard was added between them. This is that guard's own
  //   window: a settings-driven rebuild lands while the file is being read, and the op resumes
  //   holding a backend nobody is on. Without it the op would bind the handle into the ACTIVE
  //   `file-handle:local-json` slot and `guardedWrite` the empty workspace to the dead
  //   `LocalFileBackend` — i.e. it would destroy the picked file's project, which is §590's own
  //   damage reached through §588's door.
  //   ★ It lives HERE rather than in use-storage-backend.superseded-gate.test.tsx, which pins guards
  //   1 and 3: that file replaces the whole `./storage` facade, so there is no file read to pause.
  //   ★★ THE PICKED FILE IS EMPTY ON PURPOSE, so the op takes the WRITE branch — which is the hazard
  //   guard 2 exists for. With a POPULATED file the op takes the offer branch instead, and a decline
  //   commits nothing whether the guard is there or not, so the mutant survives and the test proves
  //   nothing. Measured, not assumed: that was this test's first arrangement.
  //   KILLED BY: deleting the `stage: "read"` guard.
  it("drops the pick when a rebuild lands while the picked file is being read", async () => {
    DISK.set(PICKED_FILE, "");
    let releaseRead: () => void = () => {};
    const readStarted = vi.fn();
    const paused = new Promise<void>((resolve) => { releaseRead = resolve; });
    showSaveFilePicker.mockResolvedValue({
      ...handleFor(PICKED_FILE),
      getFile: async () => {
        readStarted();
        await paused;
        return ({ text: async () => DISK.get(PICKED_FILE) ?? "" }) as unknown as File;
      },
    });
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { result, rerender } = renderHook(
      (props: { args: Parameters<typeof useStorageBackend>[0] }) => useProbe(props.args),
      {
        wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
        initialProps: { args: makeArgs({ kind: "local-json" } as StorageConfig) },
      },
    );
    await waitFor(() => expect(result.current.loadPause).toBe("load-failed"));

    let pick!: Promise<void>;
    act(() => { pick = result.current.onPickStorageFile(); });
    // ★ PRECONDITION, ASSERTED: the op is parked INSIDE the read, i.e. it got past the picker AND
    //   past guard 1. Without this the test would pass on an op that returned at guard 1 — which is
    //   a different guard's window and would make this test silently vacuous.
    await waitFor(() => expect(readStarted).toHaveBeenCalledTimes(1));

    rerender({ args: makeArgs({ kind: "browser" } as StorageConfig) });
    await act(async () => { releaseRead(); await pick; });

    expect(KV.has(HANDLE_KEY)).toBe(false); // nothing bound on the backend the user has left…
    expect(DISK.get(PICKED_FILE)).toBe(""); // …and nothing written through it
  });
});

describe("§590 — the dismissed OS dialog", () => {
  // ★★★ Review Focus item 2, and the most common path through this code by a wide margin. Before
  //   §590 `await promise` sat OUTSIDE the try, so the picker's `AbortError` escaped
  //   `onPickStorageFile` entirely and rejected the promise the click handler returned. These three
  //   `it`s are over one arrangement because an `expect` that throws stops the ones after it.
  //   KILLED BY: deleting the `try`/`catch` around `await promise` (the call then rejects and every
  //   one of the three fails inside the helper, before its own assertion is reached).
  it("does not reject the caller when the user dismisses the picker", async () => {
    await setupPick({ ...POPULATED(), cancelPicker: true });
    // Reaching here at all IS the assertion: `setupPick` awaits `onPickStorageFile()`, so an escaping
    // AbortError fails the test before this line. Restated positively so nobody deletes it as empty.
    expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
  });

  it("leaves the file untouched when the user dismisses the picker", async () => {
    await setupPick({ ...POPULATED(), cancelPicker: true });
    expect(tasksInFile()).toHaveLength(2);
    expect(KV.has(HANDLE_KEY)).toBe(false);
  });

  // ★ A dismissed dialog is not a failure, so nothing may be announced — least of all
  //   `storageSaveFailed`, which would describe a write that never started.
  it("says nothing when the user dismisses the picker", async () => {
    const { confirmSpy } = await setupPick({ ...POPULATED(), cancelPicker: true });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  // ★★★ THE OTHER SIDE OF THAT CATCH, and its sibling above is why it needs its own test: the two
  //   are the same `catch` reached by two different errors, and an over-broad "return silently"
  //   satisfies the abort tests while silencing a real failure. `pickSaveFile` throws
  //   `StorageNotReadyError` when the File System Access API is absent. That is NOT reachable
  //   through the button today — storage-config.tsx renders a notice instead of the control when
  //   `isFileSystemAccessSupported()` is false — so this pins a deliberate choice rather than a
  //   live path: a silent return on an explicit click is what `refuseWrite`'s landmine forbids, and
  //   an unreachable path that goes quiet stays quiet once it becomes reachable.
  //   KILLED BY: returning unconditionally from that `catch` (the pre-§590 shape).
  it("speaks when the picker fails for a reason that is not a cancel", async () => {
    const { confirmSpy } = await setupPick({
      ...POPULATED(),
      pickerError: new StorageNotReadyError("file-system-access-unsupported"),
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", t("en-US", "storageNotReady"));
    // …and it is NOT reported as a failed save, because no write was started.
    expect(showToast).not.toHaveBeenCalledWith("error", expect.stringContaining("Couldn't save"));
    expect(KV.has(HANDLE_KEY)).toBe(false);
    expect(tasksInFile()).toHaveLength(2);
  });
});
