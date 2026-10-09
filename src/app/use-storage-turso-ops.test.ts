// src/app/use-storage-turso-ops.test.ts
//
// Guards the outgoing-project flush: a failed pre-switch save must surface
// (warn toast + logDiag) yet the switch still proceeds — previously the flush
// failure was swallowed by a bare `catch { /* best-effort */ }`, silently
// losing unsaved edits.
//
// Also pins the §103 half this file owns: a Turso project switch is a LOAD
// path, so the target's `lastLoadTruncation` must be reported. The deps object
// carries a REAL `useLoadTruncation` guard here, not a stub — the flush skip
// and the reporting are two faces of one state machine, and a stub would let
// each pass while the machine itself was wrong.
//
// And the §408 half: `migrateCurrentProjectToTurso` probes the CONNECTION
// before it migrates. That gate cannot live on the Settings button, because a
// second button in `projects-panel.tsx` is bound to the same handler — so this
// file, not `integrations-section.test.tsx`, is where it is pinned.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTursoProjectOps, type TursoProjectOpsDeps } from "./use-storage-turso-ops";
import { useLoadTruncation } from "./use-load-truncation";
import { t, type Lang } from "./i18n";
import { emptyWorkspace } from "./workspace";
import { SaveConflictError } from "./storage-error";

// `migrateCurrentProjectToTurso` probes the connection before it migrates, so
// the real one would reach the network here. Spread the actual module rather
// than replacing it wholesale — nothing else in this graph needs the pipeline
// today, and a bare factory would break silently the moment something does.
// ★ The default RESOLVES, so every pre-existing test in this file sees the
// probe pass and its behaviour is unchanged; the failing case opts in with
// `mockRejectedValueOnce`.
import { testTursoConnection } from "./turso-pipeline";
vi.mock("./turso-pipeline", async (importActual) => ({
  ...(await importActual<typeof import("./turso-pipeline")>()),
  testTursoConnection: vi.fn(async () => {}),
}));

const loadMock = vi.fn(async () => emptyWorkspace());
const saveMock = vi.fn(async () => {});
const forceMock = vi.fn();
// `lastLoadTruncation` is a plain PROPERTY on the real backends, so the mock
// carries it as one too and `load()` publishes it — the read order (load, then
// report) is then the production order.
const tursoTruncation: { current: { entries: number; blocks: number } | undefined } = { current: undefined };
vi.mock("./turso-backend", () => ({
  TursoBackend: class {
    lastLoadTruncation: { entries: number; blocks: number } | undefined = undefined;
    load = async () => {
      this.lastLoadTruncation = tursoTruncation.current;
      return loadMock();
    };
    save = saveMock;
    forceNextSave = forceMock;
  },
}));
vi.mock("./portfolio-mode", () => ({
  saveCurrentTursoProjectId: vi.fn(),
  savePortfolioMode: vi.fn(),
}));

// ★ `migrateCurrentProjectToTurso` reaches the shared portfolio DB and the
// settings writer before it ever touches a backend; both are mocked so the
// refusal can be observed as an ABSENCE of those calls.
import { createProject as portfolioCreate } from "./turso-portfolio";
vi.mock("./turso-portfolio", () => ({
  createProject: vi.fn(async () => {}),
  archiveProject: vi.fn(async () => {}),
  restoreProject: vi.fn(async () => {}),
  hardDeleteProject: vi.fn(async () => {}),
}));
vi.mock("./use-settings", () => ({ writeSettings: vi.fn() }));

import { logDiag } from "./diagnostics";
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));

const langRef = { current: "en-US" as Lang };

function makeDeps(overrides: Partial<TursoProjectOpsDeps> = {}): TursoProjectOpsDeps {
  return {
    isPopout: false,
    showToast: vi.fn(),
    langRef,
    settingsRef: { current: {} as never },
    tursoConfigNow: () => ({ httpUrl: "https://db.example", authToken: "tok" }) as never,
    tursoProjectId: "p-1",
    setTursoProjectId: vi.fn(),
    truncationOps: { reportFor: vi.fn(), raiseDecodeFailuresFor: vi.fn(), reportImportFor: vi.fn(), flushCurrent: vi.fn(async () => {}), guardedWrite: vi.fn(async () => true), wouldRefuseWrite: vi.fn(() => false), refuseWrite: vi.fn(), clearForFreshWorkspace: vi.fn() },
    currentWorkspace: () => emptyWorkspace(),
    applyWorkspace: vi.fn(),
    suppressNextLoadRef: { current: false },
    handOverFromRef: { current: null },
    suppressNextSaveRef: { current: false },
    reportProjectError: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders the ops hook with a REAL truncation guard wired into its deps —
 * `flushCurrent` writes through `saveCurrentWorkspace`, exactly as
 * `useStorageBackend` binds it.
 */
const wsWithProject = () => ({ ...emptyWorkspace(), project: { id: "p-1", name: "Migratable", code: "MIG" } }) as never;

function renderWithRealGuard(
  saveCurrentWorkspace: () => Promise<void>,
  overrides: Partial<TursoProjectOpsDeps> = {},
) {
  const showToast = vi.fn();
  return renderHook(() => {
    const guard = useLoadTruncation(langRef, showToast, saveCurrentWorkspace);
    const ops = useTursoProjectOps(makeDeps({ truncationOps: guard.truncationOps, showToast, ...overrides }));
    return { guard, ops, showToast };
  });
}

beforeEach(() => {
  loadMock.mockClear();
  saveMock.mockClear();
  forceMock.mockClear();
  tursoTruncation.current = undefined;
  vi.mocked(logDiag).mockClear();
  vi.mocked(testTursoConnection).mockClear();
});

describe("useTursoProjectOps — outgoing flush failure", () => {
  it("surfaces a failed flush (warn toast + logDiag) but still switches", async () => {
    const setTursoProjectId = vi.fn();
    const { result } = renderWithRealGuard(
      async () => { throw new Error("network down"); },
      { setTursoProjectId },
    );

    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });

    // Flush failure surfaced.
    expect(logDiag).toHaveBeenCalledWith("warn", "storage.switchFlushFailed", expect.objectContaining({ message: "network down" }));
    expect(result.current.showToast).toHaveBeenCalledWith("error", expect.any(String));
    // …yet the switch proceeded (target loaded + project id advanced).
    expect(loadMock).toHaveBeenCalled();
    expect(setTursoProjectId).toHaveBeenCalledWith("p-2");
  });

  it("does not warn when the flush succeeds", async () => {
    const { result } = renderWithRealGuard(async () => {});
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(logDiag).not.toHaveBeenCalledWith("warn", "storage.switchFlushFailed", expect.anything());
  });
});

describe("useTursoProjectOps — §103 truncation", () => {
  it("switchToTursoProject REPORTS the target's truncation", async () => {
    tursoTruncation.current = { entries: 6, blocks: 0 };
    const { result } = renderWithRealGuard(async () => {});
    expect(result.current.guard.loadWasIncomplete).toBe(false); // control

    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });

    expect(result.current.guard.loadWasIncomplete).toBe(true);
    expect(result.current.showToast).toHaveBeenCalledWith("error", expect.stringContaining("6"));
  });

  it("a clean target load LOWERS a flag raised by the previous project", async () => {
    tursoTruncation.current = { entries: 6, blocks: 0 };
    const { result } = renderWithRealGuard(async () => {});
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(result.current.guard.loadWasIncomplete).toBe(true);

    tursoTruncation.current = { entries: 0, blocks: 0 };
    await act(async () => { await result.current.ops.switchToTursoProject("p-3"); });

    expect(result.current.guard.loadWasIncomplete).toBe(false);
  });

  it("the outgoing flush is SKIPPED while a truncated load is unresolved", async () => {
    const saveCurrent = vi.fn(async () => {});
    tursoTruncation.current = { entries: 6, blocks: 0 };
    const { result } = renderWithRealGuard(saveCurrent);

    // First switch raises the flag (its own flush runs — nothing was wrong yet).
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(saveCurrent).toHaveBeenCalledTimes(1);
    expect(result.current.guard.loadWasIncomplete).toBe(true);

    // Second switch, now under an unresolved truncation: no write at all.
    await act(async () => { await result.current.ops.switchToTursoProject("p-3"); });
    expect(saveCurrent).toHaveBeenCalledTimes(1);
    // A skip is not a failure — it must not raise the flush-failed toast.
    expect(logDiag).not.toHaveBeenCalledWith("warn", "storage.switchFlushFailed", expect.anything());
    expect(logDiag).toHaveBeenCalledWith("warn", "storage.flushSkippedAfterTruncation", expect.anything());
  });

  it("createTursoProject CLEARS the flag — a fresh project does not inherit the pause", async () => {
    // ★ The third `clearForFreshWorkspace` site. It builds its workspace rather
    // than loading one, and sets suppressNextLoadRef, so nothing else would ever
    // lower the flag: without the clear, every edit to a brand-new project is
    // silently refused and the banner reports the OLD project's counts.
    tursoTruncation.current = { entries: 5, blocks: 0 };
    const { result } = renderWithRealGuard(async () => {});
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(result.current.guard.loadWasIncomplete).toBe(true); // control: really raised

    await act(async () => {
      await result.current.ops.createTursoProject({ id: "n-1", name: "New", code: "N" } as never);
    });

    expect(result.current.guard.loadWasIncomplete).toBe(false);
  });

  const SEED_TASK = { id: 1, taskName: "From seed", assignee: "B", assigneeEmail: "a,b@x.com", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", status: "To Do", createdDate: "2026-06-01" };

  it.each([
    ["a template", { includeSeed: true, template: { id: "t", name: "T", features: [], fieldVisibility: {}, seed: { tasks: [SEED_TASK] } } }],
    ["an AI-import seed", { includeSeed: true, aiSeed: { tasks: [SEED_TASK] } }],
    // The imported workspace IS the new project's content, so its records are
    // summarised like a template's — not routed through aiSeedUnsafeEmails,
    // which would see no aiSeed and report nothing.
    ["an imported workspace", { importedWorkspace: { ...emptyWorkspace(), tasks: [SEED_TASK] } }],
  ])("createTursoProject with %s shows the unsafe-email notice after projectCreatedToast (pre-flight I5)", async (_label, opts) => {
    const { result } = renderWithRealGuard(async () => {});
    await act(async () => {
      await result.current.ops.createTursoProject({ id: "n-2", name: "New", code: "N" } as never, opts as never);
    });
    const texts = result.current.showToast.mock.calls.map((c) => c[1]);
    const created = texts.indexOf(t("en-US", "projectCreatedToast", "New"));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf(t("en-US", "importUnsafeEmailsNotice", 1, "From seed"))).toBeGreaterThan(created);
  });

  it("createTursoProject resolves to the id it handed to portfolioCreate", async () => {
    const { result } = renderWithRealGuard(async () => {});
    let returned: string | null | undefined;
    await act(async () => { returned = await result.current.ops.createTursoProject({ id: "n-5", name: "New", code: "N" } as never); });
    const createdId = vi.mocked(portfolioCreate).mock.calls.at(-1)?.[2];
    expect(typeof createdId).toBe("string");
    expect(returned).toBe(createdId);
  });

  it("createTursoProject runs seedSnapshots with the new id after its save and BEFORE the project becomes current", async () => {
    const events: string[] = [];
    saveMock.mockImplementationOnce(async () => { events.push("save"); });
    const applyWorkspace = vi.fn(() => { events.push("apply"); });
    const setTursoProjectId = vi.fn(() => { events.push("switch"); });
    const seedSnapshots = vi.fn<(id: string) => Promise<void>>(async () => { events.push("seed"); });
    const { result } = renderWithRealGuard(async () => {}, { applyWorkspace, setTursoProjectId });
    let returned: string | null | undefined;
    await act(async () => { returned = await result.current.ops.createTursoProject({ id: "n-7", name: "New", code: "N" } as never, { seedSnapshots }); });
    const createdId = vi.mocked(portfolioCreate).mock.calls.at(-1)?.[2];
    expect(seedSnapshots).toHaveBeenCalledTimes(1);
    expect(seedSnapshots).toHaveBeenCalledWith(createdId);
    expect(returned).toBe(createdId);
    expect(events).toEqual(["save", "seed", "apply", "switch"]);
  });

  it("createTursoProject still creates and switches when seedSnapshots throws", async () => {
    const applyWorkspace = vi.fn();
    const reportProjectError = vi.fn();
    const seedSnapshots = vi.fn(async () => { throw new Error("seed boom"); });
    const { result } = renderWithRealGuard(async () => {}, { applyWorkspace, reportProjectError });
    let returned: string | null | undefined;
    await act(async () => { returned = await result.current.ops.createTursoProject({ id: "n-8", name: "New", code: "N" } as never, { seedSnapshots }); });
    expect(returned).toBe(vi.mocked(portfolioCreate).mock.calls.at(-1)?.[2]);
    expect(applyWorkspace).toHaveBeenCalledTimes(1);
    expect(reportProjectError).not.toHaveBeenCalled();
    expect(logDiag).toHaveBeenCalledWith("warn", "storage.createSeedFailed", { message: "seed boom" });
  });

  it("createTursoProject resolves null when portfolioCreate throws, reporting the error once", async () => {
    const reportProjectError = vi.fn();
    const { result } = renderWithRealGuard(async () => {}, { reportProjectError });
    vi.mocked(portfolioCreate).mockRejectedValueOnce(new Error("boom"));
    let returned: string | null | undefined;
    await act(async () => { returned = await result.current.ops.createTursoProject({ id: "n-6", name: "New", code: "N" } as never); });
    expect(returned).toBeNull();
    expect(reportProjectError).toHaveBeenCalledTimes(1);
  });

  // The demo reads `null` as "the Turso create failed" and picks its fallback from it, so the two
  // early returns before the try block must resolve `null` as well, having written nothing.
  it("createTursoProject resolves null, writing nothing, when there is no usable Turso config", async () => {
    const setTursoProjectId = vi.fn();
    const { result } = renderWithRealGuard(async () => {}, { tursoConfigNow: () => null, setTursoProjectId });
    vi.mocked(portfolioCreate).mockClear();
    let returned: string | null | undefined;
    await act(async () => { returned = await result.current.ops.createTursoProject({ id: "n-10", name: "New", code: "N" } as never); });
    expect(returned).toBeNull();
    expect(portfolioCreate).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
    expect(setTursoProjectId).not.toHaveBeenCalled();
    expect(result.current.showToast).toHaveBeenCalledWith("error", t("en-US", "projectsTursoUnreachable"));
  });

  it("createTursoProject with no seed shows no notice (positive control above)", async () => {
    const { result } = renderWithRealGuard(async () => {});
    await act(async () => {
      await result.current.ops.createTursoProject({ id: "n-3", name: "New", code: "N" } as never);
    });
    const texts = result.current.showToast.mock.calls.map((c) => String(c[1]));
    expect(texts).toContain(t("en-US", "projectCreatedToast", "New"));
    expect(texts.some((s) => s.startsWith("Imported records with an invalid email address"))).toBe(false);
  });

  // ★★★ THE KILL LINE FOR MIGRATE'S PRE-CHECK. Removing it left this whole file
  // green: the census below only proves this FILE has one `.save(`, which says
  // nothing about whether migrate calls `guardedWrite`, honours its return, or
  // declines before its irreversible step. Without this test the §103 loss was
  // one deleted line away, on a green board.
  //
  // The assertion is on `portfolioCreate` specifically, because that is the
  // irreversible part: it inserts a live, non-archived row into the SHARED
  // portfolio DB. Refusing after it leaves a phantom project named after the
  // user's, opening empty forever, while the toast says "nothing is
  // overwritten".
  it("migrate declines BEFORE creating the portfolio row, leaving no phantom project", async () => {
    const saveCurrent = vi.fn(async () => {});
    tursoTruncation.current = { entries: 4, blocks: 0 };
    // ★★★ `wsWithProject` IS LOAD-BEARING, not scenery. Without it the workspace
    // has no `project` meta, migrate returns at its "no project" check BEFORE
    // reaching either the guard or `portfolioCreate`, and this test passes
    // identically with the guard DELETED. It did exactly that when first
    // written — a vacuous test, in the commit that exists to add a kill line.
    const { result } = renderWithRealGuard(saveCurrent, { currentWorkspace: wsWithProject });

    // Raise the flag through a real load, then clear the call record.
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(result.current.guard.loadWasIncomplete).toBe(true); // control: really raised
    vi.mocked(portfolioCreate).mockClear();
    saveMock.mockClear();

    await act(async () => { await result.current.ops.migrateCurrentProjectToTurso(); });

    expect(portfolioCreate).not.toHaveBeenCalled(); // no phantom row
    expect(saveMock).not.toHaveBeenCalled();        // and nothing written
  });

  it("migrate proceeds normally when nothing is truncated", async () => {
    // ★ The control. Without it, "not called" above is equally satisfied by a
    // migrate that never works at all.
    const saveCurrent = vi.fn(async () => {});
    tursoTruncation.current = { entries: 0, blocks: 0 };
    const { result } = renderWithRealGuard(saveCurrent, { currentWorkspace: wsWithProject });
    vi.mocked(portfolioCreate).mockClear();
    saveMock.mockClear();

    await act(async () => { await result.current.ops.migrateCurrentProjectToTurso(); });

    expect(portfolioCreate).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });
});

describe("useTursoProjectOps — §408 connection gate on migrate", () => {
  // ★★★ THE KILL LINE FOR THE SECOND CALL SITE. Settings disables its "Move to
  // Turso" until a Test connection has passed, and `integrations-section.test.tsx`
  // pins that affordance — but `projects-panel.tsx` binds a SECOND button to
  // this same handler gated only on `tursoConfigured`, and the Projects view is
  // reachable on a file backend. `guardTurso` resolves a CONFIG, never a
  // CONNECTION, so before the probe below a never-reachable URL/token pair got
  // all the way to `portfolioCreate` from that button.
  //
  // The assertion is on `portfolioCreate` for the same reason as the truncation
  // test above: it is the irreversible step — a live, non-archived row in the
  // SHARED portfolio DB — so a decline placed after it leaves a phantom project
  // named after the user's, opening empty forever.
  it("declines BEFORE creating the portfolio row when the connection probe fails", async () => {
    vi.mocked(testTursoConnection).mockRejectedValueOnce(new Error("host unreachable"));
    // ★ Nothing is truncated here (the beforeEach clears it), so the §103
    // refusal cannot be what declines — the toast assertion below names WHICH
    // decline fired, which is the half that separates the two.
    const { result } = renderWithRealGuard(async () => {}, { currentWorkspace: wsWithProject });
    vi.mocked(portfolioCreate).mockClear();
    saveMock.mockClear();

    await act(async () => { await result.current.ops.migrateCurrentProjectToTurso(); });

    expect(portfolioCreate).not.toHaveBeenCalled(); // no phantom row
    expect(saveMock).not.toHaveBeenCalled();        // and nothing written
    expect(result.current.showToast).toHaveBeenCalledWith(
      "error",
      t("en-US", "projectsTursoUnreachable"),
    );
  });

  // ★ The control: without it, "not called" above is equally satisfied by a
  // migrate that never runs at all. It also pins that the probe is CONSULTED —
  // deleting the `await testTursoConnection(cfg)` line leaves this green but
  // turns the test above red, which is the split that makes the pair a proof.
  it("probes the connection once, and proceeds when it passes", async () => {
    const { result } = renderWithRealGuard(async () => {}, { currentWorkspace: wsWithProject });
    vi.mocked(portfolioCreate).mockClear();
    saveMock.mockClear();

    await act(async () => { await result.current.ops.migrateCurrentProjectToTurso(); });

    expect(testTursoConnection).toHaveBeenCalledTimes(1);
    expect(portfolioCreate).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });
});

// §4 §645 — every arm of `suppressNextLoadRef` here also sets `handOverFromRef`, to THIS op's instance.
// The stale value models a file op's target left in the ref: it must never reach a Turso live backend.
describe("useTursoProjectOps — §4 hand-over and blind writes", () => {
  const STALE = { stale: true } as never;

  it("switchToTursoProject hands over the instance that loaded the target, replacing a stale one", async () => {
    const handOverFromRef = { current: STALE };
    const suppressNextLoadRef = { current: false };
    const { result } = renderWithRealGuard(async () => {}, { handOverFromRef, suppressNextLoadRef });
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(suppressNextLoadRef.current).toBe(true);
    expect(handOverFromRef.current).not.toBe(STALE);
    expect((handOverFromRef.current as unknown as { load: unknown }).load).toBeInstanceOf(Function);
    expect(forceMock).not.toHaveBeenCalled(); // a switch loads; it writes nothing blind
  });

  it("createTursoProject writes blind (forceNextSave before its save) and hands that instance over", async () => {
    const handOverFromRef = { current: STALE };
    const order: string[] = [];
    forceMock.mockImplementationOnce(() => { order.push("force"); });
    saveMock.mockImplementationOnce(async () => { order.push("save"); });
    const { result } = renderWithRealGuard(async () => {}, { handOverFromRef });
    await act(async () => {
      await result.current.ops.createTursoProject({ id: "n-4", name: "New", code: "N" } as never);
    });
    expect(order).toEqual(["force", "save"]);
    expect(forceMock).toHaveBeenCalledWith();
    expect(handOverFromRef.current).not.toBe(STALE);
    expect((handOverFromRef.current as unknown as { save: unknown }).save).toBe(saveMock);
  });

  it("migrateCurrentProjectToTurso writes blind through guardedWrite's force", async () => {
    const guardedWrite = vi.fn(async () => true);
    const { result } = renderHook(() => useTursoProjectOps(makeDeps({
      currentWorkspace: wsWithProject,
      truncationOps: { ...makeDeps().truncationOps, guardedWrite },
    })));
    await act(async () => { await result.current.migrateCurrentProjectToTurso(); });
    expect(guardedWrite).toHaveBeenCalledWith(expect.anything(), expect.anything(), { force: true });
  });
});

// §4 final review I2 / re-review r2 — the pre-switch flush throws a SaveConflictError only when the
// unsaved edits met a conflict AND could not be kept (`keepNotSavedOnSwitch`, which already toasted):
// every op must stop there, so the user stays on the paused project.
describe("a flush whose edits could not be kept stops the op (§4)", () => {
  const unkept = async () => { throw new SaveConflictError("browser"); };

  it("switchToTursoProject loads nothing and does not switch", async () => {
    const setTursoProjectId = vi.fn();
    const { result } = renderWithRealGuard(unkept, { setTursoProjectId });
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(loadMock).not.toHaveBeenCalled();
    expect(setTursoProjectId).not.toHaveBeenCalled();
    expect(result.current.showToast).not.toHaveBeenCalledWith("error", t("en-US", "storageSwitchFlushFailed"));
  });

  it("createTursoProject writes nothing and does not switch", async () => {
    const setTursoProjectId = vi.fn();
    const { result } = renderWithRealGuard(unkept, { setTursoProjectId });
    let returned: string | null | undefined;
    await act(async () => { returned = await result.current.ops.createTursoProject({ id: "n-9", name: "New", code: "N" } as never); });
    expect(returned).toBeNull();
    expect(saveMock).not.toHaveBeenCalled();
    expect(setTursoProjectId).not.toHaveBeenCalled();
  });

  it("migrateCurrentProjectToTurso creates no portfolio row", async () => {
    const { result } = renderWithRealGuard(unkept, { currentWorkspace: wsWithProject });
    await act(async () => { await result.current.ops.migrateCurrentProjectToTurso(); });
    expect(portfolioCreate).not.toHaveBeenCalled();
  });
});
