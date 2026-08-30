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
    // Everything after the count is (kind, count) PAIRS (§166) — the completion
    // trend reads them to undo its own subtraction; without them the row is a
    // bare total and a restored delete is indistinguishable from a reverted edit.
    expect(deps.logActivity).toHaveBeenCalledWith("undo", 1, "task.deleted", 1);
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

  it("captureComposite names the entity in its label when given an entityKey", () => {
    const rows = [{ id: 1, sev: "Low" }, { id: 2, sev: "Low" }];
    const { result, setRows } = mountRows<{ id: number; sev: string }>(rows);
    act(() => {
      result.current.captureComposite({
        kind: "bulk.edit",
        primaryCount: 2,
        entityKey: "task",
        parts: [capturePart({ setter: setRows, edited: rows, fromArray: rows })],
      });
    });
    // Before this change the composite path had no way to say "task", so the label
    // fell through buildUndoLabel's `if (!key)` line to the generic form.
    expect(result.current.stack[0].label).toBe("Bulk edit 2 tasks");
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
    expect(deps.logActivity).toHaveBeenCalledWith("redo", 1, "task.deleted", 1);
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

  // ── §295: a redo re-applies a deletion, so it must arm the storage bypass ──
  it("arms the destructive bypass when a redo re-removes rows", () => {
    const allowDestructiveSave = vi.fn();
    const deps = makeDeps({ allowDestructiveSave });
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "a" }];
    const setter = (u: SetStateAction<readonly Row[]>) => { arr = typeof u === "function" ? u(arr) : u; };

    act(() => {
      result.current.capture({ setter, kind: "task.deleted", removed: [{ id: 2, name: "b" }, { id: 3, name: "c" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }] });
    });
    act(() => { result.current.undo(); });
    expect(allowDestructiveSave).not.toHaveBeenCalled(); // undo RESTORES — nothing to authorise
    act(() => { result.current.redo(); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("does not arm when a redo only re-applies an edit", () => {
    // ★ The leak class §294 is about: arming on EVERY redo would hand a
    // one-shot destructive bypass to an ordinary bulk-edit redo, and the next
    // unrelated save would spend it.
    const allowDestructiveSave = vi.fn();
    const deps = makeDeps({ allowDestructiveSave });
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "after" }];
    const setter = (u: SetStateAction<readonly Row[]>) => { arr = typeof u === "function" ? u(arr) : u; };

    act(() => {
      result.current.capture({ setter, kind: "task.updated", edited: [{ id: 1, name: "before" }], fromArray: [{ id: 1, name: "before" }] });
    });
    act(() => { result.current.undo(); });
    act(() => { result.current.redo(); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });

  it("arms when any fragment of a composite redo removes rows", () => {
    const allowDestructiveSave = vi.fn();
    const deps = makeDeps({ allowDestructiveSave });
    const { result } = renderHook(() => useUndoStack(deps));
    let rows: readonly Row[] = [{ id: 1, name: "kept" }];
    let refs: readonly Ref[] = [{ id: 9, roleId: 1 }];
    const rowSetter = (u: SetStateAction<readonly Row[]>) => { rows = typeof u === "function" ? u(rows) : u; };
    const refSetter = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };

    act(() => {
      const editPart = capturePart<Ref>({ setter: refSetter, edited: [{ id: 9, roleId: 2 }], fromArray: [{ id: 9, roleId: 2 }] });
      const deletePart = capturePart<Row>({ setter: rowSetter, removed: [{ id: 2, name: "gone" }], fromArray: [{ id: 1, name: "kept" }, { id: 2, name: "gone" }], isPrimary: true });
      result.current.captureComposite({ kind: "task.deleted", primaryCount: 1, parts: [editPart, deletePart] });
    });
    act(() => { result.current.undo(); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    act(() => { result.current.redo(); });
    // ★ Composites arm because a FRAGMENT arms — `compositeUndoRunner` composes
    // the fragment redos and needs no check of its own. Do not add one.
    expect(allowDestructiveSave).toHaveBeenCalled();
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

// A state-backed harness: `capture` needs a real setter, and the through-undo
// property is only observable in the RESULTING ARRAY, not in call counts.
function useRowsHarness(initial: readonly Row[]) {
  const [rows, setRows] = useState<readonly Row[]>(initial);
  const api = useUndoStack(makeDeps());
  return { rows, setRows, api };
}

// `makeDeps`' `...overrides` spread widens each mock to a UNION with the plain
// dep signature, so `.mockClear()` is not on it. A test that clears between
// phases builds its deps directly instead.
function makeMockDeps() {
  return {
    lang: "en-US" as const,
    logActivity: vi.fn(),
    showToast: vi.fn(),
    showToastAction: vi.fn(),
  };
}

describe("undoThrough", () => {
  // ★★ SEED THREE. At N=1 a correct threaded implementation and a broken
  // loop-over-undo() are indistinguishable — both revert one entry.
  it("reverts every entry from the target up to the top, in one commit", () => {
    const start: readonly Row[] = [{ id: 1, name: "a" }];
    const { result } = renderHook(() => useRowsHarness(start));

    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "a" }, after: { name: "b" },
      });
      result.current.setRows([{ id: 1, name: "b" }]);
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "b" }, after: { name: "c" },
      });
      result.current.setRows([{ id: 1, name: "c" }]);
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "c" }, after: { name: "d" },
      });
      result.current.setRows([{ id: 1, name: "d" }]);
    });

    expect(result.current.api.stack).toHaveLength(3);
    const oldest = result.current.api.stack[0].id;

    act(() => { result.current.api.undoThrough(oldest); });

    // All three reverted, back to the starting value.
    expect(result.current.rows).toEqual([{ id: 1, name: "a" }]);
    expect(result.current.api.stack).toHaveLength(0);
    expect(result.current.api.redoStack).toHaveLength(3);
  });

  it("logs ONE activity entry with the summed count and fires ONE toast", () => {
    const deps = makeMockDeps();
    const { result } = renderHook(() => {
      const [rows, setRows] = useState<readonly Row[]>([{ id: 1, name: "a" }]);
      return { rows, setRows, api: useUndoStack(deps) };
    });
    act(() => {
      result.current.api.capture({
        setter: result.current.setRows, kind: "task.deleted",
        removed: [{ id: 2, name: "b" }, { id: 3, name: "c" }],
        fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }],
      });
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "a" }, after: { name: "z" },
      });
    });
    deps.logActivity.mockClear();
    deps.showToast.mockClear();

    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });

    expect(deps.logActivity).toHaveBeenCalledTimes(1);
    // 2 deleted + 1 edited. The batch is MIXED, and per-kind pairs describe it
    // exactly: 2 rows under `task.deleted` (which moved the total) and 1 under
    // `task.updated` (which did not). §166's first cut wrote a single "" here and
    // the trend discarded the whole 2-row correction — see `reversedKindCounts`.
    // ★★ PAIR ORDER IS EXECUTION ORDER, and undo runs NEWEST-FIRST — so the edit
    //   captured second is emitted first. Measured, not predicted: this assertion
    //   was first written delete-first and failed. The mirror `redoThrough` test
    //   below emits delete-first, because redo replays oldest-first. Order carries
    //   no meaning to the reader (`completion-trend.test.ts` pins that both orders
    //   give the same answer); it is asserted here only to keep the test exact.
    expect(deps.logActivity).toHaveBeenCalledWith("undo", 3, "task.updated", 1, "task.deleted", 2);
    expect(deps.showToast).toHaveBeenCalledTimes(1);
  });

  // The mixed-batch sibling above pins the `""` fallback; this pins the branch
  // that actually corrects the trend, so a `batchReversedKind` that always
  // returned `""` (the safe-looking simplification) fails one of the two.
  it("names the reversed kind when every entry in the batch shares it", () => {
    const deps = makeMockDeps();
    const { result } = renderHook(() => {
      const [rows, setRows] = useState<readonly Row[]>([{ id: 1, name: "a" }]);
      return { rows, setRows, api: useUndoStack(deps) };
    });
    act(() => {
      result.current.api.capture({
        setter: result.current.setRows, kind: "task.deleted",
        removed: [{ id: 2, name: "b" }, { id: 3, name: "c" }],
        fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }],
      });
    });
    act(() => {
      result.current.api.capture({
        setter: result.current.setRows, kind: "task.deleted",
        removed: [{ id: 4, name: "d" }],
        fromArray: [{ id: 1, name: "a" }, { id: 4, name: "d" }],
      });
    });
    deps.logActivity.mockClear();

    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });

    expect(deps.logActivity).toHaveBeenCalledTimes(1);
    expect(deps.logActivity).toHaveBeenCalledWith("undo", 3, "task.deleted", 3);
  });

  it("is a no-op for an absent id", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => { result.current.undoThrough(999); });
    expect(deps.logActivity).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
  });

  it("leaves the redo stack replayable oldest-undone-first", () => {
    const { result } = renderHook(() => useRowsHarness([{ id: 1, name: "a" }]));
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "a" }, after: { name: "b" },
      });
      result.current.setRows([{ id: 1, name: "b" }]);
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "b" }, after: { name: "c" },
      });
      result.current.setRows([{ id: 1, name: "c" }]);
    });
    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });
    expect(result.current.rows).toEqual([{ id: 1, name: "a" }]);

    // One redo replays the FIRST edit that was undone last → "b".
    act(() => { result.current.api.redo(); });
    expect(result.current.rows).toEqual([{ id: 1, name: "b" }]);
  });

  it("names the single entry instead of counting it when only one is reverted", () => {
    const deps = makeMockDeps();
    const { result } = renderHook(() => useUndoStack(deps));
    act(() => {
      result.current.capture({
        setter: vi.fn(), kind: "task.deleted", name: "Design review",
        removed: [{ id: 2, name: "b" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
      });
    });
    deps.showToast.mockClear();
    act(() => { result.current.undoThrough(result.current.stack[0].id); });
    // Same shape a plain undo() produces — not "Undid 1 action(s)".
    expect(deps.showToast).toHaveBeenCalledWith("info", 'Undone: Delete task "Design review"');
  });
});

// ★★★ A GUARD FOR AN INVARIANT THE PRODUCTION CODE ALREADY HOLDS: the entries'
// runners are invoked in a plain `.map` BEFORE any setState, never inside a
// setState updater. React double-invokes updaters under StrictMode, so moving
// `e.run()` back inside `setStack`/`setRedoStack` would apply all N restores
// TWICE — and every other test in this file renders without StrictMode, so all
// of them stay green through that change.
//
// ★★ SHAPE MATTERS (`src/app/strictmode.meta.test.tsx`): `reactStrictMode: true`
// leaves nothing between the root and StrictMode, so the double-invoke really
// happens here. A composed `wrapper: ({children}) => <StrictMode>{children}</StrictMode>`
// does NOT double-invoke on the mount commit and would make this vacuous-but-green.
//
// ★ The observable is the SETTER CALL COUNT, not the resulting array: a restore
// is idempotent against a fixed `prev`, so a doubled run is invisible in the
// final rows but unmistakable in how many updates were queued.
describe("through-undo runners execute OUTSIDE setState updaters (StrictMode)", () => {
  function captureTwoDeletes(api: ReturnType<typeof useUndoStack>, setter: () => void) {
    api.capture({
      setter, kind: "task.deleted",
      removed: [{ id: 2, name: "b" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
    });
    api.capture({
      setter, kind: "task.deleted",
      removed: [{ id: 3, name: "c" }], fromArray: [{ id: 1, name: "a" }, { id: 3, name: "c" }],
    });
  }

  it("runs each entry's undo exactly ONCE (undoThrough)", () => {
    const setter = vi.fn();
    const { result } = renderHook(() => useUndoStack(makeMockDeps()), { reactStrictMode: true });
    act(() => { captureTwoDeletes(result.current, setter); });
    expect(result.current.stack).toHaveLength(2);
    setter.mockClear();

    act(() => { result.current.undoThrough(result.current.stack[0].id); });

    // Two entries ⇒ two restores. Inside an updater this is 4 under StrictMode.
    expect(setter).toHaveBeenCalledTimes(2);
  });

  it("runs each entry's redo exactly ONCE (redoThrough)", () => {
    const setter = vi.fn();
    const { result } = renderHook(() => useUndoStack(makeMockDeps()), { reactStrictMode: true });
    act(() => { captureTwoDeletes(result.current, setter); });
    act(() => { result.current.undoThrough(result.current.stack[0].id); });
    expect(result.current.redoStack).toHaveLength(2);
    setter.mockClear();

    act(() => { result.current.redoThrough(result.current.redoStack[0].id); });

    expect(setter).toHaveBeenCalledTimes(2);
  });
});

describe("redoThrough", () => {
  it("replays every redo entry from the target up to the top", () => {
    const { result } = renderHook(() => useRowsHarness([{ id: 1, name: "a" }]));
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "a" }, after: { name: "b" },
      });
      result.current.setRows([{ id: 1, name: "b" }]);
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "b" }, after: { name: "c" },
      });
      result.current.setRows([{ id: 1, name: "c" }]);
    });
    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });
    expect(result.current.api.redoStack).toHaveLength(2);

    act(() => { result.current.api.redoThrough(result.current.api.redoStack[0].id); });
    expect(result.current.rows).toEqual([{ id: 1, name: "c" }]);
    expect(result.current.api.redoStack).toHaveLength(0);
    expect(result.current.api.stack).toHaveLength(2);
  });

  // ★★★ THIS SITE WAS THE ONE OF FOUR WITH NO ASSERTION AT ALL, and a cold
  //   review's mutant proved it: replacing `redoThrough`'s pair args with `""`
  //   left the whole suite green. `redoThrough` reaches the app through exactly
  //   one prop (`task-manager.tsx` `onRedoThrough`), so this file is its only
  //   possible detector. A regression here reopens §163's inflation on the redo
  //   side — the redone delete's rows are gone again, but the walk would not add
  //   them back on the way down.
  it("names the reversed kinds and counts, per kind, on a MIXED redo batch", () => {
    const deps = makeMockDeps();
    const { result } = renderHook(() => {
      const [rows, setRows] = useState<readonly Row[]>([{ id: 1, name: "a" }]);
      return { rows, setRows, api: useUndoStack(deps) };
    });
    act(() => {
      result.current.api.capture({
        setter: result.current.setRows, kind: "task.deleted",
        removed: [{ id: 2, name: "b" }, { id: 3, name: "c" }],
        fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }],
      });
    });
    act(() => {
      result.current.api.captureFieldEdit({
        setter: result.current.setRows, kind: "task.updated", id: 1,
        before: { name: "a" }, after: { name: "z" },
      });
    });
    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });
    deps.logActivity.mockClear();

    act(() => { result.current.api.redoThrough(result.current.api.redoStack[0].id); });

    expect(deps.logActivity).toHaveBeenCalledTimes(1);
    expect(deps.logActivity).toHaveBeenCalledWith("redo", 3, "task.deleted", 2, "task.updated", 1);
  });

  // ★ The homogeneous branch on the redo side, mirroring undoThrough's pair of
  //   cases — one test per branch, so a `reversedKindCounts` that collapsed to a
  //   single kind fails one of them.
  it("sums one kind across a homogeneous redo batch", () => {
    const deps = makeMockDeps();
    const { result } = renderHook(() => {
      const [rows, setRows] = useState<readonly Row[]>([{ id: 1, name: "a" }]);
      return { rows, setRows, api: useUndoStack(deps) };
    });
    act(() => {
      result.current.api.capture({
        setter: result.current.setRows, kind: "task.deleted",
        removed: [{ id: 2, name: "b" }, { id: 3, name: "c" }],
        fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }],
      });
    });
    act(() => {
      result.current.api.capture({
        setter: result.current.setRows, kind: "task.deleted",
        removed: [{ id: 4, name: "d" }],
        fromArray: [{ id: 1, name: "a" }, { id: 4, name: "d" }],
      });
    });
    act(() => { result.current.api.undoThrough(result.current.api.stack[0].id); });
    deps.logActivity.mockClear();

    act(() => { result.current.api.redoThrough(result.current.api.redoStack[0].id); });

    expect(deps.logActivity).toHaveBeenCalledWith("redo", 3, "task.deleted", 3);
  });
});

function mountRows<T extends { id: number }>(initial: readonly T[]) {
  const deps = makeDeps();
  const { result } = renderHook(() => useUndoStack(deps));
  let arr: readonly T[] = initial;
  const setRows = (u: SetStateAction<readonly T[]>) => { arr = typeof u === "function" ? u(arr) : u; };
  return { result, deps, setRows, rows: () => arr };
}

describe("captureFieldRows", () => {
  type Row = { id: number; sev: string; noteLog?: string[] };

  it("reverts only the captured fields and keeps a concurrent write", () => {
    const { result, rows, setRows } = mountRows<Row>([
      { id: 1, sev: "Low" },
      { id: 2, sev: "Low" },
    ]);

    act(() => {
      result.current.captureFieldRows<Row>({
        setter: setRows,
        kind: "bulk.edit",
        entityKey: "raid",
        edits: [
          { id: 1, before: { sev: "Low" }, after: { sev: "High" } },
          { id: 2, before: { sev: "Low" }, after: { sev: "High" } },
        ],
      });
      setRows((prev) => prev.map((r) => ({ ...r, sev: "High" })));
    });

    // The concurrent write the undo must not revert.
    act(() => { setRows((prev) => prev.map((r) => (r.id === 1 ? { ...r, noteLog: ["added"] } : r))); });
    act(() => { result.current.undo(); });

    expect(rows().find((r) => r.id === 1)).toEqual({ id: 1, sev: "Low", noteLog: ["added"] });
    expect(rows().find((r) => r.id === 2)).toEqual({ id: 2, sev: "Low" });
  });

  it("pushes ONE entry for N rows, counted by rows", () => {
    const { result, setRows } = mountRows<Row>([{ id: 1, sev: "Low" }, { id: 2, sev: "Low" }]);
    act(() => {
      result.current.captureFieldRows<Row>({
        setter: setRows, kind: "bulk.edit", entityKey: "raid",
        edits: [
          { id: 1, before: { sev: "Low" }, after: { sev: "High" } },
          { id: 2, before: { sev: "Low" }, after: { sev: "High" } },
        ],
      });
    });
    expect(result.current.stack).toHaveLength(1);
    expect(result.current.stack[0].count).toBe(2);
  });

  it("names the entity in the label, so a bulk edit does not degrade to a generic one", () => {
    const { result, setRows } = mountRows<Row>([{ id: 1, sev: "Low" }, { id: 2, sev: "Low" }]);
    act(() => {
      result.current.captureFieldRows<Row>({
        setter: setRows, kind: "bulk.edit", entityKey: "raid",
        edits: [
          { id: 1, before: { sev: "Low" }, after: { sev: "High" } },
          { id: 2, before: { sev: "Low" }, after: { sev: "High" } },
        ],
      });
    });
    // Exact string, and TWO rows on purpose: this is the label the whole-row path
    // already produces for the same input, pinned by the neighbouring test
    // "labels a bulk edit via the explicit entityKey". Asserting the identical
    // string is what proves the conversion changed the mechanism and not the UI.
    // A `not.toMatch(/item\(s\)/)` would also pass on a label naming the wrong entity.
    expect(result.current.stack[0].label).toBe("Bulk edit 2 RAID items");
  });

  it("pushes nothing for an empty edit list", () => {
    const { result, setRows } = mountRows<Row>([{ id: 1, sev: "Low" }]);
    act(() => {
      result.current.captureFieldRows<Row>({ setter: setRows, kind: "bulk.edit", entityKey: "raid", edits: [] });
    });
    expect(result.current.stack).toHaveLength(0);
  });

  it("redo re-applies the edit and keeps a note added since the undo", () => {
    const { result, rows, setRows } = mountRows<Row>([{ id: 1, sev: "Low" }]);
    act(() => {
      result.current.captureFieldRows<Row>({
        setter: setRows, kind: "bulk.edit", entityKey: "raid",
        edits: [{ id: 1, before: { sev: "Low" }, after: { sev: "High" } }],
      });
      setRows((prev) => prev.map((r) => ({ ...r, sev: "High" })));
    });
    act(() => { setRows((prev) => prev.map((r) => ({ ...r, noteLog: ["note A"] }))); });
    act(() => { result.current.undo(); });
    act(() => { setRows((prev) => prev.map((r) => ({ ...r, noteLog: [...(r.noteLog ?? []), "note B"] }))); });
    act(() => { result.current.redo(); });

    expect(rows()[0].sev).toBe("High");
    expect(rows()[0].noteLog).toEqual(["note A", "note B"]);
  });

  it("keeps a concurrently assigned RACI cell when a bulk suggestion is undone", () => {
    // open-followups §178, the reachable case. Suggest RACI writes the whole
    // `raci` map for several stakeholders as one bulk.edit; the user then assigns
    // a cell for a DIFFERENT milestone on one of those rows; Ctrl+Z must revert
    // the suggestion without taking the hand-assigned cell with it. Before the
    // merge landed the whole map was replaced and `m2` vanished.
    type S = { id: number; name: string; raci: Record<string, string> };
    const { result, rows, setRows } = mountRows<S>([{ id: 1, name: "Ada", raci: { m1: "R" } }]);

    act(() => {
      result.current.captureFieldRows<S>({
        setter: setRows,
        kind: "bulk.edit",
        entityKey: "stakeholder",
        edits: [{ id: 1, before: { raci: { m1: "R" } }, after: { raci: { m1: "A" } } }],
      });
      setRows((prev) => prev.map((r) => ({ ...r, raci: { m1: "A" } })));
    });

    act(() => { setRows((prev) => prev.map((r) => ({ ...r, raci: { ...r.raci, m2: "I" } }))); });
    act(() => { result.current.undo(); });

    expect(rows()[0].raci).toEqual({ m1: "R", m2: "I" });
  });

  it("redoes the same way — the hand-assigned cell survives the redo too", () => {
    // The merge is direction-symmetric: redo is merge(after, before, live). A test
    // covering only undo would leave the redo arm free to clobber, and the redo
    // arm is the one that runs on a Ctrl+Y the user reaches for AFTER noticing the
    // undo did what they wanted.
    type S = { id: number; name: string; raci: Record<string, string> };
    const { result, rows, setRows } = mountRows<S>([{ id: 1, name: "Ada", raci: { m1: "R" } }]);

    act(() => {
      result.current.captureFieldRows<S>({
        setter: setRows,
        kind: "bulk.edit",
        entityKey: "stakeholder",
        edits: [{ id: 1, before: { raci: { m1: "R" } }, after: { raci: { m1: "A" } } }],
      });
      setRows((prev) => prev.map((r) => ({ ...r, raci: { m1: "A" } })));
    });
    act(() => { setRows((prev) => prev.map((r) => ({ ...r, raci: { ...r.raci, m2: "I" } }))); });
    act(() => { result.current.undo(); });
    act(() => { result.current.redo(); });

    expect(rows()[0].raci).toEqual({ m1: "A", m2: "I" });
  });

  it("keeps a concurrent assigneeEmail refresh when a bulk assignee edit is undone", () => {
    // The §180 ⟺ §178 interaction, and the ONLY thing that pins it. TASK_UNDO_GROUPS
    // carries ["assignee","assigneeEmail","resourceId"], so since §180 a bulk
    // ASSIGNEE edit drags `assigneeEmail` into the patch with the SAME value on
    // both ends. `use-bulk-operations.ts`'s bulk-inquiry email refresh writes that
    // field between the edit and the undo, and a wholesale spread would revert it
    // — §180 would have introduced a data-loss path on a field that is NOT
    // write-through and therefore not protected by the preserve list.
    //
    // It does not, because `mergeFieldValue` resolves a key both ends agree on to
    // the LIVE value. That is the merge's second short-circuit, so this test dies
    // if that short-circuit is ever "simplified" to return the target.
    type T2 = { id: number; assignee: string; assigneeEmail: string; resourceId: number | null };
    const { result, rows, setRows } = mountRows<T2>([
      { id: 1, assignee: "Ada", assigneeEmail: "stale@example.com", resourceId: null },
    ]);

    act(() => {
      result.current.captureFieldRows<T2>({
        setter: setRows,
        kind: "bulk.edit",
        entityKey: "task",
        edits: [
          {
            id: 1,
            before: { assignee: "Ada", assigneeEmail: "stale@example.com", resourceId: null },
            after: { assignee: "Bo", assigneeEmail: "stale@example.com", resourceId: null },
          },
        ],
      });
      setRows((prev) => prev.map((r) => ({ ...r, assignee: "Bo" })));
    });

    act(() => {
      setRows((prev) => prev.map((r) => ({ ...r, assigneeEmail: "fresh@example.com" })));
    });
    act(() => { result.current.undo(); });

    expect(rows()[0].assignee).toBe("Ada");
    expect(rows()[0].assigneeEmail).toBe("fresh@example.com");
  });
});
