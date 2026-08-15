/**
 * The Dashboard layout engine — pure, i18n-free, DOM-free.
 *
 * ★★ ORDER IS THE ENTIRE PLACEMENT MODEL. There are no coordinates: the grid
 * renders with `grid-auto-flow: row dense`, which resolves an ordered list into
 * cells. That is what keeps every operation here an array operation, and it is
 * also why a user cannot leave a deliberate hole — dense backfills.
 *
 * ★★ THE FOUR MUTATORS RETURN THE SAME OBJECT REFERENCE ON A NO-OP, so callers
 * can skip a persist cheaply — `moveTile` · `hideTile` · `restoreTile` ·
 * `resizeTile`, each pinned by its own "returns the same object" test.
 * **`reconcile` IS NOT ONE OF THEM** and never has been: it allocates a fresh
 * `{v, board, hidden}` on EVERY non-null input, identical content or not. That
 * costs nothing today because its ONE production call site is a LOAD —
 * `readLayout` in `use-dashboard-layout.ts`, which discards the input anyway.
 * ★ The TWO call sites belong to `readLayout`, not to this function: the lazy
 * `useState` initialiser and the project-switch render reconcile. An earlier
 * revision here attributed both to `reconcile`, which sends a reader looking for
 * a second caller that does not exist (`grep -rn "reconcile(" src/app --include=*.ts
 * --include=*.tsx | grep -v '\.test\.'` returns the declaration and one call).
 * A persist-skip built on `next !== stored` would fire on every load, so do not
 * build one, and do not read the mutators' contract as covering it.
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

/** Clamp `v` into `[lo, hi]`, keeping the TileSpan type. */
function clampSpan(v: number, lo: TileSpan, hi: TileSpan): TileSpan {
  return Math.max(lo, Math.min(hi, Math.round(v))) as TileSpan;
}

/**
 * Set one axis of one tile, clamped to that tile's own limits.
 *
 * ★ The axes are INDEPENDENT by design. A single named-preset list conflated
 * them, so "taller, same width" was only expressible where the table happened
 * to hold that combination.
 */
export function resizeTile(
  layout: DashboardLayout,
  id: DashboardTileId,
  axis: "w" | "h",
  value: number,
): DashboardLayout {
  const i = layout.board.findIndex((t) => t.id === id);
  if (i < 0) return layout;
  const spec = tileById(id);
  if (!spec) return layout;
  const next = axis === "w"
    ? clampSpan(value, spec.minW, spec.maxW)
    : clampSpan(value, spec.minH, spec.maxH);
  if (layout.board[i][axis] === next) return layout;
  const board = [...layout.board];
  board[i] = { ...board[i], [axis]: next };
  return { ...layout, board };
}

/**
 * Bring a stored layout up to date with the current catalogue.
 *
 * ★★ A GATED-OFF TILE IS KEPT, NOT DROPPED, AND THAT IS WHY THIS TAKES NO
 * `TileGateInput`. A gate decides what RENDERS, never what is STORED —
 * otherwise switching Budget off and on again would lose the burn tile's
 * position permanently. The render layer filters — `dashboard-panel.tsx` tests
 * each placed tile's own `spec.gate(gate)` — and this does not, nor can it with
 * no gate in scope. ★ That filter is INLINE in the panel and there is no shared
 * helper for it. A catalogue-order `liveTiles(gate)` export briefly existed here
 * and was DELETED unused: the panel filters PLACEMENTS in board order and also
 * requires a rendered body, so a catalogue-order list is not the same function
 * and cannot be substituted for it. Do NOT reintroduce one.
 * The plan carried a `_gate`
 * parameter to document that; eslint rejects it (this repo has no
 * `argsIgnorePattern`, and CI runs `--max-warnings=0`), so the absence of the
 * parameter carries the point instead.
 *
 * ★★ A NEW TILE LANDS AFTER ITS NEAREST PRESENT CATALOGUE PREDECESSOR, not at
 * the end. Appending would dump every newly shipped tile at the bottom of every
 * existing user's board, where its author's intended priority is lost.
 *
 * ★ Sizes are clamped PER AXIS, never reset to the default: a stored height
 * that is still legal survives a width that is not.
 */
export function reconcile(stored: DashboardLayout | null): DashboardLayout {
  if (!stored) return DEFAULT_LAYOUT;

  const known = new Map(DASHBOARD_TILES.map((t) => [t.id, t]));
  // ★★ `hidden` NEEDS ITS OWN DE-DUPLICATION, not just the board's. The board
  // loop below collapses a repeated id because it checks what it has already
  // pushed; nothing did the same for the shelf, so a stored `["kpi","kpi"]`
  // — which `hideTile` cannot produce but a merged/hand-edited/older blob can —
  // came straight back out and the shelf rendered the same tile twice, with
  // duplicate React keys. Found by the "exactly once" property test, not by
  // review. Set preserves insertion order, so the shelf order survives.
  const hiddenSet = new Set(stored.hidden.filter((id) => known.has(id)));
  const hidden = [...hiddenSet];

  // 1. keep what still exists, clamped, minus anything also marked hidden
  const board: PlacedTile[] = [];
  for (const p of stored.board) {
    const spec = known.get(p.id);
    if (!spec || hiddenSet.has(p.id)) continue;
    if (board.some((b) => b.id === p.id)) continue;          // storage held a duplicate
    board.push({
      id: p.id,
      w: clampSpan(p.w, spec.minW, spec.maxW),
      h: clampSpan(p.h, spec.minH, spec.maxH),
    });
  }

  // 2. insert anything the catalogue has that storage did not
  const present = new Set(board.map((b) => b.id));
  DASHBOARD_TILES.forEach((spec, catIdx) => {
    if (present.has(spec.id) || hiddenSet.has(spec.id)) return;
    // nearest preceding catalogue neighbour that IS on the board
    let at = 0;
    for (let i = catIdx - 1; i >= 0; i--) {
      const j = board.findIndex((b) => b.id === DASHBOARD_TILES[i].id);
      if (j >= 0) { at = j + 1; break; }
    }
    board.splice(at, 0, { id: spec.id, w: spec.w, h: spec.h });
    present.add(spec.id);
  });

  return { v: 1, board, hidden };
}
