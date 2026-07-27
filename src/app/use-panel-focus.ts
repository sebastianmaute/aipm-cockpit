"use client";

import { useEffect, type RefObject } from "react";

/** Opt-in initial-focus target inside a panel. Absent on every panel today, so
 *  focus lands on the panel root — see `usePanelInitialFocus` for why that is
 *  the right default HERE and not in `modal.tsx`. */
const PREFERRED_SELECTOR = "[data-panel-initial-focus]";

/**
 * Move focus INTO a non-modal floating panel when it opens, and hand focus back
 * when it closes.
 *
 * ★★ WHY THIS EXISTS. `notes-window` and `help-menu` open from a `<button>`,
 * and clicking a button focuses it. That button lives OUTSIDE the panel — for
 * the notes window it is the "Notes (N)" control inside the task editor
 * `Modal`. So immediately after opening, `document.activeElement` was still the
 * trigger, `useClaimsWhenFocusWithin` read false, the panel DECLINED Escape,
 * and the dismissal stack handed the key to the editor beneath: the editor
 * closed and the draft went with it, while the panel the user had just opened
 * stayed. Open a thing, press Escape, lose your work — the exact defect class
 * the dismissal stack exists to end, reached through the trigger rather than
 * through listener phase.
 *
 * Moving focus in also closes a real screen-reader gap: both panels are
 * `role="dialog"` surfaces that previously appeared with NO focus movement at
 * all, so assistive tech was never told anything had opened.
 *
 * ★ Focus lands on the panel ROOT (which must carry `tabIndex={-1}`) unless the
 * panel marks a better target with `data-panel-initial-focus`. This deliberately
 * differs from `modal.tsx`, which prefers the first focusable CHILD: the notes
 * window's first focusable is its reset-size button, and arming a control the
 * user did not ask for is worse than a neutral landing on a surface they just
 * opened. A modal's first child is its content; a floating panel's is chrome.
 */
export function usePanelInitialFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    // Captured at setup, while the node is certainly mounted — by cleanup time
    // the panel may already be detached and `ref.current` nulled.
    const root = ref.current;

    // Defer a frame so children have committed before we look for a target,
    // mirroring `modal.tsx`.
    const raf = requestAnimationFrame(() => {
      const node = ref.current;
      const preferred = node?.querySelector<HTMLElement>(PREFERRED_SELECTOR) ?? null;
      (preferred ?? node)?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      if (typeof document === "undefined") return;
      const focused = document.activeElement;
      // ★★ Restore ONLY if this panel still owns focus, or if focus was LOST.
      // These panels are NON-MODAL and stay open while the user works
      // elsewhere, so an unconditional restore would yank focus out of whatever
      // they had moved to. "Lost" (body/null) counts as ours because removing a
      // focused node drops focus to `body`, which is what happens when the
      // panel closes while focused — and handing focus back to the trigger
      // beats stranding it on the body. Same "nowhere counts as ours" rule as
      // `useClaimsWhenFocusWithin`, for the same reason.
      const focusLost = focused === null || focused === document.body;
      const stillInside = root !== null && focused !== null && root.contains(focused);
      if (!focusLost && !stillInside) return;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, ref]);
}
