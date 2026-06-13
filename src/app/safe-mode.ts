//
// Single source of truth for the emergency safe-mode flag. When the page is
// loaded with ?safe=1 (or ?safe / #safe), the three config readers
// (useSettings load, loadPortfolioMode, loadCurrentTursoProjectId) return
// DEFAULTS in memory and write nothing — booting the app onto the browser/file
// backend at the empty state without touching stored config.

let cached: boolean | null = null;

/** True when the page was loaded with the safe-mode escape flag.
 *  Memoized: the URL does not change without a navigation/reload, and every
 *  honoring reader must agree within a session. */
export function isSafeMode(): boolean {
  if (cached !== null) return cached;
  try {
    if (typeof window === "undefined") return (cached = false);
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, "");
    cached = params.has("safe") || hash === "safe";
  } catch {
    cached = false;
  }
  return cached;
}

/** Test-only: clear the memoized value between cases. */
export function __resetSafeModeCache(): void {
  cached = null;
}
