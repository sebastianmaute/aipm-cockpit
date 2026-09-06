"use client";
/**
 * The Dashboard's binding of the shared arrangement tile chrome.
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT A COMPONENT. Every landmine that used to live
 * here now lives in `arrangement-tile.tsx` — the ★★ every-control's-name-is-
 * qualified-with-the-title block (axe cannot see a regression, so a two-tile
 * unit test is the only detector), the note that WCAG 2.5.3 does NOT bind on
 * two glyph-only controls, and the `DragHandle` primitive's four-prop forwarding
 * contract. Read them there before changing anything here.
 *
 * ★ The exported names are UNCHANGED on purpose — `dashboard-panel.tsx` and the
 * Dashboard's own tests keep compiling and passing untouched. If a Dashboard
 * test needs editing to accommodate a change here, the change is wrong.
 */
import { ArrangementTile, type ArrangementTileProps } from "./arrangement-tile";
import type { DashboardTileId } from "./dashboard-tiles";

export type { TileDragProps, TileHandleProps } from "./arrangement-tile";

/* ★ `testIdPrefix="tile"` IS THE COMPATIBILITY POINT OF THIS WHOLE FILE. The
 * generic component builds `data-testid={`${testIdPrefix}-${id}`}`, so this one
 * literal is what keeps every existing `data-testid="tile-raid"` query in
 * `dashboard-grid.test.tsx`, `dashboard-panel.test.tsx` and the e2e specs
 * resolving. Changing it is a breaking change wearing a rename's clothes.
 *
 * ★ The `id` intersection NARROWS rather than widens: `ArrangementTileProps.id`
 * is `string` (the generic component cannot know a surface's union), and
 * `& { id: DashboardTileId }` puts the Dashboard's own union back on the public
 * signature, so a typo'd tile id is still a build error at the call site. */
export function DashboardTile(
  props: Omit<ArrangementTileProps, "testIdPrefix"> & { id: DashboardTileId },
) {
  return <ArrangementTile {...props} testIdPrefix="tile" />;
}
