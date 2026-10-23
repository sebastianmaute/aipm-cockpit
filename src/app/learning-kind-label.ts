// Display labels for an Action Center learning `kind` (`${source}:${why.key}`,
// see `LearningState` in action-learning.ts), for the learning insights view.
//
// §777 — the view used to print the raw kind as each row's secondary text, so
// two rows of one source (two "Attention" rows, say) differed only by an
// internal identifier. The reason is now the why key's own text when that text
// takes no parameters, and a short param-free label from `REASON_LABEL_KEY`
// when it does: a why text like "No update in {0} days" has no value to fill
// here, because the learning state counts the KIND, not one action.
import { en, t, type Lang, type TranslationKey } from "./i18n";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import type { ActionSource } from "./next-actions/types";

/** A why key whose text takes parameters → its param-free reason label.
 *  ★ Covered by the "every why key" tests in `learning-insights.test.tsx`, which
 *  derive the key set from the EN dictionary: a new parameterised why key with
 *  no entry here fails them. */
const REASON_LABEL_KEY: Partial<Record<TranslationKey, TranslationKey>> = {
  actionForecastSimWhy: "learningReasonForecastSim",
  actionForecastSimWhyBelow1: "learningReasonForecastSimBelow1",
  actionTaskWhyStale: "learningReasonTaskStale",
  actionTaskWhyBlocked: "learningReasonTaskBlocked",
  actionTaskWhyDepBlocked: "learningReasonTaskDepBlocked",
  actionScheduleWhyBehind: "learningReasonScheduleBehind",
  actionScheduleWhySlipping: "learningReasonScheduleSlipping",
  actionScheduleWhyImproving: "learningReasonScheduleImproving",
  actionWorkloadWhyOverAllocated: "learningReasonWorkloadOverAllocated",
  actionWorkloadWhyOverload: "learningReasonWorkloadOverload",
  actionTaskWhyOverdue: "learningReasonTaskOverdue",
  actionTaskWhySoon: "learningReasonTaskSoon",
  actionRaidWhySeverity: "learningReasonRaidSeverity",
  actionRaidWhyNoOwner: "learningReasonRaidNoOwner",
  actionRaidWhyReviewOverdue: "learningReasonRaidReviewOverdue",
  actionRaidWhyReviewStale: "learningReasonRaidReviewStale",
  actionChangeItemWhy: "learningReasonChangeItem",
  actionBudgetWhyCpi: "learningReasonBudgetCpi",
  actionBudgetWhyWorsening: "learningReasonBudgetWorsening",
  actionBudgetWhyImproving: "learningReasonBudgetImproving",
  actionCommsWhy: "learningReasonComms",
  actionCommitteeInfoWhy: "learningReasonCommitteeInfo",
  actionCommitteeInfoWhyOne: "learningReasonCommitteeInfoOne",
};

const PLACEHOLDER = /\{\d+\}/;

function reasonLabel(lang: Lang, whyKey: string): string {
  // `Object.hasOwn`, not a bare lookup: a kind is stored data, and a key such
  // as "constructor" would otherwise resolve to a prototype member.
  const mapped = Object.hasOwn(REASON_LABEL_KEY, whyKey)
    ? REASON_LABEL_KEY[whyKey as TranslationKey]
    : undefined;
  if (mapped) return t(lang, mapped);
  if (Object.hasOwn(en, whyKey)) {
    const text = t(lang, whyKey as TranslationKey);
    if (!PLACEHOLDER.test(text)) return text;
  }
  // A why key this build cannot label (retired, or written by a newer build):
  // the raw key is then the only thing that tells two such rows apart.
  return whyKey;
}

/** The translated source and reason of one learning `kind`. Distinct kinds
 *  of one source get distinct reasons (pinned in `learning-insights.test.tsx`),
 *  which is what keeps the view's per-row control names unique (§248). */
export function learningKindLabel(lang: Lang, kind: string): { source: string; reason: string } {
  const sep = kind.indexOf(":");
  const source = sep < 0 ? kind : kind.slice(0, sep);
  const whyKey = sep < 0 ? "" : kind.slice(sep + 1);
  const sourceKey = Object.hasOwn(ACTION_SOURCE_LABEL, source)
    ? ACTION_SOURCE_LABEL[source as ActionSource]
    : undefined;
  return {
    source: sourceKey ? t(lang, sourceKey) : source,
    // No why key (no ":", or nothing after it): the raw kind, not an empty line.
    reason: whyKey ? reasonLabel(lang, whyKey) : kind,
  };
}
