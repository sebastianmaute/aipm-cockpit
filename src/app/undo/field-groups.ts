// src/app/undo/field-groups.ts
//
// Pure, i18n-free helpers for per-field edit undo. A FieldGroup lists keys that
// must revert together to keep an invariant (e.g. task status + completedDate).
// changedFieldGroups is array-AWARE on purpose: activity-log's diffFields skips
// non-primitives, but undo must be able to revert labels/dependencies edits too.

import type { Task, ChangeItem, RaidItem, Milestone, Stakeholder, Resource } from "../types";
import type { CalendarEvent } from "../calendar-event";

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

/** Public alias of `differs` for callers outside this module that need to
 *  gate a capture on a real value change (e.g. skip a no-op undo entry). */
export function valuesDiffer(a: unknown, b: unknown): boolean {
  return differs(a, b);
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

/** status⟺completedDate invariant; assignee identity is written as one unit. */
export const TASK_UNDO_GROUPS: readonly FieldGroup<Task>[] = [
  ["status", "completedDate"],
  ["assignee", "assigneeEmail", "resourceId"],
];
/** A change's status transition auto-fills/clears decisionDate together. */
export const CHANGE_UNDO_GROUPS: readonly FieldGroup<ChangeItem>[] = [
  ["status", "decisionDate"],
];
export const RAID_UNDO_GROUPS: readonly FieldGroup<RaidItem>[] = [];
export const MILESTONE_UNDO_GROUPS: readonly FieldGroup<Milestone>[] = [];
export const STAKEHOLDER_UNDO_GROUPS: readonly FieldGroup<Stakeholder>[] = [];
export const RESOURCE_UNDO_GROUPS: readonly FieldGroup<Resource>[] = [];

/** Two couplings, one group. sanitizeCalendarEvent clears `exceptions` whenever
 *  `recurrence` is absent, so reverting the rule must restore the skips/moves in
 *  the same step. And sanitizeRecurrence cross-validates `until >= startDate`, so
 *  a split entry could restore an `until` the next load strips again — the undo
 *  would appear to work and then not stick. Reverting a pure startDate move also
 *  rewrites two identical values; harmless. */
export const CALENDAR_EVENT_UNDO_GROUPS: readonly FieldGroup<CalendarEvent>[] = [
  ["startDate", "recurrence", "exceptions"],
];

/**
 * Build the `{id, before, after}` field patches a bulk edit needs, by diffing
 * each row against the row the op is about to write.
 *
 * ★★★ WHY A PATCH AND NOT THE ROW. `capturePart` captures WHOLE rows, so undoing
 * a bulk edit also reverts whatever a concurrent writer changed on those rows —
 * a note added through the notes window, an `outlookEventId` stamped by the
 * background calendar push (open-followups §50). A patch reverts only what the op
 * itself wrote.
 *
 * ★★ `WRITE_THROUGH_KEYS` is excluded even when the two rows DISAGREE on it. The
 * panel reads its rows from a render snapshot, so a note committed between that
 * read and the save legitimately shows up as a difference — and capturing it would
 * reintroduce the very clobber this exists to prevent, one layer up.
 *
 * ★ A key set on a row that lacked it (and one cleared to `undefined`) is captured
 * with an explicit `undefined` on the other side, so a bulk edit that CLEARS a
 * field is undoable. `captureFieldPart` merges the patch, and merging an explicit
 * `undefined` is what restores "absent".
 *
 * See also `WRITE_THROUGH_FIELDS` in `use-undo-stack.ts` — that constant decides
 * what a whole-row undo PRESERVES; this one decides what a patch CAPTURES.
 */
const WRITE_THROUGH_KEYS: ReadonlySet<string> = new Set(["noteLog", "outlookEventId"]);

export function buildBulkFieldEdits<T extends { id: number }>(
  rows: readonly { before: T; after: T }[],
): { id: number; before: Partial<T>; after: Partial<T> }[] {
  const out: { id: number; before: Partial<T>; after: Partial<T> }[] = [];
  for (const { before, after } of rows) {
    const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
    const changed: (keyof T & string)[] = [];
    for (const k of keys) {
      if (NEVER_CAPTURE.has(k) || WRITE_THROUGH_KEYS.has(k)) continue;
      if (differs((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k])) {
        changed.push(k as keyof T & string);
      }
    }
    if (changed.length === 0) continue;
    out.push({ id: before.id, before: pick(before, changed), after: pick(after, changed) });
  }
  return out;
}
