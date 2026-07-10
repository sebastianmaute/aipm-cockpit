import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SetStateAction } from "react";
import { useUndoStack, capturePart } from "./use-undo-stack";

type Row = { id: number; name: string };
type Ref = { id: number; roleId: number | null };

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

  it("captureComposite restores BOTH arrays in one undo (role delete + roleId cascade)", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    // Pre-op snapshots: role #7 exists; two resources point at it.
    let roles: readonly Row[] = [{ id: 7, name: "Dev/Sr" }];
    let refs: readonly Ref[] = [{ id: 1, roleId: 7 }, { id: 2, roleId: 7 }];
    const rolesBefore = roles;
    const refsBefore = refs;
    const affected = refs.filter((r) => r.roleId === 7);
    const setRoles = (u: SetStateAction<readonly Row[]>) => { roles = typeof u === "function" ? u(roles) : u; };
    const setRefs = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };
    // Simulate the delete: remove the role, clear the cascade.
    roles = [];
    refs = refs.map((r) => (r.roleId === 7 ? { ...r, roleId: null } : r));

    act(() => {
      result.current.captureComposite({
        kind: "role.deleted",
        primaryCount: 1,
        parts: [
          capturePart({ setter: setRoles, removed: [{ id: 7, name: "Dev/Sr" }], fromArray: rolesBefore }),
          capturePart({ setter: setRefs, edited: affected, fromArray: refsBefore }),
        ],
      });
    });
    // One entry, count = the PRIMARY op (1 role), not the 2 cascade edits.
    expect(result.current.stack).toHaveLength(1);
    expect(result.current.stack[0].count).toBe(1);

    act(() => result.current.undo());
    expect(roles).toEqual([{ id: 7, name: "Dev/Sr" }]);       // role re-inserted
    expect(refs).toEqual([{ id: 1, roleId: 7 }, { id: 2, roleId: 7 }]); // roleId reverted
    expect(result.current.canUndo).toBe(false);
  });

  it("captureComposite ignores null parts and skips a wholly-empty op", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    const setRoles = vi.fn();
    // A discipline delete whose cascade touched NO roles → the roles part is null.
    act(() => {
      result.current.captureComposite({
        kind: "discipline.deleted",
        primaryCount: 1,
        parts: [
          capturePart({ setter: setRoles, removed: [{ id: 3, name: "QA" }], fromArray: [{ id: 3, name: "QA" }] }),
          capturePart({ setter: vi.fn(), edited: [], fromArray: [] }), // null (nothing edited)
        ],
      });
    });
    expect(result.current.stack).toHaveLength(1);

    // A composite with ONLY empty parts pushes nothing.
    act(() => {
      result.current.captureComposite({ kind: "grade.deleted", primaryCount: 0, parts: [null, capturePart({ setter: vi.fn(), fromArray: [] })] });
    });
    expect(result.current.stack).toHaveLength(1); // unchanged
  });
});
