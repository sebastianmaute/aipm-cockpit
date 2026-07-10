import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SetStateAction } from "react";
import { useUndoStack } from "./use-undo-stack";

type Row = { id: number; name: string };

function makeDeps(overrides: Partial<Parameters<typeof useUndoStack>[0]> = {}) {
  return {
    lang: "en-US" as const,
    logActivity: vi.fn(),
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    ...overrides,
  };
}

describe("useUndoStack", () => {
  it("capture pushes an entry, fires an action toast, and sets canUndo", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    const arr: readonly Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    const setter = vi.fn();
    act(() => {
      result.current.capture({ setter, kind: "task.deleted", removed: [{ id: 2, name: "b" }], fromArray: arr });
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.stack).toHaveLength(1);
    expect(deps.showToastAction).toHaveBeenCalledWith("info", expect.any(String), expect.objectContaining({ labelKey: "undo" }));
  });

  it("undo restores via the setter, logs, toasts, and empties the stack", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "a" }];
    const setter = (u: SetStateAction<readonly Row[]>) => { arr = typeof u === "function" ? u(arr) : u; };
    act(() => {
      result.current.capture({ setter, kind: "task.deleted", removed: [{ id: 2, name: "b" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }] });
    });
    act(() => result.current.undo());
    expect(arr).toEqual([{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    expect(deps.logActivity).toHaveBeenCalledWith("undo", 1);
    expect(deps.showToast).toHaveBeenCalledWith("info", expect.any(String));
    expect(result.current.canUndo).toBe(false);
  });

  it("undoById restores and drops that specific entry", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    const setterA = vi.fn();
    const setterB = vi.fn();
    act(() => {
      result.current.capture({ setter: setterA, kind: "task.deleted", removed: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }] });
      result.current.capture({ setter: setterB, kind: "change.deleted", removed: [{ id: 9, name: "x" }], fromArray: [{ id: 9, name: "x" }] });
    });
    const firstId = result.current.stack[0].id;
    act(() => result.current.undoById(firstId));
    expect(setterA).toHaveBeenCalledTimes(1);
    expect(result.current.stack.map((m) => m.id)).not.toContain(firstId);
  });

  it("undo on an empty stack is a no-op", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => result.current.undo());
    expect(deps.logActivity).not.toHaveBeenCalled();
  });
});
