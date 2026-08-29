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
  /** Capture a bulk field-patch edit for undo (stakeholders bulk apply). */
  captureFieldRows?: UndoStackApi["captureFieldRows"];
  /** Arms the one-shot destructive-save bypass — called only when a delete actually removed a row. */
  allowDestructiveSave?: () => void;
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
          stampField: "localModifiedAt", name: item.name,
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
    if (doomed) {
      args.capture?.({ setter: setStakeholders, kind: "stakeholder.deleted", removed: [doomed], fromArray: stakeholders, name });
      // ★★ Stakeholders count toward the save-time data-loss guards. Armed
      //    inside the `doomed` guard so a miss never arms — the setter below
      //    runs either way (open-followups §285).
      args.allowDestructiveSave?.();
    }
    setStakeholders((prev) => prev.filter((s) => s.id !== id));
    args.logActivity?.("stakeholder.deleted", id, name);
  }, [stakeholders, setStakeholders, args]);

  // Called by stakeholders-panel (and use-raci-suggest's apply) BEFORE its
  // save loop, with the field patches about to be written. Field patches
  // rather than whole rows — see open-followups #50: a whole-row capture
  // reverts anything a concurrent writer changed on these rows meanwhile.
  // Stakeholders carry no write-through field today; the shape is the point,
  // so a write-through field added later is safe by construction rather than
  // by remembering this file.
  const captureBulkUndo = useCallback(
    (edits: readonly { id: number; before: Partial<Stakeholder>; after: Partial<Stakeholder> }[]) => {
      // No `stampField` here: this register omits it while the tasks bulk edit
      // passes it (`use-bulk-operations.ts`). That asymmetry is UNRESOLVED — an
      // undo that does not restamp may not propagate to a backend that syncs on
      // `localModifiedAt`. Tracked as open-followups §181; do not "harmonise" the
      // four registers without reading it.
      if (edits.length) args.captureFieldRows?.({ setter: setStakeholders, kind: "bulk.edit", edits, entityKey: "stakeholder" });
    },
    [setStakeholders, args],
  );

  return { stakeholders, handleSaveStakeholder, handleDeleteStakeholder, captureBulkUndo };
}
