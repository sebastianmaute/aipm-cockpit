"use client";
// src/app/settings-sections/ai-usage-panel.tsx
// Usage bars sub-component for AiSection. Reads from the shared AiUsageProvider.

import { useEffect, useState } from "react";
import {
  AI_CAP_BASIS_NOTICE_KEY,
  AI_COST_BASIS_NOTICE_KEY,
  useAiUsageContext,
} from "../ai-usage-context";
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
  // ★★ DISPLAY BOUNDARY ONLY. `used` is a COST-EQUIVALENT total, so the
  //    per-field weights (cacheRead 0.1, cacheWrite 1.25) make it fractional
  //    for almost every real turn — a cold turn prices at 20009.85, which
  //    rendered as "20,009.85 / 200,000" and handed assistive tech a
  //    fractional aria-valuenow. `ratio` above deliberately keeps the full
  //    precision, and NOTHING here may round on the way to crossed80/
  //    crossed100 (ai-usage-context.tsx) — the caps compare exact values.
  const usedLabel = Math.round(used);

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {usedLabel.toLocaleString(locale)} / {cap.toLocaleString(locale)} ({pct}%)
        </span>
      </div>
      <ProgressTrack height="h-3">
        <div
          role="progressbar"
          aria-valuenow={usedLabel}
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

// ★ Read ONCE, at mount, via the lazy-useState initialiser below — the same
//   shape AiUsageProvider uses for its buckets. Degrades to "do not show"
//   whenever storage is unreachable (SSR, quota, privacy mode): a settings
//   panel that throws is worse than a migration line nobody sees.
function costBasisNoticeDue(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AI_COST_BASIS_NOTICE_KEY) !== "1";
  } catch {
    return false;
  }
}

// ★★ Stamps BOTH keys. The cap-basis notice this supersedes explained a change
//    now subsumed by the cost-basis one, so marking it seen here stops any
//    later reader re-announcing something already announced.
function markCostBasisNoticeSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, "1");
    window.localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");
  } catch {
    // non-fatal: storage quota or private browsing. The line simply repeats.
  }
}

type AiUsagePanelProps = {
  lang: Lang;
  sessionCap: number;
  weeklyCap: number;
};

export function AiUsagePanel({ lang, sessionCap, weeklyCap }: AiUsagePanelProps) {
  const { sessionTotal, weekTotal, nextReset, sessionUsage } = useAiUsageContext();

  // ★★★ NOT a state setter in an effect (`react-hooks/set-state-in-effect` is
  //     fatal here, and re-rendering would only make the line vanish mid-read).
  //     The flag is read once at mount and stamped once after commit, so the
  //     line stays for THIS visit and never returns.
  const [showCostBasisNotice] = useState(costBasisNoticeDue);
  useEffect(() => {
    if (showCostBasisNotice) markCostBasisNoticeSeen();
  }, [showCostBasisNotice]);

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
      {showCostBasisNotice && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "aiUsageCostBasisChanged")}
        </p>
      )}
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
