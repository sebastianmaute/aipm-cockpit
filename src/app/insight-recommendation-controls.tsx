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

/** The "Generate recommendation" CTA — rendered both for an insight with no
 *  recommendation yet AND for a rejected one (regenerate). Returns null when AI
 *  is off: generating needs AI, so a click would fire a guaranteed-401 call.
 *  Every other AI CTA in the app gates visibility the same way. */
function GenerateRecommendationCta({
  insight,
  title,
  lang,
  actions,
  generatingId,
  aiEnabled,
}: InsightRecommendationControlsProps) {
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

/** Priority: proposed → summary + Review/Reject; applied → a muted note;
 *  rejected → a muted note PLUS the CTA again (so a dismissed suggestion isn't
 *  a dead end — regenerating overwrites it); else → the CTA alone. */
export function InsightRecommendationControls(props: InsightRecommendationControlsProps) {
  const { insight, title, lang, actions } = props;
  const rec = insight.recommendation;
  if (!rec) return <GenerateRecommendationCta {...props} />;
  if (rec.status === "applied") {
    return <p className="text-xs text-muted-foreground">{t(lang, "insightRecommendationApplied")}</p>;
  }
  if (rec.status === "rejected") {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <p className="w-full text-xs text-muted-foreground">{t(lang, "insightRecommendationRejected")}</p>
        <GenerateRecommendationCta {...props} />
      </div>
    );
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
