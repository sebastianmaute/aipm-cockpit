"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { resolveEntitySave } from "./entity-id-mint";
import { reportSilentFailure } from "./guard-feedback";
import { nextStakeholderId } from "./stakeholders";
import type { Lang } from "./i18n";
import type { Stakeholder } from "./types";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { STAKEHOLDER_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";

export interface UseStakeholdersArgs {
  today: string;
  lang?: Lang;
  showToast?: (kind: "info" | "error", text: string) => void;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  /** Capture a pre-op snapshot for undo (delete removes the row). */
  capture?: UndoStackApi["capture"];
  /** Capture per-field edits for undo (modal save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
}

export function useStakeholders(args: UseStakeholdersArgs) {
  const { stakeholders, setStakeholders } = useWorkspace();

  // isNew carries the modal's create/edit intent so a create can't be misread as
  // an update and clobber a row committed since the modal opened (id-mint race).
  // Non-modal callers (bulk edit) omit it → id-existence fallback (unchanged).
  const handleSaveStakeholder = useCallback((item: Stakeholder, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => {
    const { create, id } = resolveEntitySave(stakeholders, item.id, isNew, () =>
      nextStakeholderId(stakeholders),
    );
    const withStamp: Stakeholder = { ...item, id, localModifiedAt: new Date().toISOString() };
    const previous = create ? undefined : stakeholders.find((s) => s.id === id);
    // Editing a row a concurrent writer already deleted: the map-replace below
    // would silently no-op. Surface it instead of dropping the edit in silence.
    if (!create && !previous) {
      if (args.showToast && args.lang) {
        reportSilentFailure(args.showToast, args.lang, "stakeholder.editVanished", "concurrent delete during edit", "guardEditVanished");
      }
      return;
    }
    // Functional updater so N back-to-back saves in one tick (bulk edit) compose
    // instead of each reading the same stale closure (last write would win).
    setStakeholders((prev) =>
      create ? [...prev, withStamp] : prev.map((s) => (s.id === id ? withStamp : s)),
    );
    if (create) {
      args.logActivity?.("stakeholder.created", id, item.name);
    } else if (previous) {
      if (!opts?.suppressFieldUndo) {
        captureFieldChanges(args.captureFieldEdit, {
          setter: setStakeholders, kind: "stakeholder.updated", id,
          prev: previous, next: withStamp, groups: STAKEHOLDER_UNDO_GROUPS,
          stampField: "localModifiedAt",
        });
      }
      if (args.logActivityChanges) {
        args.logActivityChanges("stakeholder.updated", diffFields(previous, withStamp), id, item.name);
      } else {
        args.logActivity?.("stakeholder.updated", id, item.name);
      }
    }
  }, [stakeholders, setStakeholders, args]);

  const handleDeleteStakeholder = useCallback((id: number, name: string) => {
    const doomed = stakeholders.find((s) => s.id === id);
    if (doomed) args.capture?.({ setter: setStakeholders, kind: "stakeholder.deleted", removed: [doomed], fromArray: stakeholders });
    setStakeholders((prev) => prev.filter((s) => s.id !== id));
    args.logActivity?.("stakeholder.deleted", id, name);
  }, [stakeholders, setStakeholders, args]);

  // Snapshot the selected rows' pre-edit images before a bulk edit loops the
  // per-row save handler; call BEFORE the loop mutates them.
  const captureBulkUndo = useCallback((ids: readonly number[]) => {
    const edited = stakeholders.filter((s) => ids.includes(s.id));
    if (edited.length) args.capture?.({ setter: setStakeholders, kind: "bulk.edit", edited, fromArray: stakeholders });
  }, [stakeholders, setStakeholders, args]);

  return { stakeholders, handleSaveStakeholder, handleDeleteStakeholder, captureBulkUndo };
}
