"use client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query.
 *
 * Uses `useSyncExternalStore` so the live match is read during render rather
 * than corrected in an effect after the first paint. This removes the
 * one-frame "flash" where a responsive default (e.g. the collapsed sidebar)
 * briefly renders in its wrong state on narrow viewports, and avoids any
 * hydration-mismatch warning: the server snapshot is a stable `false`, and the
 * client reconciles to the real value as part of hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  // Server render (and hydration baseline) always reports no match.
  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
