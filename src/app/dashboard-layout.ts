/**
 * The Dashboard's binding of the shared arrangement engine.
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT AN ENGINE. Every landmine that used to live
 * here now lives in `arrangement-layout.ts` — read it there before changing
 * anything. What stays here is exactly the Dashboard-specific binding: the
 * catalogue, and ONE memoized default so `reconcile(null)` and `reset()` keep
 * returning the SAME OBJECT, which the mutators' no-op contract relies on.
 *
 * ★ The exported names are UNCHANGED on purpose — `dashboard-panel.tsx`,
 * `use-dashboard-layout.ts`, `dashboard-layout-store.ts` and the Dashboard's
 * own tests all keep compiling and passing untouched. If a Dashboard test needs
 * editing to accommodate a change here, the change is wrong.
 */
import {
  defaultLayout, moveBlock, hideBlock, restoreBlock, resizeBlock,
  reconcile as reconcileWith,
  type ArrangementLayout, type PlacedBlock,
} from "./arrangement-layout";
import { DASHBOARD_TILES, type DashboardTileId } from "./dashboard-tiles";

export type PlacedTile = PlacedBlock<DashboardTileId>;
export type DashboardLayout = ArrangementLayout<DashboardTileId>;

/** Every tile on the board, in catalogue order, at its default size.
 *
 *  ★ ONE instance, module-level. A factory called per use would break the
 *  reference identity that `reconcile(null)` and `reset()` both depend on. */
/** The Dashboard's one stored-layout upgrade id (spec C decision 11): Budget
 *  burn to the front at 2×8, Completion trend's height into 2–4. */
export const DASHBOARD_BURN_UPGRADE = "dashboard-burn-2x8";

/** Removes the retired Progress tile from stored layouts (its content moved into At a glance).
 *  ★ NOT added to DEFAULT_LAYOUT.upgrades: the step records its id only when it removed something.
 *  ★★ `"progress"` is not in `DASHBOARD_TILES`, so a fresh or reset board (`DEFAULT_LAYOUT`, built
 *  from that catalogue) never contains it and the step hands it back by reference. Pinned through the
 *  COMPOSED `upgradeDashboardLayout` in `dashboard-layout-upgrade.test.ts`'s "already carries the
 *  upgrade id" test. */
export const DASHBOARD_PROGRESS_REMOVAL_UPGRADE = "dashboard-progress-into-kpi";

// ★★★ THE DEFAULT CARRIES THE UPGRADE ID, AND MUST. A fresh board and a Reset
// layout both persist THIS object; without the id they would be upgraded again
// on the next load, dragging burn back to the front of a board the user has
// since rearranged. Still ONE module-level instance (see above).
// ★ Completion trend starts in the hidden tray: its line is reconstructed from
// the activity log and easy to misread, so it is opt-in (its header tooltip says
// what it shows). This is the DEFAULT only — a fresh or reset board. A stored
// layout keeps the tile wherever the user left it; there is no upgrade step.
const DEFAULT_HIDDEN: readonly DashboardTileId[] = ["completionTrend"];
const catalogueDefault = defaultLayout(DASHBOARD_TILES);
export const DEFAULT_LAYOUT: DashboardLayout = {
  ...catalogueDefault,
  board: catalogueDefault.board.filter((p) => !DEFAULT_HIDDEN.includes(p.id)),
  hidden: [...DEFAULT_HIDDEN],
  upgrades: [DASHBOARD_BURN_UPGRADE],
};

/* ★ THE RETURN TYPES ARE ANNOTATED, NOT INFERRED, AND THAT IS THE POINT OF THE
 * ADAPTER. These five are the Dashboard's whole public layout API. Left to
 * inference, a change to an engine return type would propagate straight into
 * the published type and typecheck all the way out to `dashboard-panel.tsx`;
 * annotated, it errors HERE — at the seam that exists to absorb it. */
export const moveTile = (
  l: DashboardLayout, dragId: DashboardTileId, targetId: DashboardTileId,
): DashboardLayout => moveBlock(l, dragId, targetId);
export const hideTile = (l: DashboardLayout, id: DashboardTileId): DashboardLayout =>
  hideBlock(l, id);
export const restoreTile = (
  l: DashboardLayout, id: DashboardTileId, index?: number,
): DashboardLayout => restoreBlock(DASHBOARD_TILES, l, id, index);
export const resizeTile = (
  l: DashboardLayout, id: DashboardTileId, axis: "w" | "h", value: number,
): DashboardLayout => resizeBlock(DASHBOARD_TILES, l, id, axis, value);
export const reconcile = (stored: DashboardLayout | null): DashboardLayout =>
  reconcileWith(DASHBOARD_TILES, stored, DEFAULT_LAYOUT);
