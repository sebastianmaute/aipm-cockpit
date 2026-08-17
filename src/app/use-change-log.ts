"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import { isPendingChange, nextChangeId } from "./change-log";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { resolveEntitySave } from "./entity-id-mint";
import { reportSilentFailure } from "./guard-feedback";
import type { Lang } from "./i18n";
import type { ChangeItem, ChangeStatus } from "./types";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { CHANGE_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";

/** Status transition: auto-fill decisionDate the first time the item leaves the
 *  pending set; clear it if it returns to pending. Pure + exported for testing. */
export function applyChangeStatus(item: ChangeItem, status: ChangeStatus, today: string): ChangeItem {
  if (isPendingChange(status)) {
    const next = { ...item, status };
    delete next.decisionDate;
    return next;
  }
  return { ...item, status, decisionDate: item.decisionDate ?? today };
}

export interface UseChangeLogArgs {
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
  /** Capture per-field edits for undo (modal/inline save). */
  captureFieldEdit?: UndoStackApi["captureFieldEdit"];
}

export function useChangeLog(args: UseChangeLogArgs) {
  const { changes, setChanges } = useWorkspace();

  // isNew carries the modal's create/edit intent so a create can't be misread as
  // an update and clobber a row committed since the modal opened (id-mint race).
  // Non-modal callers (bulk edit) omit it → id-existence fallback (unchanged).
  const handleSaveChange = useCallback((item: ChangeItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => {
    const { create, id } = resolveEntitySave(changes, item.id, isNew, () => nextChangeId(changes));
    const previous = create ? undefined : changes.find((c) => c.id === id);
    // Editing a row a concurrent writer already deleted: the map-replace below
    // would silently no-op. Surface it instead of dropping the edit in silence.
    if (!create && !previous) {
      if (args.showToast && args.lang) {
        reportSilentFailure(args.showToast, args.lang, "change.editVanished", "concurrent delete during edit", "guardEditVanished");
      }
      return;
    }
    // The note log is WRITE-THROUGH and owns itself: the notes window commits
    // straight to the workspace array, which the modal's edit-open snapshot
    // never sees. This save REPLACES the row, so taking the draft's value would
    // destroy any note added while the editor was open. Take it from the STORED
    // row instead — NOT the task fix (omit it from the payload), which works
    // only because the task save merges; an absent field erases the log here.
    // It lands on withStamp rather than inside setChanges so the stale value
    // never reaches captureFieldChanges and becomes undoable/redoable state.
    // On a create there is no stored row and item.noteLog is the only truth.
    const withStamp: ChangeItem = {
      ...item,
      ...(create ? {} : { noteLog: previous?.noteLog }),
      id,
      localModifiedAt: new Date().toISOString(),
    };
    // Functional updater so N back-to-back saves in one tick (bulk edit) each
    // see the latest array and compose, instead of all reading the same stale
    // closure and the last write clobbering the rest.
    setChanges((prev) =>
      create ? [...prev, withStamp] : prev.map((c) => (c.id === id ? withStamp : c)),
    );
    if (create) {
      args.logActivity?.("change.created", id, item.title);
    } else if (previous) {
      if (!opts?.suppressFieldUndo) {
        captureFieldChanges(args.captureFieldEdit, {
          setter: setChanges, kind: "change.updated", id,
          prev: previous, next: withStamp, groups: CHANGE_UNDO_GROUPS,
          stampField: "localModifiedAt", name: item.title,
        });
      }
      if (args.logActivityChanges) {
        args.logActivityChanges("change.updated", diffFields(previous, withStamp), id, item.title);
      } else {
        // Back-compat: a caller wiring only logActivity still records the update.
        args.logActivity?.("change.updated", id, item.title);
      }
    }
  }, [changes, setChanges, args]);

  // Inline status change from the table row. Routes through applyChangeStatus —
  // the SOLE writer of the status/decisionDate invariant — so the row cannot
  // acquire a status without its matching decision date, or keep a stale one.
  // Functional updater for the same reason handleSaveChange uses one: a bulk
  // status sweep would otherwise have N saves in one tick all read the same
  // stale closure and the last write clobber the rest.
  const handleChangeStatusChange = useCallback((id: number, next: ChangeStatus) => {
    const previous = changes.find((c) => c.id === id);
    // Same concurrent-delete case handleSaveChange guards: the map-replace below
    // would silently no-op. Surface it instead of dropping the edit in silence.
    if (!previous) {
      if (args.showToast && args.lang) {
        reportSilentFailure(args.showToast, args.lang, "change.editVanished", "concurrent delete during inline status change", "guardEditVanished");
      }
      return;
    }
    const updated: ChangeItem = {
      ...applyChangeStatus(previous, next, args.today),
      localModifiedAt: new Date().toISOString(),
    };
    setChanges((prev) => prev.map((c) => (c.id === id ? updated : c)));
    // CHANGE_UNDO_GROUPS pairs status with decisionDate, so one undo entry
    // restores both halves of the invariant.
    captureFieldChanges(args.captureFieldEdit, {
      setter: setChanges, kind: "change.updated", id,
      prev: previous, next: updated, groups: CHANGE_UNDO_GROUPS,
      stampField: "localModifiedAt", name: previous.title,
    });
    if (args.logActivityChanges) {
      args.logActivityChanges("change.updated", diffFields(previous, updated), id, previous.title);
    } else {
      args.logActivity?.("change.updated", id, previous.title);
    }
  }, [changes, setChanges, args]);

  const handleDeleteChange = useCallback((id: number, title: string) => {
    const doomed = changes.find((c) => c.id === id);
    if (doomed) args.capture?.({ setter: setChanges, kind: "change.deleted", removed: [doomed], fromArray: changes, name: title });
    setChanges((prev) => prev.filter((c) => c.id !== id));
    args.logActivity?.("change.deleted", id, title);
  }, [changes, setChanges, args]);

  // Snapshot the selected rows' pre-edit images before a bulk edit loops the
  // per-row save handler; call BEFORE the loop mutates them.
  const captureBulkUndo = useCallback((ids: readonly number[]) => {
    const edited = changes.filter((c) => ids.includes(c.id));
    if (edited.length) args.capture?.({ setter: setChanges, kind: "bulk.edit", edited, fromArray: changes, entityKey: "change" });
  }, [changes, setChanges, args]);

  return { changes, handleSaveChange, handleChangeStatusChange, handleDeleteChange, captureBulkUndo };
}
