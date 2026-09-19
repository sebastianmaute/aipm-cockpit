// Regression pins for open-followups §591: after a settings-driven REBUILD onto a different storage
// target (a Turso URL/token edit, a SharePoint target change), the load effect and
// `reloadCurrentProject` MERGED the previous target's activity log and budget history into the new
// one. The rule under test: MERGE only when the in-scope workspace belongs to the SAME target
// (`storageTargetKey`), otherwise REPLACE. (d) and (e) are the anti-overcorrection pins: a rebuild
// of the SAME target must keep merging.
// ★ Own file, like the load-gate pins: the main suite's module-level `mockBackend` is shared state,
//   and this file also mocks `useMsAuth` to drive an `acquireToken`-only rebuild (hypothetical today:
//   the real `acquireToken` is stable, see (d)).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { BudgetHistoryEntry } from "./budget-history";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageConfig } from "./storage";
import type { Task } from "./types";

const auth = vi.hoisted(() => ({
  acquireToken: (async () => null) as (scopes: readonly string[], options?: { interactive?: boolean }) => Promise<string | null>,
}));

vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: async () => {}, signOut: async () => {}, acquireToken: auth.acquireToken }),
}));
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

function entry(id: string, timestamp: string): ActivityEntry {
  return { id, timestamp, kind: "task.updated", args: [1, id] } as unknown as ActivityEntry;
}
function hist(id: string): BudgetHistoryEntry {
  return {
    id, at: "2026-09-01T08:00:00.000Z", date: "2026-09-01", kind: "baseline", bucketId: null, bucketName: "",
    projectBacHours: 0, projectBacValue: 0, deltaHours: 0, deltaValue: 0,
  };
}

const TASK_A = [{ id: 1, taskName: "A" } as unknown as Task];
const TASK_B = [{ id: 9, taskName: "B" } as unknown as Task];
const A_WS = { tasks: TASK_A, raid: [], absences: [], shifts: [], activityLog: [entry("a-1", "2026-09-01T08:00:00.000Z")], budgetHistory: [hist("ha-1")] };
const B_WS = { tasks: TASK_B, raid: [], absences: [], shifts: [], activityLog: [entry("b-1", "2026-09-02T08:00:00.000Z")], budgetHistory: [hist("hb-1")] };
const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };
const LOCAL_ENTRY = entry("local-1", "2026-09-03T08:00:00.000Z");
const LOCAL_HIST = hist("hl-1");
// Fix round 1 (§591 reviewer finding): a SECOND target-A payload, distinguishable from A_WS, so a
// round trip back to A can tell a REPLACE (this data alone) from a MERGE (this data plus whatever
// was left in memory from the leg in between).
const A2_WS = { tasks: [{ id: 30, taskName: "A2" } as unknown as Task], raid: [], absences: [], shifts: [], activityLog: [entry("a2-1", "2026-09-06T08:00:00.000Z")], budgetHistory: [hist("ha2-1")] };
const RELOAD_B_WS = { tasks: [{ id: 20, taskName: "RB" } as unknown as Task], raid: [], absences: [], shifts: [], activityLog: [entry("rb-1", "2026-09-05T08:00:00.000Z")], budgetHistory: [hist("hrb-1")] };

type FakeBackend = {
  kind: string;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  isReady: ReturnType<typeof vi.fn>;
  describe: ReturnType<typeof vi.fn>;
};

/** A backend whose load resolves with `stored` after `ms` on the (fake) clock. */
function makeBackend(ms: number, stored: object): FakeBackend {
  return {
    kind: "browser",
    load: vi.fn(() => new Promise((resolve) => { setTimeout(() => resolve(stored), ms); })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

/**
 * Fix round 1 — a backend whose `load` returns `values[0]` on its first call and `values[1]`
 * (held thereafter) on every call after that, each after `ms` on the (fake) clock. Lets one mocked
 * instance stand in for "the same backend object, read twice" (the load effect's initial read, then
 * `reloadCurrentProject`'s re-read of that SAME `backend` — no second `createBackend` call happens).
 */
function makeSequentialBackend(ms: number, values: readonly [object, object]): FakeBackend {
  let call = 0;
  return {
    kind: "browser",
    load: vi.fn(() => new Promise((resolve) => {
      const v = values[Math.min(call, values.length - 1)];
      call += 1;
      setTimeout(() => resolve(v), ms);
    })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

type Args = Parameters<typeof useStorageBackend>[0];
function makeArgs(storageConfig: StorageConfig, turso?: { databaseUrl: string; authToken: string }): Args {
  return {
    settings: { storageConfig, integrations: turso ? { turso: { enabled: true, ...turso } } : undefined } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
  };
}
const tursoArgs = (databaseUrl: string, authToken = "tok-a") => makeArgs({ kind: "turso" }, { databaseUrl, authToken });
const spArgs = (itemPath: string) => makeArgs({ kind: "sp-json", hostname: "contoso.sharepoint.com", sitePath: "/sites/pm", itemPath });

function useProbe(args: Args) {
  const hook = useStorageBackend(args);
  const { tasks, activityLog, setActivityLog, budgetHistory, setBudgetHistory } = useWorkspace();
  return { ...hook, tasks, activityLog, setActivityLog, budgetHistory, setBudgetHistory };
}

function render(args: Args) {
  return renderHook((props: { args: Args }) => useProbe(props.args), {
    initialProps: { args },
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
}

/** Advance the fake clock in small steps, each in its own `act` (see the load-gate file for why). */
async function advance(ms: number) {
  const STEP = 25;
  for (let done = 0; done < ms; done += STEP) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - done)); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

const ids = (list: readonly { id: string }[]) => list.map((e) => e.id);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  auth.acquireToken = async () => null;
});
afterEach(() => { vi.useRealTimers(); });

describe("§591 — a load merges the activity log and budget history only onto the SAME target", () => {
  it("(a) a Turso URL change onto a POPULATED target: both slices are the target's own", async () => {
    const a = makeBackend(100, A_WS);
    const b = makeBackend(100, B_WS);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render(tursoArgs("libsql://a.turso.io"));
    await advance(300);
    expect(ids(result.current.activityLog)).toEqual(["a-1"]); // control: A applied

    rerender({ args: tursoArgs("libsql://b.turso.io") });
    await advance(300);
    expect(result.current.tasks.map((x) => x.id)).toEqual([9]); // control: B applied
    expect(ids(result.current.activityLog)).toEqual(["b-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["hb-1"]);
  });

  it("(b) a same-kind SharePoint target change onto a POPULATED target: both slices are the target's own", async () => {
    const a = makeBackend(100, A_WS);
    const b = makeBackend(100, B_WS);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render(spArgs("/Shared Documents/a.json"));
    await advance(300);
    expect(ids(result.current.activityLog)).toEqual(["a-1"]);

    rerender({ args: spArgs("/Shared Documents/b.json") });
    await advance(300);
    expect(result.current.tasks.map((x) => x.id)).toEqual([9]);
    expect(ids(result.current.activityLog)).toEqual(["b-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["hb-1"]);
  });

  it("(c) a rebuild onto an EMPTY target, then \"Reload project\": both slices are REPLACED, as the confirm text promises", async () => {
    const a = makeBackend(100, A_WS);
    const b = makeBackend(100, EMPTY);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, rerender } = render(tursoArgs("libsql://a.turso.io"));
    await advance(300);

    rerender({ args: tursoArgs("libsql://b.turso.io") });
    await advance(300);
    expect(result.current.loadPause).toBe("empty-refused"); // control: the refusal kept A in scope
    expect(ids(result.current.activityLog)).toEqual(["a-1"]);

    await act(async () => {
      const p = result.current.reloadCurrentProject();
      await vi.advanceTimersByTimeAsync(200);
      await p;
    });
    expect(confirmSpy).toHaveBeenCalled(); // control: the reload took the confirm path and applied
    expect(result.current.tasks).toEqual([]);
    expect(result.current.activityLog).toEqual([]);
    expect(result.current.budgetHistory).toEqual([]);
    confirmSpy.mockRestore();
  });

  // ★ HYPOTHETICAL TODAY: `useMsAuth`'s `acquireToken` is a stable `useCallback`, so an M365 sign-in/out
  //   does NOT rebuild the backend. This mock swaps the identity by hand to pin the key's `acquireToken`
  //   exclusion, so that IF the identity ever changes, a rebuild against the same target keeps merging.
  it("(d) an acquireToken-only rebuild is the SAME target: an entry appended during its load is still MERGED", async () => {
    const args = spArgs("/Shared Documents/a.json");
    const a = makeBackend(100, A_WS);
    const b = makeBackend(1000, A_WS); // the same target's stored copy: it has never seen the local append
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render(args);
    await advance(300);

    auth.acquireToken = async () => "signed-in";
    rerender({ args }); // same settings object: only acquireToken moved
    await advance(100);
    expect(b.load).toHaveBeenCalledTimes(1); // control: the rebuild really started a load
    await act(async () => {
      result.current.setActivityLog((prev) => [...prev, LOCAL_ENTRY]);
      result.current.setBudgetHistory((prev) => [...prev, LOCAL_HIST]);
    });
    await advance(1000);

    expect(ids(result.current.activityLog)).toEqual(["a-1", "local-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["ha-1", "hl-1"]);
  });

  it("(e) a rebuild with an EQUAL config (new object, same values) keeps merging", async () => {
    const a = makeBackend(100, A_WS);
    const b = makeBackend(1000, A_WS);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render(makeArgs({ kind: "browser" }));
    await advance(300);

    rerender({ args: makeArgs({ kind: "browser" }) });
    await advance(100);
    expect(b.load).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.setActivityLog((prev) => [...prev, LOCAL_ENTRY]); });
    await advance(1000);

    expect(ids(result.current.activityLog)).toEqual(["a-1", "local-1"]);
  });

  // ── Fix round 1 (reviewer finding) ──────────────────────────────────────────
  // (a)-(e) above pin the two TERNARIES (merge-vs-replace). None of them can tell a working
  // post-apply RE-STAMP (`scopeTargetKeyRef.current = targetKey`) from a deleted one, because within
  // a single load neither test re-reads the ref afterward. Each of (f)-(h) is a ROUND TRIP —
  // A → (something else) → A — where the THIRD leg's correctness depends on the SECOND leg having
  // left the ref pointing at its own target, not at whatever the ref held before it ran. A deleted
  // stamp leaves the ref stale, so the third leg's ternary wrongly matches A's key and MERGES
  // leftover data from the middle leg into A's fresh load — the same leak class §591 exists to close,
  // one hop later than (a)/(b) can see.
  it("(f) an A→B→A round trip: returning to A REPLACES (pins the load effect's applied-branch re-stamp, not just its ternary)", async () => {
    const a1 = makeBackend(100, A_WS);
    const b = makeBackend(100, B_WS);
    const a2 = makeBackend(100, A2_WS);
    createBackendMock.mockReturnValueOnce(a1).mockReturnValueOnce(b).mockReturnValue(a2);
    const { result, rerender } = render(tursoArgs("libsql://a.turso.io"));
    await advance(300);
    expect(ids(result.current.activityLog)).toEqual(["a-1"]); // control: A applied

    rerender({ args: tursoArgs("libsql://b.turso.io") });
    await advance(300);
    expect(ids(result.current.activityLog)).toEqual(["b-1"]); // control: B applied (replace — different target)

    rerender({ args: tursoArgs("libsql://a.turso.io") });
    await advance(300);
    // Must be an exact REPLACE with A2's own data — NOT merged with B's "b-1", which is what a stale
    // ref (still reading "A" from boot, never updated when B's load applied) would produce.
    expect(ids(result.current.activityLog)).toEqual(["a2-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["ha2-1"]);
  });

  it("(g) a same-target reload after a rebuild onto an empty (refused) target, then a return to A: A REPLACES (pins reloadCurrentProject's own re-stamp)", async () => {
    const a1 = makeBackend(100, A_WS);
    // ★ ONE mocked instance stands in for `backend` across BOTH the load effect's read of it (returns
    //   EMPTY, triggering the empty-refusal) and reloadCurrentProject's re-read of that SAME instance
    //   (returns RELOAD_B_WS) — reloadCurrentProject calls `backend.load()` again, it does not call
    //   `createBackend` again, so this must be one object, not a second queued mock.
    const bThenReload = makeSequentialBackend(100, [EMPTY, RELOAD_B_WS]);
    const a2 = makeBackend(100, A2_WS);
    createBackendMock.mockReturnValueOnce(a1).mockReturnValueOnce(bThenReload).mockReturnValue(a2);
    const { result, rerender } = render(tursoArgs("libsql://a.turso.io"));
    await advance(300);
    expect(ids(result.current.activityLog)).toEqual(["a-1"]); // control: A applied

    rerender({ args: tursoArgs("libsql://b.turso.io") });
    await advance(300);
    expect(result.current.loadPause).toBe("empty-refused"); // control: the refusal kept A in scope
    expect(ids(result.current.activityLog)).toEqual(["a-1"]);

    await act(async () => {
      const p = result.current.reloadCurrentProject();
      await vi.advanceTimersByTimeAsync(150);
      await p;
    });
    // Control: the reload really read B's (non-empty this time) data and replaced with it —
    // this leg's correctness comes from the ternary, which fix round 1 is not re-testing.
    expect(ids(result.current.activityLog)).toEqual(["rb-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["hrb-1"]);

    rerender({ args: tursoArgs("libsql://a.turso.io") });
    await advance(300);
    // Must be an exact REPLACE with A2's own data — NOT merged with the reload's "rb-1", which is
    // what a stale ref (never updated by reloadCurrentProject's own re-stamp) would produce.
    expect(ids(result.current.activityLog)).toEqual(["a2-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["ha2-1"]);
  });

  it("(h) a storage-kind conversion (suppress-branch re-stamp), then a return to A: A REPLACES", async () => {
    const a1 = makeBackend(100, A_WS);
    // The conversion target (write-only: onRequestStorageSwitch never calls its `load`) and the
    // rebuilt memo backend for the new ("browser") kind (suppressed: its `load` must not be called
    // either) — neither is ever read, so their stored payload is irrelevant.
    const conversionTarget = makeBackend(0, {});
    const browserBackend = makeBackend(0, {});
    const a2 = makeBackend(100, A2_WS);
    createBackendMock.mockReturnValueOnce(a1).mockReturnValueOnce(conversionTarget).mockReturnValueOnce(browserBackend).mockReturnValue(a2);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, rerender } = render(tursoArgs("libsql://a.turso.io"));
    await advance(300);
    expect(ids(result.current.activityLog)).toEqual(["a-1"]); // control: A applied

    // Convert storage kind WITHOUT changing the in-memory workspace (onRequestStorageSwitch copies
    // the LIVE workspace to the new backend; it never calls applyWorkspace).
    await act(async () => {
      await result.current.onRequestStorageSwitch("browser");
    });
    expect(conversionTarget.save).toHaveBeenCalledTimes(1); // control: the conversion write ran
    expect(confirmSpy).toHaveBeenCalled();

    // Simulate the parent re-rendering with the new config `emitStorageConfig` just reported — this
    // rebuilds the backend memo, and the load effect takes the SUPPRESS branch (armed by the
    // conversion above).
    rerender({ args: makeArgs({ kind: "browser" }) });
    await advance(100);
    expect(browserBackend.load).not.toHaveBeenCalled(); // control: suppressed — no real load
    expect(browserBackend.isReady).toHaveBeenCalled(); // control: the suppress branch's status refresh ran

    rerender({ args: tursoArgs("libsql://a.turso.io") });
    await advance(300);
    // Must be an exact REPLACE with A2's own data — NOT merged with A's original "a-1", which is
    // still in memory (the conversion never changed it) and is what a stale ref (never updated by the
    // suppress branch's own re-stamp) would produce.
    expect(ids(result.current.activityLog)).toEqual(["a2-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["ha2-1"]);
    confirmSpy.mockRestore();
  });
});
