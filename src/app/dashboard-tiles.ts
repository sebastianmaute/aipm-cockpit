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
 * ★ `kpi` DID later move to h:3, for a different reason (§585): at half width
 * on xl its cells wrap to a second row in BOTH densities, and h:3 is what keeps
 * that row out of an inner scroll. `milestones` stays h:2.
 * ★★ `kpi`'s height is no longer FIXED. The §585 fix round pinned it
 * (`minH === maxH`) because a stored or chosen h:2 put the wrapped second row
 * of cells behind an inner scroll. The Dashboard now MEASURES every tile whose
 * height the user has not chosen (`use-measured-heights.ts`), so the strip gets
 * the rows its cells actually need at the current width — the pin was a proxy
 * for that measurement, taken at one viewport, and every wider screen paid for
 * it. The range is therefore a real range again: a user may choose a height,
 * and a chosen height is kept as chosen. The h:3 default above is now only what
 * renders before (or without) a measurement.
 */

// ★ TYPE-ONLY, and that is what keeps the "i18n-free" promise above true: the
// import is erased at compile time, so nothing here pulls the dictionaries into
// a bare node process. A VALUE import from `./i18n` would break that.
import type { TranslationKey } from "./i18n";
import { specById, type BlockHeight, type BlockWidth } from "./arrangement-layout";

/** ★ ALIASES OF THE ENGINE'S `BlockWidth` / `BlockHeight`, NOT SECOND
 *  DECLARATIONS. Two independent spellings of one union are how a widened
 *  engine and an un-widened catalogue could disagree in silence. Spec C split
 *  the former single `TileSpan` in two so an 8-wide tile cannot type-check. */
export type TileWidth = BlockWidth;
export type TileHeight = BlockHeight;

export type DashboardTileId =
  | "kpi" | "topActions" | "insights" | "raid" | "upcoming"
  | "trends" | "burn" | "milestones" | "changes" | "completionTrend";

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
  /** Optional i18n key for an info tooltip beside the title, saying what the
   *  tile shows. Same KEY-not-string rule as `labelKey`. */
  hintKey?: TranslationKey;
  w: TileWidth;
  h: TileHeight;
  minW: TileWidth;
  maxW: TileWidth;
  minH: TileHeight;
  maxH: TileHeight;
  /** True when this tile exists at all for the given project. */
  gate: (g: TileGateInput) => boolean;
}

const ALWAYS = () => true;

// ★★ `burn` IS FIRST, AND ORDER HERE IS `DEFAULT_LAYOUT`'S ORDER (spec C
// decision 7): the chart-only Budget burn tile leads a fresh board at 2 wide ×
// 8 tall. Moving it here does NOT move it for users who already have a stored
// layout — `reconcile` never reorders an existing tile — which is why
// `dashboard-layout-upgrade.ts` exists.
// ★★ `kpi` IS 2×3 SO IT SITS BESIDE `burn` ON xl (§585). The xl grid is four
// columns with `grid-flow-row-dense`, so a 2-wide KPI tile packs into columns
// 3–4 of burn's first rows; at its former w:4 it could not fit there and landed
// below all of burn's rows. At half width its cells wrap to a second row.
// ★ h:3 is now only the height rendered BEFORE a measurement (and when none
// can be taken). What keeps the wrapped row inside the tile body is the
// measured height (`use-measured-heights.ts`), checked by
// `e2e/dashboard-grid.spec.ts` in both densities. The upgrade resizes a stored
// 4×2 to match.
export const DASHBOARD_TILES: readonly TileSpec[] = [
  { id: "burn",            labelKey: "dashboardBudgetBurn",     w: 2, h: 8, minW: 1, maxW: 4, minH: 4, maxH: 8, gate: (g) => g.showBudget },
  { id: "kpi",             labelKey: "dashboardKpiTile",        w: 2, h: 3, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: ALWAYS },
  { id: "topActions",      labelKey: "dashboardTopActions",     w: 2, h: 3, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasTopActions },
  { id: "insights",        labelKey: "dashboardInsights",       w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasInsights },
  { id: "raid",            labelKey: "dashboardRaidRegister",   w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showRaid },
  { id: "upcoming",        labelKey: "dashboardUpcoming",       w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: ALWAYS },
  { id: "trends",          labelKey: "dashboardTrends",         w: 1, h: 2, minW: 1, maxW: 2, minH: 2, maxH: 3, gate: (g) => g.tursoActive },
  { id: "milestones",      labelKey: "dashboardMilestones",     w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showMilestones },
  { id: "changes",         labelKey: "dashboardChangesHeading", w: 2, h: 2, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.showChanges },
  { id: "completionTrend", labelKey: "dashboardCompletionTrend", hintKey: "dashboardCompletionTrendHint", w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.hasCompletionTrend },
];

/** ★ DELEGATES to the engine's `specById` rather than re-implementing the find.
 *  The return type stays `TileSpec | undefined`, NOT `BlockSpec | undefined` —
 *  callers here read `spec.gate`, which the engine's spec deliberately lacks. */
export function tileById(id: DashboardTileId): TileSpec | undefined {
  return specById(DASHBOARD_TILES, id);
}
