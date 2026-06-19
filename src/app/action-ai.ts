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

export const CONTEXT_CAP_PER_CATEGORY = 30;

export interface AnalysisContextInput {
  projectName: string;
  today: string;
  mode: string;
  enabledModules: readonly string[];
  taskCount: number;
  tasks: readonly { id: number; title: string }[];
  raid: readonly { id: number; title: string }[];
  milestones: readonly { id: number; title: string }[];
  changes: readonly { id: number; title: string }[];
  stakeholders: readonly { id: number; name: string }[];
  queue: readonly { title: string; why: string; tier: "now" | "soon" | "monitor" }[];
}

function capList(view: GroundableView, rows: readonly { id: number; title?: string; name?: string }[]): string {
  const shown = rows.slice(0, CONTEXT_CAP_PER_CATEGORY);
  const lines = shown.map((r) => `- ${view}#${r.id}: ${(r.title ?? r.name ?? "").slice(0, 120)}`);
  if (rows.length > CONTEXT_CAP_PER_CATEGORY) lines.push(`- …(${rows.length - CONTEXT_CAP_PER_CATEGORY} more truncated)`);
  return lines.join("\n");
}

/** Compact, token-bounded workspace digest + the current deterministic queue.
 *  Volatile data — sent as the user message, never in the cached system block. */
export function buildAnalysisContext(input: AnalysisContextInput): string {
  const queue = input.queue.length
    ? input.queue.map((q) => `- [${q.tier}] ${q.title} — ${q.why}`).join("\n")
    : "(none)";
  return [
    `Project: ${input.projectName}. Today: ${input.today}. Mode: ${input.mode}.`,
    `Enabled modules: ${input.enabledModules.join(", ") || "(none)"}. Open task count: ${input.taskCount}.`,
    `Entities are listed as "view#id: title"; reference an entity only by an id shown here. Lists are capped at ${CONTEXT_CAP_PER_CATEGORY} per category.`,
    "",
    "## Open tasks", capList("open-points", input.tasks),
    "## Active RAID", capList("raid", input.raid),
    "## Upcoming milestones", capList("milestones", input.milestones),
    "## Pending changes", capList("changes", input.changes),
    "## Stakeholders", capList("stakeholders", input.stakeholders),
    "",
    "## Current rule-based action queue", queue,
  ].join("\n");
}

/** Stable, cacheable system prompt. Senior-PM framing consistent with SP0. */
export function buildAnalysisSystemPrompt(): string {
  return [
    "You are a senior project manager assisting with a project tracker.",
    "You are given a digest of the project's open work and the queue of actions the app's rules already surfaced.",
    "Call the report_analysis tool exactly once. In `summary`, briefly triage what the user should focus on now, reasoning over the existing queue (do not just repeat it).",
    "In `actions`, propose only NET-NEW, cross-cutting suggestions the rules cannot derive (root-cause links, sequencing, risks spanning entities). Do not duplicate the existing queue.",
    "Set an action's `entity` only to a view#id pair that appears in the digest; omit `entity` if you cannot ground it. Keep every title and why short (one line each).",
  ].join(" ");
}

export interface GroundingIndex {
  "open-points": ReadonlySet<number>;
  raid: ReadonlySet<number>;
  milestones: ReadonlySet<number>;
  changes: ReadonlySet<number>;
  stakeholders: ReadonlySet<number>;
}

export function buildGroundingIndex(ws: {
  tasks: readonly { id: number }[];
  raid: readonly { id: number }[];
  milestones: readonly { id: number }[];
  changes: readonly { id: number }[];
  stakeholders: readonly { id: number }[];
}): GroundingIndex {
  const ids = (rows: readonly { id: number }[]) => new Set(rows.map((r) => r.id));
  return {
    "open-points": ids(ws.tasks), raid: ids(ws.raid), milestones: ids(ws.milestones),
    changes: ids(ws.changes), stakeholders: ids(ws.stakeholders),
  };
}

/** Re-validate a model entity ref against the live workspace. Returns a numeric
 *  deep-link target, or null (→ surface falls back to Discuss-in-chat). */
export function groundEntity(
  entity: { view: GroundableView; id: string } | undefined,
  index: GroundingIndex,
): { view: GroundableView; id: number } | null {
  if (!entity) return null;
  const n = Number(entity.id);
  if (!Number.isInteger(n)) return null;
  const set = index[entity.view];
  if (!set || !set.has(n)) return null;
  return { view: entity.view, id: n };
}

// AppView re-exported for surface convenience.
export type { AppView };
