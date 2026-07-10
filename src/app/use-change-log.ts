"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import { isPendingChange, nextChangeId } from "./change-log";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import { resolveEntitySave } from "./entity-id-mint";
import { reportSilentFailure } from "./guard-feedback";
import type { Lang } from "./i18n";
import type { ChangeItem, ChangeStatus } from "./types";

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
}

export function useChangeLog(args: UseChangeLogArgs) {
  const { changes, setChanges } = useWorkspace();

  // isNew carries the modal's create/edit intent so a create can't be misread as
  // an update and clobber a row committed since the modal opened (id-mint race).
  // Non-modal callers (bulk edit) omit it → id-existence fallback (unchanged).
  const handleSaveChange = useCallback((item: ChangeItem, isNew?: boolean) => {
    const { create, id } = resolveEntitySave(changes, item.id, isNew, () => nextChangeId(changes));
    const withStamp: ChangeItem = { ...item, id, localModifiedAt: new Date().toISOString() };
    const previous = create ? undefined : changes.find((c) => c.id === id);
    // Editing a row a concurrent writer already deleted: the map-replace below
    // would silently no-op. Surface it instead of dropping the edit in silence.
    if (!create && !previous) {
      if (args.showToast && args.lang) {
        reportSilentFailure(args.showToast, args.lang, "change.editVanished", "concurrent delete during edit", "guardEditVanished");
      }
      return;
    }
    // Functional updater so N back-to-back saves in one tick (bulk edit) each
    // see the latest array and compose, instead of all reading the same stale
    // closure and the last write clobbering the rest.
    setChanges((prev) =>
      create ? [...prev, withStamp] : prev.map((c) => (c.id === id ? withStamp : c)),
    );
    if (create) {
      args.logActivity?.("change.created", id, item.title);
    } else if (previous && args.logActivityChanges) {
      args.logActivityChanges("change.updated", diffFields(previous, withStamp), id, item.title);
    } else {
      // Back-compat: a caller wiring only logActivity still records the update.
      args.logActivity?.("change.updated", id, item.title);
    }
  }, [changes, setChanges, args]);

  const handleDeleteChange = useCallback((id: number, title: string) => {
    setChanges((prev) => prev.filter((c) => c.id !== id));
    args.logActivity?.("change.deleted", id, title);
  }, [setChanges, args]);

  return { changes, handleSaveChange, handleDeleteChange };
}
