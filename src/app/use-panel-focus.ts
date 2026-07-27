"use client";

import { useEffect, type RefObject } from "react";

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
 * ★ Focus lands on the panel ROOT, which must carry `tabIndex={-1}` plus
 * `focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green` — the
 * app's established idiom (7 other call sites). NOT a bare `focus:outline-none`:
 * Tailwind's `focus:` matches ANY focus, so suppressing there also hides the
 * ring when the panel was opened from the KEYBOARD, leaving a sighted
 * keyboard-only user no signal that focus moved — and therefore no way to know
 * whether their next Escape hits this panel or the editor behind it, which is
 * the exact ambiguity this hook exists to resolve. `:focus-visible` keeps the
 * ring for keyboard opens and drops it for mouse opens, which is all the
 * "undesigned ring on a 480x560 box" complaint was ever really about.
 * ★★ `modal.tsx:141-144` reaches the OPPOSITE conclusion for the same DOM shape
 * and is worth reading before changing this: it prefers the first focusable
 * CHILD and keeps its root's default ring as a deliberate WCAG 2.4.7
 * compensating control, treating root-focus as a rare fallback. This hook makes
 * root-focus the every-time target on purpose — the notes window's first
 * focusable is its reset-size button, and arming a control the user did not ask
 * for is worse than a neutral landing — so the ring modal.tsx relies on has to
 * be reinstated here explicitly rather than assumed unnecessary.
 */
export function usePanelInitialFocus(
  ref: RefObject<HTMLElement | null>,
  /** ★★ "The panel is RENDERED", not "the panel was requested". A surface with
   *  a secondary mount gate must pass that gate too — `help-menu` renders on
   *  `{open && pos && …}` where `pos` arrives a tick later, so it passes
   *  `open && pos !== null`. Pass raw `open` there and the node does not exist
   *  when the deferred frame fires, so focus never moves, the panel keeps
   *  declining its own Escape, and the bug this hook exists to fix comes back
   *  silently. */
  rendered: boolean,
): void {
  useEffect(() => {
    if (!rendered) return;
    const previouslyFocused =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    // Captured at setup for use in cleanup, where `ref.current` is already
    // nulled (React detaches host refs in the mutation phase, before passive
    // cleanups) — and where reading a ref would trip
    // `react-hooks/exhaustive-deps`, fatal under `--max-warnings=0`.
    // ★★ Safe ONLY because `rendered` means the node committed in this render.
    // Pass a flag that is true before the panel mounts and this reads `null`,
    // which then persists for the whole open session (the deps do not change
    // while it stays open), so `stillInside` below can never be true. See the
    // note on the parameter.
    const root = ref.current;

    // Defer a frame so children have committed before we look for a target,
    // mirroring `modal.tsx`.
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
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
  }, [rendered, ref]);
}
