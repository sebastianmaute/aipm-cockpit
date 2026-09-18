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
 *   · The KPI tile goes from the old catalogue default `w: 4` to `w: 2`, so it
 *     sits BESIDE burn on xl (§585) — but only when burn is moved (not hidden),
 *     and only from exactly 4: any other stored width is the user's choice and
 *     stays. Its height is kept.
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

/** The KPI tile's catalogue default before §585, and the width beside burn.
 *  Literals, like the 2×8 below, never a read of the catalogue. */
const KPI_OLD_DEFAULT_W = 4;
const KPI_BESIDE_BURN_W = 2;

/** §585: only the untouched old default narrows; a user-chosen width stays. */
function narrowKpi(p: PlacedTile): PlacedTile {
  return p.id === "kpi" && p.w === KPI_OLD_DEFAULT_W ? { ...p, w: KPI_BESIDE_BURN_W } : p;
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
    // tile narrows only alongside that move: with burn hidden there is nothing
    // for it to sit beside.
    board: burnHidden ? rest : [{ id: "burn", w: 2, h: 8 }, ...rest.map(narrowKpi)],
    upgrades: [...(layout.upgrades ?? []), DASHBOARD_BURN_UPGRADE],
  };
}
