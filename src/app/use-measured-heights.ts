/**
 * Measures each unflagged tile's content once per trigger (mount, density change) and returns a
 * render-time height override. NEVER persisted: a stored measured height would read as a user's
 * choice on the next open and freeze the board.
 *
 * ★★ Measurement runs in a requestAnimationFrame callback scheduled from an effect, following
 * tour-overlay.tsx. A synchronous setState in an effect body trips react-hooks/set-state-in-effect,
 * which is fatal here; the frame also lets the board lay out before any rect is read.
 * ★★ Content height is the EXTENT of the body's element children plus the body's padding — never the
 * body's scrollHeight, which equals the box when content fits and so can only ever grow a tile.
 * No wrapper element is measured either: a wrapper of automatic height would collapse every `h-full`
 * child (the charts). A child that fills the box therefore measures as the box, and keeps its height.
 * ★ One pass converges because content height depends on width, and width is fixed by W_CLASS at the
 * breakpoint. See the spec's "Why one pass is enough".
 * ★★ jsdom returns 0 for every rect. A tile reading 0 is SKIPPED, not clamped to its minH, so the
 * unit suite renders every tile at its stored height — the no-op path.
 */
import { useEffect, useState } from "react";
import type { BlockHeight } from "./arrangement-layout";
import { rowsForHeight } from "./arrangement-measure";

export interface MeasuredTile { id: string; minH: BlockHeight; maxH: BlockHeight; flagged: boolean }

function sameMap(a: ReadonlyMap<string, BlockHeight>, b: ReadonlyMap<string, BlockHeight>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** One tile's reading, or null when there is nothing to measure (jsdom, an empty body). */
function measureTile(section: HTMLElement, t: MeasuredTile): BlockHeight | null {
  const grid = section.closest<HTMLElement>("[data-arrangement-grid]");
  const body = section.querySelector<HTMLElement>("[data-arrangement-body]");
  if (!grid || !body) return null;
  const gs = getComputedStyle(grid);
  const rowUnit = parseFloat(gs.gridAutoRows);
  const gap = parseFloat(gs.rowGap);
  if (!(rowUnit > 0) || !Number.isFinite(gap)) return null;
  const kids = Array.from(body.children).map((k) => k.getBoundingClientRect());
  if (kids.length === 0) return null;
  const extent = Math.max(...kids.map((r) => r.bottom)) - Math.min(...kids.map((r) => r.top));
  const sectionH = section.getBoundingClientRect().height;
  if (!(extent > 0) || !(sectionH > 0)) return null;           // jsdom: every rect is 0
  const bs = getComputedStyle(body);
  const content = extent + (parseFloat(bs.paddingTop) || 0) + (parseFloat(bs.paddingBottom) || 0);
  return rowsForHeight(content, rowUnit, gap, sectionH - body.clientHeight, t.minH, t.maxH);
}

export function useMeasuredHeights(args: {
  density: string;
  tiles: readonly MeasuredTile[];
}): ReadonlyMap<string, BlockHeight> {
  const [measured, setMeasured] = useState<ReadonlyMap<string, BlockHeight>>(() => new Map());
  const { density, tiles } = args;
  // ★★ The re-measure key covers density, WHICH tiles are present, and each tile's FLAG — never its
  // height, which would loop. The flag is in the key because Reset clears every flag without
  // changing density or the tile set. Without it, a tile the user had resized would stay at its
  // default after Reset instead of being measured, which is what the spec says Reset does.
  // ★ Sorted by id, so a drag preview that only REORDERS the board does not re-measure: order
  // changes position, never width, so it cannot change a reading.
  // ★★ The effect reads its tiles back OUT OF THE KEY rather than closing over `tiles`. The panel
  // builds that array fresh every render, so depending on it would re-measure continuously; the
  // key is the whole of what the effect needs, which keeps the dependency list honest without an
  // exhaustive-deps suppression.
  const tileKey = JSON.stringify([...tiles].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const next = new Map<string, BlockHeight>();
      for (const t of JSON.parse(tileKey) as MeasuredTile[]) {
        if (t.flagged) continue;
        // ★ Looked up by bare tile id, document-wide, and the grid is then the section's own
        // ancestor — not "the first grid on the page", which would be the wrong one if another
        // arrangement surface (Reports shares these attributes) ever mounted first. This still
        // assumes no other mounted surface uses a Dashboard tile id; the id sets are disjoint today
        // (compare `DASHBOARD_TILES` with `report-blocks.ts`).
        const section = document.querySelector<HTMLElement>(
          `[data-arrangement-section][data-tile-id="${t.id}"]`,
        );
        const rows = section ? measureTile(section, t) : null;
        if (rows !== null) next.set(t.id, rows);
      }
      setMeasured((prev) => (sameMap(prev, next) ? prev : next));
    });
    return () => cancelAnimationFrame(raf);
  }, [density, tileKey]);

  return measured;
}
