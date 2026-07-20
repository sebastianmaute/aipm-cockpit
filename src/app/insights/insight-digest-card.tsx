"use client";

// #6B SP4 — the rolling-window digest card. PRESENTATIONAL and props-only (no
// context): the panel's unit tests render outside every provider, so a `useX()`
// here would throw. All derivation lives in the pure `digest.ts` engine; this
// file only decides how the already-computed numbers read.
//
// Direction colour rides the shared outcome badge's DOT — never tinted small
// text (`--rag-amber-text` is sub-AA as small text on `bg-surface` in dark and
// mockup). The `insights` view is axe-scanned across 5 theme combos.

import { type Lang, t } from "../i18n";
import { INTERACTIVE } from "../interaction-styles";
import { InsightOutcomeBadge } from "./insight-outcome-badge";
import { insightDetail, insightTitle } from "./insight-text";
import type { InsightDigest } from "./digest";
import type { Insight, InsightOutcome } from "./insight";

/** Rows per section. The full set is reachable via the History toggle already in
 *  the panel toolbar, so the overflow is a plain count — a dead affordance would
 *  be worse than no affordance. */
const MAX_DIGEST_ROWS = 5;

interface MeasuredInsight {
  readonly insight: Insight;
  readonly outcome: InsightOutcome;
}

/** Both digest lists are built from records that carry an outcome, but narrow it
 *  STRUCTURALLY rather than asserting — a `!` would silently render `undefined`
 *  into the badge if the engine's predicate ever changed. */
function measured(list: readonly Insight[]): readonly MeasuredInsight[] {
  return list.flatMap((insight) =>
    insight.outcome === undefined ? [] : [{ insight, outcome: insight.outcome }],
  );
}

function rowLabel(insight: Insight, lang: Lang): string {
  return `${insightTitle(insight, lang)} – ${insightDetail(insight, lang)}`;
}

interface DigestSectionProps {
  readonly heading: string;
  readonly rows: readonly MeasuredInsight[];
  readonly lang: Lang;
  readonly onOpenInsight?: (insight: Insight) => void;
}

function DigestSection({ heading, rows, lang, onOpenInsight }: DigestSectionProps) {
  const visible = rows.slice(0, MAX_DIGEST_ROWS);
  const overflow = rows.length - visible.length;
  // `insightDetail` embeds the ENTITY NAME, so two rows collide only when two
  // entities share a name — "Go-live" per workstream is common. Those rows are
  // buttons navigating to DIFFERENT entities, so N identical names is WCAG
  // 2.4.6 (and the axe gate passes it: the live demo seeds one row, so the
  // collision never renders at scan time).
  //
  // Qualify ONLY on collision. An aria-label that merely repeats the visible
  // text suppresses the natural accessible name and drifts silently if the
  // label shape changes, so the common case is left with no aria-label at all.
  const labels = visible.map(({ insight }) => rowLabel(insight, lang));
  const colliding = new Set(labels.filter((l, i) => labels.indexOf(l) !== i));
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-foreground">{heading}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {visible.map(({ insight, outcome }) => {
          const label = rowLabel(insight, lang);
          // WCAG 2.5.3 holds: the qualified name still CONTAINS the visible text.
          const accessibleName = colliding.has(label)
            ? `${label} – ${t(lang, "insightDigestRowRef", String(insight.entityRef?.id ?? insight.id))}`
            : undefined;
          // A row is interactive only when there is somewhere to GO: milestoneSlip
          // and raidAging carry an entityRef, but stalledWork/overdueTrend/
          // budgetVariance are portfolio-level and carry NONE. Rendering a button
          // for those would be a dead affordance — the same reason the "+N more"
          // overflow was kept a plain span.
          const canOpen = onOpenInsight !== undefined && insight.entityRef !== undefined;
          return (
            <li key={insight.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {canOpen ? (
                <button
                  type="button"
                  aria-label={accessibleName}
                  onClick={() => onOpenInsight?.(insight)}
                  className={`rounded-sm text-left text-xs text-foreground hover:text-ui-dark-blue ${INTERACTIVE}`}
                >
                  {label}
                </button>
              ) : (
                <span className="text-xs text-foreground">{label}</span>
              )}
              <InsightOutcomeBadge outcome={outcome} lang={lang} />
            </li>
          );
        })}
        {overflow > 0 ? (
          <li className="text-xs text-muted-foreground">
            {t(lang, "insightDigestMore", String(overflow))}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export interface InsightDigestCardProps {
  readonly digest: InsightDigest;
  readonly lang: Lang;
  /** Omit for a read-only card — rows then render as plain text, never a dead
   *  button. Even when passed, only rows whose insight has an `entityRef` become
   *  buttons (see the guard in DigestSection). */
  readonly onOpenInsight?: (insight: Insight) => void;
}

/** Rolling-window summary of the insight loop: what fired, what was acted on,
 *  what got better, and what got worse. */
export function InsightDigestCard({ digest, lang, onOpenInsight }: InsightDigestCardProps) {
  if (digest.isEmpty) return null;

  const wins = measured(digest.wins);
  const regressions = measured(digest.regressions);

  return (
    <section className="rounded-md border border-line bg-surface px-3 py-2">
      <h3 className="text-sm font-medium text-foreground">
        {t(lang, "insightDigestTitle", String(digest.windowDays))}
      </h3>
      {/* The two WINDOWED counts read together; the LIVE "open now" count is a
          current state, not this week's news, so it sits last behind a divider
          instead of running on from them. */}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <span>{t(lang, "insightDigestFired", String(digest.firedCount))}</span>
        <span aria-hidden="true">·</span>
        <span>{t(lang, "insightDigestActed", String(digest.actedCount))}</span>
        <span aria-hidden="true">·</span>
        <span className="font-medium">
          {t(lang, "insightDigestOpen", String(digest.openNow))}
        </span>
      </p>
      {wins.length > 0 ? (
        <DigestSection
          heading={t(lang, "insightDigestWins")}
          rows={wins}
          lang={lang}
          onOpenInsight={onOpenInsight}
        />
      ) : null}
      {regressions.length > 0 ? (
        <DigestSection
          heading={t(lang, "insightDigestRegressions")}
          rows={regressions}
          lang={lang}
          onOpenInsight={onOpenInsight}
        />
      ) : null}
    </section>
  );
}
