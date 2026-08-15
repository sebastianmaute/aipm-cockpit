/**
 * The Dashboard tile catalogue — the single declaration of what tiles exist,
 * how big they are by default, and how far a user may resize each one.
 *
 * Pure and i18n-free: it carries i18n KEYS, never strings, so it stays
 * importable from a bare node process.
 *
 * ★★ `minH: 1` IS ALMOST ALWAYS WRONG. Tile chrome (grip, title, ⋮, bottom
 * border) costs a fixed ~26px off every tile regardless of height, so at the
 * 80px row unit a h:1 tile has roughly 54px of body. That fits a sparkline and
 * nothing else. A test pins the exceptions.
 */

// ★ TYPE-ONLY, and that is what keeps the "i18n-free" promise above true: the
// import is erased at compile time, so nothing here pulls the dictionaries into
// a bare node process. A VALUE import from `./i18n` would break that.
import type { TranslationKey } from "./i18n";

export type TileSpan = 1 | 2 | 3 | 4;

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

export function tileById(id: DashboardTileId): TileSpec | undefined {
  return DASHBOARD_TILES.find((t) => t.id === id);
}

/** The tiles that exist for this project, in catalogue order. */
export function liveTiles(gate: TileGateInput): readonly TileSpec[] {
  return DASHBOARD_TILES.filter((t) => t.gate(gate));
}
