// src/app/use-storage-turso-ops.test.ts
//
// Guards the outgoing-project flush: a failed pre-switch save must surface
// (warn toast + logDiag) yet the switch still proceeds — previously the flush
// failure was swallowed by a bare `catch { /* best-effort */ }`, silently
// losing unsaved edits.
//
// Also pins the §102 half this file owns: a Turso project switch is a LOAD
// path, so the target's `lastLoadTruncation` must be reported. The deps object
// carries a REAL `useLoadTruncation` guard here, not a stub — the flush skip
// and the reporting are two faces of one state machine, and a stub would let
// each pass while the machine itself was wrong.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTursoProjectOps, type TursoProjectOpsDeps } from "./use-storage-turso-ops";
import { useLoadTruncation } from "./use-load-truncation";
import type { Lang } from "./i18n";
import { emptyWorkspace } from "./workspace";

const loadMock = vi.fn(async () => emptyWorkspace());
const saveMock = vi.fn(async () => {});
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
  },
}));
vi.mock("./portfolio-mode", () => ({
  saveCurrentTursoProjectId: vi.fn(),
  savePortfolioMode: vi.fn(),
}));

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
    truncationOps: { reportFor: vi.fn(), flushCurrent: vi.fn(async () => {}), guardedWrite: vi.fn(async () => true) },
    currentWorkspace: () => emptyWorkspace(),
    applyWorkspace: vi.fn(),
    suppressNextLoadRef: { current: false },
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
  tursoTruncation.current = undefined;
  vi.mocked(logDiag).mockClear();
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

describe("useTursoProjectOps — §102 truncation", () => {
  it("switchToTursoProject REPORTS the target's truncation", async () => {
    tursoTruncation.current = { entries: 6, blocks: 0 };
    const { result } = renderWithRealGuard(async () => {});
    expect(result.current.guard.loadWasTruncated).toBe(false); // control

    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });

    expect(result.current.guard.loadWasTruncated).toBe(true);
    expect(result.current.showToast).toHaveBeenCalledWith("error", expect.stringContaining("6"));
  });

  it("a clean target load LOWERS a flag raised by the previous project", async () => {
    tursoTruncation.current = { entries: 6, blocks: 0 };
    const { result } = renderWithRealGuard(async () => {});
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(result.current.guard.loadWasTruncated).toBe(true);

    tursoTruncation.current = { entries: 0, blocks: 0 };
    await act(async () => { await result.current.ops.switchToTursoProject("p-3"); });

    expect(result.current.guard.loadWasTruncated).toBe(false);
  });

  it("the outgoing flush is SKIPPED while a truncated load is unresolved", async () => {
    const saveCurrent = vi.fn(async () => {});
    tursoTruncation.current = { entries: 6, blocks: 0 };
    const { result } = renderWithRealGuard(saveCurrent);

    // First switch raises the flag (its own flush runs — nothing was wrong yet).
    await act(async () => { await result.current.ops.switchToTursoProject("p-2"); });
    expect(saveCurrent).toHaveBeenCalledTimes(1);
    expect(result.current.guard.loadWasTruncated).toBe(true);

    // Second switch, now under an unresolved truncation: no write at all.
    await act(async () => { await result.current.ops.switchToTursoProject("p-3"); });
    expect(saveCurrent).toHaveBeenCalledTimes(1);
    // A skip is not a failure — it must not raise the flush-failed toast.
    expect(logDiag).not.toHaveBeenCalledWith("warn", "storage.switchFlushFailed", expect.anything());
    expect(logDiag).toHaveBeenCalledWith("warn", "storage.flushSkippedAfterTruncation", expect.anything());
  });
});
