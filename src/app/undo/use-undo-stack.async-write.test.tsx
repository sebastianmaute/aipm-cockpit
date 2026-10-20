// §759 — an undo entry whose write is ASYNC (Claude's project edit, `projectUndoFragment`) says "Undone" or
// "Redone" only once the write is stored. A failed write shows no such toast, logs no undo row, keeps the entry
// where it was and pushes nothing onto the other stack; the writer's own error is the only message.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndoStack, capturePart } from "./use-undo-stack";
import { projectUndoFragment, type ProjectWriter } from "../project-meta-edit";
import type { ProjectMeta } from "../types";

const BEFORE = { name: "Atlas", sponsor: "Ann" } as unknown as ProjectMeta;
const NEXT = { name: "Atlas", sponsor: "Ben" } as unknown as ProjectMeta;

function setup(results: boolean[]) {
  const deps = { lang: "en-US" as const, logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() };
  const writes: ProjectMeta[] = [];
  const write: ProjectWriter = vi.fn(async (meta: ProjectMeta) => { writes.push(meta); return results.shift() ?? true; });
  let live: ProjectMeta = NEXT;
  const part = projectUndoFragment({
    getWriter: () => write, getLive: () => live, before: BEFORE, next: NEXT, fields: ["sponsor"], onThrow: vi.fn(),
  });
  const { result } = renderHook(() => useUndoStack(deps));
  act(() => {
    result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, name: "Atlas", parts: [part] });
  });
  const setLive = (meta: ProjectMeta) => { live = meta; };
  return { deps, result, writes, setLive };
}

const toastTexts = (showToast: ReturnType<typeof vi.fn>) => showToast.mock.calls.map((c) => String(c[1]));

describe("§759 — an async undo write is waited for", () => {
  it("a stored undo says Undone after the write, logs it and offers redo", async () => {
    const { deps, result, writes } = setup([true]);
    await act(async () => { result.current.undo(); });
    expect(writes.map((w) => w.sponsor)).toEqual(["Ann"]);
    expect(toastTexts(deps.showToast)).toEqual([expect.stringMatching(/^Undone/)]);
    expect(deps.logActivity).toHaveBeenCalledWith("undo", 1, expect.anything(), expect.anything());
    expect(result.current.stack).toHaveLength(0);
    expect(result.current.redoStack).toHaveLength(1);
  });

  it("a failed undo says nothing, logs nothing, keeps the entry and offers no redo", async () => {
    const { deps, result, writes } = setup([false]);
    await act(async () => { result.current.undo(); });
    expect(writes).toHaveLength(1);
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.logActivity).not.toHaveBeenCalled();
    expect(result.current.stack).toHaveLength(1);
    expect(result.current.redoStack).toHaveLength(0);
  });

  it("the entry kept after a failed undo can be undone again", async () => {
    const { deps, result, writes } = setup([false, true]);
    await act(async () => { result.current.undo(); });
    await act(async () => { result.current.undo(); });
    expect(writes).toHaveLength(2);
    expect(toastTexts(deps.showToast)).toEqual([expect.stringMatching(/^Undone/)]);
    expect(result.current.redoStack).toHaveLength(1);
  });

  it("a failed redo says nothing and keeps the redo entry", async () => {
    const { deps, result, setLive } = setup([true, false]);
    await act(async () => { result.current.undo(); });
    setLive(BEFORE);
    deps.showToast.mockClear();
    deps.logActivity.mockClear();
    await act(async () => { result.current.redo(); });
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.logActivity).not.toHaveBeenCalled();
    expect(result.current.redoStack).toHaveLength(1);
    expect(result.current.stack).toHaveLength(0);
  });

  it("a through-undo reports only the entries whose writes were stored, and keeps the failed one", async () => {
    const { deps, result } = setup([false]);
    act(() => {
      result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: 2, name: "b" }], fromArray: [{ id: 2, name: "b" }] });
    });
    const oldest = result.current.stack[0].id;
    await act(async () => { result.current.undoThrough(oldest); });
    expect(toastTexts(deps.showToast)).toEqual([expect.stringMatching(/^Undone/)]);
    expect(result.current.stack.map((m) => m.id)).toEqual([oldest]);
    expect(result.current.redoStack).toHaveLength(1);
  });

  it("a synchronous entry still says Undone in the same tick", () => {
    const deps = { lang: "en-US" as const, logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() };
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => {
      result.current.captureComposite({
        kind: "resource.updated", primaryCount: 1,
        parts: [capturePart({ setter: vi.fn(), edited: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }], isPrimary: true })],
      });
    });
    act(() => { result.current.undo(); });
    expect(toastTexts(deps.showToast)).toEqual([expect.stringMatching(/^Undone/)]);
    expect(result.current.redoStack).toHaveLength(1);
  });
});
