"use client";
/**
 * The Dashboard's binding of the shared arrangement hook.
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT A HOOK. Every landmine that used to live here
 * now lives in `use-arrangement.ts` — the lazy-initialiser rule, the render-body
 * project-switch read and the argument for it, the id-and-layout-as-one-state
 * fix, the separate flush effect, and the deliberate absence of a `gate` option.
 * Read them there before changing anything here. What stays is exactly the
 * Dashboard-specific binding: its catalogue, its storage key and its one default
 * layout.
 *
 * ★ The exported names are UNCHANGED on purpose — `dashboard-panel.tsx` and the
 * Dashboard's own tests keep compiling and passing untouched. If a Dashboard
 * test needs editing to accommodate a change here, the change is wrong.
 *
 * ★ The Dashboard passes NO `seed`. That option exists for a surface migrating
 * a pre-existing preference into an arrangement on first load; the Dashboard has
 * never had one, so its stored-or-default read is the plain path.
 */
import { useArrangement, type ArrangementApi } from "./use-arrangement";
import { DEFAULT_LAYOUT } from "./dashboard-layout";
import { DASHBOARD_LAYOUT_KEY } from "./dashboard-layout-store";
import { DASHBOARD_TILES, type DashboardTileId } from "./dashboard-tiles";

export { LAYOUT_PERSIST_MS } from "./use-arrangement";
export type DashboardLayoutApi = ArrangementApi<DashboardTileId>;

/* ★ BOTH ARGUMENTS BELOW ARE MODULE-LEVEL CONSTANTS, AND THAT IS LOAD-BEARING
 * RATHER THAN TIDY. `DASHBOARD_TILES` rides the returned mutators' dependency
 * arrays, and `DEFAULT_LAYOUT` is handed back BY REFERENCE by `reconcile(null)`
 * and by `reset()` — see `dashboard-layout.ts`, which holds exactly one
 * instance for that reason. Building either here per call would defeat both. */
export function useDashboardLayout({
  projectId,
  isPopout = false,
}: {
  projectId: string;
  isPopout?: boolean;
}): DashboardLayoutApi {
  return useArrangement<DashboardTileId>({
    catalogue: DASHBOARD_TILES,
    storageKey: DASHBOARD_LAYOUT_KEY,
    fallback: DEFAULT_LAYOUT,
    projectId,
    // ★ THE PUBLIC SPELLING STAYS `isPopout` AND THE GENERIC ONE IS `readOnly`,
    // and mapping between them is a job the adapter exists for. The hook knows
    // only "suppress every write"; "popout" is a Dashboard feature, and renaming
    // this parameter would break `dashboard-panel.tsx` and its tests, which the
    // Phase F export-stability rule forbids.
    readOnly: isPopout,
  });
}
