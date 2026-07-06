// src/app/use-storage-turso-ops.test.ts
//
// Guards the outgoing-project flush: a failed pre-switch save must surface
// (warn toast + logDiag) yet the switch still proceeds — previously the flush
// failure was swallowed by a bare `catch { /* best-effort */ }`, silently
// losing unsaved edits.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTursoProjectOps, type TursoProjectOpsDeps } from "./use-storage-turso-ops";
import { emptyWorkspace } from "./workspace";

const loadMock = vi.fn(async () => emptyWorkspace());
const saveMock = vi.fn(async () => {});
vi.mock("./turso-backend", () => ({
  TursoBackend: class {
    load = loadMock;
    save = saveMock;
  },
}));
vi.mock("./portfolio-mode", () => ({
  saveCurrentTursoProjectId: vi.fn(),
  savePortfolioMode: vi.fn(),
}));

import { logDiag } from "./diagnostics";
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));

function makeDeps(overrides: Partial<TursoProjectOpsDeps> = {}): TursoProjectOpsDeps {
  return {
    isPopout: false,
    showToast: vi.fn(),
    langRef: { current: "en-US" },
    settingsRef: { current: {} as never },
    tursoConfigNow: () => ({ httpUrl: "https://db.example", authToken: "tok" }) as never,
    tursoProjectId: "p-1",
    setTursoProjectId: vi.fn(),
    backend: { save: vi.fn(async () => {}) },
    currentWorkspace: () => emptyWorkspace(),
    applyWorkspace: vi.fn(),
    suppressNextLoadRef: { current: false },
    suppressNextSaveRef: { current: false },
    reportProjectError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  loadMock.mockClear();
  vi.mocked(logDiag).mockClear();
});

describe("useTursoProjectOps — outgoing flush failure", () => {
  it("surfaces a failed flush (warn toast + logDiag) but still switches", async () => {
    const showToast = vi.fn();
    const setTursoProjectId = vi.fn();
    const deps = makeDeps({
      backend: { save: vi.fn(async () => { throw new Error("network down"); }) },
      showToast,
      setTursoProjectId,
    });
    const { result } = renderHook(() => useTursoProjectOps(deps));

    await result.current.switchToTursoProject("p-2");

    // Flush failure surfaced.
    expect(logDiag).toHaveBeenCalledWith("warn", "storage.switchFlushFailed", expect.objectContaining({ message: "network down" }));
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    // …yet the switch proceeded (target loaded + project id advanced).
    expect(loadMock).toHaveBeenCalled();
    expect(setTursoProjectId).toHaveBeenCalledWith("p-2");
  });

  it("does not warn when the flush succeeds", async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useTursoProjectOps(deps));
    await result.current.switchToTursoProject("p-2");
    expect(logDiag).not.toHaveBeenCalledWith("warn", "storage.switchFlushFailed", expect.anything());
  });
});
