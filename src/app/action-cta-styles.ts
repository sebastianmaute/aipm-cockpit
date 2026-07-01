// src/app/action-cta-styles.ts
//
// Shared CTA trigger classes for the next-actions surface. PURE strings (no imports)
// so both action-cta-controls.tsx AND the popover components can consume them without
// an import cycle (action-cta-controls imports the popovers).

/** Compact ghost trigger — the default popover/row CTA look (byte-identical to the
 *  pre-existing inline popover trigger class, so non-prominent rows are unchanged). */
export const POPOVER_GHOST =
  "cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 dark:text-AIPM-light-grey";

/** Prominent filled trigger — the hero's marquee CTA (larger + solid dark-blue). */
export const POPOVER_PROMINENT =
  "cursor-pointer rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-4 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90";

/** Popover trigger class: prominent (hero marquee) vs compact (row). */
export function popoverTriggerClass(prominent?: boolean): string {
  return prominent ? POPOVER_PROMINENT : POPOVER_GHOST;
}
