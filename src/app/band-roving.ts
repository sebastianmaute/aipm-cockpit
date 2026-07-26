// Keyboard roving for the calendar meetings band. Pure and i18n-free: the
// band's chips are a sparse, lane-packed set, so "the next chip" is index
// arithmetic over a reading-order list rather than the (row, column) matrix
// walk the assignee grid below it uses.
//
// Why the band gets its OWN roving group instead of joining the day-cell
// matrix: band cells are overwhelmingly EMPTY and, unlike an empty day cell
// (which is clickable — it adds an absence), an empty band cell does nothing.
// Folding the band into the matrix would make arrow keys walk dozens of dead
// cells to cross it, and would re-index every absence move/resize site against
// an offset row space. Two roving groups in one table is a deviation from a
// strict single-tab-stop grid, but it replaces ~65 tab stops (one per chip)
// with one, which is the actual defect being fixed.

/** A chip's position in the band: which packed lane, and which day column. */
export interface BandChipRef {
  lane: number;
  /** ISO date (YYYY-MM-DD), so plain lexical order is chronological order. */
  iso: string;
}

/** Keys this model handles. Anything else is left to bubble untouched — Tab
 *  must still escape the band and Enter/Space must still reach the chip. */
const HANDLED = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

/**
 * Next focus index for `key`, or `null` when the key is not part of this model
 * (the caller must then NOT preventDefault).
 *
 * `chips` must be in reading order: lane-major, then ascending date — the same
 * order the band renders. A handled key always returns an index, even when it
 * cannot move (clamped at an end, or no lane to jump to), so the caller can
 * preventDefault unconditionally for handled keys and the page never scrolls
 * out from under a band that simply had nowhere to go.
 */
export function moveBandFocus(
  chips: readonly BandChipRef[],
  index: number,
  key: string,
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
): number | null {
  if (chips.length === 0) return null;
  if (!HANDLED.has(key)) return null;
  // The band owns the bare keys only. A chord belongs to the browser or the
  // OS — Alt+Left is Back, and swallowing it from a chip would break
  // navigation for anyone using the keyboard. (Shift is deliberately NOT
  // listed: it does not produce a competing default here.)
  if (modifiers?.altKey || modifiers?.ctrlKey || modifiers?.metaKey) return null;
  // Clamped here as well as by the caller: a band whose chips changed under a
  // stale index (window navigation) must degrade to a neighbour, not throw.
  const i = Math.min(Math.max(index, 0), chips.length - 1);

  switch (key) {
    case "ArrowRight": return Math.min(i + 1, chips.length - 1);
    case "ArrowLeft": return Math.max(i - 1, 0);
    case "Home": return 0;
    case "End": return chips.length - 1;
    default: return verticalTarget(chips, i, key === "ArrowDown" ? 1 : -1);
  }
}

/**
 * Nearest chip in the closest non-empty lane in `direction`.
 *
 * Lanes are a PACKING artefact, not calendar rows: nothing guarantees a chip
 * sits directly above or below the current one, and a lane can be empty in the
 * visible window entirely. So this scans outward for the first lane that has
 * any chip, then picks that lane's first chip at-or-after the current date —
 * falling back to its last chip when the whole lane is earlier. That keeps
 * vertical movement date-anchored (you land near where you were, not at the
 * lane's start) without any date arithmetic: ISO strings compare directly.
 */
function verticalTarget(chips: readonly BandChipRef[], i: number, direction: 1 | -1): number {
  const current = chips[i];
  const lanes = [...new Set(chips.map((c) => c.lane))].sort((a, b) => a - b);
  const laneAt = lanes.indexOf(current.lane);
  const targetLane = lanes[laneAt + direction];
  if (targetLane === undefined) return i;

  const inLane = chips
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c.lane === targetLane);
  if (inLane.length === 0) return i;

  const atOrAfter = inLane.find(({ c }) => c.iso >= current.iso);
  return (atOrAfter ?? inLane[inLane.length - 1]).idx;
}
