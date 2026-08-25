"use client";

import { type Lang, t, type TranslationKey } from "../i18n";
import { RagDot } from "../rag-dot";
import { Button } from "../button";
import { insightTitle, insightDetail, insightRowTitles } from "../insights/insight-text";
import {
  INSIGHT_SEVERITY_RANK,
  type Insight,
  type InsightActions,
  type InsightEntityRef,
  type InsightSeverity,
} from "../insights/insight";
import { InsightRecommendationControls } from "../insight-recommendation-controls";
import type { Health } from "../health";
import type { DensityClasses } from "../dashboard-density";

/** Cap the card so a noisy project never floods its tile. (It said "the masonry
 *  flow" until the arrangeable grid replaced the multicolumn masonry; the tile
 *  now scrolls its own body, so the cap bounds the scroll rather than the page.) */
const MAX_INSIGHTS_CARD = 5;

// Severity → RAG token: colour rides the DOT (non-text, AA-exempt), never tinted
// small text (per AGENTS.md — --rag-amber-text fails AA on dark/mockup).
const SEVERITY_HEALTH: Record<InsightSeverity, Health> = { high: "R", medium: "A", low: "G" };
const SEVERITY_LABEL_KEY: Record<InsightSeverity, TranslationKey> = {
  high: "insightSeverityHigh",
  medium: "insightSeverityMedium",
  low: "insightSeverityLow",
};

export interface InsightsCardProps {
  insights: readonly Insight[];
  lang: Lang;
  dc: DensityClasses;
  /** Lifecycle callbacks; omit (or `isPopout`) for a read-only card. */
  actions?: InsightActions;
  /** Id of the insight whose AI recommendation is generating (#6B SP2) —
   *  PER-ROW: only that row's CTA shows Stop. */
  generatingId?: number | null;
  /** Aborts the in-flight recommendation generate. */
  onCancelGenerate?: () => void;
  aiEnabled?: boolean;
  /** Deep-link to the insight's entity (only rendered when `entityRef` is set). */
  onOpen?: (ref: InsightEntityRef) => void;
  isPopout?: boolean;
}

/** Dashboard Insights card (#6B SP1): active insights + their lifecycle CTAs.
 *  Presentational — self-hides (returns null) when no insight is active.
 *
 *  ★★ UNBOXED AND UN-TITLED, like every other arrangeable tile body: the tile
 *  chrome (`dashboard-tile.tsx`) draws the bordered surface and renders the
 *  `<h3>`, and the catalogue's label key for this tile (`dashboardInsights`) is
 *  byte-identical to what this card used to head itself with — "Insights" /
 *  "Erkenntnisse" in both dictionaries. Re-adding a `Card` here stacks two
 *  borders and two identical headings. (Contrast `RaidRegisterCard`, which keeps
 *  its `Section` heading BECAUSE its text differs from its chrome title.)
 *
 *  ★ There is no `chromeless`/`heading` opt-out prop and there must not be one
 *  until a second consumer exists: `buildTileBodies` is the only call site —
 *  `grep -rn "InsightsCard" src --include="*.tsx" | grep -v "\.test\."`.
 *  `insights-panel.tsx` renders its OWN list and merely shares the
 *  `insightsCardTitle` string, so it is unaffected by this shape. */
export function InsightsCard({
  insights,
  lang,
  dc,
  actions,
  generatingId,
  onCancelGenerate,
  aiEnabled,
  onOpen,
  isPopout,
}: InsightsCardProps) {
  const active = insights
    .filter((i) => i.status === "active" || i.status === "acknowledged")
    .slice()
    .sort((a, b) => INSIGHT_SEVERITY_RANK[a.severity] - INSIGHT_SEVERITY_RANK[b.severity])
    .slice(0, MAX_INSIGHTS_CARD);

  if (active.length === 0) return null;

  // ★★ Row-unique names (WCAG 2.4.6) — mirrors insights-panel.tsx. Derived
  // from `active`, the filtered/sorted/capped array actually mapped below,
  // not from `insights`, so the occurrence index follows what is on screen.
  const rowTitles = insightRowTitles(active, lang);

  return (
    <ul className={`flex flex-col ${dc.kpiGap}`}>
      {active.map((insight) => {
        // ★ Split on purpose: `title` is the VISIBLE headline text; a
        // colliding row must NOT show a disambiguating "(2)" on screen —
        // only `nameToken` (the row-unique form) feeds accessible names.
        const title = insightTitle(insight, lang);
        const nameToken = rowTitles.get(insight.id) ?? title;
        const detail = insightDetail(insight, lang);
        return (
          <li
            key={insight.id}
            className="flex items-start gap-2 rounded-md border border-line bg-surface px-2 py-1.5"
          >
            <RagDot
              level={SEVERITY_HEALTH[insight.severity]}
              size="md"
              className="mt-1"
              label={t(lang, SEVERITY_LABEL_KEY[insight.severity])}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{detail}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {insight.entityRef && onOpen ? (
                  <Button
                    variant="secondary"
                    size="xs"
                    aria-label={`${t(lang, "insightOpen")} – ${nameToken}`}
                    onClick={() => onOpen(insight.entityRef!)}
                  >
                    {t(lang, "insightOpen")}
                  </Button>
                ) : null}
                {!isPopout && actions ? (
                  <>
                    {insight.status === "active" ? (
                      <Button
                        variant="secondary"
                        size="xs"
                        aria-label={`${t(lang, "insightAcknowledge")} – ${nameToken}`}
                        title={t(lang, "insightAcknowledgeHint")}
                        onClick={() => actions.onAcknowledge(insight.id)}
                      >
                        {t(lang, "insightAcknowledge")}
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="xs"
                      aria-label={`${t(lang, "insightAct")} – ${nameToken}`}
                      title={t(lang, "insightActHint")}
                      onClick={() => actions.onAct(insight.id)}
                    >
                      {t(lang, "insightAct")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      aria-label={`${t(lang, "insightDismiss")} – ${nameToken}`}
                      onClick={() => actions.onDismiss(insight.id)}
                    >
                      {t(lang, "insightDismiss")}
                    </Button>
                    <InsightRecommendationControls
                      insight={insight}
                      title={nameToken}
                      lang={lang}
                      actions={actions}
                      generatingId={generatingId}
                      onCancelGenerate={onCancelGenerate}
                      aiEnabled={aiEnabled}
                    />
                  </>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
