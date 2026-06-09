"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import { isPendingChange } from "./change-log";
import type { ActivityKind } from "./activity-log";
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
}

export function useChangeLog(args: UseChangeLogArgs) {
  const { changes, setChanges } = useWorkspace();

  const handleSaveChange = useCallback((item: ChangeItem) => {
    const withStamp: ChangeItem = { ...item, localModifiedAt: new Date().toISOString() };
    const isNew = changes.findIndex((c) => c.id === item.id) < 0;
    setChanges(isNew ? [...changes, withStamp] : changes.map((c) => (c.id === item.id ? withStamp : c)));
    args.logActivity?.(isNew ? "change.created" : "change.updated", item.id, item.title);
  }, [changes, setChanges, args]);

  const handleDeleteChange = useCallback((id: number, title: string) => {
    setChanges((prev) => prev.filter((c) => c.id !== id));
    args.logActivity?.("change.deleted", id, title);
  }, [setChanges, args]);

  return { changes, handleSaveChange, handleDeleteChange };
}
