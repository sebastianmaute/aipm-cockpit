// Task-editor glue for the budget-bucket field. Mirrors the editor's existing
// non-Task side effects (create-RAID, linked tasks): EDIT mode applies
// immediately, CREATE mode stages until the new task id is minted.
"use client";
import { useCallback, useRef, useState } from "react";
import { bucketIdForTask, moveTasksToBucket } from "./budget-task-link";
import type { BucketCommitMeta } from "./use-budget-buckets";
import type { BudgetBucket } from "./types";

export interface TaskBudgetLink {
  buckets: readonly BudgetBucket[];
  bucketId: number | null;
  onChange: (bucketId: number | null) => void;
}

interface Deps {
  /** Budget module enabled — off ⇒ no field at all. */
  enabled: boolean;
  budgets: readonly BudgetBucket[];
  editingId: number | null;
  commitBuckets: (next: readonly BudgetBucket[], meta?: BucketCommitMeta) => void;
  flushEditorBuffer: (parentId: number) => void;
  discardEditorBuffer: () => void;
}

export function useTaskBudgetLink(deps: Deps): {
  budgetLink: TaskBudgetLink | undefined;
  onTaskCreated: (newId: number) => void;
  onEditorDiscard: () => void;
} {
  const { enabled, budgets, editingId, commitBuckets, flushEditorBuffer, discardEditorBuffer } = deps;
  // `undefined` = untouched this session; null = explicitly "no bucket".
  const [pending, setPending] = useState<number | null | undefined>(undefined);
  // The side effects below run outside any state updater (strict mode
  // double-invokes updaters), so read the live value from a ref.
  const pendingRef = useRef<number | null | undefined>(undefined);

  const apply = useCallback((taskId: number, bucketId: number | null) => {
    const next = moveTasksToBucket(budgets, [taskId], bucketId, new Date().toISOString());
    if (next === budgets) return; // no-op: nothing to capture, nothing to log
    commitBuckets(next, { kind: "budget.updated", name: budgets.find((b) => b.id === bucketId)?.name });
  }, [budgets, commitBuckets]);

  const onChange = useCallback((bucketId: number | null) => {
    if (editingId !== null) { apply(editingId, bucketId); return; }
    pendingRef.current = bucketId;
    setPending(bucketId);
  }, [editingId, apply]);

  const onTaskCreated = useCallback((newId: number) => {
    flushEditorBuffer(newId);
    const staged = pendingRef.current;
    pendingRef.current = undefined;
    setPending(undefined);
    if (staged !== undefined) apply(newId, staged);
  }, [flushEditorBuffer, apply]);

  const onEditorDiscard = useCallback(() => {
    discardEditorBuffer();
    pendingRef.current = undefined;
    setPending(undefined);
  }, [discardEditorBuffer]);

  const bucketId = pending !== undefined
    ? pending
    : editingId !== null ? bucketIdForTask(budgets, editingId) : null;

  return {
    budgetLink: enabled ? { buckets: budgets, bucketId, onChange } : undefined,
    onTaskCreated,
    onEditorDiscard,
  };
}
