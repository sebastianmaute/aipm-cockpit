"use client";
import { useEffect, useRef, type RefObject } from "react";
import { claimsEscape, popDismissal, pushDismissal } from "./dismissal-stack";
import { FOCUSABLE_SELECTOR } from "./focusables";

/**
 * Trap keyboard focus within `ref` while `active`. On activation it focuses
 * `initialFocusRef` if supplied (e.g. a text input that should receive the
 * caret), else the first focusable element; Tab/Shift+Tab wrap within the
 * container; Escape calls `onEscape`; on deactivation focus is restored to
 * whatever had it before.
 *
 * Used by the mobile sidebar drawer (#25) — the app's first real off-canvas
 * surface with a focus trap. `onEscape` must be stable (wrap in useCallback) or
 * the effect re-runs and re-focuses the first element each render.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const tokenRef = useRef<symbol>(Symbol("focus-trap"));
  // ★★ Register ONLY when there is an `onEscape` to hand the key to. An
  // always-claiming entry that does nothing swallows Escape and blocks every
  // layer beneath — `inline-ai-edit-popover` passes no handler, so that shape
  // is one composition away. Gate on a BOOLEAN, not on `onEscape` itself: an
  // unstable handler identity in the deps would re-push the token to the top
  // of the stack on every parent render.
  const hasEscape = onEscape !== undefined;
  useEffect(() => {
    if (!active || !hasEscape) return;
    const token = tokenRef.current;
    pushDismissal(token, "modal");
    return () => popDismissal(token);
  }, [active, hasEscape]);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    (initialFocusRef?.current ?? focusables()[0])?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // ★★ Escape is arbitrated by the dismissal stack, not by listener
        // phase: act only when this trap is the layer that owns the key. The
        // handler check comes first because a trap with no `onEscape` never
        // joined the stack at all — see the gate above.
        // ★★ Tab is UNCHANGED: containment is WCAG 2.4.3 and must never be
        // waivable by another layer, so it never consults the stack.
        if (!onEscape) return;
        if (!claimsEscape(e, tokenRef.current)) return;
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prevFocus?.focus?.();
    };
  }, [active, ref, onEscape, initialFocusRef]);
}
