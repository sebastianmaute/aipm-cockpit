import type { AiConsentLevel } from "./ai-consent";
import type { TranslationKey } from "./i18n";

/** The usage path ids: a chat turn and an inline edit are always interactive; a forced call is
 *  `<tool name>:<consent class>`. A path recorded before ids named a feature reads as `legacy`. */
export const CHAT_PATH = "chat";
export const INLINE_EDIT_PATH = "inline-edit";
export const LEGACY_PATH = "legacy";
export const OTHER_FEATURE = "other";

export type AiFeature =
  | "chat" | "inline-edit" | "allocation" | "status-report" | "digest" | "forecast-import"
  | "insight-recommend" | "raci" | "job-analysis" | "dedup" | "project-proposal" | "wbs"
  | "weights" | "legacy" | "other";

/** The eleven forced-call tool names. Literals, not the callers' exported constants: those modules
 *  import `ai-forced-call`, which imports this one. The test pins each literal to its constant. */
export const FORCED_TOOL_FEATURE: Readonly<Record<string, AiFeature>> = {
  propose_allocations: "allocation",
  write_status_report: "status-report",
  write_digest_narrative: "digest",
  propose_forecast_mapping: "forecast-import",
  propose_insight_actions: "insight-recommend",
  propose_raci: "raci",
  report_analysis: "job-analysis",
  propose_task_merges: "dedup",
  propose_project: "project-proposal",
  propose_wbs_changes: "wbs",
  suggest_weights: "weights",
};

export function forcedPathId(toolName: string, level: AiConsentLevel): string {
  return `${toolName}:${level}`;
}

export function parseAiPathId(path: string): { feature: AiFeature; level: AiConsentLevel } {
  if (path === CHAT_PATH) return { feature: "chat", level: "interactive" };
  if (path === INLINE_EDIT_PATH) return { feature: "inline-edit", level: "interactive" };
  if (path === LEGACY_PATH) return { feature: "legacy", level: "interactive" };
  const at = path.lastIndexOf(":");
  const tool = at < 0 ? path : path.slice(0, at);
  const level: AiConsentLevel = at >= 0 && path.slice(at + 1) === "background" ? "background" : "interactive";
  return { feature: Object.hasOwn(FORCED_TOOL_FEATURE, tool) ? FORCED_TOOL_FEATURE[tool] : OTHER_FEATURE, level };
}

export const AI_FEATURE_LABEL: Record<AiFeature, TranslationKey> = {
  chat: "aiUsageFeatureChat",
  "inline-edit": "aiUsageFeatureInlineEdit",
  allocation: "aiUsageFeatureAllocation",
  "status-report": "aiUsageFeatureStatusReport",
  digest: "aiUsageFeatureDigest",
  "forecast-import": "aiUsageFeatureForecastImport",
  "insight-recommend": "aiUsageFeatureInsightRecommend",
  raci: "aiUsageFeatureRaci",
  "job-analysis": "aiUsageFeatureJobAnalysis",
  dedup: "aiUsageFeatureDedup",
  "project-proposal": "aiUsageFeatureProjectProposal",
  wbs: "aiUsageFeatureWbs",
  weights: "aiUsageFeatureWeights",
  legacy: "aiUsageFeatureLegacy",
  other: "aiUsageFeatureOther",
};
