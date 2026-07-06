"use client";
import { useEffect, useRef } from "react";

/** Base debounce before an auto-sync push fires after content settles. */
export const AUTO_SYNC_DEBOUNCE_MS = 4000;

/**
 * Background auto-sync runner: debounces a `push` and fires it once whenever the
 * pushable content changes (`contentKey`). Advances the last-seen key BEFORE
 * awaiting the push so a failed reconcile is not retried until the content next
 * changes (fail-once-per-change). Inert while `active` is false (popout /
 * M365-unconfigured / auto-off). `push` (the interactive:false reconcile) never
 * rejects and logs its own failures (logDiag) internally, so no .catch here.
 *
 * `staggerMs` adds a fixed per-entity offset to the debounce so the four entity
 * instances (task/raid/change/absence), which all become active together on
 * load with the same base delay, don't fire their pushes in one simultaneous
 * burst (thundering herd of Graph calls).
 */
export function useCalendarAutoSync({
  active,
  contentKey,
  push,
  staggerMs = 0,
}: {
  active: boolean; // enabled && auto && m365Configured && !isPopout
  contentKey: string; // hash of the pushable list (fires on meaningful change)
  push: () => Promise<void>;
  staggerMs?: number; // per-entity offset to spread simultaneous pushes
}): void {
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    if (contentKey === lastKey.current) return;
    const handle = setTimeout(() => {
      lastKey.current = contentKey; // advance BEFORE awaiting → fail-once-per-change
      void push(); // never rejects; logs its own failures internally (see below)
    }, AUTO_SYNC_DEBOUNCE_MS + staggerMs);
    return () => clearTimeout(handle);
  }, [active, contentKey, push, staggerMs]);
}
