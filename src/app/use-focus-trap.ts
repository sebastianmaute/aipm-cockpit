"use client";
import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus within `ref` while `active`. On activation it focuses the
 * first focusable element; Tab/Shift+Tab wrap within the container; Escape calls
 * `onEscape`; on deactivation focus is restored to whatever had it before.
 *
 * Used by the mobile sidebar drawer (#25) — the app's first real off-canvas
 * surface with a focus trap. `onEscape` must be stable (wrap in useCallback) or
 * the effect re-runs and re-focuses the first element each render.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape?.();
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

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      prevFocus?.focus?.();
    };
  }, [active, ref, onEscape]);
}
