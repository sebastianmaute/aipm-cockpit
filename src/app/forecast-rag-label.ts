// src/app/forecast-rag-label.ts
//
// The text equivalent of a part-4 chance dot (§502): the colour alone must not carry the severity for assistive
// technology. Red is "below even odds" (`chanceSeverity`), amber below the goal, green at or above it.

import type { Health } from "./health";
import { type Lang, type TranslationKey, t } from "./i18n";

const RAG_LABEL_KEY: Record<Health, TranslationKey> = {
  R: "forecastRagBelowEven",
  A: "forecastRagBelowTarget",
  G: "forecastRagAtTarget",
};

export function chanceRagLabel(lang: Lang, level: Health): string {
  return t(lang, RAG_LABEL_KEY[level]);
}
