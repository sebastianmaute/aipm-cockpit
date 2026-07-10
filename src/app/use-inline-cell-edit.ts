"use client";
import { useCallback, useState } from "react";

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
 * closure, and the functional `setEditing` guards against a double-commit (e.g.
 * blur firing after Enter): once `editing` is null, a second `commit` no-ops.
 */
export function useInlineCellEdit(
  onCommit: (field: InlineField, value: string) => void,
): InlineCellEdit {
  const [editing, setEditing] = useState<InlineField | null>(null);
  const [draft, setDraft] = useState("");
  const begin = useCallback((field: InlineField, current: string) => {
    setEditing(field);
    setDraft(current);
  }, []);
  const cancel = useCallback(() => setEditing(null), []);
  const commit = useCallback(() => {
    setEditing((f) => {
      if (f !== null) onCommit(f, draft);
      return null;
    });
  }, [draft, onCommit]);
  return { editing, draft, setDraft, begin, cancel, commit };
}
