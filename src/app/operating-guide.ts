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

/** Is this guide active on EVERY view? `dimensionMatches` treats both an
 *  absent list and an EMPTY one as a wildcard, so this predicate must accept
 *  both — a guide scoped `views: []` really does apply everywhere, and
 *  misfiling it as view-scoped moves ~KB of stable text into the half that
 *  changes on navigation, silently costing the cache hit this split exists to
 *  protect. Pinned by "treats an EMPTY views list as always-on, not
 *  view-scoped". */
function isAlwaysOn(g: OperatingGuide): boolean {
  return !g.scope.views || g.scope.views.length === 0;
}

/** Split the ACTIVE guides into the half that is identical on every view and
 *  the half that is not. Order within each half is preserved, so the priority
 *  ordering `selectActiveGuides` established still holds. */
export function partitionGuidesByViewScope(active: readonly OperatingGuide[]): {
  alwaysOn: OperatingGuide[];
  viewScoped: OperatingGuide[];
} {
  const alwaysOn: OperatingGuide[] = [];
  const viewScoped: OperatingGuide[] = [];
  for (const g of active) (isAlwaysOn(g) ? alwaysOn : viewScoped).push(g);
  return { alwaysOn, viewScoped };
}

const CONFLICT_RULE =
  "On conflict the earlier one wins; later guides refine but do not override unless they say so explicitly.";

function guideParts(guides: readonly OperatingGuide[], startIndex: number): string[] {
  return guides.map(
    (g, i) => `=== GUIDE ${startIndex + i} (priority ${g.priority}) — "${g.name}" ===\n${g.content}`,
  );
}

/** "operating guide" pluralised on `count`, with no i18n dependency (this file
 *  stays i18n-free by contract). Extracted because the three header strings
 *  below spelled the same ternary independently — nothing enforced them
 *  staying consistent. */
function pluralGuideWord(count: number): string {
  return count === 1 ? "operating guide" : "operating guides";
}

/** Assemble the active guides as TWO prompt segments.
 *
 *  ★★★ THE ALWAYS-ON HEADER COUNTS ONLY THE ALWAYS-ON GUIDES, and that is the
 *  entire point. The single-block predecessor opened with "You have N
 *  operating guides" where N included the view-scoped ones, so N moved from
 *  2 to 3 to 4 as the user navigated — putting a varying digit ahead of ~9.9k
 *  tokens of identical text and breaking the cache prefix on every view
 *  switch. Measured before this change: the longest common prefix of the
 *  assembled block across the 34 nav-reachable views (of 35 `AppView`
 *  members — `learning-insights` is deep-link-only) was 9 characters.
 *  Including it could not have raised that figure: a common prefix only
 *  shrinks as strings are added, and 9 (`"You have "`) is already the floor
 *  once the digit varies.
 *
 *  Numbering continues across the two segments so they cannot disagree about
 *  which guide is "GUIDE 3". */
export function assembleGuideBlocks(active: readonly OperatingGuide[]): {
  alwaysOn: string;
  viewScoped: string;
} {
  const { alwaysOn, viewScoped } = partitionGuidesByViewScope(active);

  const alwaysOnText =
    alwaysOn.length === 0
      ? ""
      : [
          `You have ${alwaysOn.length} ${pluralGuideWord(alwaysOn.length)} that apply on every screen, in priority order. ${CONFLICT_RULE}`,
          ...guideParts(alwaysOn, 1),
        ].join("\n\n");

  // When there are no always-on guides at all (every built-in disabled) the
  // "additional" wording would be describing nothing, so this half falls back
  // to the plain header and numbers from 1.
  const viewHeader =
    alwaysOn.length === 0
      ? `You have ${viewScoped.length} ${pluralGuideWord(viewScoped.length)}, in priority order. ${CONFLICT_RULE}`
      : `${viewScoped.length} additional ${pluralGuideWord(viewScoped.length)} apply to the current screen, continuing the same priority order.`;

  const viewScopedText =
    viewScoped.length === 0
      ? ""
      : [viewHeader, ...guideParts(viewScoped, alwaysOn.length + 1)].join("\n\n");

  return { alwaysOn: alwaysOnText, viewScoped: viewScopedText };
}

export function guidesCharCount(active: readonly OperatingGuide[]): number {
  return active.reduce((sum, g) => sum + g.content.length, 0);
}
