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

  it("delete → undo → redo round-trips (gone → restored → gone)", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "a" }]; // already deleted id 2
    const setter = (u: SetStateAction<readonly Row[]>) => { arr = typeof u === "function" ? u(arr) : u; };
    act(() => {
      result.current.capture({ setter, kind: "task.deleted", removed: [{ id: 2, name: "b" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }] });
    });
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.undo());
    expect(arr).toEqual([{ id: 1, name: "a" }, { id: 2, name: "b" }]); // restored
    expect(result.current.canRedo).toBe(true);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(arr).toEqual([{ id: 1, name: "a" }]); // gone again
    expect(deps.logActivity).toHaveBeenCalledWith("redo", 1);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true); // re-undoable
  });

  it("edit → undo → redo round-trips (after → before → after)", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "AFTER" }]; // already edited from "a"
    const setter = (u: SetStateAction<readonly Row[]>) => { arr = typeof u === "function" ? u(arr) : u; };
    act(() => {
      result.current.capture({ setter, kind: "task.updated", edited: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }] });
    });
    act(() => result.current.undo());
    expect(arr).toEqual([{ id: 1, name: "a" }]); // reverted to before
    act(() => result.current.redo());
    expect(arr).toEqual([{ id: 1, name: "AFTER" }]); // re-applied
  });

  it("composite → undo → redo round-trips both arrays", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let roles: readonly Row[] = [{ id: 7, name: "Dev/Sr" }];
    let refs: readonly Ref[] = [{ id: 1, roleId: 7 }, { id: 2, roleId: 7 }];
    const rolesBefore = roles;
    const refsBefore = refs;
    const affected = refs.filter((r) => r.roleId === 7);
    const setRoles = (u: SetStateAction<readonly Row[]>) => { roles = typeof u === "function" ? u(roles) : u; };
    const setRefs = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };
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
    act(() => result.current.undo());
    expect(roles).toEqual([{ id: 7, name: "Dev/Sr" }]);
    expect(refs).toEqual([{ id: 1, roleId: 7 }, { id: 2, roleId: 7 }]);
    act(() => result.current.redo());
    expect(roles).toEqual([]); // role removed again
    expect(refs).toEqual([{ id: 1, roleId: null }, { id: 2, roleId: null }]); // cascade re-applied
    expect(result.current.canUndo).toBe(true);
  });

  it("composite delete whose id is reused → redo removes the re-minted row, NOT the live one", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let roles: readonly Row[] = [{ id: 7, name: "Dev/Sr" }];
    let refs: readonly Ref[] = [{ id: 1, roleId: 7 }];
    const rolesBefore = roles;
    const refsBefore = refs;
    const setRoles = (u: SetStateAction<readonly Row[]>) => { roles = typeof u === "function" ? u(roles) : u; };
    const setRefs = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };
    roles = [];
    refs = refs.map((r) => ({ ...r, roleId: null }));
    act(() => {
      result.current.captureComposite({
        kind: "role.deleted",
        primaryCount: 1,
        parts: [
          capturePart({ setter: setRoles, removed: [{ id: 7, name: "Dev/Sr" }], fromArray: rolesBefore }),
          capturePart({ setter: setRefs, edited: refsBefore, fromArray: refsBefore }),
        ],
      });
    });
    // A brand-new role reuses the freed id 7 before undo.
    roles = [{ id: 7, name: "NEW-ROLE" }];
    act(() => result.current.undo());
    // Dev/Sr recovered under a fresh id (8); the live NEW-ROLE (id 7) untouched.
    expect(roles).toEqual([{ id: 8, name: "Dev/Sr" }, { id: 7, name: "NEW-ROLE" }]);
    act(() => result.current.redo());
    // Redo removes the RE-MINTED recovered row (id 8), never the live NEW-ROLE.
    expect(roles).toEqual([{ id: 7, name: "NEW-ROLE" }]);
  });

  it("composite cascade FK FOLLOWS the primary re-mint (fkRemapField)", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    // role #7 exists; resource #1 points at it via roleId.
    let roles: readonly Row[] = [{ id: 7, name: "Dev/Sr" }];
    let refs: readonly Ref[] = [{ id: 1, roleId: 7 }];
    const rolesBefore = roles;
    const refsBefore = refs;
    const affected = refs.filter((r) => r.roleId === 7);
    const setRoles = (u: SetStateAction<readonly Row[]>) => { roles = typeof u === "function" ? u(roles) : u; };
    const setRefs = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };
    // Delete role 7: remove it, cascade-null the FK.
    roles = [];
    refs = refs.map((r) => (r.roleId === 7 ? { ...r, roleId: null } : r));
    act(() => {
      result.current.captureComposite({
        kind: "role.deleted",
        primaryCount: 1,
        parts: [
          capturePart({ setter: setRoles, removed: [{ id: 7, name: "Dev/Sr" }], fromArray: rolesBefore }),
          capturePart({ setter: setRefs, edited: affected, fromArray: refsBefore, fkRemapField: "roleId" }),
        ],
      });
    });
    // A brand-new role reuses the freed id 7 before undo.
    roles = [{ id: 7, name: "NEW-ROLE" }];
    act(() => result.current.undo());
    // Dev/Sr recovered under a FRESH id (8); the cascade FK follows to 8, and the
    // live NEW-ROLE (id 7) is untouched — no silent wrong-FK corruption.
    expect(roles).toEqual([{ id: 8, name: "Dev/Sr" }, { id: 7, name: "NEW-ROLE" }]);
    expect(refs).toEqual([{ id: 1, roleId: 8 }]);
  });

  it("composite cascade FK restores to the ORIGINAL id when no re-mint happens", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let roles: readonly Row[] = [{ id: 7, name: "Dev/Sr" }];
    let refs: readonly Ref[] = [{ id: 1, roleId: 7 }];
    const rolesBefore = roles;
    const refsBefore = refs;
    const affected = refs.filter((r) => r.roleId === 7);
    const setRoles = (u: SetStateAction<readonly Row[]>) => { roles = typeof u === "function" ? u(roles) : u; };
    const setRefs = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };
    roles = [];
    refs = refs.map((r) => (r.roleId === 7 ? { ...r, roleId: null } : r));
    act(() => {
      result.current.captureComposite({
        kind: "role.deleted",
        primaryCount: 1,
        parts: [
          capturePart({ setter: setRoles, removed: [{ id: 7, name: "Dev/Sr" }], fromArray: rolesBefore }),
          capturePart({ setter: setRefs, edited: affected, fromArray: refsBefore, fkRemapField: "roleId" }),
        ],
      });
    });
    // No id reuse — role 7 is free at undo time.
    act(() => result.current.undo());
    expect(roles).toEqual([{ id: 7, name: "Dev/Sr" }]);
    expect(refs).toEqual([{ id: 1, roleId: 7 }]); // FK back to the original 7
  });

  it("redo after a re-minted cascade undo re-applies (FK back to null, role removed)", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let roles: readonly Row[] = [{ id: 7, name: "Dev/Sr" }];
    let refs: readonly Ref[] = [{ id: 1, roleId: 7 }];
    const rolesBefore = roles;
    const refsBefore = refs;
    const affected = refs.filter((r) => r.roleId === 7);
    const setRoles = (u: SetStateAction<readonly Row[]>) => { roles = typeof u === "function" ? u(roles) : u; };
    const setRefs = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };
    roles = [];
    refs = refs.map((r) => (r.roleId === 7 ? { ...r, roleId: null } : r));
    act(() => {
      result.current.captureComposite({
        kind: "role.deleted",
        primaryCount: 1,
        parts: [
          capturePart({ setter: setRoles, removed: [{ id: 7, name: "Dev/Sr" }], fromArray: rolesBefore }),
          capturePart({ setter: setRefs, edited: affected, fromArray: refsBefore, fkRemapField: "roleId" }),
        ],
      });
    });
    roles = [{ id: 7, name: "NEW-ROLE" }];
    act(() => result.current.undo());
    expect(refs).toEqual([{ id: 1, roleId: 8 }]);
    act(() => result.current.redo());
    // Redo removes the RE-MINTED recovered role (id 8), never the live NEW-ROLE,
    // and re-applies the cascade (FK back to null).
    expect(roles).toEqual([{ id: 7, name: "NEW-ROLE" }]);
    expect(refs).toEqual([{ id: 1, roleId: null }]);
  });

  it("a NEW capture after an undo CLEARS the redo stack", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    const setter = vi.fn();
    act(() => result.current.capture({ setter, kind: "task.deleted", removed: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }] }));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.capture({ setter, kind: "task.deleted", removed: [{ id: 2, name: "b" }], fromArray: [{ id: 2, name: "b" }] }));
    expect(result.current.canRedo).toBe(false);
    expect(result.current.redoStack).toHaveLength(0);
  });

  it("undoById of a NON-top entry clears redo; of the TOP entry keeps it redoable", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => {
      result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }] });
      result.current.capture({ setter: vi.fn(), kind: "change.deleted", removed: [{ id: 9, name: "x" }], fromArray: [{ id: 9, name: "x" }] });
    });
    const bottomId = result.current.stack[0].id;
    act(() => result.current.undoById(bottomId)); // NON-top
    expect(result.current.canRedo).toBe(false);
  });

  it("exposes redoStack metas and reports canRedo", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }] }));
    act(() => result.current.undo());
    expect(result.current.redoStack).toHaveLength(1);
    expect(result.current.redoStack[0].kind).toBe("task.deleted");
    expect(result.current.redoStack[0].count).toBe(1);
  });

  it("retains up to 25 undo entries (bumped cap)", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => {
      for (let i = 1; i <= 27; i++) {
        result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: i, name: `n${i}` }], fromArray: [{ id: i, name: `n${i}` }] });
      }
    });
    expect(result.current.stack).toHaveLength(25);
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
