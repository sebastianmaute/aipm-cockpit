// The JS half of the reduced-motion policy (open-followups §332). The CSS half is
// the `@media (prefers-reduced-motion: reduce)` block in globals.css, which cannot
// reach motion started from script — a `scrollIntoView`/`scrollTo` with
// `behavior: "smooth"` animates regardless of that block.
//
// Every smooth scroll in the app asks here instead of writing the literal, and
// `reduced-motion.guard.test.ts` fails on a bare `behavior: "smooth"` anywhere
// else. Read at CALL time, not module load, so a preference changed while the
// app is open takes effect on the next scroll.

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the user asked the OS/browser for reduced motion. False wherever
 *  the question cannot be asked (SSR, or an environment without matchMedia). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** The `behavior` for a programmatic scroll: an instant jump under reduced
 *  motion, the smooth animation otherwise. */
export function smoothScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
