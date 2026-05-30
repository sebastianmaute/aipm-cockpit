"use client";
import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "./use-media-query";

const SIDEBAR_COLLAPSED_KEY = "lop-app:sidebar-collapsed";
/** Below this width the sidebar defaults to its collapsed icon rail (Tailwind < lg). */
export const SIDEBAR_NARROW_QUERY = "(max-width: 1023px)";

/**
 * Owns the modern sidebar's collapsed state. The default follows the viewport
 * (collapsed on narrow screens); an explicit user toggle is persisted to
 * localStorage and overrides the responsive default.
 */
export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  const isNarrow = useMediaQuery(SIDEBAR_NARROW_QUERY);
  const [pref, setPref] = useState<boolean | null>(null);

  // Hydrate the persisted preference once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (raw === "1") setPref(true);
      else if (raw === "0") setPref(false);
    } catch {
      /* non-fatal */
    }
  }, []);

  const collapsed = pref ?? isNarrow;

  const toggle = useCallback(() => {
    setPref((prev) => {
      const next = !(prev ?? isNarrow);
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, [isNarrow]);

  return { collapsed, toggle };
}
