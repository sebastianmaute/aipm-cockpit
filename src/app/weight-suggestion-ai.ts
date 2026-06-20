// src/app/weight-suggestion-ai.ts - pure, i18n-free forced-tool contract for SP-C.
import { type NextActionsConfig } from "./settings-types";
import { ALL_TUNABLE_FIELDS, CONTROL_CHARS, parseWeightSuggestions, WEIGHT_FIELDS, type SuggestionScope, type WeightSuggestion } from "./next-actions-tuning";

export interface SuggestionResult { suggestions: WeightSuggestion[]; overallRationale: string; recommendEnableLearning: boolean; }

export interface SuggestionContextInput {
  workspaceDigest: string;
  current: NextActionsConfig;
  scope: SuggestionScope;
  learning: string;
  trends: string;
  learningEnabled: boolean;
}

export function buildSuggestionSystemPrompt(): string {
  return [
    "You are a senior project manager tuning a project tracker's next-actions ranking weights.",
    "Higher clarityBonus/semiClarityBonus raise clear/semi-clear actions; higher staticPenalty lowers vague aggregate signals.",
    "Call the suggest_weights tool exactly once. Propose a new value for a field ONLY when the user's behaviour (what they act on vs snooze/dismiss) and the project data support it; otherwise omit it.",
    "Give a one-sentence rationale per field. Set recommendEnableLearning=true only if learning is disabled and enabling it would improve future suggestions. Keep values within sane bounds; the app re-clamps anyway.",
  ].join(" ");
}

export function buildSuggestionContext(i: SuggestionContextInput): string {
  const weights = Object.entries(i.current).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const fields = i.scope === "all" ? ALL_TUNABLE_FIELDS : WEIGHT_FIELDS;
  return [
    i.workspaceDigest,
    "",
    `## Tuning scope: ${i.scope === "all" ? "all next-actions thresholds" : "the 3 confidence weights only"}`,
    `Suggestable fields: ${fields.join(", ")}.`,
    "",
    "## Current next-actions config", weights,
    "",
    `## Action-learning history (${i.learningEnabled ? "enabled" : "disabled"})`, i.learning,
    "",
    "## Snapshot trends", i.trends,
  ].join("\n");
}

export function parseSuggestionResponse(input: unknown, current: NextActionsConfig, scope: SuggestionScope): SuggestionResult {
  const suggestions = parseWeightSuggestions(input, current, scope);
  const obj = (input && typeof input === "object" ? input : {}) as { recommendEnableLearning?: unknown; overallRationale?: unknown };
  const overallRationale = (typeof obj.overallRationale === "string" ? obj.overallRationale : "").replace(CONTROL_CHARS, " ").trim().slice(0, 280);
  return { suggestions, overallRationale, recommendEnableLearning: obj.recommendEnableLearning === true };
}

export const SUGGEST_TOOL = {
  name: "suggest_weights",
  description: "Suggest numeric adjustments to next-actions ranking weights. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        description: "Per-field suggested adjustments. Only include a field you actually want to change.",
        items: {
          type: "object",
          properties: {
            field: { type: "string", description: "A suggestable config field name." },
            suggested: { type: "number", description: "Proposed new value." },
            rationale: { type: "string", description: "One-sentence justification from the data." },
          },
          required: ["field", "suggested", "rationale"],
        },
      },
      overallRationale: { type: "string", description: "One-line summary of the tuning recommendation." },
      recommendEnableLearning: { type: "boolean", description: "True only if learning is disabled and enabling it would help." },
    },
    required: ["suggestions"],
  },
};
