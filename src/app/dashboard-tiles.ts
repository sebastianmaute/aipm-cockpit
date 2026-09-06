/**
 * The Dashboard tile catalogue — the single declaration of what tiles exist,
 * how big they are by default, and how far a user may resize each one.
 *
 * Pure and i18n-free: it carries i18n KEYS, never strings, so it stays
 * importable from a bare node process.
 *
 * ★★ `minH: 1` IS ALMOST ALWAYS WRONG. Tile chrome (grip, title, ⋮, bottom
 * border) costs a fixed amount off every tile regardless of height, so a h:1
 * tile fits a sparkline and nothing else. A test pins the exceptions.
 *
 * ★★ THAT FIXED COST IS 37px, NOT THE ~26px THIS DOCSTRING CLAIMED, and the
 * old figure made every h:1 estimate derived from it ~11px optimistic (it put
 * a h:1 body at the 80px unit near 54px; it is nearer 41px). Measured in
 * Chromium on 2026-08-15, not reasoned: the header row's own
 * `getBoundingClientRect().height` is 37 at every row unit and both densities,
 * and a h:2 tile at the 80px unit measures section 176 = chrome 37 + body 137 +
 * 2px section borders. Re-measure rather than trusting this line — the
 * `text-sm` title and `py-1` padding are what set it, so a chrome restyle
 * moves it.
 *
 * ★ A per-tile `h` default was CONSIDERED AND REJECTED as the fix for compact
 * density overflow: `kpi` and `milestones` both fit with zero overflow at h:3
 * even at a 64px unit, so raising their defaults would have solved it without
 * touching the row unit. It was rejected because these defaults are shared —
 * it would change the board for COMFORTABLE users to fix a COMPACT-only
 * problem. The row unit moved instead (`dashboard-density.ts`, which carries
 * the measurements). Revisit only if a per-density default ever exists.
 */

// ★ TYPE-ONLY, and that is what keeps the "i18n-free" promise above true: the
// import is erased at compile time, so nothing here pulls the dictionaries into
// a bare node process. A VALUE import from `./i18n` would break that.
import type { TranslationKey } from "./i18n";
import { specById, type BlockSpan } from "./arrangement-layout";

/** ★ AN ALIAS OF THE ENGINE'S `BlockSpan`, NOT A SECOND DECLARATION. The two
 *  were briefly independent spellings of the same closed union, which is how a
 *  widened engine and an un-widened catalogue could have disagreed in silence.
 *  The NAME stays because it has 20+ call sites across the Dashboard's own
 *  components — this is a rename-free collapse, not an export change. */
export type TileSpan = BlockSpan;

export type DashboardTileId =
  | "kpi" | "topActions" | "insights" | "raid" | "upcoming"
  | "progress" | "trends" | "burn" | "milestones" | "changes" | "completionTrend";

/** Which module flags must be on for a tile to exist for this project. */
export interface TileGateInput {
  showRaid: boolean;
  showBudget: boolean;
  showChanges: boolean;
  showMilestones: boolean;
  tursoActive: boolean;
  hasTopActions: boolean;
  hasInsights: boolean;
  hasCompletionTrend: boolean;
}

/** ★ Named TileSpec, NOT DashboardTile — `dashboard-tile.tsx` exports a COMPONENT
 *  called `DashboardTile`, and `dashboard-panel.tsx` imports both. Two different
 *  concepts must not share a name in this flat directory. */
export interface TileSpec {
  id: DashboardTileId;
  /**
   * i18n key for the tile's title in the chrome header.
   *
   * ★★ THIS IS `TranslationKey` (`i18n.ts` exports it as `keyof typeof enUS`),
   * tightened from `string` once the last four keys landed —
   * `dashboardKpiTile`, `dashboardInsights`, `dashboardRaidRegister`,
   * `dashboardTrends`. So `t(lang, spec.labelKey)` needs no cast and a typo is
   * a build error, which is the whole reason the catalogue holds keys rather
   * than strings. Do NOT widen it back to `string` to add a tile: add the key
   * to BOTH dicts first, or `tsc` is telling you the tile has no title.
   */
  labelKey: TranslationKey;
  w: TileSpan;
  h: TileSpan;
  minW: TileSpan;
  maxW: TileSpan;
  minH: TileSpan;
  maxH: TileSpan;
  /** True when this tile exists at all for the given project. */
  gate: (g: TileGateInput) => boolean;
}

const ALWAYS = () => true;

export const DASHBOARD_TILES: readonly TileSpec[] = [
  { id: "kpi",             labelKey: "dashboardKpiTile",        w: 4, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3, gate: ALWAYS },
  { id: "topActions",      labelKey: "dashboardTopActions",     w: 2, h: 3, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasTopActions },
  { id: "insights",        labelKey: "dashboardInsights",       w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasInsights },
  { id: "raid",            labelKey: "dashboardRaidRegister",   w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showRaid },
  { id: "upcoming",        labelKey: "dashboardUpcoming",       w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: ALWAYS },
  { id: "progress",        labelKey: "dashboardProgress",       w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 3, gate: ALWAYS },
  { id: "trends",          labelKey: "dashboardTrends",         w: 1, h: 2, minW: 1, maxW: 2, minH: 2, maxH: 3, gate: (g) => g.tursoActive },
  { id: "burn",            labelKey: "dashboardBudgetBurn",     w: 1, h: 2, minW: 1, maxW: 2, minH: 2, maxH: 3, gate: (g) => g.showBudget },
  { id: "milestones",      labelKey: "dashboardMilestones",     w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showMilestones },
  { id: "changes",         labelKey: "dashboardChangesHeading", w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showChanges },
  { id: "completionTrend", labelKey: "dashboardCompletionTrend", w: 2, h: 1, minW: 2, maxW: 4, minH: 1, maxH: 2, gate: (g) => g.hasCompletionTrend },
];

/** ★ DELEGATES to the engine's `specById` rather than re-implementing the find.
 *  The return type stays `TileSpec | undefined`, NOT `BlockSpec | undefined` —
 *  callers here read `spec.gate`, which the engine's spec deliberately lacks. */
export function tileById(id: DashboardTileId): TileSpec | undefined {
  return specById(DASHBOARD_TILES, id);
}
