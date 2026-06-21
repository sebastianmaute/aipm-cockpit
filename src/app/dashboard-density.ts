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
}

const COMFORTABLE: DensityClasses = { outer: "space-y-4", kpiGap: "gap-2", cardPad: "p-3" };
const COMPACT: DensityClasses = { outer: "space-y-2", kpiGap: "gap-1", cardPad: "p-2" };

/** Spacing classes for the given density. Defaults to comfortable. */
export function densityClasses(density: DashboardDensity): DensityClasses {
  return density === "compact" ? COMPACT : COMFORTABLE;
}
