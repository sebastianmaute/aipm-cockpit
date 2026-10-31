// The AI data disclosure as ONE table (AI-01): every path that sends data to an AI or speech service,
// the consent level it needs, and what it sends. The consent dialog renders its rows by level and
// `docs/security.md` "What leaves the browser" lists one bullet per row, so the three cannot drift
// apart silently: `ai-disclosure.test.ts` fails when an activation site in
// `src/test/ai-activation-sites.ts` has no row, and when the doc misses a row's label.
//
// ★★ The data texts (`dataKey`) are a promise about what leaves the browser. Change one only after
//    reading the request builder it describes, and change it in the SAME commit as a builder change.
// ★★ `whenProtected` (and `protectedKey`) is the PROTECTED column: what people protection does to the path. The consent
//    dialog and docs/security.md "People protection" render it per row; it is pinned with the row.
// ★★ `AI_DISCLOSURE_VERSION` (`ai-consent.ts`) must be bumped whenever this table changes (a row
//    added, removed, re-levelled or re-keyed): consent was given to the table as it was, so a changed
//    table must be asked again. `ai-disclosure.test.ts` pins the table per version, with a hash of
//    each row's English label and data text, and fails on any change until it is re-pinned (wording
//    only) or the version is bumped (what is sent changed).
import type { TranslationKey } from "./i18n";
import { type AiRoute, currentAiRoute } from "./ai-deployment";

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
  /** What people protection does to this path while it is ON (AI people protection): the feature is
   *  `hidden`, switched `off` (audio cannot be redacted), or its request is `redacted`. (Review 3, R3: the
   *  former `unredacted` state is gone — the project proposal now always pattern-redacts, see its `protectedKey`.) */
  whenProtected: AiProtectedState;
  /** Replaces the standard text of the state, for a row that must say more or less than it. */
  protectedKey?: TranslationKey;
}

export const AI_PROTECTED_STATES = ["hidden", "redacted", "off"] as const;
export type AiProtectedState = (typeof AI_PROTECTED_STATES)[number];

const PROTECTED_STATE_KEY: Readonly<Record<AiProtectedState, TranslationKey>> = {
  hidden: "aiProtectedHidden",
  redacted: "aiProtectedRedacted",
  off: "aiProtectedOff",
};

/** The text that says what protection does to a row: its own override, else the state's standard text. */
export function aiProtectedTextKey(row: AiDataPath): TranslationKey {
  return row.protectedKey ?? PROTECTED_STATE_KEY[row.whenProtected];
}

export const AI_DATA_PATHS: readonly AiDataPath[] = [
  { id: "chat", level: "interactive", labelKey: "aiDataChatLabel", dataKey: "aiDataChat", whenProtected: "redacted", protectedKey: "aiProtectedChat" },
  { id: "inline-edit", level: "interactive", labelKey: "aiDataInlineEditLabel", dataKey: "aiDataInlineEdit", whenProtected: "redacted" },
  { id: "committee-report", level: "interactive", labelKey: "aiDataCommitteeReportLabel", dataKey: "aiDataCommitteeReport", whenProtected: "redacted" },
  { id: "digest-narrative", level: "interactive", labelKey: "aiDataDigestNarrativeLabel", dataKey: "aiDataDigestNarrative", whenProtected: "redacted" },
  { id: "forecast-import", level: "interactive", labelKey: "aiDataForecastImportLabel", dataKey: "aiDataForecastImport", whenProtected: "redacted" },
  { id: "insight-recommendation", level: "interactive", labelKey: "aiDataInsightRecommendationLabel", dataKey: "aiDataInsightRecommendation", whenProtected: "redacted" },
  { id: "action-analysis", level: "interactive", labelKey: "aiDataActionAnalysisLabel", dataKey: "aiDataActionAnalysis", whenProtected: "redacted" },
  { id: "alloc-plan", level: "interactive", labelKey: "aiDataAllocPlanLabel", dataKey: "aiDataAllocPlan", whenProtected: "hidden" },
  { id: "raci-suggest", level: "interactive", labelKey: "aiDataRaciSuggestLabel", dataKey: "aiDataRaciSuggest", whenProtected: "hidden" },
  { id: "task-dedup", level: "interactive", labelKey: "aiDataTaskDedupLabel", dataKey: "aiDataTaskDedup", whenProtected: "redacted" },
  { id: "wbs-plan", level: "interactive", labelKey: "aiDataWbsPlanLabel", dataKey: "aiDataWbsPlan", whenProtected: "redacted" },
  { id: "weight-suggestion", level: "interactive", labelKey: "aiDataWeightSuggestionLabel", dataKey: "aiDataWeightSuggestion", whenProtected: "redacted" },
  { id: "project-proposal", level: "interactive", labelKey: "aiDataProjectProposalLabel", dataKey: "aiDataProjectProposal", whenProtected: "redacted", protectedKey: "aiProtectedProjectProposal" },
  { id: "dictation", level: "interactive", labelKey: "aiDataDictationLabel", dataKey: "aiDataDictation", whenProtected: "off" },
  { id: "scheduled-job", level: "background", labelKey: "aiDataScheduledJobLabel", dataKey: "aiDataScheduledJob", whenProtected: "redacted" },
  { id: "insight-recommendation-auto", level: "background", labelKey: "aiDataInsightRecommendationAutoLabel", dataKey: "aiDataInsightRecommendation", whenProtected: "redacted" },
  { id: "digest-narrative-scheduled", level: "background", labelKey: "aiDataDigestNarrativeScheduledLabel", dataKey: "aiDataDigestNarrative", whenProtected: "redacted" },
];

/** The rows one consent level discloses, in table order. */
export function aiDataPathsFor(level: AiConsentLevel): readonly AiDataPath[] {
  return AI_DATA_PATHS.filter((row) => row.level === level);
}

/** The texts that say WHERE the data and the key go, one set per AI route: `direct` (this browser
 *  calls Anthropic) or `gateway` (this browser calls this app's server, which relays through the
 *  organisation's AI gateway). The consent dialog, the key note in Settings → AI and the AI Help entry
 *  read them through `aiDestinationKey`, so each says the route the deployment actually uses.
 *  ★ Changing one is a wording change, pinned by `DESTINATION_PIN` in ai-disclosure.test.ts; it does
 *  not bump `AI_DISCLOSURE_VERSION`, because a consent already records the route it was given for. */
export interface AiDestinationKeys {
  /** Lead-in to the interactive consent dialog's data rows. */
  interactive: TranslationKey;
  /** Lead-in to the background consent dialog's data rows. */
  background: TranslationKey;
  /** The note under the key field in Settings → AI. */
  keyNote: TranslationKey;
  /** The consent dialog's bullet on how the key is kept and where it is sent. */
  keySecurity: TranslationKey;
  /** The consent dialog's bullet naming who else receives the data: Anthropic, and on a gateway
   *  deployment also the organisation's AI gateway and the provider that runs it. */
  thirdParty: TranslationKey;
  /** The AI chat Help entry's body. */
  help: TranslationKey;
}

export const AI_DESTINATION_KEYS: Readonly<Record<AiRoute, AiDestinationKeys>> = {
  direct: {
    interactive: "aiConsentDataIntro",
    background: "aiConsentBackgroundDataIntro",
    keyNote: "aiApiKeyHint",
    keySecurity: "aiConsentBullet2",
    thirdParty: "aiConsentBullet3",
    help: "helpSecAiBody",
  },
  gateway: {
    interactive: "aiConsentDataIntroGateway",
    background: "aiConsentBackgroundDataIntroGateway",
    keyNote: "aiApiKeyHintGateway",
    keySecurity: "aiConsentBullet2Gateway",
    thirdParty: "aiConsentBullet3Gateway",
    help: "helpSecAiBodyGateway",
  },
  // The relay route (organisation key restriction) sends the browser's calls to this app's server
  // too; until it has texts of its own it reads the gateway ones, the nearer truth than "direct".
  relay: {
    interactive: "aiConsentDataIntroGateway",
    background: "aiConsentBackgroundDataIntroGateway",
    keyNote: "aiApiKeyHintGateway",
    keySecurity: "aiConsentBullet2Gateway",
    thirdParty: "aiConsentBullet3Gateway",
    help: "helpSecAiBodyGateway",
  },
};

/** The text for `kind` on this deployment's AI route. */
export function aiDestinationKey(kind: keyof AiDestinationKeys): TranslationKey {
  return AI_DESTINATION_KEYS[currentAiRoute()][kind];
}
