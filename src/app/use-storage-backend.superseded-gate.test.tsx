// Probe for open-followups §588 — filed from reading code, never reproduced.
//
// ★★★ THE CLAIM: a reload started against the backend of the CURRENT render (`first`) can still be
// AWAITING when a settings-driven rebuild (e.g. a Turso URL/token edit) mints a NEW backend instance
// (`second`) and its own load effect lands, opening `second`'s save gate (`applyWorkspaceFromLoad`'s
// trailing `allowSavesTo` call, use-storage-backend.ts). If the STALE reload against `first` then
// resolves, its own `applyWorkspaceFromLoad` call — reached through `reloadCurrentProject`'s render-#1
// closure — runs that same `allowSavesTo`, with `first` as the target, which moves the gate OFF the
// live backend. An edit made after that point is silently never persisted: no banner, no toast,
// because `loadPause` is published only for an instance whose OWN load failed or was refused — a
// superseded reload is neither.
//
// This file proves the precondition explicitly (per the Task 2 dispatch's ruling (b) — NOT stated in
// task-2-brief.md itself): `second`'s gate must be OPEN, demonstrated by an actual save landing on
// it, BEFORE the stale reload is allowed to resolve and (on today's code) close it again.
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
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));
// ★★ CALL-THROUGH, for the same reason as its sibling in
// use-storage-file-ops.pick-overwrite.test.tsx: this suite asserts on the ARGUMENTS handed to
// `logDiag` (the `stage: "write"` label, and the reload leg's `outcome`), and a bare stub pins the
// call while leaving the emission unexercised. ★ It also replaces the whole module wholesale until
// now — `importOriginal` keeps `readDiagLog`/`clearDiagLog`/`buildDiagnosticBundle` real for
// anything else on the load path.
const { logDiagSpy } = vi.hoisted(() => ({ logDiagSpy: vi.fn() }));
vi.mock("./diagnostics", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./diagnostics")>();
  return {
    ...mod,
    logDiag: (...args: Parameters<typeof mod.logDiag>) => {
      logDiagSpy(...args);
      return mod.logDiag(...args);
    },
  };
});

import * as storageMod from "./storage";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;

const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };
const STALE_RELOAD_RESULT = { tasks: [{ id: 99, taskName: "Stale reload payload" } as unknown as Task], raid: [], absences: [], shifts: [] };
const EDIT_ONE = [{ id: 1, taskName: "First edit — proves the gate is open" }] as unknown as Task[];
const EDIT_TWO = [{ id: 1, taskName: "First edit — proves the gate is open" }, { id: 2, taskName: "Second edit — after the stale reload lands" }] as unknown as Task[];

type FakeBackend = {
  kind: string;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  isReady: ReturnType<typeof vi.fn>;
  describe: ReturnType<typeof vi.fn>;
};

/** A backend whose `load()` never settles on its own — the test controls it via
 *  the returned `release` function. Mirrors the caller's own control over a
 *  reload that is still in flight when a rebuild happens. */
function makeControlledBackend(): { backend: FakeBackend; release: (ws: object) => void } {
  let release: (ws: object) => void = () => {};
  const backend: FakeBackend = {
    kind: "browser",
    load: vi.fn(() => new Promise<object>((resolve) => { release = resolve; })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
  return { backend, release: (ws) => release(ws) };
}

/** A backend whose load settles after `ms` on the (fake) clock — same shape as
 *  use-storage-backend.load-gate.test.tsx's `makeBackend`. */
function makeBackend(ms: number, stored: object = EMPTY, kind = "turso"): FakeBackend {
  return {
    kind,
    load: vi.fn(() => new Promise((resolve) => { setTimeout(() => resolve(stored), ms); })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

/** Mount load settles normally (so this backend's gate opens); the SECOND
 *  `load()` — `reloadCurrentProject`'s — hangs until the test REJECTS it. That
 *  is the half `reloadCurrentProject`'s post-await guard cannot see: a
 *  superseded reload that fails rather than succeeds resumes in the `catch`. */
function makeBackendWithRejectingReload(ms: number): { backend: FakeBackend; rejectReload: (err: Error) => void } {
  let reject: (err: Error) => void = () => {};
  let calls = 0;
  const backend: FakeBackend = {
    kind: "browser",
    load: vi.fn(() => {
      calls += 1;
      if (calls === 1) return new Promise<object>((resolve) => { setTimeout(() => resolve(EMPTY), ms); });
      return new Promise<object>((_resolve, rej) => { reject = rej; });
    }),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
  return { backend, rejectReload: (err) => reject(err) };
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
  // ★★ THE DIAGNOSTICS RING IS SHARED MUTABLE STATE AND `clearAllMocks` DOES NOT TOUCH IT. This
  //   file calls through to the real `logDiag`, which appends to `localStorage`
  //   (`aipm-cockpit:diag-log`), and jsdom scopes `localStorage` per test FILE — so without this
  //   the ring accumulates across every test here. It is inert TODAY only because nothing in this
  //   file reads the ring back (every assertion goes through `logDiagSpy`) — a CONTINGENT fact,
  //   not an invariant: the sibling `pick-overwrite` suite added exactly such a ring assertion in
  //   the round that introduced the call-through. `test:shuffle` reorders within a file, so the
  //   first test to read the ring would see a different prefix depending on the seed. One line
  //   here costs nothing and removes the whole class.
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // ★★★ DRAIN THE `…Once` QUEUES — `vi.clearAllMocks()` IN `beforeEach` DOES NOT. Read off
  //   @vitest/spy's source rather than recalled: `mockClear` assigns only `state.calls`, `contexts`,
  //   `instances`, `invocationCallOrder`, `results` and `settledResults`; `mockReset` is the one that
  //   sets `config.onceMockImplementations = []`, and (because `vi.fn(impl)` is created with
  //   `resetToMockImplementation: true`) also restores the mock factory's own `() => null`.
  // ★★ So a queued `mockReturnValueOnce` SURVIVES into the next test. Nothing leaks TODAY: every
  //   test consumes what it queues, and no statement between a queue and its consuming call can
  //   throw. That is the problem — it is a premise held by statement ORDER inside each helper, which
  //   the tests do not own. A test that aborts mid-helper, or an assertion added into that gap later,
  //   would hand the NEXT test an already-open picker dialog or somebody else's backend, and
  //   `test:shuffle` reorders WITHIN a file, so "the next test" is not a fixed one. Without this the
  //   symptom would be a test failing only in shuffled order, only after an unrelated test went red.
  createBackendMock.mockReset();
  (storageMod.pickFileHandleForBackend as ReturnType<typeof vi.fn>).mockReset();
});

/** The shared arrangement all four `it`s below run identically, so they cannot
 *  drift apart — only the ASSERTION after it differs per test. Runs the whole
 *  scenario through the point where the stale reload has just resolved:
 *  mount on `first`, start a reload against it (still pending), rebuild onto
 *  `second` while that reload is in flight, let `second`'s own load land and
 *  open its gate, prove the gate is genuinely open with a real edit+save
 *  (the precondition — ruling (b) in the Task 2 dispatch), THEN release the
 *  stale reload and await it. Each `it` picks up from the returned handles. */
async function setupSupersededReloadScenario() {
  const { backend: first, release: releaseFirstLoad } = makeControlledBackend();
  const second = makeBackend(100);
  createBackendMock.mockReturnValueOnce(first).mockReturnValue(second);

  const { result, rerender } = renderHook(
    (props: { config: StorageConfig }) => useProbe(makeArgs(props.config)),
    {
      wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
      initialProps: { config: { kind: "browser" } as StorageConfig },
    },
  );

  // Start a reload against the FIRST backend (its own mount-time load is still
  // pending too, and stays that way — orphaned, never resolved, harmless).
  let reload!: Promise<void>;
  act(() => { reload = result.current.reloadCurrentProject(); });
  expect(first.load).toHaveBeenCalledTimes(2); // the mount load, plus reload's own call

  // Rebuild onto a second backend while that reload is still awaiting —
  // e.g. a Turso URL/token edit.
  rerender({ config: { kind: "turso" } as StorageConfig });

  // `second`'s OWN load effect lands (100 ms) and applies, which runs
  // `allowSavesTo(second)` — its gate is now open.
  await advance(150);
  expect(second.load).toHaveBeenCalledTimes(1);

  // ★ PRECONDITION, ASSERTED, NOT ASSUMED: prove the gate is genuinely open on
  // `second` by making an edit land there, before the stale reload gets anywhere
  // near it. If this fails, the scenario is set up wrong — every `it` below would
  // be turning on a gate that was never open in the first place.
  await act(async () => { result.current.setTasks(EDIT_ONE); });
  await advance(SAVE_DEBOUNCE_MS + 100);
  expect(second.save).toHaveBeenCalledTimes(1);
  expect(second.save.mock.calls[0][0].tasks.map((x: Task) => x.id)).toEqual([1]);
  const savesBeforeStaleReload = second.save.mock.calls.length;

  // Now let the STALE reload (against `first`) resolve. It resolves through
  // `reloadCurrentProject`'s render-#1 closure; BEFORE the §588 guard that
  // closure ran on to `applyWorkspaceFromLoad`, whose trailing `allowSavesTo`
  // then took `first` as its target — moving the gate away from `second`, the
  // backend actually live and on screen. The guard now returns ahead of all of
  // it; the four assertions below are what that return has to buy.
  await act(async () => { releaseFirstLoad(STALE_RELOAD_RESULT); await reload; });

  return { result, first, second, savesBeforeStaleReload };
}

/** The REJECTION arrangement: mount on `first` and let its gate open, start a
 *  reload against it, rebuild onto `second` and let ITS load land, then make the
 *  stale reload FAIL. The op resumes in `reloadCurrentProject`'s `catch`, which
 *  is the branch the post-await guard cannot reach. */
async function setupSupersededRejectingReloadScenario() {
  const { backend: first, rejectReload } = makeBackendWithRejectingReload(50);
  const second = makeBackend(100);
  createBackendMock.mockReturnValueOnce(first).mockReturnValue(second);

  const { result, rerender } = renderHook(
    (props: { config: StorageConfig }) => useProbe(makeArgs(props.config)),
    {
      wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
      initialProps: { config: { kind: "browser" } as StorageConfig },
    },
  );
  await advance(100);

  let reload!: Promise<void>;
  act(() => { reload = result.current.reloadCurrentProject(); });
  expect(first.load).toHaveBeenCalledTimes(2); // ★ the reload really started — without this the catch is never entered and both tests below are vacuous

  rerender({ config: { kind: "turso" } as StorageConfig });
  await advance(150);
  expect(second.load).toHaveBeenCalledTimes(1);

  await act(async () => { rejectReload(new Error("backend gone")); await reload; });

  return { result, first, second };
}

describe("§588 — a superseded reload must not shut the new backend's gate", () => {
  // ★ F2 (split 1/3) — THE DATA HALF, not just the gate. A fix that guards
  // `allowSavesTo` alone would still let the superseded reload's
  // `applyWorkspaceFromLoad` stomp the in-memory workspace with `first`'s stale
  // payload — the screen would show data nobody asked to see, even if the
  // (correct) gate refused to persist it. `second`'s own last-applied state
  // (EDIT_ONE, id 1) must still be what's in scope; the stale payload (id 99)
  // must never have landed.
  it("the stale payload from a superseded reload must not land in the live workspace", async () => {
    const { result } = await setupSupersededReloadScenario();
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
  });

  // ★ F2 (split 2/3) — THE §548 SKELETON. The same superseded apply calls
  // `setSettledBackend(first)` from its render-#1 closure, while the render's
  // live `backend` is `second` — so `settledBackend !== backend` and
  // `loadPending` (`!hydrated || settledBackend !== backend || swapsInFlight >
  // 0`, declared beside `settledBackend` in use-storage-backend.ts) is stranded `true` forever: no further load
  // or op will ever re-run to clear it, since nothing rebuilds the backend again
  // in this scenario. A fix that only patches `allowSavesTo` and leaves this
  // stamp misrouted would hang the app on the load-hold skeleton
  // (task-manager.tsx's `PanelSkeleton`) permanently, even though saves would
  // otherwise resume.
  it("a superseded reload must not strand loadPending true", async () => {
    const { result } = await setupSupersededReloadScenario();
    expect(result.current.loadPending).toBe(false);
  });

  // ★ F2 (split 3/3) — THE PERSISTENCE HALF, and the assertion the probe was
  // originally written for. `second` is still the live, on-screen backend (the
  // config passed to the hook never reverted), so an edit made after the stale
  // reload resolved must be persisted to it. Before the §588 guard it silently
  // was not — no banner, no toast (see the separate silence test below), because
  // `loadPause` only publishes for an instance whose own load failed or was
  // refused, and this reload did neither.
  // ★ The title states the GUARANTEE, not the defect. It was renamed with the
  // fix: a test called "… is never persisted" that passes because the edit IS
  // persisted reads as a latent inversion to everyone after you.
  it("a superseded reload must not shut the live backend's gate — an edit after it is still persisted", async () => {
    const { result, first, second, savesBeforeStaleReload } = await setupSupersededReloadScenario();

    await act(async () => { result.current.setTasks(EDIT_TWO); });
    await advance(SAVE_DEBOUNCE_MS + 100);

    expect(second.save).toHaveBeenCalledTimes(savesBeforeStaleReload + 1);
    expect(second.save.mock.calls[savesBeforeStaleReload][0].tasks.map((x: Task) => x.id)).toEqual([1, 2]);

    // Sanity, same test: the stale backend `first` never receives a save of its
    // own. By now `savesAllowedFor`/`loadedBackend`/`settledBackend` all point at
    // `first` — that's the bug, not a shortfall in `first`'s state. What actually
    // blocks a write to it is that the save EFFECT only ever runs for the
    // render's LIVE `backend` (`second`): its `doSave` closure checks
    // `savesAllowedForRef.current !== backend`, i.e. `first !== second`, and
    // returns before calling anything. No code path ever calls `first.save(...)`
    // post-switch, gate or no gate — so this always passes and is not the probe.
    expect(first.save).not.toHaveBeenCalled();
  });

  // ★ F1 — NOT PROBE EVIDENCE. Expected GREEN today AND after the Task 3 fix;
  // this documents §588's own characterisation rather than proving the defect.
  // §588 is a SILENT stall — "no banner and no toast appear" — because
  // `loadPause` (the hook's pause signal, backed by `savesPaused`) is published
  // only for an instance whose own load failed or was refused; a superseded
  // reload is neither, so this must read `null` on both legs. Deliberately NOT
  // a bare `showToast`/`showToastAction` not-called check: the reload's own
  // SUCCESS toast (`reloadProjectSuccess`) legitimately fires `showToast` on
  // this exact path, and a not-called assertion on it would fail for the wrong
  // reason. If this ever comes back RED, STOP — it means §588's own spec is
  // wrong about the stall being silent, which is a finding worth more than this
  // task.
  it("regression: a superseded reload announces no saving-paused banner (documents the silence, not the defect)", async () => {
    const { result } = await setupSupersededReloadScenario();
    expect(result.current.loadPause).toBeNull();
  });

  // ★★★ THE REJECTION LEG. The guard after `await backend.load()` only covers a
  // reload that RESOLVES; one that THROWS resumes in the `catch`, which raises
  // the sticky storage banner (`emitOutcome`) and an error toast — against the
  // project the user switched TO, about a backend they are no longer on. Same
  // defect class as the four above, and worse than the toast suggests: the
  // banner is sticky and outlives it.
  // ★★ Split into two `it`s over one helper for the same reason the four above
  // are: an `expect` that throws stops the ones after it, so a single test
  // asserting both would leave whichever came second UNREACHED under the very
  // mutant that is supposed to prove it. Measured: with the catch guard deleted,
  // the first assertion fires and the second is never evaluated.
  it("a superseded reload that REJECTS takes the drop path (its own diagnostic, labelled rejected)", async () => {
    await setupSupersededRejectingReloadScenario();
    expect(logDiagSpy).toHaveBeenCalledWith("warn", "storage.supersededLoadDropped", { writer: "reloadCurrentProject", outcome: "rejected" });
  });

  it("a superseded reload that REJECTS raises no error toast over the project the user switched to", async () => {
    await setupSupersededRejectingReloadScenario();
    expect(showToast).not.toHaveBeenCalledWith("error", expect.any(String));
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// §588, THE PICKER HALF. `onPickStorageFile` has the same shape as the reload —
// it captures the render-scope backend and reaches `allowSavesToActiveBackend`
// after an await — but it has several awaits, and each needs its own witness.
// Every other test of this op mocks the picker to `null`, so it returns before
// any guard: deleting them all outright leaves the rest of the suite green.
// These three tests are the only thing standing under them.
// ★★ §590 RENUMBERED THEM 1-of-3, and this file pins the OUTER two. The op picks
// without binding and then READS the chosen file, which is a new await between
// the old guards. ★★ THE GUARDS ARE NAMED BY THEIR `stage` LABEL NOW, NOT
// NUMBERED — picker · read · bind · write — because every addition renumbered
// every citation in two files and the last one left three of them wrong. This
// file pins the PICKER-to-write stretch and the WRITE window; the read and bind
// windows need a controllable file read and a controllable `idbSet`, which only
// the real-backend harness in use-storage-file-ops.pick-overwrite.test.tsx has.
// ───────────────────────────────────────────────────────────────────────────────

/** Queue ONE "Pick storage file" whose OS dialog stays open until the returned
 *  `release` is called. ★ Since §590 the promise's VALUE is used — it is the
 *  picked handle the op then reads and later binds — so it resolves with a
 *  handle-shaped stub rather than `undefined`. */
function openPickerDialog(): { release: () => void } {
  let release: () => void = () => {};
  (storageMod.pickFileHandleForBackend as ReturnType<typeof vi.fn>).mockReturnValueOnce(
    new Promise<{ name: string }>((resolve) => { release = () => resolve({ name: "picked.json" }); }),
  );
  return { release: () => release() };
}

/** THE PICKER WINDOW. Mount on `first` and let its own load open its gate, open
 *  the picker dialog against it, THEN rebuild onto `second` and let its load
 *  land — so when the user finally picks a file, the op resumes holding a
 *  backend nobody is on. The precondition (`second`'s gate really is open) is
 *  asserted with a real save, exactly as the reload scenario does. */
async function setupSupersededPickScenario() {
  const first = makeBackend(50, EMPTY, "browser");
  const second = makeBackend(100);
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

  const dialog = openPickerDialog();
  let pick!: Promise<void>;
  act(() => { pick = result.current.onPickStorageFile(); });
  expect(storageMod.pickFileHandleForBackend).toHaveBeenCalledTimes(1); // the op is genuinely parked on the dialog, not returned early

  rerender({ config: { kind: "turso" } as StorageConfig });
  await advance(150);
  expect(second.load).toHaveBeenCalledTimes(1);

  // ★ PRECONDITION, ASSERTED: `second`'s gate is open, shown by a save landing.
  await act(async () => { result.current.setTasks(EDIT_ONE); });
  await advance(SAVE_DEBOUNCE_MS + 100);
  expect(second.save).toHaveBeenCalledTimes(1);
  const savesBeforePick = second.save.mock.calls.length;

  await act(async () => { dialog.release(); await pick; });

  return { result, first, second, savesBeforePick };
}

describe("§588 — a superseded pick must not write to, or arm, the dead backend", () => {
  // ★ THE WRITE HALF. `guardedWrite(deps.backend, …)` calls `save` on the
  // captured instance, so with NO guard in the picker→write stretch the live
  // project's workspace is written to a backend the user has left — a
  // wrong-target write, not merely a misplaced gate. Its POSITIVE control is the
  // sibling test below: `second` does still receive a save on the same
  // arrangement, so "not called" here cannot pass because saving stopped working
  // altogether.
  // ★★★ THIS NO LONGER PINS THE PICKER GUARD, AND IT SAID IT DID. §590 added the
  // READ guard above `guardedWrite`, so that one stops this write too: disabling
  // the picker guard ALONE reds exactly one test, and it is not in this file —
  // measured, not predicted. ★ No tally here on purpose; this said "23/23 green"
  // and was stale by two within a day of being written.
  // The picker guard's only remaining unique kill lives in that other file
  // ("does not even read the picked file when a rebuild lands while the picker is
  // open"), because what it uniquely prevents now is the READ, which this harness
  // has no way to observe: it replaces the whole `./storage` facade, so no file is
  // ever read here. What this test still pins is that SOME guard stands between
  // the picker and the write.
  it("a rebuild during the picker drops the write to the superseded backend", async () => {
    const { first } = await setupSupersededPickScenario();
    expect(first.save).not.toHaveBeenCalled();
  });

  // ★ THE GATE HALF — the durable one. `allowSavesToActiveBackend()` resolves to
  // `allowSavesTo(first)`, moving the save gate off the backend on screen; every
  // later edit is then dropped in silence for the rest of the session.
  // ★★★ THIS TEST DOES NOT PIN THE PICKER GUARD, AND THE MUTATION TABLE SAYS SO —
  // measured, not predicted (I predicted it would). Deleting it leaves this GREEN,
  // because the op then runs on to a later guard, which catches the same rebuild
  // and refuses the same gate move. Its own sibling short-circuits the mutant.
  // Only deleting EVERY guard turns it red. Keep it anyway: it is the only
  // witness that the guards TOGETHER close the gate half, and it is the positive
  // control for its sibling's `not.toHaveBeenCalled()` — but do NOT cite it as
  // evidence for any guard on its own. The WRITE guard's unique kill is the
  // write-window test below; the PICKER guard's is in
  // use-storage-file-ops.pick-overwrite.test.tsx, and the READ guard is the one
  // that makes the write test above pass.
  // ★ §590 added the read and bind guards between them, so "the op runs on to a
  // later guard" is now true of several rather than one — which is also why the
  // write test above stopped pinning the picker guard.
  it("a rebuild during the picker leaves the live backend's gate open", async () => {
    const { result, second, savesBeforePick } = await setupSupersededPickScenario();

    await act(async () => { result.current.setTasks(EDIT_TWO); });
    await advance(SAVE_DEBOUNCE_MS + 100);

    expect(second.save).toHaveBeenCalledTimes(savesBeforePick + 1);
    expect(second.save.mock.calls[savesBeforePick][0].tasks.map((x: Task) => x.id)).toEqual([1, 2]);
  });

  // ★ THE WRITE GUARD's window, which no earlier guard can see: the rebuild lands
  // INSIDE `guardedWrite`'s own await, i.e. after both have already answered
  // "current". Here the picker resolves at once and `first.save` is what hangs.
  // ★★ The write is NOT recoverable at this point and the assertion says so —
  // `first.save` HAS been called. The write guard exists for the half that outlives the
  // tick: the gate. Asserting `first.save` was called is also what stops this
  // test passing vacuously by never entering the window at all.
  it("a rebuild during the write still leaves the live backend's gate open (the write itself is already gone)", async () => {
    const first = makeBackend(50, EMPTY, "browser");
    const second = makeBackend(100);
    createBackendMock.mockReturnValueOnce(first).mockReturnValue(second);
    let releaseSave: () => void = () => {};
    first.save = vi.fn(() => new Promise<void>((resolve) => { releaseSave = () => resolve(); }));

    const { result, rerender } = renderHook(
      (props: { config: StorageConfig }) => useProbe(makeArgs(props.config)),
      {
        wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
        initialProps: { config: { kind: "browser" } as StorageConfig },
      },
    );
    await advance(100);

    // The dialog closes IMMEDIATELY, so the picker guard sees a still-current backend and
    // waves the op through into the write.
    (storageMod.pickFileHandleForBackend as ReturnType<typeof vi.fn>).mockReturnValueOnce(Promise.resolve({ name: "picked.json" }));
    let pick!: Promise<void>;
    act(() => { pick = result.current.onPickStorageFile(); });
    await advance(1);
    expect(first.save).toHaveBeenCalledTimes(1); // parked INSIDE guardedWrite — the window this test is about

    rerender({ config: { kind: "turso" } as StorageConfig });
    await advance(150);
    expect(second.load).toHaveBeenCalledTimes(1);

    await act(async () => { result.current.setTasks(EDIT_ONE); });
    await advance(SAVE_DEBOUNCE_MS + 100);
    expect(second.save).toHaveBeenCalledTimes(1);
    const savesBeforeWriteLands = second.save.mock.calls.length;

    await act(async () => { releaseSave(); await pick; });

    await act(async () => { result.current.setTasks(EDIT_TWO); });
    await advance(SAVE_DEBOUNCE_MS + 100);
    expect(second.save).toHaveBeenCalledTimes(savesBeforeWriteLands + 1);
    expect(second.save.mock.calls[savesBeforeWriteLands][0].tasks.map((x: Task) => x.id)).toEqual([1, 2]);
    // ★★ THE `write` STAGE LABEL, asserted HERE because this is the only suite that can reach that
    //   window: it needs a `guardedWrite` that hangs, which means a controllable `backend.save`, and
    //   the real-backend harness in use-storage-file-ops.pick-overwrite.test.tsx writes through a
    //   real `LocalFileBackend`. The other four labels are asserted there.
    // ★ It was the one label of the five that nothing observed — the round that added the
    //   assertions pinned picker, read and the two binds and reported "all three", naming a set that
    //   did not include this one.
    expect(logDiagSpy).toHaveBeenCalledWith("warn", "storage.supersededPickDropped", { stage: "write" });
  });
});
