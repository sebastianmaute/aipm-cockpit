"use client";

import { type Lang, t } from "./i18n";
import { effortProgress, formatDuration } from "./duration";
import { ProgressTrack } from "./progress-track";

interface EffortProgressBarProps {
  lang: Lang;
  estimateMin?: number;
  spentMin?: number;
}

/** Display-only bar: time spent consumption of the original estimate.
 *
 *  The track is DECORATIVE: it is rendered inside `TaskTimeTrackingButton`,
 *  and THAT button carries the accessible name and the figures. A progressbar
 *  nested inside a button announces twice. The caption below is plain text, so
 *  the figures stay readable either way.
 *  `settings-sections/ai-usage-panel.tsx` renders its OWN progressbar; this
 *  change does not touch it.
 *
 *  No `sm:col-span-2` here: inside the button this component no longer owns a
 *  grid cell, and a span class on a non-grid child is silently inert. */
export function EffortProgressBar({ lang, estimateMin, spentMin }: EffortProgressBarProps) {
  const { hasEstimate, pct, over } = effortProgress(estimateMin, spentMin);
  const fillPct = Math.min(pct, 1) * 100;
  const labelPct = Math.round(pct * 100);
  return (
    <div>
      <ProgressTrack
        height="h-2.5"
        aria-hidden="true"
        className={hasEstimate ? undefined : "opacity-60"}
      >
        {hasEstimate && (
          <div
            className={`h-full rounded-full transition-all ${over ? "bg-ui-pink" : "bg-ui-dark-blue"}`}
            style={{ width: `${fillPct}%` }}
          />
        )}
      </ProgressTrack>
      <p className={`mt-1 text-xs ${over ? "text-ui-pink-strong" : "text-muted-foreground"}`}>
        {hasEstimate
          ? `${formatDuration(spentMin ?? 0) || "0m"} / ${formatDuration(estimateMin ?? 0)} · ${labelPct}%`
          : t(lang, "taskEffortNoEstimate")}
      </p>
    </div>
  );
}
