/**
 * Carry a block SELECTION (a bare index) through the three structural ops.
 *
 * NO React, NO DOM, NO i18n — index arithmetic and nothing else, so it is
 * unit-testable without a jsdom environment and exhaustively checkable against
 * the splice it mirrors.
 *
 * ★★★ THE FALLBACK IN `document-editor.tsx` CANNOT DO THIS JOB, and that is the
 * whole reason this module exists. That component resolves an out-of-range or
 * now-non-paragraph selection to the first paragraph — which handles "the
 * chosen index stopped being a paragraph" and NOTHING else. The common case in
 * a document of paragraphs is the opposite: the index is still a paragraph, and
 * it is a DIFFERENT one. Moving the block you just selected therefore expanded
 * its neighbour and collapsed the block you were working in, with the fallback
 * never firing.
 *
 * ★★ Apply these ONLY when the op actually landed. Every structural op can be
 * refused by the engine's `expect` precondition, and remapping a selection past
 * a refusal moves it for a change that never happened.
 */

// ★ TYPE-ONLY, so it erases at compile time and keeps the "NO i18n" promise
//  above — `document-block-seeds.ts` itself imports `t`/`Lang` for `blockSeed`,
//  but nothing from that module is imported here in VALUE position.
import type { AddableBlockType } from "./document-block-seeds";

/**
 * Where a selection lands after `reorderIds`' splice: remove at `from`, insert
 * at the index `to` held BEFORE that removal.
 *
 * ★ The moved block itself lands at `to` — the same index `document-editor.tsx`
 *  hands its pending-focus request, so selection and focus cannot disagree.
 */
export function selectionAfterMove(
  chosen: number | null,
  from: number,
  to: number,
): number | null {
  if (chosen === null) return null;
  if (chosen === from) return to;
  // The two shifts the splice implies, in the splice's own order.
  const afterRemoval = chosen > from ? chosen - 1 : chosen;
  return afterRemoval >= to ? afterRemoval + 1 : afterRemoval;
}

/**
 * Where a selection lands after a block is inserted at `at`.
 *
 * ★★★ §199. A block inserted AT or BEFORE the selection pushes it up by one —
 *  EXCEPT for a paragraph, which BECOMES the selection. At a narrow pane
 *  `document-editor.tsx` collapses every paragraph but the selected one, so
 *  shifting the old selection past the insertion handed the user a fresh
 *  paragraph rendered read-only behind an "Edit this block" button: the block
 *  they had just asked for was the one block they could not type in.
 *
 * ★★ PARAGRAPH ONLY. Nothing else is in the selection model:
 *  `resolvedSelection` re-checks `type === "paragraph"`, and the collapse prop
 *  is read by a paragraph row alone. Selecting an inserted heading or table
 *  would be resolved away on the next render — a no-op that a test would
 *  happily pass either way.
 *
 * ★ The branch is on the KIND, never on the position — a paragraph can be
 *  inserted at any index, including 0, and must become the selection at
 *  every one of them.
 */
export function selectionAfterInsert(
  chosen: number | null,
  at: number,
  kind: AddableBlockType,
): number | null {
  if (kind === "paragraph") return at;
  if (chosen === null) return null;
  return chosen >= at ? chosen + 1 : chosen;
}

/**
 * A block deleted BEFORE the selection pulls it down by one.
 *
 * ★★ Deleting the SELECTED block clears the selection rather than keeping the
 *  number, which would hand it to whichever block slid into that slot. Null
 *  means "not chosen yet" to the caller, which resolves it to the first
 *  paragraph — a defined, visible state, unlike silently selecting a block the
 *  user never pointed at right after they asked for a delete.
 */
export function selectionAfterDelete(chosen: number | null, at: number): number | null {
  if (chosen === null) return null;
  if (chosen === at) return null;
  return chosen > at ? chosen - 1 : chosen;
}
