// src/app/use-conflict-resolution.test.ts
//
// §4 — the three ways out of a conflict pause, as a unit: the Overwrite force armed only inside a save
// job that runs AFTER the request, and disarmed again when that write fails; Reload through the given
// reload; Download of the live workspace under a Windows-safe name. The wiring into the storage hook is
// pinned end to end in use-storage-backend.conflict.test.tsx.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as download from "./download-json";
import { emptyWorkspace, workspaceToJson } from "./storage";
import type { Task } from "./types";
import { conflictFileName, useConflictResolution, type ConflictResolutionDeps } from "./use-conflict-resolution";
import type { StorageBackend, Workspace } from "./workspace";

function fakeBackend(revision: string | null = "r1") {
  const calls: string[] = [];
  const backend = {
    save: vi.fn(async () => { calls.push("save"); }),
    forceNextSave: vi.fn(() => { calls.push("force"); }),
    revision: vi.fn(() => revision),
    adoptRevision: vi.fn((rev: string) => { calls.push(`adopt:${rev}`); }),
  } as unknown as StorageBackend & { save: ReturnType<typeof vi.fn>; forceNextSave: ReturnType<typeof vi.fn>; adoptRevision: ReturnType<typeof vi.fn> };
  return { backend, calls };
}

function setup(overrides: Partial<ConflictResolutionDeps> = {}) {
  const { backend, calls } = fakeBackend();
  const live: Workspace = { ...emptyWorkspace(), tasks: [{ id: 1, taskName: "LIVE" } as unknown as Task] };
  const deps: ConflictResolutionDeps = {
    backend,
    currentWorkspace: () => live,
    reload: vi.fn(async () => {}),
    openGate: vi.fn(() => true),
    onDownloadFailed: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => useConflictResolution(deps));
  return { hook, deps, backend, calls, live, r: () => hook.result.current };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("conflictFileName", () => {
  it("names the project and the conflict, with nothing Windows refuses in a file name", () => {
    const name = conflictFileName("Alpha: Beta/Gamma?", new Date(Date.UTC(2026, 8, 29, 14, 3, 12)));
    expect(name).toBe("aipm-cockpit-alpha-beta-gamma-conflict-2026-09-29T14-03-12.json");
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("falls back to a generic stem when the project has no usable name", () => {
    expect(conflictFileName(undefined, new Date(Date.UTC(2026, 0, 2)))).toBe("aipm-cockpit-project-conflict-2026-01-02T00-00-00.json");
    expect(conflictFileName("???", new Date(Date.UTC(2026, 0, 2)))).toBe("aipm-cockpit-project-conflict-2026-01-02T00-00-00.json");
  });
});

describe("useConflictResolution — Overwrite", () => {
  it("opens the gate, then arms the force inside the next save job, right before its write, once", async () => {
    const { r, deps, backend, calls } = setup();
    act(() => { r().resolveConflictOverwrite(); });
    expect(deps.openGate).toHaveBeenCalledTimes(1);
    expect(backend.forceNextSave).not.toHaveBeenCalled(); // never armed outside a job
    await r().runSaveJob(backend, () => backend.save(emptyWorkspace()));
    expect(calls).toEqual(["force", "save"]);
    await r().runSaveJob(backend, () => backend.save(emptyWorkspace()));
    expect(calls).toEqual(["force", "save", "save"]); // one-shot: the next job is an ordinary save
  });

  it("does not arm a job for another backend instance, nor any job when no Overwrite was asked for", async () => {
    const { r, backend } = setup();
    const other = fakeBackend().backend;
    await r().runSaveJob(backend, () => backend.save(emptyWorkspace()));
    expect(backend.forceNextSave).not.toHaveBeenCalled();
    act(() => { r().resolveConflictOverwrite(); });
    await r().runSaveJob(other, () => other.save(emptyWorkspace()));
    expect(other.forceNextSave).not.toHaveBeenCalled();
    await r().runSaveJob(backend, () => backend.save(emptyWorkspace()));
    expect(backend.forceNextSave).toHaveBeenCalledTimes(1); // still pending for its own instance
  });

  it("arms nothing when the gate would not open (no conflict pause holds)", async () => {
    const { r, backend } = setup({ openGate: vi.fn(() => false) });
    act(() => { r().resolveConflictOverwrite(); });
    await r().runSaveJob(backend, () => backend.save(emptyWorkspace()));
    expect(backend.forceNextSave).not.toHaveBeenCalled();
  });

  it("a cancelled request arms nothing", async () => {
    const { r, backend } = setup();
    act(() => { r().resolveConflictOverwrite(); });
    r().cancelOverwrite();
    await r().runSaveJob(backend, () => backend.save(emptyWorkspace()));
    expect(backend.forceNextSave).not.toHaveBeenCalled();
  });

  it("a forced write that fails leaves no force armed, and the failure still reaches the caller", async () => {
    const { r, backend, calls } = setup();
    act(() => { r().resolveConflictOverwrite(); });
    const boom = new Error("disk full");
    await expect(r().runSaveJob(backend, async () => { calls.push("save"); throw boom; })).rejects.toBe(boom);
    expect(calls).toEqual(["force", "save", "adopt:r1"]); // re-adopting its own revision clears the backend's force
    await r().runSaveJob(backend, () => backend.save(emptyWorkspace()));
    expect(backend.forceNextSave).toHaveBeenCalledTimes(1);
  });

  it("an ordinary write that fails touches no revision", async () => {
    const { r, backend } = setup();
    await expect(r().runSaveJob(backend, async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(backend.adoptRevision).not.toHaveBeenCalled();
  });

  it("returns what the save job returned, so a skipped job still settles as skipped", async () => {
    const { r, backend } = setup();
    await expect(r().runSaveJob(backend, async () => "superseded" as const)).resolves.toBe("superseded");
  });
});

describe("useConflictResolution — Reload", () => {
  it("drops a pending Overwrite and runs the reload", async () => {
    const { r, deps, backend } = setup();
    act(() => { r().resolveConflictOverwrite(); });
    await act(async () => { await r().resolveConflictReload(); });
    expect(deps.reload).toHaveBeenCalledTimes(1);
    await r().runSaveJob(backend, () => backend.save(emptyWorkspace()));
    expect(backend.forceNextSave).not.toHaveBeenCalled();
  });
});

describe("useConflictResolution — Download my version", () => {
  it("downloads the LIVE workspace as JSON under a conflict name, and opens nothing", () => {
    const spy = vi.spyOn(download, "downloadJson").mockReturnValue(true);
    const { r, deps, live } = setup();
    r().downloadConflictVersion();
    expect(spy).toHaveBeenCalledTimes(1);
    const [name, json] = spy.mock.calls[0];
    expect(name).toMatch(/^aipm-cockpit-project-conflict-.*\.json$/);
    expect(json).toBe(workspaceToJson(live));
    expect(deps.openGate).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.onDownloadFailed).not.toHaveBeenCalled();
  });

  it("names the project in the file and reports a download the browser refused", () => {
    const spy = vi.spyOn(download, "downloadJson").mockReturnValue(false);
    const ws = { ...emptyWorkspace(), project: { name: "Apollo" } } as unknown as Workspace;
    const { r, deps } = setup({ currentWorkspace: () => ws });
    r().downloadConflictVersion();
    const name = spy.mock.calls[0][0];
    expect(name).toContain("apollo");
    expect(name).toContain("conflict");
    expect(deps.onDownloadFailed).toHaveBeenCalledWith(name);
  });
});
