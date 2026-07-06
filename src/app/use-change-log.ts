"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import { isPendingChange } from "./change-log";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
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
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
}

export function useChangeLog(args: UseChangeLogArgs) {
  const { changes, setChanges } = useWorkspace();

  const handleSaveChange = useCallback((item: ChangeItem) => {
    const withStamp: ChangeItem = { ...item, localModifiedAt: new Date().toISOString() };
    const previous = changes.find((c) => c.id === item.id);
    const isNew = previous === undefined;
    // Functional updater so N back-to-back saves in one tick (bulk edit) each
    // see the latest array and compose, instead of all reading the same stale
    // closure and the last write clobbering the rest.
    setChanges((prev) => {
      const idx = prev.findIndex((c) => c.id === item.id);
      return idx < 0 ? [...prev, withStamp] : prev.map((c) => (c.id === item.id ? withStamp : c));
    });
    if (isNew) {
      args.logActivity?.("change.created", item.id, item.title);
    } else if (args.logActivityChanges) {
      args.logActivityChanges("change.updated", diffFields(previous, withStamp), item.id, item.title);
    } else {
      // Back-compat: a caller wiring only logActivity still records the update.
      args.logActivity?.("change.updated", item.id, item.title);
    }
  }, [changes, setChanges, args]);

  const handleDeleteChange = useCallback((id: number, title: string) => {
    setChanges((prev) => prev.filter((c) => c.id !== id));
    args.logActivity?.("change.deleted", id, title);
  }, [setChanges, args]);

  return { changes, handleSaveChange, handleDeleteChange };
}
