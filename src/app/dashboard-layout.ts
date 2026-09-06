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
