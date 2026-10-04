// §629 — the unload journal's RESTORE on load (use-unload-journal.ts `restoreOnLoad` and
// its conflict pair, plus the thin calls in use-storage-backend.ts's load effect). The
// write and clear halves are tested in use-unload-journal.test.tsx.
//
// Two layers:
//   1. `useStorageBackend` with a fake backend — the spec's Restore branches but "No
//      journal" (every other storage-hook suite loads without one): match, mismatch
//      (+ Restore anyway, + Discard), a journal that already landed, each conflict
//      action once this tab has overwritten or cleared the key, each incomplete-load cause, a
//      failed load, an empty-load refusal, another project's journal, and a popout.
//   2. `useUnloadJournal` on its own — ruling R7 (a held op base nulls the live one).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t, type Lang, type TranslationKey } from "./i18n";
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

import * as storageMod from "./storage";
import { TestProviders } from "./test-providers";
import { fingerprintWorkspace, UNLOAD_JOURNAL_PREFIX, type UnloadJournal } from "./unload-journal";
import { useStorageBackend } from "./use-storage-backend";
import { UNLOAD_JOURNAL_TAB_ID, useUnloadJournal } from "./use-unload-journal";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { isMassDeletion, workspaceRecordCount } from "./workspace-metrics";
import { useWorkspace } from "./workspace-context";
import { useBroadcastSync, type SyncContext } from "./broadcast-sync";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;

// No registry entry and kind "browser" → projectKey "browser".
const JOURNAL_KEY = `${UNLOAD_JOURNAL_PREFIX}browser`;

const STORED = { tasks: [{ id: 1, taskName: "Stored" } as unknown as Task], raid: [], absences: [], shifts: [] };
const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };
const JOURNALED: Workspace = { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "Stored" }, { id: 2, taskName: "Unsaved" }] as unknown as Task[] };

type Settle = { resolve: () => void; reject: (err: unknown) => void };
type LoadReport = { lastLoadTruncation?: { entries: number; blocks: number }; lastDecodeFailures?: readonly string[]; lastImportMalformedQuotes?: number };

/** A backend whose load lands after `loadMs`, reporting `report` about that load, and whose
 *  saves stay pending until the test settles them through `saves`. */
function makeBackend(loadMs: number, loadOutcome: "resolve" | "reject" = "resolve", stored: object = STORED, report: LoadReport = {}) {
  const saves: Settle[] = [];
  return {
    saves,
    kind: "browser",
    ...report,
    load: vi.fn(() => new Promise((resolve, reject) => {
      setTimeout(() => (loadOutcome === "resolve" ? resolve(stored) : reject(new Error("load boom"))), loadMs);
    })),
    save: vi.fn(() => new Promise<void>((resolve, reject) => { saves.push({ resolve, reject }); })),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

const showToast = vi.fn();

function makeArgs(isPopout = false, storageConfig: StorageConfig = { kind: "browser" }): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout,
    showToast,
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

const EARLIER_TAB = "an-earlier-page";
const EARLIER_SAVED_AT = 1_000;

/** Seeds a journal as an earlier page load would have left it. */
function seedJournal(baseFingerprint: string, key = JOURNAL_KEY, projectKey = "browser", workspace: Workspace = JOURNALED): UnloadJournal {
  const rec: UnloadJournal = { v: 1, projectKey, tabId: EARLIER_TAB, savedAt: EARLIER_SAVED_AT, baseFingerprint, workspace: workspaceToJson(workspace) };
  localStorage.setItem(key, JSON.stringify(rec));
  return rec;
}

function readJournal(key = JOURNAL_KEY): UnloadJournal | null {
  const raw = localStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as UnloadJournal);
}

function savedTaskIds(backend: ReturnType<typeof makeBackend>, call: number): number[] {
  return (backend.save.mock.calls[call] as unknown as [Workspace])[0].tasks.map((x) => x.id as number);
}

const matchingBase = () => fingerprintWorkspace(STORED as unknown as Workspace);
const restoredToast = () => showToast.mock.calls.filter((c) => c[1] === t("en-US", "unloadJournalRestored"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: 5_000_000 });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("§629 — the load effect restores the unload journal", () => {
  it("match: the journal is applied, toasted, SAVED (not suppressed), and cleared when that save confirms (R3)", async () => {
    seedJournal(matchingBase());
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(200);

    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(restoredToast()).toHaveLength(1);
    expect(result.current.unloadJournalConflict).toBe(false);
    // R3 — re-tagged to THIS page load, savedAt kept.
    expect(readJournal()).toMatchObject({ tabId: UNLOAD_JOURNAL_TAB_ID, savedAt: EARLIER_SAVED_AT });

    await advance(600); // the debounce: the restored workspace goes out through the normal path
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(savedTaskIds(backend, 0)).toEqual([1, 2]);

    await act(async () => { backend.saves[0].resolve(); });
    await advance(0);
    expect(readJournal()).toBeNull();
  });

  it("R3 — restore, the save-back confirms, and the key is gone (the confirmation alone clears it)", async () => {
    seedJournal(matchingBase());
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    render();
    await advance(800);
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(readJournal()).not.toBeNull(); // still there while the save-back is in flight

    await act(async () => { backend.saves[0].resolve(); });
    await advance(0);
    expect(readJournal()).toBeNull();
  });

  it("match: the restored workspace meets the destructive guard, measured against what the backend RETURNED", async () => {
    const many = { ...STORED, tasks: Array.from({ length: 400 }, (_, i) => ({ id: i + 1, taskName: `T${i}` })) as unknown as Task[] };
    seedJournal(fingerprintWorkspace(many as unknown as Workspace)); // JOURNALED holds 2 of those 400
    // The precondition, measured rather than assumed: decoding seeds reference lists into the journal.
    expect(isMassDeletion(workspaceRecordCount(many as unknown as Workspace), workspaceRecordCount(jsonToWorkspace(workspaceToJson(JOURNALED))))).toBe(true);
    const backend = makeBackend(100, "resolve", many);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(200);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);

    await advance(600);
    expect(backend.save).not.toHaveBeenCalled(); // a mass deletion: refused, not written
    expect(result.current.destructiveRefusal).not.toBeNull();
  });

  // §629 — the LOOP this guards: a restored journal the guard refuses is
  // re-tagged to this tab and never written, so a PAGE reload restores it and is
  // refused again. The banner's "Discard this deletion" runs reloadCurrentProject,
  // whose `dropUnconfirmed` must remove that record: the next page load then
  // restores nothing and nothing is refused.
  it("refused restore → Reload project (the banner's Discard) removes the journal: the next page load restores nothing", async () => {
    const many = { ...STORED, tasks: Array.from({ length: 400 }, (_, i) => ({ id: i + 1, taskName: `T${i}` })) as unknown as Task[] };
    seedJournal(fingerprintWorkspace(many as unknown as Workspace));
    const backend = makeBackend(100, "resolve", many);
    createBackendMock.mockReturnValue(backend);
    const first = render();
    await advance(800);
    // The premise: restored, refused, and the journal still there to loop on.
    expect(first.result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(first.result.current.destructiveRefusal).not.toBeNull();
    expect(readJournal()).not.toBeNull();

    let reload: Promise<void> | undefined;
    act(() => { reload = first.result.current.reloadCurrentProject(); });
    await advance(200);
    await act(async () => { await reload; });
    expect(first.result.current.tasks).toHaveLength(400);
    expect(first.result.current.destructiveRefusal).toBeNull();
    expect(readJournal()).toBeNull();
    first.unmount();
    showToast.mockClear(); // the first page's restore toast is the premise, not the result

    const next = makeBackend(100, "resolve", many);
    createBackendMock.mockReturnValue(next);
    const { result } = render();
    await advance(800);
    expect(result.current.tasks).toHaveLength(400);
    expect(restoredToast()).toHaveLength(0);
    expect(result.current.destructiveRefusal).toBeNull();
  });

  it("mismatch: the loaded workspace applies as today, the journal is kept untouched, and the notice is published", async () => {
    const seeded = seedJournal("changed-elsewhere");
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);

    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal()).toEqual(seeded);
    expect(result.current.unloadJournalConflict).toBe(true);
    expect(restoredToast()).toHaveLength(0);
    expect(backend.save).not.toHaveBeenCalled(); // the load's own save is suppressed, as today
  });

  it("mismatch → Restore anyway: the journal is applied, saved, and cleared when that save confirms", async () => {
    seedJournal("changed-elsewhere");
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);

    await act(async () => { result.current.restoreUnloadJournalAnyway(); });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(readJournal()).toMatchObject({ tabId: UNLOAD_JOURNAL_TAB_ID, savedAt: EARLIER_SAVED_AT });

    await advance(600);
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(savedTaskIds(backend, 0)).toEqual([1, 2]);
    await act(async () => { backend.saves[0].resolve(); });
    await advance(0);
    expect(readJournal()).toBeNull();
  });

  it("mismatch → Discard: the key is removed, the notice goes, and the loaded workspace stays", async () => {
    seedJournal("changed-elsewhere");
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);

    await act(async () => { result.current.discardUnloadJournal(); });
    expect(readJournal()).toBeNull();
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
  });

  it("a journal that already LANDED (its content is what loaded, its base is not): cleared silently — no notice, no toast", async () => {
    seedJournal("changed-elsewhere", JOURNAL_KEY, "browser", STORED as unknown as Workspace);
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);

    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal()).toBeNull();
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(restoredToast()).toHaveLength(0);
    expect(backend.save).not.toHaveBeenCalled(); // nothing extra applied, so nothing to write back
  });

  it("a landed journal whose base ALSO matches is cleared silently too — the content check comes first", async () => {
    seedJournal(matchingBase(), JOURNAL_KEY, "browser", STORED as unknown as Workspace);
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);

    expect(readJournal()).toBeNull();
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(restoredToast()).toHaveLength(0);
    expect(backend.save).not.toHaveBeenCalled();
  });

  /** Raises the conflict, then this tab, hidden, saves: `noteSaveStarted` writes its own record
   *  over the conflicting one. With `confirm`, that save's confirmation then clears the key. Ends
   *  with a visible edit whose save is not yet due, so an apply would be observable. */
  async function conflictThenThisTabsWrite(confirm: boolean) {
    seedJournal("changed-elsewhere");
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const hook = render();
    await advance(800);
    expect(hook.result.current.unloadJournalConflict).toBe(true);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      act(() => { hook.result.current.setTasks([{ id: 1, taskName: "Stored" }, { id: 3, taskName: "Later" }] as unknown as Task[]); });
      await advance(600);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(readJournal()).toMatchObject({ tabId: UNLOAD_JOURNAL_TAB_ID }); // the premise: the key now holds a DIFFERENT record
    if (confirm) {
      await act(async () => { backend.saves[0].resolve(); });
      await advance(0);
      expect(readJournal()).toBeNull(); // the premise: that save's confirmation cleared the key
    }
    const later = readJournal();
    act(() => { hook.result.current.setTasks([{ id: 1, taskName: "Stored" }, { id: 3, taskName: "Later" }, { id: 4, taskName: "Live" }] as unknown as Task[]); });
    return { ...hook, backend, later };
  }

  it("Discard acts only on the record the notice describes: this tab's later write is untouched and nothing is applied", async () => {
    const { result, later } = await conflictThenThisTabsWrite(false);
    await act(async () => { result.current.discardUnloadJournal(); });
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(readJournal()).toEqual(later);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 3, 4]);
    expect(restoredToast()).toHaveLength(0);
  });

  it.each([
    ["overwritten by this tab's later write", false],
    ["cleared by that write's confirmation", true],
  ] as const)("Restore anyway still applies and saves the last session's record once the key is %s", async (_label, confirm) => {
    const { result, backend } = await conflictThenThisTabsWrite(confirm);
    await act(async () => { result.current.restoreUnloadJournalAnyway(); });
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(restoredToast()).toHaveLength(1);
    expect(readJournal()).toMatchObject({ tabId: UNLOAD_JOURNAL_TAB_ID, savedAt: EARLIER_SAVED_AT }); // R3

    await advance(600);
    if (!confirm) {
      // §627 — one save at a time per backend: the save-back waits behind this tab's write, still in flight.
      expect(backend.save).toHaveBeenCalledTimes(1);
      await act(async () => { backend.saves[0].resolve(); });
      await advance(0);
    }
    expect(backend.save).toHaveBeenCalledTimes(2);
    expect(savedTaskIds(backend, 1)).toEqual([1, 2]);
    await act(async () => { backend.saves[1].resolve(); });
    await advance(0);
    expect(readJournal()).toBeNull(); // the save-back's confirmation clears the re-tagged record
  });

  it("Restore anyway while saving is paused (a rebuilt load FAILED) reports it, applies nothing, keeps the notice, and works once saving resumes", async () => {
    seedJournal("changed-elsewhere");
    const a = makeBackend(100);
    const failed = makeBackend(100, "reject");
    const c = makeBackend(100);
    createBackendMock.mockReturnValueOnce(a).mockReturnValueOnce(failed).mockReturnValue(c);
    const { result, rerender } = render();
    await advance(800);
    expect(result.current.unloadJournalConflict).toBe(true);

    rerender({ args: makeArgs(false, { kind: "browser" }) }); // same target key, a new instance whose load fails
    await advance(800);
    expect(result.current.loadPause).toBe("load-failed"); // the premise: saves are not allowed
    expect(result.current.unloadJournalConflict).toBe(true);

    await act(async () => { result.current.restoreUnloadJournalAnyway(); });
    expect(showToast.mock.calls.filter((call) => call[1] === t("en-US", "unloadJournalRestoreBlocked"))).toEqual([["error", t("en-US", "unloadJournalRestoreBlocked")]]);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(restoredToast()).toHaveLength(0);
    expect(result.current.unloadJournalConflict).toBe(true);
    await advance(600);
    expect(a.save).not.toHaveBeenCalled();
    expect(failed.save).not.toHaveBeenCalled();

    rerender({ args: makeArgs(false, { kind: "browser" }) }); // saving resumes: a load that lands
    await advance(800);
    expect(result.current.loadPause).toBeNull();
    await act(async () => { result.current.restoreUnloadJournalAnyway(); });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(restoredToast()).toHaveLength(1);
    await advance(600);
    expect(c.save).toHaveBeenCalledTimes(1);
    expect(savedTaskIds(c, 0)).toEqual([1, 2]);
  });

  it("Restore anyway with no conflict for the target in scope reports it, rather than doing nothing", async () => {
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    expect(result.current.unloadJournalConflict).toBe(false);

    await act(async () => { result.current.restoreUnloadJournalAnyway(); });
    expect(showToast.mock.calls.filter((c) => c[1] === t("en-US", "unloadJournalRestoreUnavailable"))).toEqual([["error", t("en-US", "unloadJournalRestoreUnavailable")]]);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
  });

  /** An edit whose save fires while visible (so nothing is journaled yet) and REJECTS, then "Reload
   *  project" re-reads STORED. Returns the hook with that reload applied. */
  async function failedSaveThenReload() {
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const hook = render();
    await advance(800);
    act(() => { hook.result.current.setTasks(JOURNALED.tasks); });
    await advance(600);
    expect(backend.save).toHaveBeenCalledTimes(1);
    await act(async () => { backend.saves[0].reject(new Error("save boom")); });
    await advance(0);
    let reload: Promise<void> | undefined;
    act(() => { reload = hook.result.current.reloadCurrentProject(); });
    await advance(200);
    await act(async () => { await reload; });
    expect(hook.result.current.tasks.map((x) => x.id)).toEqual([1]); // the premise: the reload discarded task 2
    return hook;
  }

  function pageHide() {
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    window.dispatchEvent(new Event("pageshow")); // resets debounced-save.ts's module-level `pageHiding` (jsdom never fires one)
  }

  it("I1 — a FAILED save, then Reload project, then pagehide with no new edit: nothing is journaled, and the next page load restores nothing", async () => {
    const first = await failedSaveThenReload();
    pageHide();
    expect(readJournal()).toBeNull();
    first.unmount();

    const next = makeBackend(100);
    createBackendMock.mockReturnValue(next);
    const { result } = render();
    await advance(800);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(restoredToast()).toHaveLength(0);
    expect(result.current.unloadJournalConflict).toBe(false);
    await advance(600);
    expect(next.save).not.toHaveBeenCalled();
    expect(readJournal()).toBeNull();
  });

  it("I1 — Reload project leaves an earlier page's conflict record, its notice and its in-memory copy alone", async () => {
    const seeded = seedJournal("changed-elsewhere");
    const hook = await failedSaveThenReload();
    expect(readJournal()).toEqual(seeded);
    expect(hook.result.current.unloadJournalConflict).toBe(true);

    await act(async () => { hook.result.current.restoreUnloadJournalAnyway(); });
    expect(hook.result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(restoredToast()).toHaveLength(1);
  });

  it.each<[string, LoadReport]>([
    ["truncated", { lastLoadTruncation: { entries: 1, blocks: 0 } }],
    ["decode failures", { lastDecodeFailures: ["documentVersions"] }],
    ["malformed quotes", { lastImportMalformedQuotes: 2 }],
  ])("an incomplete load (%s): nothing applied, nothing cleared, no notice", async (_label, report) => {
    const seeded = seedJournal(matchingBase());
    const backend = makeBackend(100, "resolve", STORED, report);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);

    expect(result.current.loadWasIncomplete).toBe(true); // the fake really did report a paused load
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal()).toEqual(seeded);
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(restoredToast()).toHaveLength(0);
    // §632 — no restore ran for the key, so its journal is listed (Download / Discard), not hidden.
    expect(result.current.otherJournals.others.map((e) => e.journal.projectKey)).toEqual(["browser"]);
  });

  it("a FAILED load: nothing applied, nothing cleared, no notice", async () => {
    const seeded = seedJournal(matchingBase());
    createBackendMock.mockReturnValue(makeBackend(100, "reject"));
    const { result } = render();
    await advance(800);

    expect(result.current.loadPause).toBe("load-failed");
    expect(result.current.tasks).toEqual([]);
    expect(readJournal()).toEqual(seeded);
    expect(result.current.unloadJournalConflict).toBe(false);
  });

  it("an EMPTY-load refusal: nothing applied, nothing cleared, no notice", async () => {
    const a = makeBackend(100);
    const b = makeBackend(100, "resolve", EMPTY);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render();
    await advance(700);
    const seeded = seedJournal(fingerprintWorkspace(EMPTY as unknown as Workspace)); // it WOULD match the empty load

    rerender({ args: makeArgs(false, { kind: "browser" }) });
    await advance(700);
    expect(result.current.loadPause).toBe("empty-refused");
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal()).toEqual(seeded);
    expect(result.current.unloadJournalConflict).toBe(false);
  });

  it("another project's journal is ignored and never deleted", async () => {
    const otherKey = `${UNLOAD_JOURNAL_PREFIX}some-other-project`;
    const seeded = seedJournal(matchingBase(), otherKey, "some-other-project");
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);

    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal(otherKey)).toEqual(seeded);
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(restoredToast()).toHaveLength(0);
  });

  it("a popout never restores — not on a match, not as a notice", async () => {
    const seeded = seedJournal(matchingBase());
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render(makeArgs(true));
    await advance(800);

    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal()).toEqual(seeded);
    expect(result.current.unloadJournalConflict).toBe(false);
    expect(restoredToast()).toHaveLength(0);
  });
});

describe("§629 — useUnloadJournal restore on its own", () => {
  const WS_1: Workspace = { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "One" } as unknown as Task] };
  const WS_2: Workspace = { ...emptyWorkspace(), tasks: [{ id: 2, taskName: "Two" } as unknown as Task] };
  const KEY = `${UNLOAD_JOURNAL_PREFIX}p1`;

  it("R7 — holdBase nulls the live base: an op that fails before its config flip journals base \"\", which restores as a notice, never a match", () => {
    const { result } = renderHook(() => useUnloadJournal({ projectKey: "p1", enabled: true, isPopout: false }));
    act(() => { result.current.setBase(WS_1, "p1"); });
    act(() => { result.current.holdBase(WS_2); }); // the op applied; its flip never comes
    expect(result.current.baseFingerprint()).toBe("");

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      act(() => { result.current.noteSaveStarted(WS_2); });
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
    expect(readJournal(KEY)!.baseFingerprint).toBe("");

    let applied: Workspace | null = WS_2;
    act(() => { applied = result.current.restoreOnLoad(WS_1, "p1", "browser"); });
    expect(applied).toBeNull();
    expect(result.current.conflict).toBe(true);
  });
});

describe("§632 — journals under other keys, wired into the load", () => {
  it("a conflicting journal for the loaded key is shown by the conflict notice only, not listed again", async () => {
    seedJournal("a-base-that-does-not-match");
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(200);
    expect(result.current.unloadJournalConflict).toBe(true);
    expect(result.current.otherJournals.others).toEqual([]);
  });

  it("the loaded key's own journal, however old, is restored rather than expired", async () => {
    vi.setSystemTime(Date.UTC(2026, 8, 28));
    seedJournal(matchingBase()); // savedAt 1_000: decades old
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(200);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(result.current.otherJournals.expired.length).toBe(0);
    expect(result.current.otherJournals.others).toEqual([]);
  });

  it("expires an old one only once the first load has applied, and lists a younger one", async () => {
    const now = Date.UTC(2026, 8, 28);
    vi.setSystemTime(now);
    const old = { v: 1, projectKey: "gone", tabId: EARLIER_TAB, savedAt: now - 31 * 24 * 60 * 60 * 1000, baseFingerprint: "", workspace: "{}" };
    const young = { ...old, projectKey: "other", savedAt: now - 60_000 };
    localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}gone`, JSON.stringify(old));
    localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}other`, JSON.stringify(young));
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();

    await advance(50); // the load is still in flight
    expect(readJournal(`${UNLOAD_JOURNAL_PREFIX}gone`)).not.toBeNull();
    expect(result.current.otherJournals.others).toEqual([]);
    expect(result.current.otherJournals.expired.length).toBe(0);

    await advance(150);
    expect(readJournal(`${UNLOAD_JOURNAL_PREFIX}gone`)).toBeNull();
    expect(result.current.otherJournals.expired.length).toBe(1);
    expect(result.current.otherJournals.others.map((e) => e.journal.projectKey)).toEqual(["other"]);
  });
});

// §644 (review I3) — tab sync tells other same-project windows to ignore a slice this window LOADED,
// because it is only what storage already holds. A restored journal is the opposite: unsaved EDITS
// that storage does not hold, so it must go out as an edit, or another tab's autosave writes over it.
describe("§644 — a restored journal is sent to other tabs as an edit, a load is not", () => {
  const mainSyncContext = () => {
    const calls = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls;
    const ctx = calls[calls.length - 1][3] as SyncContext;
    if (ctx.role !== "main") throw new Error("expected a main context");
    return ctx;
  };

  it("marks a plain load's slices as loaded", async () => {
    seedJournal("changed-elsewhere"); // a mismatch: the loaded workspace applies, nothing is restored
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(mainSyncContext().isLoadedValue(result.current.tasks)).toBe(true);
  });

  it("does not mark the slices of a journal restored on load", async () => {
    seedJournal(matchingBase());
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(200);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(mainSyncContext().isLoadedValue(result.current.tasks)).toBe(false);
  });

  it("does not mark the slices of a journal restored with Restore anyway", async () => {
    seedJournal("changed-elsewhere");
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    await act(async () => { result.current.restoreUnloadJournalAnyway(); });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]);
    expect(mainSyncContext().isLoadedValue(result.current.tasks)).toBe(false);
  });
});

describe("§655 — Restore a kept version of the project in scope", () => {
  const KEPT_KEY = `${UNLOAD_JOURNAL_PREFIX}browser:kept`;
  const KEPT: Workspace = { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "Stored" }, { id: 3, taskName: "Kept" }] as unknown as Task[] };
  type Result = ReturnType<typeof render>["result"];
  const entryFor = (result: Result, projectKey: string) => result.current.otherJournals.others.find((e) => e.journal.projectKey === projectKey)!;
  /** Kept slots of the live version: the numbered ones beside the seeded slot. */
  const numberedKept = () => Object.keys(localStorage).filter((k) => k.startsWith(`${KEPT_KEY}:`));
  const toastsOf = (key: TranslationKey) => showToast.mock.calls.filter((c) => c[1] === t("en-US", key));

  it("keeps the live version first, applies the kept one, saves it, and removes its slot", async () => {
    seedJournal("", KEPT_KEY, "browser:kept", KEPT);
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);
    const entry = entryFor(result, "browser:kept");
    expect(result.current.otherJournals.isRestorable(entry)).toBe(true);

    await act(async () => { result.current.restoreKeptJournal(entry); });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 3]);
    expect(readJournal(KEPT_KEY)).toBeNull();
    // The version that was open is now a kept version of its own — the way back.
    expect(numberedKept()).toHaveLength(1);
    expect(jsonToWorkspace(readJournal(numberedKept()[0])!.workspace).tasks.map((x) => x.id)).toEqual([1]);
    expect(result.current.otherJournals.others.map((e) => `${UNLOAD_JOURNAL_PREFIX}${e.journal.projectKey}`)).toEqual(numberedKept());
    expect(toastsOf("unloadJournalKeptRestored")).toEqual([["success", t("en-US", "unloadJournalKeptRestored")]]);

    await advance(600);
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(savedTaskIds(backend, 0)).toEqual([1, 3]);
  });

  it("another project's kept version is not restorable here: nothing applied, kept or removed", async () => {
    const otherKey = `${UNLOAD_JOURNAL_PREFIX}p-other:kept`;
    seedJournal("", otherKey, "p-other:kept", KEPT);
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    const entry = entryFor(result, "p-other:kept");
    expect(result.current.otherJournals.isRestorable(entry)).toBe(false);
    await act(async () => { result.current.restoreKeptJournal(entry); });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal(otherKey)).not.toBeNull();
    expect(numberedKept()).toEqual([]);
  });

  it("while saving is paused it is reported, and nothing is applied, kept or removed", async () => {
    seedJournal("", KEPT_KEY, "browser:kept", KEPT);
    createBackendMock.mockReturnValueOnce(makeBackend(100)).mockReturnValue(makeBackend(100, "reject"));
    const { result, rerender } = render();
    await advance(800);
    rerender({ args: makeArgs(false, { kind: "browser" }) }); // a new instance whose load fails
    await advance(800);
    expect(result.current.loadPause).toBe("load-failed"); // the premise
    await act(async () => { result.current.restoreKeptJournal(entryFor(result, "browser:kept")); });
    expect(toastsOf("unloadJournalKeptRestoreBlocked")).toHaveLength(1);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal(KEPT_KEY)).not.toBeNull();
    expect(numberedKept()).toEqual([]);
  });

  it("while a load is in flight (§548) it is refused, and nothing is applied, kept or removed", async () => {
    seedJournal("", KEPT_KEY, "browser:kept", KEPT);
    // A RELOAD of the same instance: saves stay allowed throughout, so only the load hold refuses here.
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    const entry = entryFor(result, "browser:kept");
    // Taken BEFORE the reload, as the banner's handler is: the restore runs after an awaited confirm,
    // so it must read the load hold live, not the value its closure captured.
    const staleRestore = result.current.restoreKeptJournal;
    let reload: Promise<void> | undefined;
    act(() => { reload = result.current.reloadCurrentProject(); });
    await advance(25);
    expect(result.current.loadPending).toBe(true); // the premise
    await act(async () => { staleRestore(entry); });
    expect(toastsOf("unloadJournalKeptRestoreLoading")).toHaveLength(1);
    expect(toastsOf("unloadJournalKeptRestoreBlocked")).toHaveLength(0);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal(KEPT_KEY)).not.toBeNull();
    expect(numberedKept()).toEqual([]);
    await advance(200);
    await act(async () => { await reload; });
  });

  it("keeps the version that is live AT the confirm, not the one at the click", async () => {
    seedJournal("", KEPT_KEY, "browser:kept", KEPT);
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    const entry = entryFor(result, "browser:kept");
    const handlerAtClick = result.current.restoreKeptJournal; // the banner holds this across its awaited confirm
    act(() => { result.current.setTasks((prev) => [...prev, { id: 9, taskName: "Arrived during the dialog" } as unknown as Task]); });
    await act(async () => { handlerAtClick(entry); });
    expect(numberedKept()).toHaveLength(1);
    expect(jsonToWorkspace(readJournal(numberedKept()[0])!.workspace).tasks.map((x) => x.id)).toEqual([1, 9]);
  });

  it("a version another tab already restored or discarded is not applied again", async () => {
    seedJournal("", KEPT_KEY, "browser:kept", KEPT);
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    const entry = entryFor(result, "browser:kept");
    localStorage.removeItem(KEPT_KEY); // another tab resolved it
    let rowGone: boolean | undefined;
    await act(async () => { rowGone = result.current.restoreKeptJournal(entry); });
    expect(rowGone).toBe(true); // its row is re-listed away, so the banner takes focus
    expect(toastsOf("unloadJournalKeptRestoreGone")).toHaveLength(1);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(numberedKept()).toEqual([]);
    expect(result.current.otherJournals.others.some((e) => e.journal.projectKey === "browser:kept")).toBe(false);
  });

  it("when the live version cannot be kept first, nothing is restored", async () => {
    seedJournal("", KEPT_KEY, "browser:kept", KEPT);
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    const realSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith(`${KEPT_KEY}:`)) throw new Error("QuotaExceededError");
      realSetItem.call(this, key, value);
    });
    try {
      await act(async () => { result.current.restoreKeptJournal(entryFor(result, "browser:kept")); });
    } finally {
      spy.mockRestore();
    }
    expect(toastsOf("unloadJournalKeptRestoreNotKept")).toHaveLength(1);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(readJournal(KEPT_KEY)).not.toBeNull();
  });

  it("a kept version that does not decode is reported, and nothing is kept or applied", async () => {
    localStorage.setItem(KEPT_KEY, JSON.stringify({ v: 1, projectKey: "browser:kept", tabId: EARLIER_TAB, savedAt: EARLIER_SAVED_AT, baseFingerprint: "", workspace: "{not json" }));
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    await act(async () => { result.current.restoreKeptJournal(entryFor(result, "browser:kept")); });
    expect(toastsOf("unloadJournalKeptRestoreUnavailable")).toHaveLength(1);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(numberedKept()).toEqual([]);
    expect(readJournal(KEPT_KEY)).not.toBeNull();
  });
});

// open-followups §668 — a journal that does not decode is never applied. Lenient decoding turned it
// into an EMPTY workspace: applied with no click when its base matched, and the payload of "Restore
// anyway" when it did not.
describe("§668 — a corrupt journal is refused, not applied as an empty project", () => {
  /** A record the field check accepts, whose workspace text is not a workspace. */
  function seedCorrupt(baseFingerprint: string, workspace = "{not json"): void {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify({ v: 1, projectKey: "browser", tabId: EARLIER_TAB, savedAt: EARLIER_SAVED_AT, baseFingerprint, workspace }));
  }
  const unreadableToasts = () => showToast.mock.calls.filter((c) => c[1] === t("en-US", "unloadJournalUnreadable"));

  it.each([
    ["unparseable text", "{not json"],
    ["JSON that is not a workspace object", "[1, 2, 3]"],
  ])("load restore, base matching: %s leaves the project as loaded, says so, and writes nothing", async (_label, workspace) => {
    seedCorrupt(matchingBase(), workspace);
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(unreadableToasts()).toEqual([["error", t("en-US", "unloadJournalUnreadable")]]);
    expect(restoredToast()).toHaveLength(0);
    expect(backend.save).not.toHaveBeenCalled();
    expect(localStorage.getItem(JOURNAL_KEY)).not.toBeNull(); // left in place...
    // ...and LISTED, so Download and Discard reach it: nothing else would ever remove it.
    expect(result.current.otherJournals.others.map((e) => e.journal.projectKey)).toEqual(["browser"]);
    expect(result.current.otherJournals.others[0].unreadable).toBe(true); // its own text: "reload to restore" would only fail again
  });

  it("an unreadable journal can be discarded from the notice, and the next load says nothing", async () => {
    seedCorrupt(matchingBase());
    createBackendMock.mockReturnValue(makeBackend(100));
    const first = render();
    await advance(800);
    const [entry] = first.result.current.otherJournals.others;
    act(() => first.result.current.otherJournals.discard(entry));
    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    first.unmount();
    showToast.mockClear();
    const second = render();
    await advance(800);
    expect(unreadableToasts()).toHaveLength(0);
    expect(second.result.current.otherJournals.others).toEqual([]);
  });

  it("base differing: no conflict notice, so \"Restore anyway\" has nothing to apply", async () => {
    seedCorrupt("changed-elsewhere");
    createBackendMock.mockReturnValue(makeBackend(100));
    const { result } = render();
    await advance(800);
    expect(result.current.unloadJournalConflict).toBe(false);
    await act(async () => { result.current.restoreUnloadJournalAnyway(); });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(unreadableToasts()).toHaveLength(1);
  });

  // The EMPTY case is not refused here: a deliberate Clear all journals an empty workspace, and the
  // existing save-path guard (isMassDeletion, §629) decides — with "Save anyway" / "Discard" as recourse.
  it("a deliberate clear of a small project is restored and saved, like any edit", async () => {
    seedJournal(matchingBase(), JOURNAL_KEY, "browser", emptyWorkspace());
    const backend = makeBackend(100);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);
    expect(result.current.tasks).toEqual([]);
    expect(unreadableToasts()).toHaveLength(0);
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(result.current.destructiveRefusal).toBeNull();
  });

  it("a deliberate clear of a large project is restored, and its save meets the mass-deletion guard", async () => {
    const many = { ...STORED, tasks: Array.from({ length: 400 }, (_, i) => ({ id: i + 1, taskName: `T${i}` })) as unknown as Task[] };
    seedJournal(fingerprintWorkspace(many as unknown as Workspace), JOURNAL_KEY, "browser", emptyWorkspace());
    const backend = makeBackend(100, "resolve", many);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(800);
    expect(result.current.tasks).toEqual([]);
    expect(unreadableToasts()).toHaveLength(0);
    expect(backend.save).not.toHaveBeenCalled();
    expect(result.current.destructiveRefusal).not.toBeNull(); // the banner's Save anyway / Discard
  });
});

// Post-merge review I1 — a restore keeps the project but replaces the rows every undo image was taken
// against, so it moves the UNDO epoch (not the scope epoch) and asks the caller to prune the history.
describe("a restore resets the undo history, not the project scope", () => {
  it.each([
    ["the kept-version restore (§655)", "kept"],
    ["Restore anyway (§629)", "anyway"],
  ] as const)("%s", async (_label, path) => {
    if (path === "kept") seedJournal("", `${UNLOAD_JOURNAL_PREFIX}browser:kept`, "browser:kept", JOURNALED);
    else seedJournal("changed-elsewhere");
    createBackendMock.mockReturnValue(makeBackend(100));
    const onUndoHistoryReset = vi.fn();
    const { result } = render({ ...makeArgs(), onUndoHistoryReset });
    await advance(800);
    const scopeBefore = result.current.getScopeEpoch();
    const undoBefore = result.current.getUndoEpoch();
    expect(undoBefore).toBe(scopeBefore); // nothing restored yet
    await act(async () => {
      if (path === "kept") result.current.restoreKeptJournal(result.current.otherJournals.others.find((e) => e.journal.projectKey === "browser:kept")!);
      else result.current.restoreUnloadJournalAnyway();
    });
    expect(result.current.tasks.map((x) => x.id)).toEqual([1, 2]); // the premise: it applied
    expect(onUndoHistoryReset).toHaveBeenCalledTimes(1);
    expect(result.current.getUndoEpoch()).toBe(undoBefore + 1); // every pre-restore undo entry is now stale
    expect(result.current.getScopeEpoch()).toBe(scopeBefore); // in-flight writes for THIS project still land
  });
});
