"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { resolveEntitySave } from "./entity-id-mint";
import { nextStakeholderId } from "./stakeholders";
import type { Stakeholder } from "./types";

export interface UseStakeholdersArgs {
  today: string;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
}

export function useStakeholders(args: UseStakeholdersArgs) {
  const { stakeholders, setStakeholders } = useWorkspace();

  // isNew carries the modal's create/edit intent so a create can't be misread as
  // an update and clobber a row committed since the modal opened (id-mint race).
  // Non-modal callers (bulk edit) omit it → id-existence fallback (unchanged).
  const handleSaveStakeholder = useCallback((item: Stakeholder, isNew?: boolean) => {
    const { create, id } = resolveEntitySave(stakeholders, item.id, isNew, () =>
      nextStakeholderId(stakeholders),
    );
    const withStamp: Stakeholder = { ...item, id, localModifiedAt: new Date().toISOString() };
    const previous = create ? undefined : stakeholders.find((s) => s.id === id);
    // Functional updater so N back-to-back saves in one tick (bulk edit) compose
    // instead of each reading the same stale closure (last write would win).
    setStakeholders((prev) =>
      create ? [...prev, withStamp] : prev.map((s) => (s.id === id ? withStamp : s)),
    );
    if (create) {
      args.logActivity?.("stakeholder.created", id, item.name);
    } else if (previous && args.logActivityChanges) {
      args.logActivityChanges("stakeholder.updated", diffFields(previous, withStamp), id, item.name);
    } else {
      args.logActivity?.("stakeholder.updated", id, item.name);
    }
  }, [stakeholders, setStakeholders, args]);

  const handleDeleteStakeholder = useCallback((id: number, name: string) => {
    setStakeholders((prev) => prev.filter((s) => s.id !== id));
    args.logActivity?.("stakeholder.deleted", id, name);
  }, [setStakeholders, args]);

  return { stakeholders, handleSaveStakeholder, handleDeleteStakeholder };
}
