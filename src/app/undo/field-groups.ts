// src/app/undo/field-groups.ts
//
// Pure, i18n-free helpers for per-field edit undo. A FieldGroup lists keys that
// must revert together to keep an invariant (e.g. task status + completedDate).
// changedFieldGroups is array-AWARE on purpose: activity-log's diffFields skips
// non-primitives, but undo must be able to revert labels/dependencies edits too.

export type FieldGroup<T> = readonly (keyof T & string)[];

/** Keys never captured as an editable field: identity + the sync stamp (the
 *  stamp is re-applied by captureFieldEdit's stampField, not undone directly). */
const NEVER_CAPTURE: ReadonlySet<string> = new Set(["id", "localModifiedAt"]);

/** Shallow copy of just the named keys. */
export function pick<T extends object>(row: T, keys: readonly (keyof T & string)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) out[k] = row[k];
  return out;
}

/** Structural inequality for our plain-JSON entity values (primitives + arrays
 *  of primitives + small objects). Object.is fast-path; JSON for the rest. */
function differs(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return false;
  const aObj = typeof a === "object" && a !== null;
  const bObj = typeof b === "object" && b !== null;
  if (aObj || bObj) return JSON.stringify(a) !== JSON.stringify(b);
  return true;
}

/**
 * Diff prev→next and return one {before, after} patch per CHANGED logical field.
 * A changed key that belongs to a multi-key group emits a single entry carrying
 * ALL of that group's keys (so reverting one reverts its partners). Any changed
 * key not named in a group is its own single-key entry. id/localModifiedAt are
 * never captured.
 */
export function changedFieldGroups<T extends { id: number }>(
  prev: T,
  next: T,
  groups: readonly FieldGroup<T>[],
): Array<{ before: Partial<T>; after: Partial<T> }> {
  const grouped = new Set<string>();
  for (const g of groups) for (const k of g) grouped.add(k);

  const out: Array<{ before: Partial<T>; after: Partial<T> }> = [];

  // Multi-key groups first: emit once if ANY member changed.
  for (const g of groups) {
    if (g.some((k) => differs((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k]))) {
      out.push({ before: pick(prev, g), after: pick(next, g) });
    }
  }

  // Then every remaining changed key as its own entry.
  const keys = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (NEVER_CAPTURE.has(k) || grouped.has(k)) continue;
    if (differs((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k])) {
      out.push({ before: pick(prev, [k as keyof T & string]), after: pick(next, [k as keyof T & string]) });
    }
  }

  return out;
}
