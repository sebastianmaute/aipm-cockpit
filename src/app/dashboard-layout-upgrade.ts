/**
 * The Dashboard's stored-layout upgrade — spec C decision 11. Pure, i18n-free,
 * DOM-free.
 *
 * `upgradeDashboardLayout` runs through `useArrangement`'s `upgrade` option on
 * every read that found a stored layout, BEFORE `reconcile`. It is a composer
 * over independently gated STEPS, each keyed on its own id in the layout's
 * `upgrades` list — a step that finds its id already recorded returns its
 * input untouched, so adding a step never re-runs an earlier one and never
 * skips a later one for a layout that already has an earlier id.
 *
 * `burnUpgradeStep` (`DASHBOARD_BURN_UPGRADE`):
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
 *
 * `progressRemovalStep` (`DASHBOARD_PROGRESS_REMOVAL_UPGRADE`): gated on its
 * own id, same as the burn step. When the id is not yet recorded, it drops the
 * retired Progress tile from `board` and `hidden` and records the id only when
 * it actually removed something — a layout that never held `progress` is
 * returned by reference, unchanged, without recording anything.
 *
 * ★★ THE ID GATE WAS LOAD-BEARING WHILE `"progress"` WAS STILL IN THE
 * CATALOGUE. `reconcile` (which runs AFTER this composer, on every load)
 * re-inserts any catalogue tile absent from both `board` and `hidden`, so a
 * step gated only on presence would have removed `progress` on every load and
 * had it put straight back: a re-dirty loop, one more id appended each time.
 * With `progress` gone from `DASHBOARD_TILES`, `reconcile` no longer
 * re-inserts it and a presence check alone would terminate; the id gate stays
 * so this step is gated exactly as the burn step is, and so a layout that
 * recorded it is never re-examined. The load-path round trip is pinned in
 * `use-dashboard-layout.test.tsx`.
 * ★★ THE FILTER DUPLICATES `reconcile`, which drops an id with no catalogue
 * spec from `board` and `hidden` anyway. What this step is load-bearing for is
 * returning a NEW reference: `useArrangement` writes the reconciled layout back
 * only for a read `upgrade` changed, so without the step a layout that already
 * carries the burn id would keep `progress` in storage for good.
 * ★★★ EACH STEP RETURNS ITS INPUT BY REFERENCE WHEN ITS OWN ID IS ALREADY
 * RECORDED. That is the hook's signal that nothing needs writing; a copy
 * would rewrite storage on every load (`use-arrangement.ts`, the `upgrade`
 * option).
 * ★★ WHY A SEPARATE STEP, not a catalogue edit: `reconcile` never reorders or
 * resizes a tile the stored layout already holds, so moving `burn` first in
 * `DASHBOARD_TILES` changes a FRESH board only.
 * ★ Accepted cost (spec): an older build's `reconcile` drops the `upgrades`
 * list, so a layout it rewrites is upgraded once more, moving burn back to the
 * front.
 */
import { isArrangementLayout } from "./arrangement-store";
import {
  DASHBOARD_BURN_UPGRADE, DASHBOARD_PROGRESS_REMOVAL_UPGRADE, DEFAULT_LAYOUT,
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

export function burnUpgradeStep(layout: DashboardLayout): DashboardLayout {
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

/** Retired ids are compared as strings — `"progress"` is no longer in the
 *  `DashboardTileId` union, so comparing a tile's `id` to it directly does
 *  not typecheck. */
export function progressRemovalStep(layout: DashboardLayout): DashboardLayout {
  if (layout.upgrades?.includes(DASHBOARD_PROGRESS_REMOVAL_UPGRADE)) return layout;
  const onBoard = layout.board.some((p) => (p.id as string) === "progress");
  const inHidden = layout.hidden.some((h) => (h as string) === "progress");
  if (!onBoard && !inHidden) return layout;
  return {
    ...layout,
    board: layout.board.filter((p) => (p.id as string) !== "progress"),
    hidden: layout.hidden.filter((h) => (h as string) !== "progress"),
    upgrades: [...(layout.upgrades ?? []), DASHBOARD_PROGRESS_REMOVAL_UPGRADE],
  };
}

/**
 * ★ Takes `unknown`, not a layout: junk falls back to `DEFAULT_LAYOUT` (by
 * reference). Through the hook it only ever sees a validated, sanitised layout
 * — `readArrangement` applied `isArrangementLayout` first — so that branch is
 * for direct callers.
 *
 * Each step is gated on its OWN id and runs independently. A single function
 * with an early return would skip every later step for a user who already has
 * an earlier one — exactly the users a later step exists for.
 */
export function upgradeDashboardLayout(stored: unknown): DashboardLayout {
  if (!isArrangementLayout(stored)) return DEFAULT_LAYOUT;
  // Membership is `reconcile`'s job: an unknown id rides through untouched and
  // is dropped there, exactly as for any other stored layout.
  const layout = stored as DashboardLayout;
  return progressRemovalStep(burnUpgradeStep(layout));
}
