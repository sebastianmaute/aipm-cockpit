// §759 — an undo entry whose write is ASYNC (Claude's project edit, `projectUndoFragment`) says "Undone" or
// "Redone" only once the write is stored. A failed write shows no such toast, logs no undo row, keeps the entry
// where it was and pushes nothing onto the other stack; the writer's own error is the only message.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SetStateAction } from "react";
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

// §759 review round — the cases the first round left open: a composite mixing array fragments with the async one
// (an applied plan, `collapseCaptures`), a press or a capture or a scope change while a write is out, the
// through-paths, and an out-of-order undo. Writes are DEFERRED here, so each test decides when one settles.
describe("§759 — an async undo write, the review-round cases", () => {
  type Row = { id: number; name: string };

  /** One project fragment per call, its writes settled by the test through `settle`. */
  function deferredProject(getLive: () => ProjectMeta) {
    const resolvers: ((ok: boolean) => void)[] = [];
    const write: ProjectWriter = vi.fn(() => new Promise<boolean>((resolve) => { resolvers.push(resolve); }));
    const part = projectUndoFragment({ getWriter: () => write, getLive, before: BEFORE, next: NEXT, fields: ["sponsor"], onThrow: vi.fn() });
    const settle = async (ok: boolean) => { await act(async () => { resolvers.shift()!(ok); }); };
    return { part, write, settle, pending: () => resolvers.length };
  }

  function hook(extra: { getScopeEpoch?: () => number } = {}) {
    const deps = { lang: "en-US" as const, logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn(), ...extra };
    const { result } = renderHook(() => useUndoStack(deps));
    return { deps, result };
  }

  it("a failed write in a mixed composite rolls the array part back, so a retry restores each row once (C1)", async () => {
    let rows: readonly Row[] = [{ id: 1, name: "a" }];
    const setter = (u: SetStateAction<readonly Row[]>) => { rows = typeof u === "function" ? u(rows) : u; };
    const proj = deferredProject(() => NEXT);
    const { result } = hook();
    act(() => {
      result.current.captureComposite({
        kind: "task.deleted", primaryCount: 1,
        parts: [capturePart({ setter, removed: [{ id: 2, name: "b" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }], isPrimary: true }), proj.part],
      });
    });
    act(() => { result.current.undo(); });
    expect(rows.map((r) => r.name)).toEqual(["a", "b"]); // the array part undid at once
    await proj.settle(false);
    expect(rows.map((r) => r.name)).toEqual(["a"]); // rolled back with the failed write
    expect(result.current.stack).toHaveLength(1);
    act(() => { result.current.undo(); });
    await proj.settle(true);
    expect(rows.map((r) => r.name).sort()).toEqual(["a", "b"]); // once each, no duplicate
    expect(result.current.redoStack).toHaveLength(1);
  });

  it("a press while a write is out does nothing, even with an entry below to undo", async () => {
    const proj = deferredProject(() => NEXT);
    const setter = vi.fn();
    const { result } = hook();
    act(() => { result.current.capture({ setter, kind: "task.deleted", removed: [{ id: 9, name: "z" }], fromArray: [{ id: 9, name: "z" }] }); });
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [proj.part] }); });
    act(() => { result.current.undo(); });
    act(() => { result.current.undo(); });
    expect(setter).not.toHaveBeenCalled(); // the entry below was not undone
    expect(result.current.stack).toHaveLength(1);
    await proj.settle(true);
    expect(result.current.redoStack).toHaveLength(1);
  });

  it("a capture while the write is out: a stored undo pushes no redo, since the capture cleared that stack", async () => {
    const proj = deferredProject(() => NEXT);
    const { deps, result } = hook();
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [proj.part] }); });
    act(() => { result.current.undo(); });
    act(() => { result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: 9, name: "z" }], fromArray: [{ id: 9, name: "z" }] }); });
    await proj.settle(true);
    expect(toastTexts(deps.showToast)).toEqual([expect.stringMatching(/^Undone/)]);
    expect(result.current.redoStack).toHaveLength(0);
  });

  it("a capture while the write is out: a failed undo returns below the newer capture, in id order", async () => {
    const proj = deferredProject(() => NEXT);
    const { result } = hook();
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [proj.part] }); });
    const projectId = result.current.stack[0].id;
    act(() => { result.current.undo(); });
    act(() => { result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: 9, name: "z" }], fromArray: [{ id: 9, name: "z" }] }); });
    await proj.settle(false);
    const ids = result.current.stack.map((m) => m.id);
    expect(ids[0]).toBe(projectId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBeGreaterThan(projectId);
  });

  it("a write that settles after a scope change says nothing and moves no stack", async () => {
    let epoch = 1;
    const proj = deferredProject(() => NEXT);
    const { deps, result } = hook({ getScopeEpoch: () => epoch });
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [proj.part] }); });
    act(() => { result.current.undo(); });
    epoch = 2;
    await proj.settle(true);
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.logActivity).not.toHaveBeenCalled();
    expect(result.current.redoStack).toHaveLength(0);
    expect(result.current.stack).toHaveLength(0);
  });

  it("a stored async redo says Redone and returns the entry to the undo stack", async () => {
    let live: ProjectMeta = NEXT;
    const proj = deferredProject(() => live);
    const { deps, result } = hook();
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [proj.part] }); });
    act(() => { result.current.undo(); });
    await proj.settle(true);
    live = BEFORE;
    act(() => { result.current.redo(); });
    await proj.settle(true);
    expect(toastTexts(deps.showToast)).toEqual([expect.stringMatching(/^Undone/), expect.stringMatching(/^Redone/)]);
    expect(result.current.stack).toHaveLength(1);
    expect(result.current.redoStack).toHaveLength(0);
  });

  it("a failed redoThrough says nothing and keeps the entry on the redo stack", async () => {
    let live: ProjectMeta = NEXT;
    const proj = deferredProject(() => live);
    const { deps, result } = hook();
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [proj.part] }); });
    act(() => { result.current.undo(); });
    await proj.settle(true);
    live = BEFORE;
    deps.showToast.mockClear();
    const id = result.current.redoStack[0].id;
    act(() => { result.current.redoThrough(id); });
    await proj.settle(false);
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(result.current.redoStack.map((m) => m.id)).toEqual([id]);
    expect(result.current.stack).toHaveLength(0);
  });

  it("an out-of-order undo whose write fails returns to its own place, not the top", async () => {
    const proj = deferredProject(() => NEXT);
    const { result } = hook();
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [proj.part] }); });
    act(() => { result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: 9, name: "z" }], fromArray: [{ id: 9, name: "z" }] }); });
    const before = result.current.stack.map((m) => m.id);
    act(() => { result.current.undoById(before[0]); });
    await proj.settle(false);
    expect(result.current.stack.map((m) => m.id)).toEqual(before);
  });

  it("two failed writes in one undoThrough return in their old order", async () => {
    const one = deferredProject(() => NEXT);
    const two = deferredProject(() => NEXT);
    const { result } = hook();
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [one.part] }); });
    act(() => { result.current.captureComposite({ kind: "project.updated", entityKey: "project", primaryCount: 1, parts: [two.part] }); });
    const before = result.current.stack.map((m) => m.id);
    act(() => { result.current.undoThrough(before[0]); });
    await act(async () => { await Promise.resolve(); });
    await two.settle(false);
    await one.settle(false);
    expect(result.current.stack.map((m) => m.id)).toEqual(before);
  });
});
