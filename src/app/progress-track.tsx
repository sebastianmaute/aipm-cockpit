"use client";

// Shared <ProgressTrack> shell (design-system Phase 3f). The full-width rounded
// muted rail that clips a progress/usage fill was repeated verbatim across the
// KPI gauge, effort bar, AI-usage bar and the stacked report bar. Only the TRACK
// is shared here — the fill(s) stay the caller's, because they genuinely diverge:
//   • KpiGradientBar — a single `--gradient-kpi` token fill ("more = better")
//   • EffortProgressBar — a solid fill that flips pink when over budget
//   • UsageBar — a thresholded green→amber→pink fill with its own aria-value*
//   • StackedBar — N coloured segments (the track is `flex`)
// Height differs per use (h-1.5 / h-2.5 / h-3) so it is a prop. Emits the exact
// prior DOM: `<div class="{height} w-full overflow-hidden rounded-full
// bg-surface-muted {className}">{children}</div>`.

import type { HTMLAttributes, ReactNode } from "react";

export interface ProgressTrackProps extends HTMLAttributes<HTMLDivElement> {
  /** Track height utility (default `h-2.5`). */
  height?: string;
  children: ReactNode;
}

/** The muted, rounded, overflow-clipping progress-bar rail. The caller supplies
 *  the fill element(s) as children and any live-region role/aria on the track
 *  (or on the fill, per the pattern that component already used). */
export function ProgressTrack({ height = "h-2.5", className, children, ...props }: ProgressTrackProps) {
  return (
    <div
      className={`${height} w-full overflow-hidden rounded-full bg-surface-muted${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
