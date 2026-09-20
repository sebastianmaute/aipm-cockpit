// Probe for open-followups §589 — filed from reading code, never reproduced.
//
// ★★★ THE CLAIM: the save effect lists `backend` in its deps, so a settings-driven rebuild (a Turso
// URL/token edit, a SharePoint target change) runs the PREVIOUS run's cleanup. That cleanup
// (`scheduleDebouncedSave`'s return, debounced-save.ts) clears the debounce timer and drops both
// hide listeners WITHOUT flushing — so an edit still inside the 500 ms window is never written to
// the backend it was made against, and the new target's load then replaces scope, taking the edit
// out of memory too. Silent: no banner, no toast, nothing refused.
//
// ★★ WHY THE OP PATHS DO NOT COVER IT: a project switch/open/create runs `flushCurrent`
// (use-load-truncation.ts) before it flips config, so those nine paths write the pending edit
// themselves. A BARE settings rebuild has no op and therefore no flush — that is the hole.
//
// ★ WHAT EACH TEST HERE IS. Exactly one assertion in this file was RED before the fix: the flush
// itself, in the first `it`. The other two are REGRESSION assertions — green before AND after —
// and their titles say so, because an unlabelled green assertion sitting beside a red one gets
// counted as evidence by the next reader (the branch has already paid for that once).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageConfig } from "./storage";
import type { Task } from "./types";
import { SAVE_DEBOUNCE_MS } from "./debounced-save";

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
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));

import * as storageMod from "./storage";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;

const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };
/** The edit that lands normally, proving `first`'s gate is OPEN before anything else is asked of it. */
const EDIT_ONE = [{ id: 1, taskName: "First edit — lands normally, proves the gate is open" }] as unknown as Task[];
/** The edit under test: made, then left pending inside the debounce window when the rebuild happens. */
const EDIT_TWO = [
  { id: 1, taskName: "First edit — lands normally, proves the gate is open" },
  { id: 2, taskName: "Second edit — still inside the debounce when the backend is rebuilt" },
] as unknown as Task[];

type FakeBackend = {
  kind: string;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  isReady: ReturnType<typeof vi.fn>;
  describe: ReturnType<typeof vi.fn>;
};

/** A backend whose load settles after `ms` on the (fake) clock — same shape as
 *  use-storage-backend.load-gate.test.tsx's `makeBackend` and the §588 probe's. */
function makeBackend(ms: number, stored: object = EMPTY, kind = "browser"): FakeBackend {
  return {
    kind,
    load: vi.fn(() => new Promise((resolve) => { setTimeout(() => resolve(stored), ms); })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

/** A backend whose mount load REJECTS after `ms`, so its save gate never opens
 *  and `loadPause` publishes "load-failed" for it — the positively-readable
 *  witness the shut-gate scenario below rests on. */
function makeFailingBackend(ms: number, kind = "browser"): FakeBackend {
  return {
    kind,
    load: vi.fn(() => new Promise((_resolve, reject) => { setTimeout(() => reject(new Error("backend unreachable")), ms); })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

const showToast = vi.fn();
const showToastAction = vi.fn();

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
  const { tasks, setTasks } = useWorkspace();
  return { ...hook, tasks, setTasks };
}

/** Advance the fake clock in small steps, each in its own `act` — see the
 *  load-gate file's identical helper for why one big advance can miss a
 *  same-tick effect re-run. */
async function advance(ms: number) {
  const STEP = 25;
  for (let done = 0; done < ms; done += STEP) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - done)); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // ★★★ DRAIN THE `…Once` QUEUE — `vi.clearAllMocks()` does NOT. `mockClear` touches only the call
  //   records; `mockReset` is what empties `onceMockImplementations`. A `mockReturnValueOnce` left
  //   queued by a test that threw mid-helper would hand the NEXT test somebody else's backend, and
  //   `test:shuffle` reorders WITHIN a file, so "the next test" is not a fixed one. Carried from
  //   use-storage-backend.superseded-gate.test.tsx, which says the same thing at length.
  createBackendMock.mockReset();
});

/** THE SHARED ARRANGEMENT for the open-gate tests, so they cannot drift apart —
 *  only the assertion after it differs per test. It runs the scenario to exactly
 *  the moment the rebuild commits, which is where the §589 flush has to happen:
 *
 *    mount on `first` → its load lands, opening its gate → land a REAL save on it
 *    (the precondition, observed rather than assumed) → make a second edit and
 *    stop the clock INSIDE the debounce window (asserted, or the probe is vacuous)
 *    → rebuild onto `second` by changing the storage config.
 *
 *  `second`'s own load is deliberately left UNRESOLVED here (100 ms, clock not
 *  advanced) so nothing it does can be mistaken for the flush; the regression
 *  test below advances past it on purpose. */
async function setupPendingEditAcrossRebuild() {
  const first = makeBackend(50);
  const second = makeBackend(100, EMPTY, "turso");
  createBackendMock.mockReturnValueOnce(first).mockReturnValue(second);

  const { result, rerender } = renderHook(
    (props: { config: StorageConfig }) => useProbe(makeArgs(props.config)),
    {
      wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
      initialProps: { config: { kind: "browser" } as StorageConfig },
    },
  );

  // `first`'s mount load lands (50 ms) and applies, which runs `allowSavesTo(first)`.
  await advance(100);
  expect(first.load).toHaveBeenCalledTimes(1);

  // ★ PRECONDITION 1, OBSERVED THROUGH THE GATE, NOT READ OFF IT: `loadPause` is null both when a
  //   gate is open and when nothing has touched it, so it cannot witness this. Land an actual save
  //   instead — that is the only thing whose arrival requires the gate to be open.
  await act(async () => { result.current.setTasks(EDIT_ONE); });
  await advance(SAVE_DEBOUNCE_MS + 100);
  expect(first.save).toHaveBeenCalledTimes(1);
  expect(first.save.mock.calls[0][0].tasks.map((x: Task) => x.id)).toEqual([1]);
  const savesBeforePendingEdit = first.save.mock.calls.length;

  // The edit under test. Stop 200 ms short of the debounce so it is genuinely still pending.
  await act(async () => { result.current.setTasks(EDIT_TWO); });
  await advance(SAVE_DEBOUNCE_MS - 200);
  // ★ PRECONDITION 2, AND THE ONE THAT DECIDES WHETHER THE PROBE MEANS ANYTHING: if this edit had
  //   already been written by the ordinary debounce, the flush assertion below would pass with the
  //   §589 fix DELETED. The whole defect lives in the window this line pins us inside.
  expect(first.save).toHaveBeenCalledTimes(savesBeforePendingEdit);

  // THE REBUILD: a settings-driven backend change, no project op, so nothing calls `flushCurrent`.
  // React runs the save effect's cleanup here — the one §589 is about.
  await act(async () => { rerender({ config: { kind: "turso" } as StorageConfig }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });

  return { result, first, second, savesBeforePendingEdit };
}

describe("§589 — an edit inside the debounce survives a backend rebuild", () => {
  // ★★ THE PROBE. This is the one assertion in the file that was RED before the fix: the cleanup
  //    cleared the timer and returned, so `first.save` was never called a second time and EDIT_TWO
  //    existed nowhere but React state — which `second`'s load then replaces.
  // ★ KILLED BY: Mutant B (`shouldFlushOnCleanup` → `() => false` in use-storage-backend.ts) and
  //   Mutant C (deleting the `shouldFlushOnCleanup?.()` branch from debounced-save.ts's cleanup).
  it("flushes the pending edit to the OLD backend when the backend is rebuilt", async () => {
    const { first, savesBeforePendingEdit } = await setupPendingEditAcrossRebuild();

    expect(first.save).toHaveBeenCalledTimes(savesBeforePendingEdit + 1);
    expect(first.save.mock.calls[savesBeforePendingEdit][0].tasks.map((x: Task) => x.id)).toEqual([1, 2]);
  });

  // ★ REGRESSION ASSERTION — EXPECTED GREEN BOTH BEFORE AND AFTER THE §589 FIX. Not probe evidence.
  //   The flush must reach the backend the edit was MADE against, never the new one: `second`'s own
  //   gate is shut until its load applies, and after it applies the save effect's suppress branch
  //   consumes the run. This test advances past `second`'s load (100 ms) on purpose so it is
  //   asserting against an OPEN new gate rather than an untouched one.
  // ★ KILLED BY: nothing in this file. A predicate mutation cannot redirect the flush — `doSave`
  //   closes over `first` — so if this ever goes RED the fix has been rewritten, not mutated.
  it("REGRESSION (green before and after the fix): the rebuilt backend receives no save of its own", async () => {
    const { second } = await setupPendingEditAcrossRebuild();

    await advance(SAVE_DEBOUNCE_MS + 200); // let `second`'s load land and its gate open
    expect(second.load).toHaveBeenCalledTimes(1);
    expect(second.save).not.toHaveBeenCalled();
  });

  // ★ REGRESSION ASSERTION — EXPECTED GREEN BOTH BEFORE AND AFTER THE §589 FIX. Not probe evidence.
  //   §586 says an instance whose own load failed must never be written to. The flush is a THIRD
  //   exit from the same `save` argument as the timer and the hide listeners, so it inherits that
  //   gate — but on this path it never even gets the chance, and saying so is the honest statement:
  //   with the gate shut the save effect returns ABOVE `scheduleDebouncedSave`, so no timer, no
  //   listeners and no cleanup predicate exist to flush. That is why Mutant A (`() => true`) kills
  //   nothing here; it is an equivalent mutant on this path by construction, not an untested one.
  // ★ PRECONDITION, POSITIVELY READ: `loadPause === "load-failed"` is published ONLY for an
  //   instance whose own load failed AND whose gate is shut (`savesPaused.backend === backend &&
  //   !savesAllowed`, use-storage-backend.ts). Unlike a null `loadPause` it cannot mean "nothing
  //   has happened yet", so it is a real witness rather than an absence.
  it("REGRESSION (green before and after the fix): a rebuild never flushes to a backend whose own save gate never opened", async () => {
    const first = makeFailingBackend(50);
    const second = makeBackend(100, EMPTY, "turso");
    createBackendMock.mockReturnValueOnce(first).mockReturnValue(second);

    const { result, rerender } = renderHook(
      (props: { config: StorageConfig }) => useProbe(makeArgs(props.config)),
      {
        wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
        initialProps: { config: { kind: "browser" } as StorageConfig },
      },
    );

    await advance(100);
    expect(first.load).toHaveBeenCalledTimes(1);
    expect(result.current.loadPause).toBe("load-failed"); // the witness — see above

    await act(async () => { result.current.setTasks(EDIT_TWO); });
    await advance(SAVE_DEBOUNCE_MS - 200);
    await act(async () => { rerender({ config: { kind: "turso" } as StorageConfig }); });
    await advance(SAVE_DEBOUNCE_MS + 200);

    expect(first.save).not.toHaveBeenCalled();
    expect(second.save).not.toHaveBeenCalled();
  });
});
