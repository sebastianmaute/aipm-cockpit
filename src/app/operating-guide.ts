// src/app/operating-guide.ts
// Pure, i18n-free engine for AI operating guides. No React, no i18n imports.
import type { AppMode, FeatureModuleId } from "./feature-modules";
import type { AppView } from "./nav-config";

export interface GuideScope {
  modes?: AppMode[];
  modules?: FeatureModuleId[];
  views?: AppView[];
}

export interface OperatingGuide {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  priority: number; // lower = higher precedence, injected first
  scope: GuideScope;
  builtIn: boolean;
}

export interface GuideContext {
  mode: AppMode;
  modules: FeatureModuleId[];
  view: AppView;
}

/** Soft cap; above this the Settings UI warns. ~10k tokens. */
export const GUIDE_CHAR_BUDGET = 40_000;

function dimensionMatches<T>(allowed: T[] | undefined, current: T | T[]): boolean {
  if (!allowed || allowed.length === 0) return true; // wildcard
  const have = Array.isArray(current) ? current : [current];
  return allowed.some((a) => have.includes(a));
}

export function selectActiveGuides(
  guides: readonly OperatingGuide[],
  ctx: GuideContext,
): OperatingGuide[] {
  return guides
    .filter((g) => g.enabled)
    .filter((g) => dimensionMatches(g.scope.modes, ctx.mode))
    .filter((g) => dimensionMatches(g.scope.modules, ctx.modules))
    .filter((g) => dimensionMatches(g.scope.views, ctx.view))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function assembleGuideBlock(active: readonly OperatingGuide[]): string {
  if (active.length === 0) return "";
  const header = [
    `You have ${active.length} operating guide${active.length === 1 ? "" : "s"}, in priority order.`,
    "On conflict the earlier one wins; later guides refine but do not override unless they say so explicitly.",
  ].join(" ");
  const parts = active.map(
    (g, i) => `=== GUIDE ${i + 1} (priority ${g.priority}) — "${g.name}" ===\n${g.content}`,
  );
  return [header, ...parts].join("\n\n");
}

export function guidesCharCount(active: readonly OperatingGuide[]): number {
  return active.reduce((sum, g) => sum + g.content.length, 0);
}
