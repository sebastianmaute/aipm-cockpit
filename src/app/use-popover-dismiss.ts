"use client";

import { useEffect, type RefObject } from "react";

/** Dismiss an open popover/menu on outside-click (mousedown) or Escape. The
 *  `wrapperRef` must wrap BOTH the trigger and the floating panel so a click on
 *  the trigger (which toggles `open`) is treated as inside and does not race the
 *  close. No-op while `open` is false. Mirrors the ExportMenu/AskClaudeMenu
 *  pattern; `onClose` should be stable (e.g. a useCallback or a useState setter
 *  wrapper) so the listeners are not re-subscribed on every render. */
export function usePopoverDismiss(
  open: boolean,
  wrapperRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // ★★ Both halves of the app's Escape protocol, and both matter here.
      //
      // CONSUMER (`defaultPrevented`): something nearer the user may already
      // have claimed this Escape — a combobox dismissing its own dropdown, say.
      // Closing on top of that dismisses two layers with one keypress.
      //
      // PRODUCER (`preventDefault`): the shared `Modal` closes on a
      // document-level Escape unless a descendant marked it handled. Popovers
      // render INSIDE edit modals — `ModalFieldControls` puts one behind the ⚙
      // button of every one — so without this, Escape closed the popover AND
      // the modal, discarding the user's draft.
      //
      // ★ stopPropagation is NOT the tool: React 19 delegates on `document`
      // (Next hydrates the root there), the same node `Modal` listens on, and
      // stopPropagation cannot suppress a listener co-registered on it.
      if (e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    // ★★★ CAPTURE phase, and it is load-bearing. `Modal` also listens on
    // `document`, and listeners on one node fire in REGISTRATION order — the
    // modal opens first, so in the bubble phase its handler runs BEFORE this
    // one and has already closed by the time we mark the event. Capture runs on
    // the way DOWN, so this sees a real keystroke (which targets the focused
    // element, not `document`) first and can claim it. Same reason
    // `use-focus-trap` captures.
    // ★ A test that dispatches on `document` cannot detect this: that is an
    // AT-TARGET dispatch where capture and bubble both fire in registration
    // order. See popover-in-modal.test.tsx for the shape that can.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, wrapperRef, onClose]);
}
