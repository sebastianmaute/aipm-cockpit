"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
}: DismissableOptions): symbol {
  // ★★ This DIVERGES from modal.tsx's token pattern, deliberately — do not
  // "align" them. `modal.tsx` holds its token in a `useRef` (minting a Symbol
  // every render and keeping only the first), which is fine there because it
  // never returns the token and only reads `.current` inside effects. This
  // hook RETURNS the token, and returning is a render-time read, which
  // `react-hooks/refs` rejects outright ("Cannot access refs during render")
  // — a fatal rule under `--max-warnings=0`. A lazy `useState` initializer
  // mints once and yields a normal render-time value with no such restriction.
  const [token] = useState<symbol>(() => Symbol("dismissable"));
  const onDismissRef = useRef(onDismiss);
  const claimsRef = useRef(claims);
  useEffect(() => {
    onDismissRef.current = onDismiss;
    claimsRef.current = claims;
  });

  // ★★ Deps are [open, kind, token] — `token` never changes after mount, so
  // adding it cannot cause the re-push-to-top bug the comment below warns
  // about; it satisfies exhaustive-deps for a value the effect closes over.
  // Adding onDismiss or claims here would re-run this on any parent
  // re-render, re-pushing the token to the TOP of the stack and making the
  // wrong layer topmost — the bug modal.tsx hit twice.
  useEffect(() => {
    if (!open) return;
    pushDismissal(token, kind, () => claimsRef.current?.() ?? true);
    return () => popDismissal(token);
  }, [open, kind, token]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!claimsEscape(e, token)) return;
      // Still mark it: element-scoped handlers and anything outside the stack
      // read `defaultPrevented` as the boundary signal.
      e.preventDefault();
      onDismissRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, kind, token]);

  // ★ Returned so a caller that runs its OWN Tab trap can ask
  // `isTopmostOfKind(token, "modal")` and stand down when something is layered
  // above it. ★★ NO consumer reads it yet — every call site invokes this hook
  // as a bare statement — so do not read an unused return as dead API and
  // delete it. `popover-panel.tsx`'s Tab cycle is the intended first reader.
  // Enumerate today's call sites rather than trusting a count here:
  //   git grep -n 'useDismissable(' -- src | grep -v test
  return token;
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
