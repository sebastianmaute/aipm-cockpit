"use client";
import { useEffect, useRef, type RefObject } from "react";
import {
  claimsEscape,
  isTopmostOfKind,
  popDismissal,
  pushDismissal,
} from "./dismissal-stack";
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
  // ★★ Always register while active, and DECLINE Escape rather than staying
  // out of the stack. An always-claiming entry that does nothing would swallow
  // the key and block every layer beneath — `inline-ai-edit-popover` passes no
  // handler, so that shape is live, not hypothetical — but the `claims`
  // predicate closes that without hiding the entry: `escapeOwner()` walks past
  // a declining entry to the one underneath. Being absent instead made the
  // trap invisible to `isTopmostOfKind`, so nothing could ask it to stand down
  // and the Tab branch below could not consult the stack at all (§318).
  // ★ Gate on a BOOLEAN, not on `onEscape` itself: an unstable handler
  // identity in the deps would re-push the token to the top of the stack on
  // every parent render — the bug that bit `modal.tsx` twice.
  const hasEscape = onEscape !== undefined;
  useEffect(() => {
    if (!active) return;
    const token = tokenRef.current;
    pushDismissal(token, "modal", () => hasEscape);
    return () => popDismissal(token);
  }, [active, hasEscape]);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    // ★ An arrow, like `focusables`, because `onKeyDown` below is a hoisted
    // function DECLARATION and TypeScript does not carry the `container` null
    // narrowing into one. A null `activeElement` counts as outside, matching
    // `modal.tsx`'s `!container.contains(active)`.
    const contains = (node: Node | null) => node !== null && container.contains(node);

    (initialFocusRef?.current ?? focusables()[0])?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // ★★ Escape is arbitrated by the dismissal stack, not by listener
        // phase: act only when this trap is the layer that owns the key. The
        // handler check is now redundant with the entry's own `claims`
        // predicate and is kept as the local, readable statement of the same
        // rule.
        if (!onEscape) return;
        if (!claimsEscape(e, tokenRef.current)) return;
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      // ★★ Tab consults the stack too, exactly as `modal.tsx` and
      // `popover-panel.tsx` do. `kind` MEANS "traps Tab", so a `"modal"` above
      // this one runs a trap of its own and deferring to it strands nobody;
      // a `"layer"` traps nothing and never takes Tab away, so containment is
      // still never waivable by a surface that cannot honour it (WCAG 2.4.3).
      if (!isTopmostOfKind(tokenRef.current, "modal")) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      // ★★★ Focus OUTSIDE the container matches NEITHER edge, so without this
      // term the trap silently declines to act and Tab walks out of the
      // surface. Two live states reach it: focus escaped to a portal, and
      // focus sitting on a container node that `FOCUSABLE_SELECTOR` excludes
      // (a `tabIndex={-1}` card focused for AT) — which is the state a surface
      // is in on the FIRST keypress, the only one that matters. `modal.tsx`
      // carries the same term; this hook was the outlier.
      const outside = !contains(activeEl);
      if (e.shiftKey && (activeEl === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || outside)) {
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
