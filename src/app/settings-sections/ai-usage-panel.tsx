"use client";
// src/app/settings-sections/ai-usage-panel.tsx
// Usage bars sub-component for AiSection. Reads from the shared AiUsageProvider.

import { useEffect, useState } from "react";
import {
  AI_CAP_BASIS_NOTICE_KEY,
  AI_COST_BASIS_NOTICE_KEY,
  useAiUsageContext,
} from "../ai-usage-context";
import { nextWeekReset } from "../ai-usage";
import { ProgressTrack } from "../progress-track";
import { type Lang, t, localeFor } from "../i18n";
import {
  DEFAULT_SESSION_TOKEN_CAP,
  DEFAULT_WEEKLY_TOKEN_CAP,
} from "../settings-types";

const BAR_BASE = "h-3 rounded-full transition-all";
// Brand palette only: green below 80 %, pink (warning/error) at 80 %+.
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

/** The pre-0.297 value of `AI_COST_BASIS_NOTICE_KEY`: a bare "already seen"
 *  boolean, written by the retired toast path AND still written today by
 *  `loadBucketsAndSeedBasisNotices` for a genuinely fresh install. It means
 *  "never show", forever. */
const NOTICE_SEEN_SENTINEL = "1";

// ★★★ THE LINE'S LIFETIME MUST MATCH WHAT THE LINE SAYS. It promises the old
//     scale lasts "until the week resets", so a one-shot flag stamped on the
//     first Settings visit made the text false for anyone who looked on day 1
//     — their history stays mis-scaled for the rest of the week with nothing
//     on screen to say so. The key therefore stores the ISO timestamp of the
//     FIRST observation and the line lives until that week's reset, reusing
//     `nextWeekReset` rather than re-deriving week arithmetic (the bars'
//     "Resets …" line comes from the same function, so the two cannot drift).
// ★ Read ONCE, at mount, via the lazy-useState initialiser below — the same
//   shape AiUsageProvider uses for its buckets, and the sanctioned place for
//   the `new Date()` the react-hooks purity rule bans from a render body.
//   Degrades to "do not show" whenever storage is unreachable (SSR, quota,
//   privacy mode) or holds something unparseable: a settings panel that throws
//   is worse than a migration line nobody sees, and a notice that cannot
//   expire is worse than one that never appears.
function costBasisNoticeDue(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(AI_COST_BASIS_NOTICE_KEY);
    if (raw === null) return true; // never observed → show, and stamp below
    // ★★★ THIS BRANCH MUST PRECEDE THE PARSE. `new Date("1")` is NOT an
    //     invalid date — V8 reads it as the year 2001 (verified, not assumed).
    //     ★ Honest note: it is behaviourally REDUNDANT today, because 2001 is
    //     long past its own week reset and so falls through to the same
    //     "hidden" answer. A mutant deleting this line therefore SURVIVES.
    //     It is kept because the equivalence is a coincidence of the sentinel
    //     being date-shaped, not a property anyone chose — flip the default
    //     below, or pick a non-numeric sentinel, and the fallthrough silently
    //     starts re-showing the notice to every legacy device.
    if (raw === NOTICE_SEEN_SENTINEL) return false;
    const firstSeen = new Date(raw);
    if (Number.isNaN(firstSeen.getTime())) return false;
    const now = new Date();
    // ★★ A stamp in the FUTURE is a wrong clock at first observation, not a
    //    lifetime — a device briefly set to 2030 would otherwise keep the line
    //    up for years once its clock was corrected, which is the
    //    cannot-expire failure this whole shape exists to avoid. Unlike the
    //    two guards above, this one is NOT behaviourally redundant: a future
    //    date parses fine and the comparison below would return true.
    if (firstSeen > now) return false;
    return now < nextWeekReset(firstSeen);
  } catch {
    return false;
  }
}

// ★★ FIRST OBSERVATION ONLY — the `!== null` guard is what stops the window
//    being extended. Without it every mount would re-stamp "now" and the line
//    would never expire, which is the same defect as never showing it, just
//    louder. It also makes the write idempotent under StrictMode's
//    double-invoked effects.
// ★ Stamps the cap key as a bare sentinel. The cap-basis notice this supersedes
//   explained a change now subsumed by the cost-basis one, so marking it seen
//   stops any later reader re-announcing something already announced; only the
//   COST key carries a date, because only the cost key has a lifetime.
function recordCostBasisNoticeFirstSeen(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(AI_COST_BASIS_NOTICE_KEY) !== null) return;
    window.localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, new Date().toISOString());
    window.localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, NOTICE_SEEN_SENTINEL);
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
  //     Read once at mount, stamped once after commit. The line therefore
  //     survives a remount for as long as the stored week has not reset —
  //     re-evaluated per mount, never mutated mid-visit.
  const [showCostBasisNotice] = useState(costBasisNoticeDue);
  useEffect(() => {
    if (showCostBasisNotice) recordCostBasisNoticeFirstSeen();
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
