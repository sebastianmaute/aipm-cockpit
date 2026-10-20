// §4 §645 — the Turso project flows hand their own instance's revision to the LIVE backend, through
// the same single site the file flows use (`handOverFromRef`, consumed in the suppressed-load branch).
// Backends are FAIL CLOSED: a live instance that skipped its load and was handed nothing refuses its
// first save, and a blind write that is not declared with `forceNextSave()` refuses too.
// ★ Nothing that decides a save is doubled: the hook, the ops, `TursoBackend`, the statement builders
//   and `runTursoPipeline` are REAL, and the store is a real SQLite engine behind a fake `/v2/pipeline`
//   (`src/test/fake-turso.ts`) that runs §637's conditional batch — so the revision guard is enforced
//   by SQL, exactly as on a live database. Doubled is the environment: the broadcast channel and the
//   page reload migrate ends in.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { ProjectMeta, Task } from "./types";

vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn(), useRevisionSync: vi.fn(), postRevision: vi.fn() }));
vi.mock("./diagnostics", async (importOriginal) => ({ ...(await importOriginal<typeof import("./diagnostics")>()), logDiag: vi.fn() }));

import { BrowserBackend } from "./browser-backend";
import { CURRENT_TURSO_PROJECT_KEY, MODE_KEY } from "./portfolio-mode";
import type { StorageConfig } from "./storage";
import { emptyWorkspace } from "./storage";
import { TestProviders } from "./test-providers";
import { TursoBackend } from "./turso-backend";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";
import { fakeTursoFetch, storedRevision } from "../test/fake-turso";

const TURSO = { databaseUrl: "https://fake.turso.test", authToken: "fake-token" };
const CONFIG = { httpUrl: "https://fake.turso.test", authToken: "fake-token" };
const EDIT = "EDITED-AFTER-THE-OP";
const edited = {
  id: 91, taskName: EDIT, assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01",
  priority: "Medium", blockers: "", notes: "",
} as unknown as Task;
const META: ProjectMeta = {
  name: "Apollo", code: "APO", projectManager: "PM", keyStakeholdersInternal: [], keyStakeholdersExternal: [],
  customer: "Acme", naceSection: "C", identityTypes: [], products: "P", deployment: "Cloud",
  startDate: "2026-01-01", endDate: "2026-12-31", profitCenter: "PC-1", contactPersons: [], regulatory: [],
};
const showToast = vi.fn();

let db: DatabaseSync;

function renderApp(initial: StorageConfig) {
  const pause = { raised: 0, last: false };
  const hook = renderHook(() => {
    const [storageConfig, setStorageConfig] = useState(initial);
    const settings = useMemo(() => ({ storageConfig, integrations: { turso: TURSO } }) as unknown as Settings, [storageConfig]);
    const ops = useStorageBackend({
      settings, lang: "en-US" as Lang, hydrated: true, isPopout: false, showToast, showToastAction: vi.fn(),
      onRevealSavingPaused: vi.fn(), setStorageConfig, onStorageOutcome: vi.fn(),
    });
    if (ops.conflictPause && !pause.last) pause.raised += 1;
    pause.last = ops.conflictPause;
    return { ops, workspace: useWorkspace() };
  }, { wrapper: TestProviders });
  return { hook, ops: () => hook.result.current.ops, conflicts: () => pause.raised };
}
type App = ReturnType<typeof renderApp>;

async function settle(ms = 50) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
async function booted(app: App) {
  await waitFor(() => expect(app.ops().loadPending).toBe(false));
  await settle();
}

const taskNames = (projectId: string): string[] =>
  db.prepare("SELECT taskName FROM tasks WHERE project_id = ?").all(projectId).map((r) => String(r.taskName));

/** Makes one edit and waits until it is stored in `projectId`, or the conflict pause is raised. */
async function editAndSave(app: App, projectId: string) {
  const before = app.conflicts();
  await act(async () => { app.hook.result.current.workspace.setTasks([edited]); });
  await waitFor(() => expect(taskNames(projectId).includes(EDIT) || app.conflicts() > before).toBe(true), { timeout: 4000 });
}

/** Writes `ws` into tenant project `id` the way a peer would, `times` times (revision = `times`). */
async function seedProject(id: string, times = 1) {
  const peer = new TursoBackend(CONFIG, id);
  peer.forceNextSave();
  await peer.save({ ...emptyWorkspace(), project: META });
  for (let i = 1; i < times; i += 1) await peer.save({ ...emptyWorkspace(), project: { ...META } });
}

const originalLocation = window.location;
beforeEach(() => {
  vi.clearAllMocks();
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  db = new DatabaseSync(":memory:");
  vi.stubGlobal("fetch", fakeTursoFetch(db));
  // `migrateCurrentProjectToTurso` ends in `window.location.reload()`; jsdom's is a no-op that warns.
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload: vi.fn() } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  db.close();
});

describe("useStorageBackend — the Turso project flows save under the revision they were opened with (§4 §645)", () => {
  it("switchToTursoProject: the first save after the switch is written, and bumps the target's revision", async () => {
    await seedProject("p1");
    await seedProject("p2", 3);
    localStorage.setItem(CURRENT_TURSO_PROJECT_KEY, "p1");
    const app = renderApp({ kind: "turso" });
    await booted(app);
    await act(async () => { await app.ops().switchToTursoProject("p2"); });
    await settle();
    await editAndSave(app, "p2");
    expect(app.conflicts()).toBe(0);
    expect(taskNames("p2")).toEqual([EDIT]);
    expect(storedRevision(db, "p2")).toBe("4");
    expect(taskNames("p1")).toEqual([]); // and the edit did not land in the project switched away from
  });

  it("switchToTursoProject: a peer's write between the switch and the first save refuses that save", async () => {
    await seedProject("p1");
    await seedProject("p2");
    localStorage.setItem(CURRENT_TURSO_PROJECT_KEY, "p1");
    const app = renderApp({ kind: "turso" });
    await booted(app);
    await act(async () => { await app.ops().switchToTursoProject("p2"); });
    await settle();
    const peer = new TursoBackend(CONFIG, "p2");
    await peer.load();
    await peer.save({ ...emptyWorkspace(), project: { ...META, name: "Peer" } });
    await editAndSave(app, "p2");
    expect(app.conflicts()).toBe(1);
    expect(taskNames("p2")).toEqual([]);
    expect(storedRevision(db, "p2")).toBe("2");
  });

  it("createTursoProject: writes the new project blind, then saves the next edit into it", async () => {
    await seedProject("p1");
    localStorage.setItem(CURRENT_TURSO_PROJECT_KEY, "p1");
    const app = renderApp({ kind: "turso" });
    await booted(app);
    await act(async () => { await app.ops().createTursoProject({ ...META, name: "Brand new" }); });
    await settle();
    const id = localStorage.getItem(CURRENT_TURSO_PROJECT_KEY) ?? "";
    expect(id).not.toBe("p1");
    expect(storedRevision(db, id)).toBe("1"); // the create's own blind write
    await editAndSave(app, id);
    expect(app.conflicts()).toBe(0);
    expect(taskNames(id)).toEqual([EDIT]);
    expect(storedRevision(db, id)).toBe("2");
  });

  it("migrateCurrentProjectToTurso: writes the copy blind into the new project", async () => {
    const seed = new BrowserBackend();
    seed.forceNextSave();
    await seed.save({ ...emptyWorkspace(), tasks: [edited], project: META });
    const app = renderApp({ kind: "browser" });
    await booted(app);
    await act(async () => { await app.ops().migrateCurrentProjectToTurso(); });
    const id = localStorage.getItem(CURRENT_TURSO_PROJECT_KEY) ?? "";
    expect(id).not.toBe("");
    expect(taskNames(id)).toEqual([EDIT]);
    expect(storedRevision(db, id)).toBe("1");
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});

// §751 — with the portfolio on Turso and NO project chosen, `createBackend` hands back the single-project
// `TursoBackend`, whose save starts with an unscoped `DELETE FROM` every workspace table. On a database
// that holds projects those are the same tables, so that save would wipe every project. Measured live
// (2026-10-18): the first setup on an empty database ran it, and its unconfirmed copy was the "Turso
// workspace (no project)" draft. Nothing may be saved in that state.
describe("§751 — the Turso portfolio with no project chosen saves nothing", () => {
  const KEPT = { ...edited, id: 7, taskName: "KEPT-IN-P1" } as unknown as Task;

  // §753 — the flag the no-project banner and the footer's "saving paused" read; false once a project is chosen.
  it.each([
    ["no project is chosen", null, true],
    ["a project is chosen", "p1", false],
  ])("reports tursoPortfolioWithoutProject when %s", async (_label, projectId, expected) => {
    localStorage.setItem(MODE_KEY, "turso");
    if (projectId) localStorage.setItem(CURRENT_TURSO_PROJECT_KEY, projectId);
    const app = renderApp({ kind: "turso" });
    await booted(app);
    expect(app.ops().tursoPortfolioWithoutProject).toBe(expected);
  });

  it("an edit with no project chosen leaves every stored project as it was", async () => {
    const peer = new TursoBackend(CONFIG, "p1");
    peer.forceNextSave();
    await peer.save({ ...emptyWorkspace(), project: META, tasks: [KEPT] });
    expect(taskNames("p1")).toEqual(["KEPT-IN-P1"]);
    localStorage.setItem(MODE_KEY, "turso"); // the portfolio is on Turso; no CURRENT_TURSO_PROJECT_KEY
    // Every statement sent is kept: the rows surviving is not enough, since a rolled-back batch hides a
    // wipe that a different revision state would commit (measured: the delete IS sent, then rolled back).
    const sent: string[] = [];
    const real = fakeTursoFetch(db);
    vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
      sent.push(String((args[1] as RequestInit | undefined)?.body ?? ""));
      return real(...args);
    }) as typeof fetch);
    const app = renderApp({ kind: "turso" });
    await booted(app);
    await act(async () => { app.hook.result.current.workspace.setTasks([edited]); });
    await settle(2500); // past the save debounce
    expect(sent.filter((b) => /DELETE FROM tasks(?! WHERE)/.test(b))).toEqual([]);
    expect(taskNames("p1")).toEqual(["KEPT-IN-P1"]);
    expect(storedRevision(db, "p1")).toBe("1");
  });

  // The pre-switch flush (`flushCurrent`) writes the live workspace to the CURRENT backend before a
  // switch or a create. In this state that is the single-project backend, so picking a project — the
  // very action that leaves the state — would send the same unscoped delete.
  it("choosing a project with no project chosen flushes nothing to the single-project layout", async () => {
    const peer = new TursoBackend(CONFIG, "p1");
    peer.forceNextSave();
    await peer.save({ ...emptyWorkspace(), project: META, tasks: [KEPT] });
    localStorage.setItem(MODE_KEY, "turso");
    const sent: string[] = [];
    const real = fakeTursoFetch(db);
    vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
      sent.push(String((args[1] as RequestInit | undefined)?.body ?? ""));
      return real(...args);
    }) as typeof fetch);
    const app = renderApp({ kind: "turso" });
    await booted(app);
    await act(async () => { app.hook.result.current.workspace.setTasks([edited]); });
    await act(async () => { await app.ops().switchToTursoProject("p1"); });
    expect(sent.filter((b) => /DELETE FROM tasks(?! WHERE)/.test(b))).toEqual([]);
    expect(taskNames("p1")).toEqual(["KEPT-IN-P1"]);
    expect(storedRevision(db, "p1")).toBe("1");
  });
});
