"use client";

// Per-entity CRUD hook for reference data (roles · disciplines · grades).
// Extracted from use-resource-planner.ts, which sat at its file-size ratchet
// baseline with zero slack (open-followups §2), mirroring use-calendar-events.ts
// — the earlier extraction out of that same file, for that same reason.
//
// MOVE ONLY, no behaviour change: each handler keeps the body and the
// memoization form it had in use-resource-planner.ts, so the move cannot itself
// regress anything downstream. ★ An earlier revision of this comment justified
// that by citing open-followups §1 and "the ResourcesPanel memo these handler
// identities feed" — FALSE. ★★ Counted, after that same revision asserted a
// wrong count of its own ("14 of the 15 reach only RolesPanel"): TWELVE reach
// RolesPanel (task-manager.tsx:2200-2211), which is not memo()'d and whose
// wrapping JSX is rebuilt every render anyway; handleAssignRoleById is the
// thirteenth and reaches the memo'd ResourceDirectory already wrapped in
// guardEdit(), which mints a fresh identity per render regardless. (Two more
// handlers with no production consumer were deleted — open-followups §62;
// handleAssignRoleById covers both assigning and clearing a role.)
// §1 is about ResourcesPanel and ResourceCalendar, and onAssignRoleById reaches
// only ResourceDirectory (workspace-section.tsx:486), so neither §1 component
// receives any handler from this file. Preserving the memoization form needs no
// reason beyond this being a move-only commit — don't reintroduce one.
//
// The args the moved bodies read go through a REF derived here rather than
// threaded in: exhaustive-deps only knows a value is render-stable when it can
// see the useRef, so threading ref objects as args made the rule demand them in
// every dependency array — a change to the memoization form this move is
// forbidden to make. Deriving it locally keeps every dependency array
// byte-identical. It is ONE `argsRef` mirroring the whole bag after every commit,
// not a ref per arg — the per-arg pairs were the same boilerplate hand-rolled in
// four sibling hooks (open-followups §61 (c)); the four now share this shape.
// `logUpdate` is threaded instead of re-derived because it was
// ALREADY a named dependency of handleSaveRole (so nothing changes) and
// re-deriving it would duplicate a 13-line helper the owner still needs.

import { useCallback, useEffect, useRef } from "react";
import { useWorkspace } from "./workspace-context";
import { mintId } from "./id-mint-session";
import { type Resource, type Role } from "./types";
import { type ActivityKind } from "./activity-log";
import { captureFieldPart, capturePart, type UndoStackApi } from "./undo/use-undo-stack";

export interface UseReferenceDataArgs {
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  /** Capture a MULTI-array pre-op snapshot for undo — a role/discipline/grade
   *  delete cascades an edit into a second array. */
  captureComposite?: UndoStackApi["captureComposite"];
  /** useResourcePlanner's diff-aware update logger — stable (it reads refs),
   *  and already a declared dependency of handleSaveRole before the move. */
  logUpdate: (
    kind: ActivityKind,
    previous: object | undefined,
    next: object,
    ...args: (string | number)[]
  ) => void;
  /** Arms the one-shot destructive-save bypass. Optional — popouts and tests
   *  supply none. */
  allowDestructiveSave?: () => void;
}

export function useReferenceData(args: UseReferenceDataArgs) {
  const { roles, setRoles, disciplines, setDisciplines, grades, setGrades, resources, setResources } =
    useWorkspace();
  const { logUpdate } = args;

  const argsRef = useRef(args);
  useEffect(() => { argsRef.current = args; });

  // ── moved verbatim from use-resource-planner.ts ──

  const resolveOrCreateRole = useCallback(
    (disciplineId: number, gradeId: number): number => {
      const existing = roles.find(
        (r) => r.disciplineId === disciplineId && r.gradeId === gradeId,
      );
      if (existing) return existing.id;
      const id = mintId("role", roles);
      const role: Role = {
        id,
        disciplineId,
        gradeId,
        internalRate: 0,
        externalRate: 0,
        localModifiedAt: new Date().toISOString(),
      };
      setRoles((prev) => [...prev, role]);
      argsRef.current.logActivity("role.created", id, `${disciplineId}/${gradeId}`);
      return id;
    },
    [roles, setRoles],
  );

  const handleSaveRole = useCallback(
    (role: Role) => {
      const stamp = new Date().toISOString();
      const withStamp: Role = { ...role, localModifiedAt: stamp };
      const previous = roles.find((r) => r.id === role.id);
      setRoles((prev) =>
        prev.map((r) => (r.id === role.id ? withStamp : r)),
      );
      logUpdate("role.updated", previous, withStamp, role.id, `${role.disciplineId}/${role.gradeId}`);
    },
    [roles, setRoles, logUpdate],
  );

  const handleDeleteRole = useCallback(
    (id: number) => {
      const removed = roles.find((r) => r.id === id);
      const stamp = new Date().toISOString();
      // Rows the cascade will edit (roleId → null) — snapshot BEFORE the setter.
      const affected = resources.filter((r) => r.roleId === id);
      // ONE spelling of the cascade, shared by the write and the undo patch below, so the two cannot drift.
      const cleared = { roleId: null } as const;
      setRoles((prev) => prev.filter((r) => r.id !== id));
      setResources((prev) =>
        prev.map((r) =>
          r.roleId === id ? { ...r, ...cleared, localModifiedAt: stamp } : r,
        ),
      );
      if (removed) {
        // One undo reverts BOTH the role removal and the roleId-clearing cascade.
        argsRef.current.captureComposite?.({
          kind: "role.deleted",
          primaryCount: 1,
          name: `${removed.disciplineId}/${removed.gradeId}`,
          parts: [
            capturePart({ setter: setRoles, removed: [removed], fromArray: roles, isPrimary: true }),
            // §177b — a FIELD patch, so undo restores `roleId` alone and a
            // concurrent edit to another field of these resources survives.
            captureFieldPart<Resource>({
              setter: setResources,
              edits: affected.map((r) => ({ id: r.id, before: { roleId: r.roleId }, after: cleared })),
              stampField: "localModifiedAt",
              fkRemapField: "roleId",
            }),
          ],
        });
        argsRef.current.logActivity("role.deleted", id, `${removed.disciplineId}/${removed.gradeId}`);
        argsRef.current.allowDestructiveSave?.();
      }
    },
    [roles, resources, setRoles, setResources],
  );

  // Directory single-role picker: assign an existing rate-card role directly by
  // id (or clear with null). This never mints a
  // role — new discipline/grade combos are authored in the rate-card editor.
  const handleAssignRoleById = useCallback(
    (resourceId: number, roleId: number | null) => {
      const stamp = new Date().toISOString();
      setResources((prev) =>
        prev.map((r) =>
          r.id === resourceId ? { ...r, roleId, localModifiedAt: stamp } : r,
        ),
      );
    },
    [setResources],
  );

  const handleAddDiscipline = useCallback(
    (name: string): number | null => {
      const clean = name.trim();
      if (!clean) return null;
      const id = mintId("discipline", disciplines);
      setDisciplines((prev) => [
        ...prev,
        { id, name: clean, localModifiedAt: new Date().toISOString() },
      ]);
      return id;
    },
    [disciplines, setDisciplines],
  );

  const handleRenameDiscipline = useCallback(
    (id: number, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      const stamp = new Date().toISOString();
      setDisciplines((prev) =>
        prev.map((d) => (d.id === id ? { ...d, name: clean, localModifiedAt: stamp } : d)),
      );
    },
    [setDisciplines],
  );

  const handleAddGrade = useCallback(
    (name: string): number | null => {
      const clean = name.trim();
      if (!clean) return null;
      const id = mintId("grade", grades);
      setGrades((prev) => [
        ...prev,
        { id, name: clean, localModifiedAt: new Date().toISOString() },
      ]);
      return id;
    },
    [grades, setGrades],
  );

  const handleRenameGrade = useCallback(
    (id: number, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      const stamp = new Date().toISOString();
      setGrades((prev) =>
        prev.map((g) => (g.id === id ? { ...g, name: clean, localModifiedAt: stamp } : g)),
      );
    },
    [setGrades],
  );

  const onDeleteDiscipline = useCallback((id: number) => {
    const removed = disciplines.find((d) => d.id === id);
    const affected = roles.filter((r) => r.disciplineId === id);
    // ONE spelling of the cascade, shared by the write and the undo patch below, so the two cannot drift.
    const cleared = { disciplineId: 0, internalRate: 0, externalRate: 0 } as const;
    setDisciplines((prev) => prev.filter((d) => d.id !== id));
    setRoles((prev) => prev.map((r) =>
      r.disciplineId === id ? { ...r, ...cleared } : r,
    ));
    if (removed) {
      // One undo reverts the discipline removal AND the roles' cleared FK + rates.
      argsRef.current.captureComposite?.({
        kind: "discipline.deleted",
        primaryCount: 1,
        name: removed.name,
        parts: [
          capturePart({ setter: setDisciplines, removed: [removed], fromArray: disciplines, isPrimary: true }),
          captureFieldPart<Role>({
            setter: setRoles,
            edits: affected.map((r) => ({
              id: r.id,
              before: { disciplineId: r.disciplineId, internalRate: r.internalRate, externalRate: r.externalRate },
              after: cleared,
            })),
            fkRemapField: "disciplineId",
          }),
        ],
      });
      argsRef.current.logActivity("discipline.deleted", id, removed.name);
      // `disciplines` is a counted slice — a deliberate delete must arm the
      // one-shot bypass or the save guard refuses the user's own removal.
      argsRef.current.allowDestructiveSave?.();
    }
  }, [disciplines, roles, setDisciplines, setRoles]);

  const onDeleteGrade = useCallback((id: number) => {
    const removed = grades.find((g) => g.id === id);
    const affected = roles.filter((r) => r.gradeId === id);
    // ONE spelling of the cascade, shared by the write and the undo patch below, so the two cannot drift.
    const cleared = { gradeId: 0, internalRate: 0, externalRate: 0 } as const;
    setGrades((prev) => prev.filter((g) => g.id !== id));
    setRoles((prev) => prev.map((r) =>
      r.gradeId === id ? { ...r, ...cleared } : r,
    ));
    if (removed) {
      argsRef.current.captureComposite?.({
        kind: "grade.deleted",
        primaryCount: 1,
        name: removed.name,
        parts: [
          capturePart({ setter: setGrades, removed: [removed], fromArray: grades, isPrimary: true }),
          captureFieldPart<Role>({
            setter: setRoles,
            edits: affected.map((r) => ({
              id: r.id,
              before: { gradeId: r.gradeId, internalRate: r.internalRate, externalRate: r.externalRate },
              after: cleared,
            })),
            fkRemapField: "gradeId",
          }),
        ],
      });
      argsRef.current.logActivity("grade.deleted", id, removed.name);
      // `grades` is a counted slice — same one-shot arming as the discipline
      // and role routes above.
      argsRef.current.allowDestructiveSave?.();
    }
  }, [grades, roles, setGrades, setRoles]);

  const onReorderDisciplines = useCallback((orderedIds: number[]) => {
    setDisciplines((prev) =>
      orderedIds
        .map((id) => prev.find((d) => d.id === id))
        .filter((d): d is (typeof prev)[number] => !!d),
    );
  }, [setDisciplines]);

  const onReorderGrades = useCallback((orderedIds: number[]) => {
    setGrades((prev) =>
      orderedIds
        .map((id) => prev.find((g) => g.id === id))
        .filter((g): g is (typeof prev)[number] => !!g),
    );
  }, [setGrades]);

  // Rate-card row reorder: roles carry an explicit `order` field (not array
  // order) so the manual sequence survives Turso, which doesn't guarantee row
  // order without an ORDER BY. Rewrite each moved role's order to its new index.
  const onReorderRoles = useCallback((orderedIds: number[]) => {
    const stamp = new Date().toISOString();
    setRoles((prev) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      return prev.map((r) =>
        orderMap.has(r.id) ? { ...r, order: orderMap.get(r.id)!, localModifiedAt: stamp } : r,
      );
    });
  }, [setRoles]);

  return {
    resolveOrCreateRole,
    handleSaveRole,
    handleDeleteRole,
    handleAssignRoleById,
    handleAddDiscipline,
    handleRenameDiscipline,
    handleAddGrade,
    handleRenameGrade,
    onDeleteDiscipline,
    onDeleteGrade,
    onReorderDisciplines,
    onReorderGrades,
    onReorderRoles,
  };
}
