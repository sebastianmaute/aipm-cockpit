// src/app/undo/merge-field-value.ts
//
// Pure three-way merge for undo/redo of a field patch. No React, no i18n, no DOM.
//
// A field patch holds {before, after} for exactly the fields an op wrote. Undo
// used to write `before` back WHOLESALE, so a concurrent writer that changed a
// different KEY of the same object-valued field lost its change — the unit of
// preservation was the FIELD, not the key inside it (open-followups §178).
//
// `target` is the end the undo/redo is moving toward; `other` is the opposite
// end. Undo is merge(before, after, live); redo is merge(after, before, live).
// One function, both directions.
import { differs } from "./field-groups";

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasDuplicates(xs: readonly unknown[]): boolean {
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) if (!differs(xs[i], xs[j])) return true;
  }
  return false;
}

/** Key-wise three-way merge: a key the op touched takes `target`'s value (or is
 *  removed when `target` lacks it); every other key keeps `live`'s.
 *  ★ Built in `target`'s key order, then `live`-only keys (concurrent additions)
 *  in `live`'s order — so an undo restores a key the op removed at its original
 *  POSITION, not at the end (open-followups §291). Content is independent of
 *  the order; only enumeration order depends on it. */
function mergeRecord(
  target: Record<string, unknown>,
  other: Record<string, unknown>,
  live: Record<string, unknown>,
): Record<string, unknown> {
  const touched = (k: string) => differs(target[k], other[k]);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(target)) {
    if (touched(k)) out[k] = target[k];
    else if (k in live) out[k] = live[k]; // untouched — live wins, including a concurrent delete
  }
  for (const k of Object.keys(live)) {
    if (k in out || touched(k)) continue; // a touched key missing from target stays removed
    out[k] = live[k];
  }
  return out;
}

/** Order-preserving three-way merge. Drops what the op added, re-inserts what it
 *  removed anchored to its nearest surviving predecessor in `target`, and leaves
 *  concurrent additions in their own relative order.
 *
 *  ★ Duplicates make the anchor ambiguous, so either end holding a repeated
 *  member falls back to the whole-value revert. A silent wrong answer here is
 *  worse than the coarse behaviour this function exists to replace.
 *  ★ When the op REORDERED members and a concurrent write also landed, the result
 *  keeps `live`'s relative order for surviving members rather than `target`'s.
 *  The no-race case is exact — `mergeFieldValue` short-circuits it. */
function mergeArray(
  target: readonly unknown[],
  other: readonly unknown[],
  live: readonly unknown[],
): unknown[] {
  if (hasDuplicates(target) || hasDuplicates(other)) return [...target];
  const inTarget = (v: unknown) => target.some((x) => !differs(x, v));
  const inOther = (v: unknown) => other.some((x) => !differs(x, v));
  const out = live.filter((v) => !(inOther(v) && !inTarget(v)));
  for (let i = 0; i < target.length; i += 1) {
    const m = target[i];
    if (inOther(m)) continue; // the op did not remove it
    if (out.some((v) => !differs(v, m))) continue; // a concurrent writer re-added it
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const idx = out.findIndex((v) => !differs(v, target[j]));
      if (idx !== -1) {
        at = idx + 1;
        break;
      }
    }
    out.splice(at, 0, m);
  }
  return out;
}

/** Merge one captured field's value. See the module header for the direction
 *  convention. */
export function mergeFieldValue(target: unknown, other: unknown, live: unknown): unknown {
  // Nothing raced: a plain revert, identical to the pre-§178 behaviour. This
  // short-circuit is what makes "every non-racing undo is unchanged" true by
  // construction rather than by argument — including for a pure reorder, which
  // the array merge alone would not reproduce exactly.
  if (!differs(live, other)) return target;
  // The op never touched this value (a group-completed key, §180): live wins.
  if (!differs(target, other)) return live;
  if (isPlainRecord(target) && isPlainRecord(other) && isPlainRecord(live)) {
    return mergeRecord(target, other, live);
  }
  if (Array.isArray(target) && Array.isArray(other) && Array.isArray(live)) {
    return mergeArray(target, other, live);
  }
  return target;
}

/** Apply a whole captured patch to a live row, merging each key. Replaces the
 *  `{ ...row, ...patch }` spread the undo runner used to do. */
export function mergeFieldPatch<T extends object>(
  live: T,
  target: Partial<T>,
  other: Partial<T>,
): T {
  const out = { ...live } as Record<string, unknown>;
  const t = target as Record<string, unknown>;
  const o = other as Record<string, unknown>;
  for (const k of new Set<string>([...Object.keys(t), ...Object.keys(o)])) {
    out[k] = mergeFieldValue(t[k], o[k], (live as Record<string, unknown>)[k]);
  }
  return out as T;
}
