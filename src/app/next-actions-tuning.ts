// src/app/next-actions-tuning.ts - pure, i18n-free contract for AI weight suggestions.
import { NEXT_ACTIONS_FIELD_COERCE, type NextActionsConfig } from "./settings-types";

export type TunableField = keyof NextActionsConfig;
export const WEIGHT_FIELDS: TunableField[] = ["clarityBonus", "semiClarityBonus", "staticPenalty"];
export const ALL_TUNABLE_FIELDS: TunableField[] = Object.keys(NEXT_ACTIONS_FIELD_COERCE) as TunableField[];

export type SuggestionScope = "weights" | "all";
export interface WeightSuggestion { field: TunableField; current: number; suggested: number; rationale: string; }

const MAX_SUGGESTIONS = ALL_TUNABLE_FIELDS.length;
const MAX_RATIONALE = 240;
const CONTROL_CHARS = /[\x00-\x1f]/g; // strip ASCII control chars from untrusted rationale

function allowedFields(scope: SuggestionScope): Set<TunableField> {
  return new Set(scope === "all" ? ALL_TUNABLE_FIELDS : WEIGHT_FIELDS);
}

/** Validate + clamp untrusted model output. Never throws. Clamps each suggested value
 *  through the SAME per-field coercer the config uses, drops no-ops + out-of-scope/unknown
 *  fields, sanitizes rationale, caps the list. */
export function parseWeightSuggestions(input: unknown, current: NextActionsConfig, scope: SuggestionScope): WeightSuggestion[] {
  if (!input || typeof input !== "object") return [];
  const arr = (input as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(arr)) return [];
  const allow = allowedFields(scope);
  const seen = new Set<TunableField>();
  const out: WeightSuggestion[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { field?: unknown; suggested?: unknown; rationale?: unknown };
    if (typeof r.field !== "string" || !allow.has(r.field as TunableField)) continue;
    const field = r.field as TunableField;
    if (seen.has(field)) continue;
    if (typeof r.suggested !== "number" && typeof r.suggested !== "string") continue;
    const cur = current[field];
    const clamped = NEXT_ACTIONS_FIELD_COERCE[field](r.suggested, cur);
    if (clamped === cur) continue;
    const rationale = (typeof r.rationale === "string" ? r.rationale : "").replace(CONTROL_CHARS, " ").trim().slice(0, MAX_RATIONALE);
    out.push({ field, current: cur, suggested: clamped, rationale });
    seen.add(field);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Pure: new config with the one field set to the suggested value. */
export function applyWeightSuggestion(config: NextActionsConfig, s: WeightSuggestion): NextActionsConfig {
  return { ...config, [s.field]: s.suggested };
}
