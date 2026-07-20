"use client";

// #6B SP2 — the AI-recommendation lifecycle controls for an insight row,
// shared by the dashboard InsightsCard and the dedicated Insights view so the
// two surfaces render identical markup/a11y for the same insight.

import { type Lang, t } from "./i18n";
import { Button } from "./button";
import type { Insight, InsightActions } from "./insights/insight";

export interface InsightRecommendationControlsProps {
  insight: Insight;
  /** The row's row-unique title (mirrors the Open/Ack/Act/Dismiss aria-labels). */
  title: string;
  lang: Lang;
  actions: InsightActions;
  /** Id of the insight (if any) whose recommendation is currently generating. */
  generatingId?: number | null;
  /** Whether AI is enabled + configured. `false` hides the Generate CTA (apply /
   *  reject of an EXISTING recommendation stay available — they don't call AI).
   *  Undefined = unknown (tests) → treated as enabled for back-compat. */
  aiEnabled?: boolean;
}

/** Priority: proposed → summary + Review/Reject; applied/rejected → a muted
 *  note (no buttons); else → the "Generate recommendation" CTA. */
export function InsightRecommendationControls({
  insight,
  title,
  lang,
  actions,
  generatingId,
  aiEnabled,
}: InsightRecommendationControlsProps) {
  const rec = insight.recommendation;
  if (!rec) {
    // Generating a NEW recommendation needs AI — hide the CTA when it's off
    // (a click would otherwise fire a guaranteed-401 call). Every other AI CTA
    // in the app gates visibility the same way.
    if (aiEnabled === false) return null;
    const isGenerating = generatingId === insight.id;
    const labelKey = isGenerating ? "insightRecommendationGenerating" : "insightGenerateRecommendation";
    return (
      <Button
        variant="ghost"
        size="xs"
        disabled={isGenerating}
        aria-label={`${t(lang, labelKey)} – ${title}`}
        onClick={() => actions.onGenerateRecommendation(insight.id)}
      >
        {t(lang, labelKey)}
      </Button>
    );
  }
  if (rec.status === "applied") {
    return <p className="text-xs text-muted-foreground">{t(lang, "insightRecommendationApplied")}</p>;
  }
  if (rec.status === "rejected") {
    return <p className="text-xs text-muted-foreground">{t(lang, "insightRecommendationRejected")}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <p className="w-full text-xs text-muted-foreground">
        {t(lang, "insightRecommendationSuggests", rec.summary)}
      </p>
      <Button
        variant="ghost"
        size="xs"
        aria-label={`${t(lang, "insightApplyRecommendation")} – ${title}`}
        onClick={() => actions.onApplyRecommendation(insight.id)}
      >
        {t(lang, "insightApplyRecommendation")}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        aria-label={`${t(lang, "insightRejectRecommendation")} – ${title}`}
        onClick={() => actions.onRejectRecommendation(insight.id)}
      >
        {t(lang, "insightRejectRecommendation")}
      </Button>
    </div>
  );
}
