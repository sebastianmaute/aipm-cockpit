"use client";
import { useCallback, useRef, useState } from "react";

/** The five Open-Points task cells that support in-place inline editing. */
export type InlineField = "taskName" | "startDate" | "dueDate" | "assignee" | "priority";

export interface InlineCellEdit {
  editing: InlineField | null;
  draft: string;
  setDraft: (v: string) => void;
  begin: (field: InlineField, current: string) => void;
  cancel: () => void;
  commit: () => void;
}

/**
 * Single-active-cell inline edit state for a task row.
 *
 * `begin` opens a cell with its current value seeded into `draft`; `commit`
 * fires `onCommit(field, draft)` for the active cell then clears it; `cancel`
 * drops the draft without committing. `commit` reads the latest `draft` via its
 * closure, and an `editingRef` guards against a double-commit (e.g. blur firing
 * after Enter): once the active cell is cleared, a second `commit` no-ops. The
 * `onCommit` side-effect runs OUTSIDE any state updater (updaters must be pure —
 * strict mode double-invokes them, which would otherwise fire onCommit twice).
 */
export function useInlineCellEdit(
  onCommit: (field: InlineField, value: string) => void,
): InlineCellEdit {
  const [editing, setEditing] = useState<InlineField | null>(null);
  const [draft, setDraft] = useState("");
  const editingRef = useRef<InlineField | null>(null);
  const begin = useCallback((field: InlineField, current: string) => {
    editingRef.current = field;
    setEditing(field);
    setDraft(current);
  }, []);
  const cancel = useCallback(() => {
    editingRef.current = null;
    setEditing(null);
  }, []);
  const commit = useCallback(() => {
    const field = editingRef.current;
    if (field === null) return; // double-commit guard (blur after Enter)
    editingRef.current = null;
    setEditing(null);
    onCommit(field, draft);
  }, [draft, onCommit]);
  return { editing, draft, setDraft, begin, cancel, commit };
}
