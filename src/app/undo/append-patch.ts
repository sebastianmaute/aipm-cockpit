// src/app/undo/append-patch.ts
//
// Pure. The field-patch ends (`before`/`after`) for an op that APPENDED exactly
// one member to an array field — e.g. an escalation adding one note-log entry.
import { differs } from "./field-groups";

/**
 * Undo/redo ends for an op that appended `appended` to `prior`.
 *
 * ★★★ NOT THE WHOLE ARRAY. `mergeFieldValue` handles arrays member-wise, but
 * `mergeArray` falls back to a WHOLESALE revert whenever either end holds two
 * deep-equal members. A stored log can (legacy/imported entries), so ends built
 * from the full log would, on undo, overwrite the live log with `before` and
 * delete anything a concurrent writer appended meanwhile. These ends are a
 * WINDOW instead: at most the last prior member (the anchor) plus the appended
 * one, which can never contain a duplicate. The merge then removes only the
 * appended member on undo, and on redo re-inserts it right after the anchor.
 * ★ Both ends are always arrays — an `undefined` end also reverts wholesale.
 * ★ If the appended member deep-equals the anchor, the window drops the anchor
 * (otherwise `after` would hold a duplicate). Undo then removes EVERY member
 * equal to it, one prior copy included — unreachable for a note log, whose
 * appended id is always max+1.
 */
export function appendPatch<T>(prior: readonly T[], appended: T): { before: T[]; after: T[] } {
  if (prior.length === 0) return { before: [], after: [appended] };
  const anchor = prior[prior.length - 1];
  if (!differs(anchor, appended)) return { before: [], after: [appended] };
  return { before: [anchor], after: [anchor, appended] };
}
