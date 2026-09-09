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
  locale: string;
};

function UsageBar({ label, used, cap, locale }: UsageBarProps) {
  const safeCap = cap > 0 ? cap : 1;
  const ratio = Math.min(used / safeCap, 1);
  const pct = Math.round(ratio * 100);

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {used.toLocaleString(locale)} / {cap.toLocaleString(locale)} ({pct}%)
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
  const { sessionTotal, weekTotal, nextReset, sessionUsage } = useAiUsageContext();

  const effectiveSessionCap = sessionCap > 0 ? sessionCap : DEFAULT_SESSION_TOKEN_CAP;
  const effectiveWeeklyCap = weeklyCap > 0 ? weeklyCap : DEFAULT_WEEKLY_TOKEN_CAP;

  const locale = localeFor(lang);
  const resetLabel = nextReset.toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // ★ Denominator is every INPUT-side class, not the grand total: output tokens
  //   are never cacheable, so including them would report a hit rate that can
  //   never reach 100% even on a perfectly cached conversation.
  const inputSide = sessionUsage.input + sessionUsage.cacheRead + sessionUsage.cacheWrite;
  const hitRatePct = inputSide === 0 ? 0 : Math.round((sessionUsage.cacheRead / inputSide) * 100);

  return (
    <div className="mt-3 space-y-1">
      <UsageBar
        label={t(lang, "aiUsageSession")}
        used={sessionTotal}
        cap={effectiveSessionCap}
        locale={locale}
      />
      <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>{t(lang, "aiUsageUncachedInput")}</dt>
          <dd className="tabular-nums">{sessionUsage.input.toLocaleString(locale)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t(lang, "aiUsageCacheRead")}</dt>
          <dd className="tabular-nums">{sessionUsage.cacheRead.toLocaleString(locale)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t(lang, "aiUsageCacheWrite")}</dt>
          <dd className="tabular-nums">{sessionUsage.cacheWrite.toLocaleString(locale)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t(lang, "aiUsageOutput")}</dt>
          <dd className="tabular-nums">{sessionUsage.output.toLocaleString(locale)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-muted-foreground">{t(lang, "aiUsageBasisHint")}</p>
      {inputSide > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "aiUsageCacheHitRate", String(hitRatePct))}
        </p>
      )}
      <UsageBar
        label={t(lang, "aiUsageWeek")}
        used={weekTotal}
        cap={effectiveWeeklyCap}
        locale={locale}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {t(lang, "aiUsageResetAt", resetLabel)}
      </p>
    </div>
  );
}
