// src/app/undo/use-undo-stack.created.test.tsx
//
// §796 — `captureCreatedPart`: an undo that REMOVES the rows an op created, on the
// real `useUndoStack` under StrictMode (`wrapper: StrictMode` is the shape
// `src/app/strictmode.meta.test.tsx` proves double-invokes; updaters are
// double-invoked in StrictMode regardless).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { useUndoStack, captureCreatedPart, captureFieldPart, type CreatedPart } from "./use-undo-stack";

type Task = { id: number; title: string; deps: number[]; localModifiedAt?: string };

const T = (id: number, title: string, deps: number[] = []): Task => ({ id, title, deps });

const isReferenced = (prev: readonly Task[], id: number) => prev.some((r) => r.id !== id && r.deps.includes(id));
const dropRefs = (row: Task, removed: ReadonlySet<number>): Task =>
  row.deps.some((d) => removed.has(d)) ? { ...row, deps: row.deps.filter((d) => !removed.has(d)) } : row;
const remapRefs = (row: Task, remap: ReadonlyMap<number, number>): Task =>
  row.deps.some((d) => remap.has(d)) ? { ...row, deps: row.deps.map((d) => remap.get(d) ?? d) } : row;

function setup(initial: readonly Task[], epoch?: { current: number }) {
  // A stand-in for the destructive-save guard: the arm is a one-shot the next
  // save (an effect over `tasks`) consumes — the same shape as `consumeArm`.
  const armed = { current: false };
  const arm = vi.fn(() => { armed.current = true; });
  const effectSaw: { ids: number[]; armed: boolean }[] = [];
  const deps = {
    lang: "en-US" as const,
    logActivity: vi.fn(),
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    allowDestructiveSave: arm,
    ...(epoch ? { getScopeEpoch: () => epoch.current } : {}),
  };
  const hook = renderHook(() => {
    const [tasks, setTasks] = useState<readonly Task[]>(initial);
    const api = useUndoStack(deps);
    useEffect(() => {
      effectSaw.push({ ids: tasks.map((t) => t.id), armed: armed.current });
      armed.current = false;
    }, [tasks]);
    return { tasks, setTasks, api };
  }, { wrapper: StrictMode });
  return { hook, arm, deps, effectSaw };
}

type Hook = ReturnType<typeof setup>["hook"];

function part(hook: Hook, created: readonly Task[], extra: Partial<CreatedPart<Task>> = {}) {
  return captureCreatedPart<Task>({
    setter: hook.result.current.setTasks,
    created,
    createdKind: "task.created",
    isReferenced,
    dropRefs,
    remapRefs,
    ...extra,
  });
}

const flushMicrotasks = () => act(async () => { await Promise.resolve(); });

describe("captureCreatedPart (§796)", () => {
  it("returns null when nothing was created", () => {
    const { hook } = setup([T(1, "a")]);
    expect(part(hook, [])).toBeNull();
  });

  it("undo removes the created rows and arms once; redo re-inserts and does not arm", () => {
    const created = [T(10, "new A"), T(11, "new B")];
    const { hook, arm } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 2, parts: [part(hook, created)] }));
    act(() => hook.result.current.api.undo());
    expect(hook.result.current.tasks.map((t) => t.id)).toEqual([1]);
    expect(arm).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.api.redo());
    expect(hook.result.current.tasks).toEqual([T(1, "a"), ...created]);
    expect(arm).toHaveBeenCalledTimes(1);
    // Re-undo after redo removes them again (and arms again): the runner is reusable.
    act(() => hook.result.current.api.undo());
    expect(hook.result.current.tasks.map((t) => t.id)).toEqual([1]);
    expect(arm).toHaveBeenCalledTimes(2);
  });

  // §295 — the arm must be in place BEFORE the save that sees the removal runs.
  // An arm placed after a flushed write lands after the commit's effects, so the
  // save would have consumed nothing and refused.
  it("the arm is set before the save effect sees the removal", () => {
    const created = [T(10, "new A")];
    const { hook, effectSaw } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 1, parts: [part(hook, created)] }));
    act(() => hook.result.current.api.undo());
    const sawRemoval = effectSaw.filter((e) => e.ids.join() === "1");
    expect(sawRemoval).toHaveLength(1);
    expect(sawRemoval[0].armed).toBe(true);
  });

  it("undo that keeps every row does not arm and calls onKept once", async () => {
    const created = [T(10, "new A")];
    const onKept = vi.fn();
    const { hook, arm } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 1, parts: [part(hook, created, { onKept })] }));
    // Someone worked on the created row after the apply.
    act(() => hook.result.current.setTasks((prev) => prev.map((t) => (t.id === 10 ? { ...t, title: "edited" } : t))));
    act(() => hook.result.current.api.undo());
    await flushMicrotasks();
    expect(hook.result.current.tasks.map((t) => t.id)).toEqual([1, 10]);
    expect(arm).not.toHaveBeenCalled();
    expect(onKept).toHaveBeenCalledTimes(1);
    expect(onKept).toHaveBeenCalledWith([10]);
  });

  it("a localModifiedAt stamp alone does not keep a created row", () => {
    const created = [T(10, "new A")];
    const { hook } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 1, parts: [part(hook, created)] }));
    act(() => hook.result.current.setTasks((prev) => prev.map((t) => (t.id === 10 ? { ...t, localModifiedAt: "2026-11-20T10:00:00.000Z" } : t))));
    act(() => hook.result.current.api.undo());
    expect(hook.result.current.tasks.map((t) => t.id)).toEqual([1]);
  });

  it("undo row and redo row carry the created pair", () => {
    const created = [T(10, "new A"), T(11, "new B")];
    const { hook, deps } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 2, parts: [part(hook, created)] }));
    act(() => hook.result.current.api.undo());
    expect(deps.logActivity).toHaveBeenLastCalledWith("undo", 2, "bulk.edit", 2, "task.created", 2);
    act(() => hook.result.current.api.redo());
    expect(deps.logActivity).toHaveBeenLastCalledWith("redo", 2, "bulk.edit", 2, "task.created", 2);
  });

  it("with one created row kept, the pair counts only the removed one", () => {
    const created = [T(10, "new A"), T(11, "new B")];
    const { hook, deps } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 2, parts: [part(hook, created)] }));
    act(() => hook.result.current.setTasks((prev) => prev.map((t) => (t.id === 11 ? { ...t, title: "edited" } : t))));
    act(() => hook.result.current.api.undo());
    expect(deps.logActivity).toHaveBeenLastCalledWith("undo", 2, "bulk.edit", 2, "task.created", 1);
    act(() => hook.result.current.api.redo());
    expect(deps.logActivity).toHaveBeenLastCalledWith("redo", 2, "bulk.edit", 2, "task.created", 1);
  });

  it("an undo that removes nothing appends no created pair", () => {
    const created = [T(10, "new A")];
    const { hook, deps } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 1, parts: [part(hook, created)] }));
    act(() => hook.result.current.setTasks((prev) => prev.map((t) => (t.id === 10 ? { ...t, title: "edited" } : t))));
    act(() => hook.result.current.api.undo());
    expect(deps.logActivity).toHaveBeenLastCalledWith("undo", 1, "bulk.edit", 1);
  });

  it("a kept row's links to removed rows are dropped on undo and put back on redo", () => {
    const created = [T(10, "new A"), T(11, "new B", [10])];
    const isRefOutside = (prev: readonly Task[], id: number) => prev.some((r) => r.id !== id && r.id !== 11 && r.deps.includes(id));
    const { hook } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 2, parts: [part(hook, created, { isReferenced: isRefOutside })] }));
    act(() => hook.result.current.setTasks((prev) => prev.map((t) => (t.id === 11 ? { ...t, title: "edited" } : t))));
    act(() => hook.result.current.api.undo());
    expect(hook.result.current.tasks).toEqual([T(1, "a"), T(11, "edited", [])]);
    act(() => hook.result.current.api.redo());
    expect(hook.result.current.tasks).toEqual([T(1, "a"), T(11, "edited", [10]), T(10, "new A")]);
  });

  it("a composite with a field part first and the created part second undoes both in one entry", () => {
    const created = [T(10, "new A"), T(11, "new B")];
    const { hook, arm } = setup([T(1, "a", [10]), ...created]);
    act(() => hook.result.current.api.captureComposite({
      kind: "bulk.edit", primaryCount: 3,
      parts: [
        captureFieldPart<Task>({ setter: hook.result.current.setTasks, edits: [{ id: 1, before: { deps: [] }, after: { deps: [10] } }] }),
        part(hook, created),
      ],
    }));
    expect(hook.result.current.api.stack).toHaveLength(1);
    act(() => hook.result.current.api.undo());
    // The edit reverted first, so the link from task 1 no longer keeps row 10.
    expect(hook.result.current.tasks).toEqual([T(1, "a", [])]);
    expect(hook.result.current.api.stack).toHaveLength(0);
    expect(hook.result.current.api.redoStack).toHaveLength(1);
    expect(arm).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.api.redo());
    expect(hook.result.current.tasks).toEqual([T(1, "a", [10]), ...created]);
  });

  it("redo re-mints a taken id and follows it in the remapScope rows only", () => {
    const created = [T(10, "new A")];
    const { hook, arm } = setup([T(1, "a", [10]), T(2, "b"), ...created]);
    act(() => hook.result.current.api.captureComposite({
      kind: "bulk.edit", primaryCount: 2,
      parts: [
        captureFieldPart<Task>({ setter: hook.result.current.setTasks, edits: [{ id: 1, before: { deps: [] }, after: { deps: [10] } }] }),
        part(hook, created, { remapScope: [1] }),
      ],
    }));
    act(() => hook.result.current.api.undo());
    expect(hook.result.current.tasks).toEqual([T(1, "a", []), T(2, "b")]);
    // A new row takes the freed id, and a person links task 2 to it.
    act(() => hook.result.current.setTasks((prev) => [...prev.map((t) => (t.id === 2 ? { ...t, deps: [10] } : t)), T(10, "unrelated")]));
    act(() => hook.result.current.api.redo());
    expect(hook.result.current.tasks).toEqual([T(1, "a", [11]), T(2, "b", [10]), T(10, "unrelated"), T(11, "new A")]);
    expect(arm).toHaveBeenCalledTimes(1);
  });

  it("a re-undo after a re-minted redo removes the re-minted row, never the row that took the id", () => {
    const created = [T(10, "new A")];
    const { hook, arm } = setup([T(1, "a"), ...created]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 1, parts: [part(hook, created)] }));
    act(() => hook.result.current.api.undo());
    act(() => hook.result.current.setTasks((prev) => [...prev, T(10, "unrelated")]));
    act(() => hook.result.current.api.redo());
    expect(hook.result.current.tasks).toEqual([T(1, "a"), T(10, "unrelated"), T(11, "new A")]);
    act(() => hook.result.current.api.undo());
    expect(hook.result.current.tasks).toEqual([T(1, "a"), T(10, "unrelated")]);
    expect(arm).toHaveBeenCalledTimes(2);
  });

  it("undoThrough over two such entries removes both sets with no duplicates", () => {
    const first = [T(10, "A"), T(11, "B")];
    const second = [T(12, "C"), T(13, "D")];
    const { hook, deps, arm } = setup([T(1, "a"), ...first, ...second]);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 2, parts: [part(hook, first)] }));
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 2, parts: [part(hook, second)] }));
    const firstId = hook.result.current.api.stack[0].id;
    act(() => hook.result.current.api.undoThrough(firstId));
    expect(hook.result.current.tasks.map((t) => t.id)).toEqual([1]);
    expect(deps.logActivity).toHaveBeenLastCalledWith("undo", 4, "bulk.edit", 4, "task.created", 4);
    expect(arm).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.api.redoThrough(hook.result.current.api.redoStack[0].id));
    const ids = hook.result.current.tasks.map((t) => t.id);
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 10, 11, 12, 13]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(deps.logActivity).toHaveBeenLastCalledWith("redo", 4, "bulk.edit", 4, "task.created", 4);
    expect(arm).toHaveBeenCalledTimes(2);
  });

  // The arming peek and the write must judge ONE snapshot of the referrers. Here the reader's answer changes after
  // its first call (as a referrers ref refreshed by the peek's commit would): read per updater, the peek saw the
  // row linked and did not arm while the write saw it free and removed it unarmed.
  it("the peek and the write read the referrers once, so the arm and the removal agree", () => {
    const created = [T(10, "new A")];
    const { hook, arm, effectSaw } = setup([T(1, "a"), ...created]);
    let reads = 0;
    const readReferrers = vi.fn(() => (reads++ === 0 ? "linked" : "free"));
    const fragment = captureCreatedPart<Task, string>({
      setter: hook.result.current.setTasks,
      created,
      createdKind: "task.created",
      readReferrers,
      isReferenced: (prev, id, refs) => refs === "linked" || isReferenced(prev, id),
      dropRefs,
      remapRefs,
    });
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 1, parts: [fragment] }));
    act(() => hook.result.current.api.undo());
    expect(readReferrers).toHaveBeenCalledTimes(1);
    // The one snapshot said "linked": the row is kept and nothing armed.
    expect(hook.result.current.tasks.map((t) => t.id)).toEqual([1, 10]);
    expect(arm).not.toHaveBeenCalled();
    expect(effectSaw.filter((e) => !e.ids.includes(10))).toEqual([]);
  });

  it("an entry captured before a scope change is dropped and removes nothing", () => {
    const created = [T(10, "new A")];
    const epoch = { current: 1 };
    const { hook, arm, deps } = setup([T(1, "a"), ...created], epoch);
    act(() => hook.result.current.api.captureComposite({ kind: "bulk.edit", primaryCount: 1, parts: [part(hook, created)] }));
    epoch.current = 2;
    act(() => hook.result.current.api.undo());
    expect(hook.result.current.tasks.map((t) => t.id)).toEqual([1, 10]);
    expect(arm).not.toHaveBeenCalled();
    expect(deps.logActivity).not.toHaveBeenCalled();
    expect(hook.result.current.api.stack).toHaveLength(0);
  });
});
