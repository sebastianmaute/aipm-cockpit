"use client";

import { useEffect } from "react";

/** Invoke `onEscape` when the Escape key is pressed (window-level keydown).
 *  Extracted from the edit modals, which each had a byte-identical effect.
 *  `onEscape` should be stable (a useCallback or a setter wrapper) so the
 *  listener is not re-subscribed on every render. */
export function useEscapeKey(onEscape: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}
