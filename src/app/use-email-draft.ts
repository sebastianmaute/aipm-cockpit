// src/app/use-email-draft.ts
//
// Shared local-draft state for a write-safe-only email field. Extracted in
// fix round 1 after the draft/reconcile block (Task 4's `emailDraft` /
// `seenEmail` / render-time reconcile / `emailRefusal`) shipped byte-identical
// in jira-settings.tsx and timelog-settings.tsx — the same drift class
// editor-email-rule.ts was extracted to close for the editor modals.
"use client";
import { useId, useState } from "react";
import { emailWriteRefusal, type EmailRefusal } from "./sanitize";

export interface UseEmailDraft {
  /** What the input should render — typing is never blocked. */
  readonly value: string;
  /** Call on every keystroke. Does NOT persist anything itself: the two
   *  current call sites disagree on trim (Jira trims on write, Timelog does
   *  not), so the caller judges `emailWriteRefusal(next, stored)` itself and
   *  decides what to persist and how. */
  readonly setValue: (next: string) => void;
  /** Non-null while `value`, trimmed, would refuse a write against `stored`
   *  (`emailWriteRefusal` — spec Part 1, decision 1): null for a blank draft,
   *  one unchanged vs. `stored`, or a write-safe one. */
  readonly refusal: EmailRefusal | null;
  /** `useId()`-derived id for the paired `FieldError`, for the input's
   *  `aria-describedby`. */
  readonly errorId: string;
}

/** ★★★ RENDER-TIME RECONCILE, never a `useEffect` —
 *  `react-hooks/set-state-in-effect` is fatal here. A draft lives only while
 *  `stored` still matches what was last observed (`seen`): a re-render at the
 *  SAME `stored` (including one caused by an unrelated sibling field change)
 *  leaves an in-progress, possibly-invalid draft alone, and only a genuine
 *  external change to `stored` (another tab, an AI write, a project switch)
 *  overwrites it. Comparing against `seen` — a mirror of `stored` — rather
 *  than against the parsed draft is what tells the two apart. */
export function useEmailDraft(stored: string): UseEmailDraft {
  const errorId = useId();
  const [value, setValue] = useState(stored);
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    setValue(stored);
  }
  return { value, setValue, refusal: emailWriteRefusal(value, stored), errorId };
}
