"use client";

// #6B SP2 — the AI-recommendation lifecycle controls for an insight row,
// shared by the dashboard InsightsCard and the dedicated Insights view so the
// two surfaces render identical markup/a11y for the same insight.

import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { AiTriggerButton } from "./ai-trigger-button";
import { GUARDRAIL_INSIGHT_TYPES, type Insight, type InsightActions } from "./insights/insight";
import { isPersonScopedInsight } from "./insights/insight-prompt";

export interface InsightRecommendationControlsProps {
  insight: Insight;
  /** The row's row-unique title (mirrors the Open/Ack/Act/Dismiss aria-labels). */
  title: string;
  lang: Lang;
  actions: InsightActions;
  /** Id of the insight (if any) whose recommendation is currently generating —
   *  PER-ROW, so only the running row's CTA shows Stop. Undefined → idle. */
  generatingId?: number | null;
  /** Aborts the in-flight generate — GLOBAL, since only one generate can ever
   *  be running. Undefined at surfaces that don't wire it. */
  onCancelGenerate?: () => void;
  /** Whether AI is enabled + configured. `false` hides the Generate CTA (apply /
   *  reject of an EXISTING recommendation stay available — they don't call AI).
   *  Undefined = unknown (tests) → treated as enabled for back-compat. */
  aiEnabled?: boolean;
  /** Whether Timelog is on for the project (`isModuleEnabled("timelog", …)`). `false` withholds the
   *  Generate CTA, and Apply on a proposed recommendation, on a TimeLog guardrail insight and says why
   *  in visible text: while Timelog is off the recommendations leave every guardrail row out
   *  (`useInsightRecommendations`). Reject stays. Undefined = unknown (tests) → treated as on, like `aiEnabled`. */
  timelogEnabled?: boolean;
}

/** A TimeLog guardrail insight while Timelog is off: the recommendations leave it out, so neither
 *  Generate nor Apply can act on it. */
function timelogWithheld(insight: Insight, timelogEnabled: boolean | undefined): boolean {
  return timelogEnabled === false && GUARDRAIL_INSIGHT_TYPES.has(insight.type);
}

/** Said in place of a withheld Generate or Apply — visible text, so a screen-reader user reads it too.
 *  Two texts: Generate says no recommendation is made; Apply sits under a recommendation the user can
 *  see, so it says that one cannot be applied. */
function TimelogOffNote({ lang, withheld }: { lang: Lang; withheld: "generate" | "apply" }) {
  const key = withheld === "apply" ? "insightRecommendationTimelogOffApply" : "insightRecommendationTimelogOff";
  return <p className="w-full text-xs text-muted-foreground">{t(lang, key)}</p>;
}

/** AI people protection: an insight about one person is never sent, so Generate would do nothing. Said in
 *  visible text in its place, like `TimelogOffNote`. */
function PeopleProtectedNote({ lang }: { lang: Lang }) {
  return <p className="w-full text-xs text-muted-foreground">{t(lang, "insightRecommendationPeopleProtected")}</p>;
}

/** The "Generate recommendation" CTA — rendered both for an insight with no
 *  recommendation yet AND for a rejected one (regenerate). Returns null when AI
 *  is off: generating needs AI, so a click would fire a guaranteed-401 call.
 *  Every other AI CTA in the app gates visibility the same way. A TimeLog
 *  guardrail insight while Timelog is off gets a muted note in its place —
 *  plain text, so a screen-reader user reads the reason too. */
function GenerateRecommendationCta({
  insight,
  title,
  lang,
  actions,
  generatingId,
  onCancelGenerate,
  aiEnabled,
  timelogEnabled,
}: InsightRecommendationControlsProps) {
  if (aiEnabled === false) return null;
  if (timelogWithheld(insight, timelogEnabled)) return <TimelogOffNote lang={lang} withheld="generate" />;
  if (actions.peopleProtected === true && isPersonScopedInsight(insight)) return <PeopleProtectedNote lang={lang} />;
  // ★ `nameQualifier` is NOT optional polish here — every insight row renders
  //   this CTA, so without the row-unique suffix a list is N identically-named
  //   buttons (WCAG 2.4.6), and it must qualify the Stop state too since that
  //   is exactly when they all read the same word.
  // ★★ `busy` is PER-ROW and `onCancel` is GLOBAL, and that pairing is correct
  //   rather than inconsistent. The invariant is "a Stop button must stop the
  //   call it appears to belong to": only one generate can ever be in flight
  //   (`useAbortableAi.run` aborts the previous one), so the global cancel IS
  //   this row's call whenever this row is the one generating. Feeding the
  //   GLOBAL flag to `busy` instead would turn EVERY row's CTA into "Stop"
  //   while one runs, leaving a user who wants row 5 no way to say so — a
  //   worse control than the disabled-and-labelled one this replaced.
  return (
    <AiTriggerButton
      lang={lang}
      busy={generatingId === insight.id}
      onRun={() => actions.onGenerateRecommendation(insight.id)}
      onCancel={() => onCancelGenerate?.()}
      idleLabelKey="insightGenerateRecommendation"
      nameQualifier={title}
    />
  );
}

/** Priority: proposed → summary + Review/Reject; applied → a muted note (plus
 *  the CTA when some calls were refused — "Partly applied", §351);
 *  rejected → a muted note PLUS the CTA again (so a dismissed suggestion isn't
 *  a dead end — regenerating overwrites it); else → the CTA alone. */
export function InsightRecommendationControls(props: InsightRecommendationControlsProps) {
  const { insight, title, lang, actions } = props;
  const rec = insight.recommendation;
  if (!rec) return <GenerateRecommendationCta {...props} />;
  if (rec.status === "applied") {
    // §351: some calls wrote nothing — say so, and re-offer Generate for the
    // rest (as the rejected branch does). Regenerating REPLACES proposedCalls,
    // so the creates that already committed are never replayed.
    if ((rec.refusedCalls ?? 0) > 0) {
      return (
        <div className="flex flex-wrap items-center gap-1">
          <p className="w-full text-xs text-muted-foreground">{t(lang, "insightRecommendationAppliedPartial")}</p>
          <GenerateRecommendationCta {...props} />
        </div>
      );
    }
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
      {/* Apply is withheld like Generate while Timelog is off; Reject stays, it calls nothing. */}
      {timelogWithheld(insight, props.timelogEnabled) ? (
        <TimelogOffNote lang={lang} withheld="apply" />
      ) : (
        <Button
          variant="secondary"
          size="xs"
          aria-label={`${t(lang, "insightApplyRecommendation")} – ${title}`}
          onClick={() => actions.onApplyRecommendation(insight.id)}
        >
          {t(lang, "insightApplyRecommendation")}
        </Button>
      )}
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
