/**
 * Converts a measured content height into a tile row count.
 *
 * Pure and DOM-free, so it is fully unit-tested; the DOM reads live in the Dashboard's
 * measuring hook. Every pixel argument is READ from the page by the caller, never quoted —
 * this repo's hand-quoted chrome figure was once 11px wrong.
 *
 * A tile spanning n rows is `n * rowUnitPx + (n - 1) * gapPx` tall, of which `nonBodyPx` (header
 * plus section borders) is not body. Returns the smallest n whose body holds `contentPx`,
 * clamped to [minH, maxH].
 */
import type { BlockHeight } from "./arrangement-layout";

export function rowsForHeight(
  contentPx: number,
  rowUnitPx: number,
  gapPx: number,
  nonBodyPx: number,
  minH: BlockHeight,
  maxH: BlockHeight,
): BlockHeight {
  if (!(rowUnitPx > 0) || !Number.isFinite(contentPx) || contentPx <= 0) return minH;
  const perRow = rowUnitPx + gapPx;
  // body(n) = n*perRow - gapPx - nonBodyPx  →  smallest n with body(n) >= contentPx
  const n = Math.ceil((contentPx + nonBodyPx + gapPx) / perRow);
  return Math.max(minH, Math.min(maxH, n)) as BlockHeight;
}
