"use client";

import { type Lang, t, type TranslationKey } from "../i18n";
import { Card } from "../card";
import { RagDot } from "../rag-dot";
import { Button } from "../button";
import { insightTitle, insightDetail } from "../insights/insight-text";
import {
  INSIGHT_SEVERITY_RANK,
  type Insight,
  type InsightActions,
  type InsightEntityRef,
  type InsightSeverity,
} from "../insights/insight";
import type { Health } from "../health";
import type { DensityClasses } from "../dashboard-density";

/** Cap the card so a noisy project never floods the masonry flow. */
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
  /** Deep-link to the insight's entity (only rendered when `entityRef` is set). */
  onOpen?: (ref: InsightEntityRef) => void;
  isPopout?: boolean;
}

/** Dashboard Insights card (#6B SP1): active insights + their lifecycle CTAs.
 *  Presentational — self-hides (returns null) when no insight is active. */
export function InsightsCard({ insights, lang, dc, actions, onOpen, isPopout }: InsightsCardProps) {
  const active = insights
    .filter((i) => i.status === "active" || i.status === "acknowledged")
    .slice()
    .sort((a, b) => INSIGHT_SEVERITY_RANK[a.severity] - INSIGHT_SEVERITY_RANK[b.severity])
    .slice(0, MAX_INSIGHTS_CARD);

  if (active.length === 0) return null;

  return (
    <Card boxed className={dc.cardPad}>
      <h3 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        {t(lang, "insightsCardTitle")}
      </h3>
      <ul className={`flex flex-col ${dc.kpiGap}`}>
        {active.map((insight) => {
          const title = insightTitle(insight, lang);
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
                      variant="ghost"
                      size="xs"
                      aria-label={`${t(lang, "insightOpen")} – ${title}`}
                      onClick={() => onOpen(insight.entityRef!)}
                    >
                      {t(lang, "insightOpen")}
                    </Button>
                  ) : null}
                  {!isPopout && actions ? (
                    <>
                      {insight.status === "active" ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`${t(lang, "insightAcknowledge")} – ${title}`}
                          onClick={() => actions.onAcknowledge(insight.id)}
                        >
                          {t(lang, "insightAcknowledge")}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={`${t(lang, "insightAct")} – ${title}`}
                        onClick={() => actions.onAct(insight.id)}
                      >
                        {t(lang, "insightAct")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={`${t(lang, "insightDismiss")} – ${title}`}
                        onClick={() => actions.onDismiss(insight.id)}
                      >
                        {t(lang, "insightDismiss")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
