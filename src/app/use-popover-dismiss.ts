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
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, wrapperRef, onClose]);
}
