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
function makeBackend(ms: number, stored: object = EMPTY): FakeBackend {
  return {
    kind: "turso",
    load: vi.fn(() => new Promise((resolve) => { setTimeout(() => resolve(stored), ms); })),
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
});
