import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState, type SetStateAction } from "react";
import { useUndoStack, capturePart, buildUndoLabel } from "./use-undo-stack";
import { ACTIVITY_KIND_TO_KEY, type ActivityKind } from "../activity-log";
import { t } from "../i18n";

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

  it("carries a human label naming the entity; undo/redo toasts include it", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "a" }];
    const setter = (u: SetStateAction<readonly Row[]>) => { arr = typeof u === "function" ? u(arr) : u; };
    act(() => {
      result.current.capture({
        setter, kind: "task.deleted", name: "Design review",
        removed: [{ id: 2, name: "b" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
      });
    });
    // Label built at capture: verb + entity + name.
    expect(result.current.stack[0].label).toBe('Delete task "Design review"');
    act(() => result.current.undo());
    expect(deps.showToast).toHaveBeenCalledWith("info", 'Undone: Delete task "Design review"');
    act(() => result.current.redo());
    expect(deps.showToast).toHaveBeenCalledWith("info", 'Redone: Delete task "Design review"');
  });

  it("labels a bulk edit via the explicit entityKey (kind is ambiguous)", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => {
      result.current.capture({
        setter: vi.fn(), kind: "bulk.edit", entityKey: "raid",
        edited: [{ id: 1, name: "a" }, { id: 2, name: "b" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
      });
    });
    expect(result.current.stack[0].label).toBe("Bulk edit 2 RAID items");
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

  it("undoById: undoing the TOP entry stays redoable; undoing a NON-top entry clears redo", () => {
    // TOP branch: undoById the newest entry behaves like undo() → redoable.
    const top = renderHook(() => useUndoStack(makeDeps()));
    act(() => {
      top.result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }] });
      top.result.current.capture({ setter: vi.fn(), kind: "change.deleted", removed: [{ id: 9, name: "x" }], fromArray: [{ id: 9, name: "x" }] });
    });
    act(() => top.result.current.undoById(top.result.current.stack[top.result.current.stack.length - 1].id));
    expect(top.result.current.canRedo).toBe(true);

    // NON-top branch: with a pending redo, undoById an OLDER (non-top) entry
    // clears it (out-of-order undo can't stay coherently redoable).
    const non = renderHook(() => useUndoStack(makeDeps()));
    act(() => {
      non.result.current.capture({ setter: vi.fn(), kind: "task.deleted", removed: [{ id: 1, name: "a" }], fromArray: [{ id: 1, name: "a" }] });
      non.result.current.capture({ setter: vi.fn(), kind: "change.deleted", removed: [{ id: 2, name: "b" }], fromArray: [{ id: 2, name: "b" }] });
      non.result.current.capture({ setter: vi.fn(), kind: "raid.deleted", removed: [{ id: 3, name: "c" }], fromArray: [{ id: 3, name: "c" }] });
    });
    act(() => non.result.current.undo()); // newest → redo pending
    expect(non.result.current.canRedo).toBe(true);
    act(() => non.result.current.undoById(non.result.current.stack[0].id)); // oldest = non-top
    expect(non.result.current.canRedo).toBe(false);
  });

  it("uses the explicit isPrimary fragment as the remap source, regardless of parts order", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    let roles: readonly Row[] = [{ id: 7, name: "Dev/Sr" }];
    let refs: readonly Ref[] = [{ id: 1, roleId: 7 }];
    const rolesBefore = roles;
    const refsBefore = refs;
    const setRoles = (u: SetStateAction<readonly Row[]>) => { roles = typeof u === "function" ? u(roles) : u; };
    const setRefs = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };
    roles = [];
    refs = [{ id: 1, roleId: null }];
    act(() => {
      result.current.captureComposite({
        kind: "role.deleted",
        primaryCount: 1,
        parts: [
          // CASCADE first, PRIMARY second — the primary is chosen by the flag,
          // NOT by position, and still runs first so its remap publishes.
          capturePart({ setter: setRefs, edited: refsBefore, fromArray: refsBefore, fkRemapField: "roleId" }),
          capturePart({ setter: setRoles, removed: [{ id: 7, name: "Dev/Sr" }], fromArray: rolesBefore, isPrimary: true }),
        ],
      });
    });
    roles = [{ id: 7, name: "NEW-ROLE" }]; // id reused before undo
    act(() => result.current.undo());
    expect(roles).toEqual([{ id: 8, name: "Dev/Sr" }, { id: 7, name: "NEW-ROLE" }]);
    expect(refs).toEqual([{ id: 1, roleId: 8 }]); // FK follows the re-mint via the flagged primary
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

  // ★ Proves the flushSync fix (not just the pure remap logic): REAL useState
  // hooks with the CASCADE hook declared BEFORE the primary (mirroring
  // workspace-context's resources-before-roles order). Under React batching the
  // separate setters flush in hook-declaration order, so without flushSync the
  // cascade updater would read the still-empty remap box and its FK would NOT
  // follow the re-mint (roleId stays 7). This test fails if flushSync is removed.
  it("REAL useState, cascade hook before primary: cascade FK follows the re-mint under batching", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => {
      const [refs, setRefs] = useState<readonly Ref[]>([{ id: 1, roleId: 7 }]); // cascade FIRST
      const [roles, setRoles] = useState<readonly Row[]>([{ id: 7, name: "Dev/Sr" }]); // primary SECOND
      const undo = useUndoStack(deps);
      return { refs, roles, setRefs, setRoles, undo };
    });
    const rolesBefore = result.current.roles;
    const refsBefore = result.current.refs;
    // Simulate the role delete + roleId cascade.
    act(() => {
      result.current.setRoles([]);
      result.current.setRefs([{ id: 1, roleId: null }]);
    });
    act(() => {
      result.current.undo.captureComposite({
        kind: "role.deleted",
        primaryCount: 1,
        parts: [
          capturePart({ setter: result.current.setRoles, removed: [{ id: 7, name: "Dev/Sr" }], fromArray: rolesBefore }),
          capturePart({ setter: result.current.setRefs, edited: refsBefore, fromArray: refsBefore, fkRemapField: "roleId" }),
        ],
      });
    });
    // A brand-new role reuses the freed id 7 before undo.
    act(() => { result.current.setRoles([{ id: 7, name: "NEW-ROLE" }]); });
    act(() => { result.current.undo.undo(); });
    // Dev/Sr recovered under id 8; the live NEW-ROLE (id 7) untouched.
    expect(result.current.roles).toEqual([{ id: 8, name: "Dev/Sr" }, { id: 7, name: "NEW-ROLE" }]);
    // ★ Cascade FK follows the re-mint to 8 (would be a stale 7 without flushSync).
    expect(result.current.refs).toEqual([{ id: 1, roleId: 8 }]);
  });
});

describe("buildUndoLabel — entity registration", () => {
  // ★ Regression guard for a gap that shipped silently. buildUndoLabel resolves
  // the entity from the kind's prefix via ENTITY_KEY_SET; an unregistered prefix
  // yields `null` and the function returns its generic fallback BEFORE reading
  // `opts.name`. So a capture site can correctly pass the entity's title and
  // still get "Deleted 1 item(s)" — restore works, only the label is wrong,
  // which no functional test can see. calendarEvent shipped exactly that way.
  it("names a calendar event on delete instead of falling back to the generic label", () => {
    const label = buildUndoLabel("en-US", "calendarEvent.deleted", 1, { name: "Sprint Planning" });
    expect(label).toBe('Delete meeting "Sprint Planning"');
    expect(label).not.toBe("Deleted 1 item(s)");
  });

  it("names a calendar event on edit", () => {
    expect(buildUndoLabel("en-US", "calendarEvent.updated", 1, { name: "Standup" })).toBe(
      'Edit meeting "Standup"',
    );
  });

  // The real invariant, stated once rather than per-entity: every entity prefix
  // that ACTIVITY_KIND_TO_KEY gives a log line must also resolve to a named undo
  // label. This catches the NEXT entity added without its ENTITY_KEY_SET row.
  it("resolves a named label for every row-entity prefix in ACTIVITY_KIND_TO_KEY", () => {
    // `settings` is a singleton config write, not a row: there is no instance to
    // name, and it has no per-row undo, so the generic fallback is correct for it
    // rather than a gap. Every OTHER .created/.updated/.deleted prefix is a real
    // entity and must resolve to a named label.
    const NON_ROW_PREFIXES = new Set(["settings"]);
    // ★ Derived from the translator, never hardcoded. A literal copy of these
    // strings would stop matching the moment someone reworded either fallback,
    // and the sweep would then report zero unnamed entities for EVERY future
    // omission — passing vacuously at exactly the moment it should fail. That
    // is the same silent-fallback class this whole test exists to catch.
    const generic = [t("en-US", "undoToastDelete", 1), t("en-US", "undoToastEdit", 1)];
    const prefixes = new Set(
      (Object.keys(ACTIVITY_KIND_TO_KEY) as ActivityKind[])
        .filter((k) => k.endsWith(".created") || k.endsWith(".updated") || k.endsWith(".deleted"))
        .map((k) => k.split(".")[0])
        .filter((p) => !NON_ROW_PREFIXES.has(p)),
    );
    const unnamed = [...prefixes].filter((p) =>
      generic.includes(buildUndoLabel("en-US", `${p}.deleted` as ActivityKind, 1, { name: "X" })),
    );
    expect(unnamed).toEqual([]);
  });
});
