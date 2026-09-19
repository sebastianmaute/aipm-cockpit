// Regression pins for open-followups §591: after a settings-driven REBUILD onto a different storage
// target (a Turso URL/token edit, a SharePoint target change), the load effect and
// `reloadCurrentProject` MERGED the previous target's activity log and budget history into the new
// one. The rule under test: MERGE only when the in-scope workspace belongs to the SAME target
// (`storageTargetKey`), otherwise REPLACE. (d) and (e) are the anti-overcorrection pins: a rebuild
// of the SAME target must keep merging.
// ★ Own file, like the load-gate pins: the main suite's module-level `mockBackend` is shared state,
//   and this file also mocks `useMsAuth` to drive an `acquireToken`-only rebuild.
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

  it("(d) an acquireToken-only rebuild (M365 sign-in/out) is the SAME target: an entry appended during its load is still MERGED", async () => {
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
});
