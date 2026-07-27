"use client";

import { useEffect, type RefObject } from "react";
import { useDismissable } from "./use-dismissable";

/** Dismiss an open popover/menu on outside-click (mousedown) or Escape. The
 *  `wrapperRef` must wrap BOTH the trigger and the floating panel so a click on
 *  the trigger (which toggles `open`) is treated as inside and does not race the
 *  close. No-op while `open` is false.
 *
 *  Escape is delegated to the dismissal stack: this popover registers as a
 *  `layer` while open, and the stack hands the key to whichever layer is
 *  topmost. That replaced a capture-phase listener, which had been needed only
 *  because `Modal` (opening first) won the bubble phase — and which broke the
 *  combobox pickers, whose React `onKeyDown` handlers React delegates at
 *  bubble, so a capture listener took both layers down at once.
 *
 *  `onClose` no longer needs to be stable for correctness — it is read through
 *  a ref — though a stable identity still avoids re-subscribing the mousedown
 *  listener below. */
export function usePopoverDismiss(
  open: boolean,
  wrapperRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useDismissable({ open, kind: "layer", onDismiss: onClose });

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, wrapperRef, onClose]);
}
