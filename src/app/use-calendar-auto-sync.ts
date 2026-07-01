"use client";
import { useEffect, useRef } from "react";

/**
 * Background auto-sync runner: debounces a `push` and fires it once whenever the
 * pushable content changes (`contentKey`). Advances the last-seen key BEFORE
 * awaiting the push so a failed reconcile is not retried until the content next
 * changes (fail-once-per-change). Inert while `active` is false (popout /
 * M365-unconfigured / auto-off). The `.catch` label is fixed — never a token/body.
 */
export function useCalendarAutoSync({
  active,
  contentKey,
  push,
}: {
  active: boolean; // enabled && auto && m365Configured && !isPopout
  contentKey: string; // hash of the pushable list (fires on meaningful change)
  push: () => Promise<void>;
}): void {
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    if (contentKey === lastKey.current) return;
    const handle = setTimeout(() => {
      lastKey.current = contentKey; // advance BEFORE awaiting → fail-once-per-change
      void push().catch((err) => console.warn("calendar auto-sync failed", err));
    }, 4000);
    return () => clearTimeout(handle);
  }, [active, contentKey, push]);
}
