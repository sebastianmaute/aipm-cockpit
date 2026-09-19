/**
 * The Dashboard's one-time stored-layout upgrade — spec C decision 11. Pure,
 * i18n-free, DOM-free.
 *
 * Runs through `useArrangement`'s `upgrade` option on every read that found a
 * stored layout, BEFORE `reconcile`, and is keyed on `DASHBOARD_BURN_UPGRADE`
 * in the layout's `upgrades` list:
 *   · Budget burn moves to the FRONT of the board at 2×8 — unless the user has
 *     hidden it: a hidden tile stays hidden, and restoring it later gives it the
 *     catalogue default, which is 2×8 anyway.
 *   · Completion trend's height is clamped into its new 2–4.
 *   · The KPI tile goes from the old catalogue default 4×2 to 2×3, so it sits
 *     BESIDE burn on xl (§585) and its cells, which wrap to a second row at
 *     half width, stay inside the tile body — but only when burn is moved (not
 *     hidden), and each axis only from exactly its old default (`w: 4`,
 *     `h: 2`): any other stored width or height is the user's choice and stays.
 *   · Every other tile keeps its order, size and hidden state.
 * The id is then recorded, so it never runs again.
 *
 * ★★★ IT RETURNS ITS INPUT BY REFERENCE WHEN THE ID IS ALREADY RECORDED. That
 * is the hook's signal that nothing needs writing; a copy would rewrite storage
 * on every load (`use-arrangement.ts`, the `upgrade` option).
 * ★★ WHY A SEPARATE STEP, not a catalogue edit: `reconcile` never reorders or
 * resizes a tile the stored layout already holds, so moving `burn` first in
 * `DASHBOARD_TILES` changes a FRESH board only.
 * ★ Accepted cost (spec): an older build's `reconcile` drops the `upgrades`
 * list, so a layout it rewrites is upgraded once more, moving burn back to the
 * front.
 */
import { isArrangementLayout } from "./arrangement-store";
import {
  DASHBOARD_BURN_UPGRADE, DEFAULT_LAYOUT,
  type DashboardLayout, type PlacedTile,
} from "./dashboard-layout";
import type { TileHeight } from "./dashboard-tiles";

/** Completion trend's height bounds after spec C decision 9. */
const TREND_MIN_H = 2;
const TREND_MAX_H = 4;

function clampTrendHeight(h: number): TileHeight {
  return Math.max(TREND_MIN_H, Math.min(TREND_MAX_H, Math.round(h))) as TileHeight;
}

/** The KPI tile's catalogue default before §585 (4×2), and its size beside
 *  burn (2×3). Literals, like the 2×8 below, never a read of the catalogue. */
const KPI_OLD_DEFAULT_W = 4;
const KPI_BESIDE_BURN_W = 2;
const KPI_OLD_DEFAULT_H = 2;
const KPI_BESIDE_BURN_H = 3;

/** §585: each axis moves only from its untouched old default; a user-chosen
 *  width or height stays. The two axes are judged independently. */
function resizeKpi(p: PlacedTile): PlacedTile {
  if (p.id !== "kpi") return p;
  return {
    ...p,
    w: p.w === KPI_OLD_DEFAULT_W ? KPI_BESIDE_BURN_W : p.w,
    h: p.h === KPI_OLD_DEFAULT_H ? KPI_BESIDE_BURN_H : p.h,
  };
}

/**
 * ★ Takes `unknown`, not a layout: junk falls back to `DEFAULT_LAYOUT` (by
 * reference). Through the hook it only ever sees a validated, sanitised layout
 * — `readArrangement` applied `isArrangementLayout` first — so that branch is
 * for direct callers.
 */
export function upgradeDashboardLayout(stored: unknown): DashboardLayout {
  if (!isArrangementLayout(stored)) return DEFAULT_LAYOUT;
  // Membership is `reconcile`'s job: an unknown id rides through untouched and
  // is dropped there, exactly as for any other stored layout.
  const layout = stored as DashboardLayout;
  if (layout.upgrades?.includes(DASHBOARD_BURN_UPGRADE)) return layout;

  const rest: PlacedTile[] = layout.board
    .filter((p) => p.id !== "burn")
    .map((p) => (p.id === "completionTrend" ? { ...p, h: clampTrendHeight(p.h) } : p));
  const burnHidden = layout.hidden.includes("burn");
  return {
    ...layout,
    // The literal 2×8 the id names, never a read of the catalogue. The KPI
    // tile is resized only alongside that move: with burn hidden there is
    // nothing for it to sit beside.
    board: burnHidden ? rest : [{ id: "burn", w: 2, h: 8 }, ...rest.map(resizeKpi)],
    upgrades: [...(layout.upgrades ?? []), DASHBOARD_BURN_UPGRADE],
  };
}
