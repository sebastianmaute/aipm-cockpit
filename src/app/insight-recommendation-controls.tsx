"use client";

// #6B SP2 — the AI-recommendation lifecycle controls for an insight row,
// shared by the dashboard InsightsCard and the dedicated Insights view so the
// two surfaces render identical markup/a11y for the same insight.

import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { AiTriggerButton } from "./ai-trigger-button";
import type { Insight, InsightActions } from "./insights/insight";

export interface InsightRecommendationControlsProps {
  insight: Insight;
  /** The row's row-unique title (mirrors the Open/Ack/Act/Dismiss aria-labels). */
  title: string;
  lang: Lang;
  actions: InsightActions;
  /** The GLOBAL in-flight flag from `useInsightRecommend`, driving the shared
   *  AiTriggerButton's Stop state. ★ Deliberately NOT that hook's per-row
   *  `generatingId`: `cancel` aborts whatever call is actually running, so the
   *  Stop affordance has to track the same global thing or it is a Stop button
   *  that cannot stop. Undefined = unknown (tests) → idle. */
  busy?: boolean;
  /** Aborts the in-flight generate. Undefined at surfaces that don't wire it. */
  onCancelGenerate?: () => void;
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
  busy,
  onCancelGenerate,
  aiEnabled,
}: InsightRecommendationControlsProps) {
  if (aiEnabled === false) return null;
  // ★ `nameQualifier` is NOT optional polish here — every insight row renders
  //   this CTA, so without the row-unique suffix a list is N identically-named
  //   buttons (WCAG 2.4.6), and it must qualify the Stop state too since that
  //   is exactly when they all read the same word.
  // ★ Whole-list consequence of the global `busy`, accepted deliberately: while
  //   ANY generate is in flight EVERY row's CTA reads "Stop". That matches the
  //   engine — `useAbortableAi.run` aborts the previous call, so only one
  //   generate can ever be running and starting another cancels it anyway.
  return (
    <AiTriggerButton
      lang={lang}
      busy={busy === true}
      onRun={() => actions.onGenerateRecommendation(insight.id)}
      onCancel={() => onCancelGenerate?.()}
      idleLabelKey="insightGenerateRecommendation"
      nameQualifier={title}
    />
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
        variant="secondary"
        size="xs"
        aria-label={`${t(lang, "insightApplyRecommendation")} – ${title}`}
        onClick={() => actions.onApplyRecommendation(insight.id)}
      >
        {t(lang, "insightApplyRecommendation")}
      </Button>
      <Button
        variant="secondary"
        size="xs"
        aria-label={`${t(lang, "insightRejectRecommendation")} – ${title}`}
        onClick={() => actions.onRejectRecommendation(insight.id)}
      >
        {t(lang, "insightRejectRecommendation")}
      </Button>
    </div>
  );
}
