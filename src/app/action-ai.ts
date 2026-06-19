// Pure, i18n-free contract for the Action Center "Analyze with AI" feature.
// Defines the analysis shape Claude returns (via a forced tool call) plus the
// transforms that build its context and ground its entity refs. No React, no
// fetch, no i18n.
import type { AppView } from "./nav-config";

export type AiActionSeverity = "now" | "soon" | "monitor";
const SEVERITIES: ReadonlySet<string> = new Set<AiActionSeverity>(["now", "soon", "monitor"]);

/** Views an AI action may deep-link to (entities we ground against real ids). */
export const GROUNDABLE_VIEWS = ["open-points", "raid", "milestones", "changes", "stakeholders"] as const;
export type GroundableView = (typeof GROUNDABLE_VIEWS)[number];
const GROUNDABLE_SET: ReadonlySet<string> = new Set(GROUNDABLE_VIEWS);

export const MAX_AI_ACTIONS = 8;

export interface AiAction {
  title: string;
  why: string;
  severity: AiActionSeverity;
  entity?: { view: GroundableView; id: string };
}

export interface ActionAnalysis {
  summary: string;
  actions: AiAction[];
}

function asEntity(raw: unknown): { view: GroundableView; id: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { view?: unknown; id?: unknown };
  if (typeof r.view !== "string" || !GROUNDABLE_SET.has(r.view)) return undefined;
  if (typeof r.id !== "string" && typeof r.id !== "number") return undefined;
  return { view: r.view as GroundableView, id: String(r.id) };
}

/** Validate + clamp the model's tool input. Returns null only when the overall
 *  shape is unusable; individual malformed actions are dropped, not fatal. */
export function parseAnalysis(input: unknown): ActionAnalysis | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as { summary?: unknown; actions?: unknown };
  if (typeof obj.summary !== "string" || !Array.isArray(obj.actions)) return null;
  const actions: AiAction[] = [];
  for (const raw of obj.actions) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as { title?: unknown; why?: unknown; severity?: unknown; entity?: unknown };
    const title = typeof a.title === "string" ? a.title.trim() : "";
    const why = typeof a.why === "string" ? a.why.trim() : "";
    if (!title || !why) continue;
    const severity = (typeof a.severity === "string" && SEVERITIES.has(a.severity) ? a.severity : "soon") as AiActionSeverity;
    actions.push({ title, why, severity, entity: asEntity(a.entity) });
    if (actions.length >= MAX_AI_ACTIONS) break;
  }
  return { summary: obj.summary.trim(), actions };
}

// AppView re-exported for surface convenience.
export type { AppView };
