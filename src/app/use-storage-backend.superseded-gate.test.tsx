// Probe for open-followups §588 — filed from reading code, never reproduced.
//
// ★★★ THE CLAIM: a reload started against the backend of the CURRENT render (`first`) can still be
// AWAITING when a settings-driven rebuild (e.g. a Turso URL/token edit) mints a NEW backend instance
// (`second`) and its own load effect lands, opening `second`'s save gate (`allowSavesTo(second)`,
// use-storage-backend.ts:421 via `applyWorkspaceFromLoad`). If the STALE reload against `first` then
// resolves, its own `applyWorkspaceFromLoad` call — reached through `reloadCurrentProject`'s render-#1
// closure — calls `allowSavesTo(first)` (use-storage-backend.ts:421), which moves the gate OFF the
// live backend. An edit made after that point is silently never persisted: no banner, no toast,
// because `loadPause` is published only for an instance whose OWN load failed or was refused — a
// superseded reload is neither.
//
// This file proves the precondition explicitly (§588's own PR ruling — see task-2-brief.md's ruling
// (b)): `second`'s gate must be OPEN, demonstrated by an actual save landing on it, BEFORE the stale
// reload is allowed to resolve and (on today's code) close it again.
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

describe("§588 — a superseded reload must not shut the new backend's gate", () => {
  it("a reload that resolves after a rebuild does not open the new backend's gate", async () => {
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
    // near it. If this fails, the scenario below is set up wrong — the whole probe
    // would be turning on a gate that was never open in the first place.
    await act(async () => { result.current.setTasks(EDIT_ONE); });
    await advance(SAVE_DEBOUNCE_MS + 100);
    expect(second.save).toHaveBeenCalledTimes(1);
    expect(second.save.mock.calls[0][0].tasks.map((x: Task) => x.id)).toEqual([1]);
    const savesBeforeStaleReload = second.save.mock.calls.length;

    // Now let the STALE reload (against `first`) resolve. On today's code this
    // resolves through `reloadCurrentProject`'s render-#1 closure, whose
    // `applyWorkspaceFromLoad` calls `allowSavesTo(first)` — moving the gate away
    // from `second`, the backend actually live and on screen.
    await act(async () => { releaseFirstLoad(STALE_RELOAD_RESULT); await reload; });

    // A second edit, after the stale reload landed.
    await act(async () => { result.current.setTasks(EDIT_TWO); });
    await advance(SAVE_DEBOUNCE_MS + 100);

    // ★ RED TODAY, AND THIS IS THE ASSERTION THE PROBE EXISTS FOR. `second` is
    // still the live, on-screen backend (the config passed to the hook never
    // reverted), so this edit must be persisted to it. Today it silently is not —
    // no banner, no toast, because `loadPause` only publishes for an instance
    // whose own load failed or was refused, and this reload did neither.
    expect(second.save).toHaveBeenCalledTimes(savesBeforeStaleReload + 1);
    expect(second.save.mock.calls[savesBeforeStaleReload][0].tasks.map((x: Task) => x.id)).toEqual([1, 2]);

    // Sanity: the stale backend never receives a save of its own — its gate is
    // never legitimately open (it lost `workspaceLoaded`/`settledBackend` the
    // moment `second` was minted), so this always passes and is not the probe.
    expect(first.save).not.toHaveBeenCalled();
  });
});
