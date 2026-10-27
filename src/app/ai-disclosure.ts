// The AI data disclosure as ONE table (AI-01): every path that sends data to an AI or speech service,
// the consent level it needs, and what it sends. The consent dialog renders its rows by level and
// `docs/security.md` "What leaves the browser" lists one bullet per row, so the three cannot drift
// apart silently: `ai-disclosure.test.ts` fails when an activation site in
// `src/test/ai-activation-sites.ts` has no row, and when the doc misses a row's label.
//
// ★★ The data texts (`dataKey`) are a promise about what leaves the browser. Change one only after
//    reading the request builder it describes, and change it in the SAME commit as a builder change.
// ★★ `AI_DISCLOSURE_VERSION` (`ai-consent.ts`) must be bumped whenever this table changes (a row
//    added, removed, re-levelled or re-keyed): consent was given to the table as it was, so a changed
//    table must be asked again. `ai-disclosure.test.ts` pins the table per version, with a hash of
//    each row's English label and data text, and fails on any change until it is re-pinned (wording
//    only) or the version is bumped (what is sent changed).
import type { TranslationKey } from "./i18n";

export const AI_CONSENT_LEVELS = ["interactive", "background"] as const;
export type AiConsentLevel = (typeof AI_CONSENT_LEVELS)[number];

export interface AiDataPath {
  /** Stable id, referenced by the activation-site coverage test. Unique across levels. */
  id: string;
  level: AiConsentLevel;
  /** The feature's name, as the consent dialog and docs/security.md show it. */
  labelKey: TranslationKey;
  /** What it sends. Two rows of one feature at different levels may share a text. */
  dataKey: TranslationKey;
}

export const AI_DATA_PATHS: readonly AiDataPath[] = [
  { id: "chat", level: "interactive", labelKey: "aiDataChatLabel", dataKey: "aiDataChat" },
  { id: "inline-edit", level: "interactive", labelKey: "aiDataInlineEditLabel", dataKey: "aiDataInlineEdit" },
  { id: "committee-report", level: "interactive", labelKey: "aiDataCommitteeReportLabel", dataKey: "aiDataCommitteeReport" },
  { id: "digest-narrative", level: "interactive", labelKey: "aiDataDigestNarrativeLabel", dataKey: "aiDataDigestNarrative" },
  { id: "forecast-import", level: "interactive", labelKey: "aiDataForecastImportLabel", dataKey: "aiDataForecastImport" },
  { id: "insight-recommendation", level: "interactive", labelKey: "aiDataInsightRecommendationLabel", dataKey: "aiDataInsightRecommendation" },
  { id: "action-analysis", level: "interactive", labelKey: "aiDataActionAnalysisLabel", dataKey: "aiDataActionAnalysis" },
  { id: "alloc-plan", level: "interactive", labelKey: "aiDataAllocPlanLabel", dataKey: "aiDataAllocPlan" },
  { id: "raci-suggest", level: "interactive", labelKey: "aiDataRaciSuggestLabel", dataKey: "aiDataRaciSuggest" },
  { id: "task-dedup", level: "interactive", labelKey: "aiDataTaskDedupLabel", dataKey: "aiDataTaskDedup" },
  { id: "wbs-plan", level: "interactive", labelKey: "aiDataWbsPlanLabel", dataKey: "aiDataWbsPlan" },
  { id: "weight-suggestion", level: "interactive", labelKey: "aiDataWeightSuggestionLabel", dataKey: "aiDataWeightSuggestion" },
  { id: "project-proposal", level: "interactive", labelKey: "aiDataProjectProposalLabel", dataKey: "aiDataProjectProposal" },
  { id: "dictation", level: "interactive", labelKey: "aiDataDictationLabel", dataKey: "aiDataDictation" },
  { id: "scheduled-job", level: "background", labelKey: "aiDataScheduledJobLabel", dataKey: "aiDataScheduledJob" },
  { id: "insight-recommendation-auto", level: "background", labelKey: "aiDataInsightRecommendationAutoLabel", dataKey: "aiDataInsightRecommendation" },
  { id: "digest-narrative-scheduled", level: "background", labelKey: "aiDataDigestNarrativeScheduledLabel", dataKey: "aiDataDigestNarrative" },
];

/** The rows one consent level discloses, in table order. */
export function aiDataPathsFor(level: AiConsentLevel): readonly AiDataPath[] {
  return AI_DATA_PATHS.filter((row) => row.level === level);
}
