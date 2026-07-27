"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  claimsEscape,
  popDismissal,
  pushDismissal,
  type DismissalKind,
} from "./dismissal-stack";

export interface DismissableOptions {
  /** No entry is pushed and no listener attached while false. */
  open: boolean;
  kind: DismissalKind;
  /** Called when this layer wins the Escape. Identity may change freely — it
   *  is read through a ref, never through effect deps. */
  onDismiss: () => void;
  /** Return false to pass the Escape to the layer beneath. Read at EVENT time,
   *  so it must be a live DOM read — never a captured state value. */
  claims?: () => boolean;
}

/** Register an open layer with the dismissal stack and dismiss it when it wins
 *  an Escape. BUBBLE phase: the stack decides ownership, so registration order
 *  is irrelevant and the capture/IME hazard is gone. */
export function useDismissable({
  open,
  kind,
  onDismiss,
  claims,
}: DismissableOptions): void {
  // Matches modal.tsx's token pattern: a Symbol is minted each render but only
  // the first is kept. Assigning to a ref during render would trip the
  // react-hooks purity rule, which CI rejects.
  const tokenRef = useRef<symbol>(Symbol("dismissable"));
  const onDismissRef = useRef(onDismiss);
  const claimsRef = useRef(claims);
  useEffect(() => {
    onDismissRef.current = onDismiss;
    claimsRef.current = claims;
  });

  // ★★ Deps are [open, kind] ONLY. Adding onDismiss or claims here would
  // re-run this on any parent re-render, re-pushing the token to the TOP of
  // the stack and making the wrong layer topmost — the bug modal.tsx hit twice.
  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    pushDismissal(token, kind, () => claimsRef.current?.() ?? true);
    return () => popDismissal(token);
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    function onKeyDown(e: KeyboardEvent) {
      if (!claimsEscape(e, token)) return;
      // Still mark it: element-scoped handlers and anything outside the stack
      // read `defaultPrevented` as the boundary signal.
      e.preventDefault();
      onDismissRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, kind]);
}

/** Claim Escape only while focus is inside `ref` — or nowhere at all.
 *
 *  ★★ For a NON-MODAL floating panel that stays open while the user works
 *  elsewhere (`notes-window`, `help-menu`). Without this, opening notes, then
 *  opening the task editor, then pressing Escape while typing in the editor
 *  closes notes and leaves the editor up.
 *  ★ `activeElement === body` counts as "nowhere", so Escape immediately after
 *  opening the panel still closes it.
 *  ★★ A HOOK, not a plain factory, because `react-hooks/refs` rejects passing a
 *  ref object into an ordinary function call during render ("Cannot access refs
 *  during render") — the same rule that shaped `use-storage-backend.ts`. A
 *  `useMemo` wrapper does NOT satisfy it; only a `use*` hook may receive the
 *  ref. Call it unconditionally and pass the result, or `undefined`, to
 *  `useDismissable`. */
export function useClaimsWhenFocusWithin(
  ref: RefObject<HTMLElement | null>,
): () => boolean {
  return useCallback(() => {
    const focused = document.activeElement;
    if (focused === null || focused === document.body) return true;
    return ref.current?.contains(focused) ?? false;
  }, [ref]);
}
