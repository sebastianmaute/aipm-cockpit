"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useMediaQuery } from "./use-media-query";

const SIDEBAR_COLLAPSED_KEY = "aipm-cockpit:sidebar-collapsed";
/** Below this width the sidebar defaults to its collapsed icon rail (Tailwind < lg). */
export const SIDEBAR_NARROW_QUERY = "(max-width: 1023px)";

// Module-level pub/sub so toggle() can notify useSyncExternalStore subscribers
// in this tab; the `storage` event covers cross-tab changes.
const listeners = new Set<() => void>();
function emitChange(): void {
  for (const listener of listeners) listener();
}

/** Read the persisted preference: true (collapsed), false (expanded), or null (unset). */
function readPref(): boolean | null {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* non-fatal */
  }
  return null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIDEBAR_COLLAPSED_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Owns the modern sidebar's collapsed state. The default follows the viewport
 * (collapsed on narrow screens); an explicit user toggle is persisted to
 * localStorage and overrides the responsive default.
 *
 * Reads the persisted preference via useSyncExternalStore: the server snapshot
 * is `null` so SSR and the first client render agree (no hydration mismatch),
 * then the real stored value flows in via subscription — without a
 * setState-in-effect.
 */
export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  const isNarrow = useMediaQuery(SIDEBAR_NARROW_QUERY);
  const pref = useSyncExternalStore(subscribe, readPref, () => null);

  const collapsed = pref ?? isNarrow;

  const toggle = useCallback(() => {
    const next = !(pref ?? isNarrow);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* non-fatal */
    }
    emitChange();
  }, [pref, isNarrow]);

  return { collapsed, toggle };
}
