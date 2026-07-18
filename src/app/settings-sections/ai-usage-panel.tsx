"use client";
// src/app/settings-sections/ai-usage-panel.tsx
// Usage bars sub-component for AiSection. Reads from the shared AiUsageProvider.

import { useAiUsageContext } from "../ai-usage-context";
import { ProgressTrack } from "../progress-track";
import { type Lang, t, localeFor } from "../i18n";
import {
  DEFAULT_SESSION_TOKEN_CAP,
  DEFAULT_WEEKLY_TOKEN_CAP,
} from "../settings-types";

const BAR_BASE = "h-3 rounded-full transition-all";
// AIPM palette only: green below 80 %, pink (warning/error) at 80 %+.
function barColor(ratio: number): string {
  if (ratio >= 0.8) return "bg-ui-pink";
  return "bg-ui-green";
}

type UsageBarProps = {
  label: string;
  used: number;
  cap: number;
};

function UsageBar({ label, used, cap }: UsageBarProps) {
  const safeCap = cap > 0 ? cap : 1;
  const ratio = Math.min(used / safeCap, 1);
  const pct = Math.round(ratio * 100);

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {used.toLocaleString()} / {cap.toLocaleString()} ({pct}%)
        </span>
      </div>
      <ProgressTrack height="h-3">
        <div
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-label={label}
          className={`${BAR_BASE} ${barColor(ratio)}`}
          style={{ width: `${pct}%` }}
        />
      </ProgressTrack>
    </div>
  );
}

type AiUsagePanelProps = {
  lang: Lang;
  sessionCap: number;
  weeklyCap: number;
};

export function AiUsagePanel({ lang, sessionCap, weeklyCap }: AiUsagePanelProps) {
  const { sessionTotal, weekTotal, nextReset } = useAiUsageContext();

  const effectiveSessionCap = sessionCap > 0 ? sessionCap : DEFAULT_SESSION_TOKEN_CAP;
  const effectiveWeeklyCap = weeklyCap > 0 ? weeklyCap : DEFAULT_WEEKLY_TOKEN_CAP;

  const resetLabel = nextReset.toLocaleString(localeFor(lang), {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="mt-3 space-y-1">
      <UsageBar
        label={t(lang, "aiUsageSession")}
        used={sessionTotal}
        cap={effectiveSessionCap}
      />
      <UsageBar
        label={t(lang, "aiUsageWeek")}
        used={weekTotal}
        cap={effectiveWeeklyCap}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {t(lang, "aiUsageResetAt", resetLabel)}
      </p>
    </div>
  );
}
