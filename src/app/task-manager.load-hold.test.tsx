// §548 — the load hold, pinned at its only call site. While `loadPending` is true the MAIN window
// renders PanelSkeleton instead of the app tree, so no control that writes workspace state exists to
// race the load. The writers that do NOT unmount — the insight reconcile timer and the undo hotkey —
// gate themselves. The load is held open with a deferred `BrowserBackend.load`, so the pending window
// is observable rather than a race the test would usually lose.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { t } from "./i18n";
import { BrowserBackend } from "./browser-backend";
import { emptyWorkspace, type Workspace } from "./workspace";
import { DEFAULT_TASK_STATUS, type Task } from "./types";
import { reconcileInsights } from "./insights/reconcile";

const undoCalls = vi.hoisted(() => ({ n: 0 }));
const redoCalls = vi.hoisted(() => ({ n: 0 })); // §548 F1 item 6 — the REDO half of the same gate, unpinned before this.
const handed = vi.hoisted(() => ({ calendar: [] as boolean[], recs: [] as boolean[] }));

vi.mock("./use-calendar-integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-calendar-integrations")>();
  return {
    ...actual,
    useCalendarIntegrations: (d: Parameters<typeof actual.useCalendarIntegrations>[0]) => {
      handed.calendar.push(d.loadPending);
      return actual.useCalendarIntegrations(d);
    },
  };
});

vi.mock("./use-insight-recommendations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-insight-recommendations")>();
  return {
    ...actual,
    useInsightRecommendations: (d: Parameters<typeof actual.useInsightRecommendations>[0]) => {
      handed.recs.push(d.loadPending);
      return actual.useInsightRecommendations(d);
    },
  };
});
// §548 revision — drives the settings secret merge: "real" (default), "hang" (never settles) or "throw".
const secretMode = vi.hoisted(() => ({ mode: "real" as "real" | "hang" | "throw" }));

vi.mock("./secrets-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./secrets-store")>();
  return {
    ...actual,
    migratePlaintextSecrets: (input: Parameters<typeof actual.migratePlaintextSecrets>[0]) =>
      secretMode.mode === "hang" ? new Promise<never>(() => {})
        : secretMode.mode === "throw" ? Promise.reject(new Error("secret store down"))
          : actual.migratePlaintextSecrets(input),
  };
});

// Count real undo calls without changing `undo`'s identity between renders.
vi.mock("./undo/use-undo-stack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./undo/use-undo-stack")>();
  const wrapped = new WeakMap<() => void, () => void>();
  return {
    ...actual,
    useUndoStack: (deps: Parameters<typeof actual.useUndoStack>[0]) => {
      const api = actual.useUndoStack(deps);
      let undo = wrapped.get(api.undo);
      if (!undo) {
        const real = api.undo;
        undo = () => { undoCalls.n += 1; real(); };
        wrapped.set(real, undo);
      }
      let redo = wrapped.get(api.redo);
      if (!redo) {
        const real = api.redo;
        redo = () => { redoCalls.n += 1; real(); };
        wrapped.set(real, redo);
      }
      return { ...api, undo, redo };
    },
  };
});

vi.mock("./insights/reconcile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./insights/reconcile")>();
  return { ...actual, reconcileInsights: vi.fn(actual.reconcileInsights) };
});

vi.mock("./workspace-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-section")>();
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...actual,
    WorkspaceSection: () => {
      const { tasks } = useWorkspace();
      return <div data-testid="ws-section-mock" data-task-count={tasks.length} />;
    },
  };
});

import TaskManager from "./task-manager";

function task(id: number, taskName: string): Task {
  return {
    id, taskName, assignee: "M. Bennett", assigneeEmail: "", dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19", priority: "Medium", status: DEFAULT_TASK_STATUS,
    blockers: "", description: "",
  };
}

const LOADED: Workspace = { ...emptyWorkspace(), tasks: [task(1, "Loaded one"), task(2, "Loaded two")] };

/** A deferred `BrowserBackend.load`. `land` resolves EVERY call made so far and answers any later call
 *  at once. ★ Settings hydration can rebuild the backend memo and re-run the load effect, so there may
 *  be more than one call, and resolving only the latest could leave the effective run pending. */
function holdLoad() {
  const waiting: Array<(w: Workspace) => void> = [];
  let landed: Workspace | null = null;
  const spy = vi.spyOn(BrowserBackend.prototype, "load").mockImplementation(() =>
    landed !== null ? Promise.resolve(landed) : new Promise<Workspace>((resolve) => { waiting.push(resolve); }),
  );
  return {
    spy,
    land: (w: Workspace) => {
      landed = w;
      for (const resolve of waiting.splice(0)) resolve(w);
    },
  };
}

/** `withSettings` stores a settings blob, which is what makes `useSettings` take the secret-merge path
 *  (with no blob it hydrates on the defaults at once). */
function mountAt(search: string, opts: { withSettings?: boolean } = {}) {
  window.localStorage.clear();
  window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({
    projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
    currentProjectId: "p1",
  }));
  if (opts.withSettings) window.localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  window.history.replaceState(null, "", search);
  render(<TaskManager />);
}

const loadingText = () => screen.queryByText(t("en-US", "loading"));

beforeEach(() => {
  __resetMintStateForTests();
  undoCalls.n = 0;
  redoCalls.n = 0;
  secretMode.mode = "real";
  handed.calendar.length = 0;
  handed.recs.length = 0;
  vi.mocked(reconcileInsights).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("§548 — no edit can start while the load is pending", () => {
  it("renders the loading placeholder instead of the app until the load lands, and the landed load is intact", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled()); // the hold answers a REAL pending load
    await waitFor(() => expect(loadingText()).not.toBeNull());
    expect(loadingText()!.closest('[role="status"]')).not.toBeNull();
    // No app tree, so no control that writes: no pane, no shell navigation.
    expect(screen.queryByTestId("ws-section-mock")).toBeNull();
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);

    await act(async () => { load.land(LOADED); });
    const pane = await screen.findByTestId("ws-section-mock");
    expect(pane.getAttribute("data-task-count")).toBe("2"); // the loaded data is what shows
    expect(screen.queryAllByRole("navigation").length).toBeGreaterThan(0);
  }, 45000);

  it("a FAILED load releases the hold and shows the storage banner", async () => {
    vi.spyOn(BrowserBackend.prototype, "load").mockRejectedValue(new Error("load boom"));
    mountAt("/");
    expect(await screen.findByTestId("ws-section-mock")).toBeInTheDocument();
    expect(screen.queryAllByRole("navigation").length).toBeGreaterThan(0);
    // A plain Error classifies as "generic" (classifyStorageError), so the sticky banner carries this text.
    // A timed-out SharePoint load throws the same kind of error (Task 4), so this is its render half too.
    expect(await screen.findByText(t("en-US", "storageSaveFailedBanner"))).toBeInTheDocument();
  }, 45000);

  // ── spec revision 2026-09-19: the pre-hydration window is held too ──────────────────────────────
  it("holds BEFORE hydration: while the secret merge is pending there is a skeleton, no app, and no load yet; the bound then lifts it", async () => {
    secretMode.mode = "hang";
    const loadSpy = vi.spyOn(BrowserBackend.prototype, "load");
    mountAt("/", { withSettings: true });
    await waitFor(() => expect(loadingText()).not.toBeNull()); // i18n is ready, settings are not hydrated
    expect(loadSpy).not.toHaveBeenCalled(); // control: this IS the pre-hydration window, no load has started
    expect(screen.queryByTestId("ws-section-mock")).toBeNull();
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);

    // SECRET_MERGE_TIMEOUT_MS (5 s) hydrates on the fallback; the load then runs and settles.
    expect(await screen.findByTestId("ws-section-mock", {}, { timeout: 15000 })).toBeInTheDocument();
  }, 45000);

  it("a FAILING secret merge still lifts the hold", async () => {
    secretMode.mode = "throw";
    mountAt("/", { withSettings: true });
    expect(await screen.findByTestId("ws-section-mock")).toBeInTheDocument();
    expect(screen.queryAllByRole("navigation").length).toBeGreaterThan(0);
  }, 45000);

  it("a popout never shows the skeleton, even while its own load is pending", async () => {
    const load = holdLoad();
    mountAt("/?popout=raid");
    expect(await screen.findByTestId("ws-section-mock")).toBeInTheDocument();
    expect(loadingText()).toBeNull();
    await act(async () => { load.land(LOADED); });
  }, 45000);

  it("does not run the insight reconcile while the load is pending, and runs it once the load lands", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    // Well past INSIGHTS_RECONCILE_DEBOUNCE_MS (4 s), with the load still held.
    await act(async () => { await new Promise((r) => setTimeout(r, 6000)); });
    expect(vi.mocked(reconcileInsights)).not.toHaveBeenCalled();

    await act(async () => { load.land(LOADED); });
    await waitFor(() => expect(vi.mocked(reconcileInsights)).toHaveBeenCalled(), { timeout: 10000 });
  }, 45000);

  it("ignores the undo hotkey while the load is pending, and honours it once the load lands", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    await waitFor(() => expect(loadingText()).not.toBeNull()); // the hold is up
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoCalls.n).toBe(0);

    await act(async () => { load.land(LOADED); });
    await screen.findByTestId("ws-section-mock");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoCalls.n).toBe(1); // control: the same keystroke does undo once the load has landed
  }, 45000);

  // §548 F1 item 6 — the REDO half of the same `loadPendingRef` gate (task-manager.tsx), previously
  // unpinned: only the undo chord above had a test.
  it("ignores the redo hotkey while the load is pending, and honours it once the load lands", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    await waitFor(() => expect(loadingText()).not.toBeNull()); // the hold is up
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
    expect(redoCalls.n).toBe(0);

    await act(async () => { load.land(LOADED); });
    await screen.findByTestId("ws-section-mock");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
    expect(redoCalls.n).toBe(1); // control: the same chord does redo once the load has landed
  }, 45000);

  it("hands loadPending to the background hooks: true while held, false once the load lands", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    await waitFor(() => expect(loadingText()).not.toBeNull()); // the hold is up
    expect(handed.calendar[handed.calendar.length - 1]).toBe(true);
    expect(handed.recs[handed.recs.length - 1]).toBe(true);

    await act(async () => { load.land(LOADED); });
    await screen.findByTestId("ws-section-mock");
    expect(handed.calendar[handed.calendar.length - 1]).toBe(false);
    expect(handed.recs[handed.recs.length - 1]).toBe(false);
  }, 45000);
});
