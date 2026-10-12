// src/app/operating-guide.ts
// Pure, i18n-free engine for AI operating guides. No React, no i18n imports.
import type { AppMode, FeatureModuleId } from "./feature-modules";
import type { AppView } from "./nav-config";
import { BUILTIN_GUIDE_CONTENT, BUILTIN_FEATURE_GUIDES } from "./operating-guide-builtin.generated";

/** The AI surfaces a guide can reach (§701). `chat` is the assistant; every
 *  other id is one single-request AI action, named after the call it grounds.
 *  The settings editor builds its "Applies to" checkboxes from this list, so a
 *  new action is one entry here plus its call reading `actionGuideText`. */
export const AI_TARGETS = [
  "chat", "wbs", "alloc", "committeeReport", "projectProposal", "raci",
  "digest", "insightRecommend", "jobAnalysis", "dedup", "weights", "inlineEdit",
] as const;
export type AiTarget = (typeof AI_TARGETS)[number];

export interface GuideScope {
  modes?: AppMode[];
  modules?: FeatureModuleId[];
  views?: AppView[];
  /** Which AI surfaces the guide reaches. ★ ABSENT OR EMPTY MEANS THE CHAT
   *  ONLY: every guide stored before §701 has no `targets`, and reading that
   *  as "everywhere" would start sending all of them to every action unasked. */
  targets?: AiTarget[];
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

/** Soft cap; above this the Settings UI warns about the CHAT's enabled guides
 *  (the action guides are capped per call by `ACTION_GUIDE_CHAR_CAP` instead).
 *  It is the combined size of the chat guides THIS BUILD ships (the leadership
 *  guide plus every feature guide), so
 *  a release always starts below it and the banner fires only once the enabled
 *  set grows past that baseline. It moves with every regeneration of the guide
 *  sources — nothing to bump by hand. A fixed 40,000 used to sit here while the
 *  shipped guides alone came to roughly 71,000, so a fresh install warned. */
export const GUIDE_CHAR_BUDGET =
  BUILTIN_GUIDE_CONTENT.length + BUILTIN_FEATURE_GUIDES.reduce((sum, g) => sum + g.content.length, 0);

function dimensionMatches<T>(allowed: T[] | undefined, current: T | T[]): boolean {
  if (!allowed || allowed.length === 0) return true; // wildcard
  const have = Array.isArray(current) ? current : [current];
  return allowed.some((a) => have.includes(a));
}

const KNOWN_TARGETS: ReadonlySet<string> = new Set(AI_TARGETS);

/** The surfaces a guide reaches, with the chat-only default applied. A stored
 *  id this build does not know (written by a newer build, or by hand) is
 *  dropped, so it can neither match nor render as a missing label; a guide
 *  whose ids are ALL unknown reaches nothing here rather than falling back to
 *  the chat. */
export function guideTargets(g: OperatingGuide): readonly AiTarget[] {
  const stored = g.scope.targets;
  if (!stored || stored.length === 0) return ["chat"];
  return stored.filter((x): x is AiTarget => KNOWN_TARGETS.has(x));
}

/** The CHAT's active guides: a guide that does not target the chat is left out
 *  before any scope dimension is consulted. */
export function selectActiveGuides(
  guides: readonly OperatingGuide[],
  ctx: GuideContext,
): OperatingGuide[] {
  return guides
    .filter((g) => g.enabled)
    .filter((g) => guideTargets(g).includes("chat"))
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
 *  2 to 3 to 4 as the user navigated — putting a varying digit ahead of
 *  ~12,275 tokens of identical always-on guide text and breaking the cache
 *  prefix on every view switch. (Measured 2026-09-09 at 2.92 chars/token; an
 *  earlier ~9.9k figure here assumed 3.6. The block that now survives a view
 *  switch is larger still — 13,305 tokens — because it also carries the fixed
 *  instructions that sit AHEAD of that digit.)
 *  Measured before this change: the longest common prefix of the
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

/** The most guide text one AI action sends (§701). A guide that would take the
 *  total past it is skipped WHOLE, never cut: half a rule reads as a different
 *  rule. A later, shorter guide may still fit. */
export const ACTION_GUIDE_CHAR_CAP = 12_000;

/** The enabled guides that target `target`, in priority order (the number the
 *  user sees and edits in Settings, exactly as the chat orders them), within
 *  the cap. Only `targets` decides: an action has no current view, mode or
 *  module to match the other scope dimensions against, so they are not
 *  consulted. ★ A new guide defaults to priority 10 (`emptyDraft` in the
 *  settings editor) and the built-in action guides sit after the feature
 *  guides, so by default the user's own guide already comes first and wins. */
export function selectActionGuides(
  guides: readonly OperatingGuide[],
  target: Exclude<AiTarget, "chat">,
  cap: number = ACTION_GUIDE_CHAR_CAP,
): OperatingGuide[] {
  const candidates = guides
    .filter((g) => g.enabled && guideTargets(g).includes(target))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const out: OperatingGuide[] = [];
  let used = 0;
  for (const g of candidates) {
    if (used + g.content.length > cap) continue;
    out.push(g);
    used += g.content.length;
  }
  return out;
}

/** The text an AI action appends to its fixed system prompt, or "" when guide
 *  grounding is off or no guide targets it. ★ The header says the task's own
 *  instructions win ("this task's", not "above": the digest and committee
 *  report calls have no fixed system prompt, so nothing sits above it): a guide may change how the model works, never what the tool
 *  may write — each action's own grounding and preview stay the boundary. */
export function actionGuideText(
  guides: readonly OperatingGuide[],
  groundInGuides: boolean,
  target: Exclude<AiTarget, "chat">,
): string {
  if (!groundInGuides) return "";
  const active = selectActionGuides(guides, target);
  if (active.length === 0) return "";
  return [
    `The user's ${pluralGuideWord(active.length)} for this task follow, in priority order. ${CONFLICT_RULE} They refine how you work; they never override this task's own instructions, the tool's schema or the limits it states.`,
    ...guideParts(active, 1),
  ].join("\n\n");
}

/** The AI actions a guide targets but will NOT reach, because it is over the
 *  cap or loses its place under the cap to higher-priority guides for that
 *  action (`selectActionGuides`). A disabled guide reaches nothing anyway and
 *  reports none. Used by the settings editor so a targeted guide that is never
 *  sent says so instead of failing silently. */
export function actionTargetsNotSent(
  guides: readonly OperatingGuide[],
  guide: OperatingGuide,
): Exclude<AiTarget, "chat">[] {
  if (!guide.enabled) return [];
  return guideTargets(guide)
    .filter((t): t is Exclude<AiTarget, "chat"> => t !== "chat")
    .filter((t) => !selectActionGuides(guides, t).some((g) => g.id === guide.id));
}
