/**
 * Dashboard density — pure, i18n-free spacing classes for the Dashboard cockpit.
 *
 * Per-device Comfortable/Compact preference (slice #8). Spacing only — no font
 * size, palette, or contrast change. "comfortable" reproduces the current
 * literal classes exactly (a no-op for existing users).
 */

export type DashboardDensity = "comfortable" | "compact";

export interface DensityClasses {
  /** Vertical rhythm of the panel container. */
  outer: string;
  /** Gap of the KPI tile grid. */
  kpiGap: string;
  /** Padding of cockpit cards (e.g. the completion-trend sparkline card). */
  cardPad: string;
  /** Padding of the KPI strip (§585). Same horizontal padding as `cardPad` —
   *  the strip's container queries read that width — but compact drops the
   *  vertical padding, or a wrapped strip at the 72px row unit overflows its
   *  h:3 tile body by 3px (measured in `e2e/dashboard-grid.spec.ts`). The tile
   *  body's own `p-2` still frames it. */
  kpiPad: string;
  /** Gap of the arrangeable tile grid. */
  sectionGap: string;
  /** Height of one grid row unit in the arrangeable tile grid. */
  tileRow: string;
  /** Row 1's delta strip at `lg`, while the digest beside it is showing: as
   *  wide as row 2's hero column — half the row minus half of `sectionGap` —
   *  and spaced so the digest starts where Overall status starts. The row's own
   *  `gap-2` (0.5rem) plus this margin equals `sectionGap`; keep them in step. */
  topRowSplit: string;
}

// ★ Tailwind needs every class as a literal string, so the `:has(+ …)` variant
// is spelled out per class rather than composed.
const COMFORTABLE: DensityClasses = {
  outer: "space-y-4", kpiGap: "gap-2", cardPad: "p-3", kpiPad: "p-3", sectionGap: "gap-4", tileRow: "auto-rows-[80px]",
  topRowSplit: "lg:[&:has(+:not(:empty))]:flex-none lg:[&:has(+:not(:empty))]:w-[calc(50%_-_0.5rem)] lg:[&:has(+:not(:empty))]:mr-2",
};
const COMPACT: DensityClasses = {
  outer: "space-y-2", kpiGap: "gap-1", cardPad: "p-2", kpiPad: "px-2 py-0", sectionGap: "gap-2", tileRow: "auto-rows-[72px]",
  topRowSplit: "lg:[&:has(+:not(:empty))]:flex-none lg:[&:has(+:not(:empty))]:w-[calc(50%_-_0.25rem)]",
};

/** Spacing classes for the given density. Defaults to comfortable. */
export function densityClasses(density: DashboardDensity): DensityClasses {
  return density === "compact" ? COMPACT : COMFORTABLE;
}
