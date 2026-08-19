"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import { applyChangeStatus, nextChangeId } from "./change-log";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { resolveEntitySave } from "./entity-id-mint";
import { reportSilentFailure } from "./guard-feedback";
import type { Lang } from "./i18n";
import type { ChangeItem, ChangeStatus } from "./types";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { CHANGE_UNDO_GROUPS } from "./undo/field-groups";
import type { UndoStackApi } from "./undo/use-undo-stack";

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
  /** Capture a bulk field-patch edit for undo (changes bulk apply). */
  captureFieldRows?: UndoStackApi["captureFieldRows"];
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
  // where every status TRANSITION in the app stamps or clears decisionDate — so
  // the row cannot acquire a status without its matching decision date, or keep
  // a stale one. (That helper is not the only writer of decisionDate itself;
  // its docblock in change-log.ts scopes what is actually exclusive.)
  // Functional updater, but note what it does and does not buy: `updated` is
  // built OUTSIDE it from the closure's `previous`, so a concurrent write to
  // THIS row is still overwritten. What it protects is the rest of the array —
  // N status changes in one tick each see the latest one and compose, instead
  // of all mapping over the same stale closure and the last write winning.
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

  // Called by change-panel BEFORE its save loop, with the field patches the
  // bulk form is about to write. Field patches rather than whole rows: a
  // whole-row capture reverts anything a concurrent writer changed on these
  // rows meanwhile — a note added through the notes window, an outlookEventId
  // stamped by the background calendar push (open-followups §50). ChangeItem
  // carries a noteLog too, as of 0.245.0.
  const captureBulkUndo = useCallback(
    (edits: readonly { id: number; before: Partial<ChangeItem>; after: Partial<ChangeItem> }[]) => {
      // No `stampField` here, deliberately: the tasks bulk path
      // (`use-bulk-operations.ts`) passes `stampField: "localModifiedAt"` and
      // these four converted registers do not, so undoing a bulk edit reverts
      // the values and leaves the apply's `localModifiedAt` standing.
      // `stampField` does NOT restore the prior stamp; it writes a FRESH
      // `new Date().toISOString()` on undo AND redo, the reversal being itself
      // a local modification the backends must push. Adding it here would be a
      // behaviour change, not a consistency fix.
      if (edits.length) args.captureFieldRows?.({ setter: setChanges, kind: "bulk.edit", edits, entityKey: "change" });
    },
    [setChanges, args],
  );

  return { changes, handleSaveChange, handleChangeStatusChange, handleDeleteChange, captureBulkUndo };
}
