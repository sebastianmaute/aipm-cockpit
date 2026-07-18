"use client";

import { type Lang, t } from "./i18n";
import { effortProgress, formatDuration } from "./duration";
import { ProgressTrack } from "./progress-track";

interface EffortProgressBarProps {
  lang: Lang;
  estimateMin?: number;
  spentMin?: number;
}

/** Display-only bar: time spent consumption of the original estimate. */
export function EffortProgressBar({ lang, estimateMin, spentMin }: EffortProgressBarProps) {
  const { hasEstimate, pct, over } = effortProgress(estimateMin, spentMin);
  const fillPct = Math.min(pct, 1) * 100;
  const labelPct = Math.round(pct * 100);
  return (
    <div className="sm:col-span-2">
      <ProgressTrack
        height="h-2.5"
        role="progressbar"
        aria-label={t(lang, "taskEffortProgressLabel")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hasEstimate ? Math.min(labelPct, 100) : 0}
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
