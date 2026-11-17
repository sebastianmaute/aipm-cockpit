// src/app/ai-content-mark.ts — the constants and the one predicate for marking
// project documents an AI tool wrote. Pure and i18n-free.

/** IPTC digital source type for content composed with a trained algorithmic
 *  model. Carried verbatim into every download that can hold metadata. */
export const AI_SOURCE_TYPE_URI =
  "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia";

/** Mail header that states the same thing for a generated message. */
export const AI_MARK_HEADER = "X-AI-Generated";

/** True only when the flag is the literal `true`; absence means not marked. */
export function isAiMarked(doc: { aiGenerated?: true } | undefined): boolean {
  return doc?.aiGenerated === true;
}

/** A copy of `doc` without the mark. The mark is for human readers: a document
 *  handed to the model is passed through here first, so the model never sees it. */
export function omitAiMark<T extends object>(doc: T): Omit<T, "aiGenerated"> {
  const rest: Record<string, unknown> = { ...doc };
  delete rest.aiGenerated;
  return rest as Omit<T, "aiGenerated">;
}
