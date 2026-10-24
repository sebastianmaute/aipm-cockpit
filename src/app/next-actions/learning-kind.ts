// src/app/next-actions/learning-kind.ts — pure, i18n-free: the Action Center
// LEARNING kind of a suggested action, `${source}:${whyKey}` with the why key
// made canonical.
//
// §778 — the providers pick a singular why key by count (`n === 1 ? "…One" :
// "…"`). That split only words the visible "why" line; it is one signal. The
// forecast's "…Below1" (a chance under 1%, from `buildSimMilestoneActions`, not
// a provider) is aliased for consistency only and is inert today: sim actions
// never reach `computeNextActions`, and `record` returns early for them (§502). Keyed by the raw why key, it
// was learned and overridden as TWO kinds: "Always suppress" on "Task — Due
// soon" did not demote a task due in exactly 1 working day. Every place that
// builds a kind (recording an outcome, the engine's bias lookup) goes through
// this module. Stored kinds are normalised ONCE, when `useActionLearning` loads
// the snapshot (`normalizeLearningSnapshot`); everything downstream (the bias
// map, the learning view, the AI weight prompt) reads that normalised state.

/** Count-variant why key → the canonical why key it is learned under.
 *  ★ `learning-kind.test.ts` derives every "…One" / "…Below1" why key from the
 *  EN dictionary and fails when one is missing here, so a new provider cannot
 *  reintroduce the split. */
export const LEARNING_WHY_ALIAS: Readonly<Record<string, string>> = {
  actionTaskWhyOverdueOne: "actionTaskWhyOverdue",
  actionTaskWhySoonOne: "actionTaskWhySoon",
  actionRaidWhyReviewOverdueOne: "actionRaidWhyReviewOverdue",
  actionRaidWhyReviewStaleOne: "actionRaidWhyReviewStale",
  actionWorkloadWhyOverloadOne: "actionWorkloadWhyOverload",
  actionCommitteeInfoWhyOne: "actionCommitteeInfoWhy",
  actionForecastSimWhyBelow1: "actionForecastSimWhy",
};

function canonicalWhyKey(whyKey: string): string {
  // `Object.hasOwn`: a stored kind is data, and "constructor" must not resolve
  // to a prototype member.
  return Object.hasOwn(LEARNING_WHY_ALIAS, whyKey) ? LEARNING_WHY_ALIAS[whyKey] : whyKey;
}

/** The learning kind of an action. */
export function learningKindOf(a: { source: string; why: { key: string } }): string {
  return `${a.source}:${canonicalWhyKey(a.why.key)}`;
}

/** The canonical form of a stored kind. A kind with no why key is returned as is. */
export function canonicalLearningKind(kind: string): string {
  const sep = kind.indexOf(":");
  if (sep < 0) return kind;
  return `${kind.slice(0, sep)}:${canonicalWhyKey(kind.slice(sep + 1))}`;
}
