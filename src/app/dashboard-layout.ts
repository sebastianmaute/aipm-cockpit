/**
 * The Dashboard layout engine — pure, i18n-free, DOM-free.
 *
 * ★★ ORDER IS THE ENTIRE PLACEMENT MODEL. There are no coordinates: the grid
 * renders with `grid-auto-flow: row dense`, which resolves an ordered list into
 * cells. That is what keeps every operation here an array operation, and it is
 * also why a user cannot leave a deliberate hole — dense backfills.
 *
 * Every function returns the SAME object reference on a no-op, so callers can
 * skip a persist cheaply.
 */
import { reorderIds } from "./list-reorder";
import { DASHBOARD_TILES, tileById, type DashboardTileId, type TileSpan } from "./dashboard-tiles";

export interface PlacedTile {
  id: DashboardTileId;
  w: TileSpan;
  h: TileSpan;
}

export interface DashboardLayout {
  v: 1;
  board: PlacedTile[];
  hidden: DashboardTileId[];
}

/** Every tile on the board, in catalogue order, at its default size. */
export const DEFAULT_LAYOUT: DashboardLayout = {
  v: 1,
  board: DASHBOARD_TILES.map((t) => ({ id: t.id, w: t.w, h: t.h })),
  hidden: [],
};

export function moveTile(
  layout: DashboardLayout,
  dragId: DashboardTileId,
  targetId: DashboardTileId,
): DashboardLayout {
  const ids = layout.board.map((t) => t.id);
  const next = reorderIds(ids, dragId, targetId);
  if (next === ids) return layout;
  const byId = new Map(layout.board.map((t) => [t.id, t]));
  return { ...layout, board: next.map((id) => byId.get(id)!) };
}

export function hideTile(layout: DashboardLayout, id: DashboardTileId): DashboardLayout {
  if (!layout.board.some((t) => t.id === id)) return layout;
  return {
    ...layout,
    board: layout.board.filter((t) => t.id !== id),
    hidden: [...layout.hidden, id],
  };
}

export function restoreTile(
  layout: DashboardLayout,
  id: DashboardTileId,
  index?: number,
): DashboardLayout {
  if (!layout.hidden.includes(id)) return layout;
  const spec = tileById(id);
  if (!spec) return layout;
  const board = [...layout.board];
  const at = index === undefined ? board.length : Math.max(0, Math.min(board.length, index));
  board.splice(at, 0, { id, w: spec.w, h: spec.h });
  return { ...layout, board, hidden: layout.hidden.filter((h) => h !== id) };
}
