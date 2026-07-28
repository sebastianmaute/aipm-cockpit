// Draft-then-commit state for a text/number input that writes into workspace
// state. Without it, an `onChange`-committing cell writes once per KEYSTROKE —
// which, once a write is captured for undo and logged to the activity feed,
// would mean one undo entry and one activity row per typed character.
"use client";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export interface CommitDraft {
  /** The live draft while editing, else the committed value — so an undo/redo
   *  that changes the underlying value is reflected immediately. */
  value: string;
  onChange: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function useCommitDraft(committed: string, commit: (raw: string) => void): CommitDraft {
  const [draft, setDraft] = useState<string | null>(null);
  // Guards a blur that follows an Enter (or an Escape) from committing twice.
  const doneRef = useRef(false);

  const doCommit = (raw: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDraft(null);
    if (raw !== null && raw !== committed) commit(raw);
  };

  return {
    value: draft ?? committed,
    onChange: (next) => {
      doneRef.current = false;
      setDraft(next);
    },
    onFocus: () => {
      doneRef.current = false;
    },
    onBlur: () => doCommit(draft),
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doCommit(draft);
      } else if (e.key === "Escape") {
        doneRef.current = true; // the blur that follows must not commit
        setDraft(null);
        e.currentTarget.blur();
      }
    },
  };
}
