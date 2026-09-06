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
export const DEFAULT_LAYOUT: DashboardLayout = defaultLayout(DASHBOARD_TILES);

export const moveTile = (l: DashboardLayout, dragId: DashboardTileId, targetId: DashboardTileId) =>
  moveBlock(l, dragId, targetId);
export const hideTile = (l: DashboardLayout, id: DashboardTileId) => hideBlock(l, id);
export const restoreTile = (l: DashboardLayout, id: DashboardTileId, index?: number) =>
  restoreBlock(DASHBOARD_TILES, l, id, index);
export const resizeTile = (l: DashboardLayout, id: DashboardTileId, axis: "w" | "h", value: number) =>
  resizeBlock(DASHBOARD_TILES, l, id, axis, value);
export const reconcile = (stored: DashboardLayout | null) =>
  reconcileWith(DASHBOARD_TILES, stored, DEFAULT_LAYOUT);
