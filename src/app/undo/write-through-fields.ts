// src/app/undo/write-through-fields.ts
//
// Fields written to a live row by something OTHER than the op that captured it.
// A whole-row undo lets the LIVE value win on these, or it reverts a write the
// user's undo was never about (open-followups §50). Two consumers need the list
// for opposite reasons — `use-undo-stack.ts` PRESERVES them across a whole-row
// undo, `field-groups.ts` EXCLUDES them from a bulk patch's capture — and this
// is the sole authoring site for both (open-followups §177). The set below is
// DERIVED from the tuple, so the two views cannot drift.
//
// ★★ MEMBERSHIP RULE, not a list of "important" fields: a field belongs here iff
// some writer OTHER than an entity's own save handler can change it on a row that
// is not being edited. Today that is the notes window (`noteLog`, on Task, RaidItem
// and ChangeItem) and the background calendar push/pull (`outlookEventId`, on every
// calendar-capable entity).
//
// ★★ THIS LIST IS THE BACKSTOP, NOT THE PRIMARY FIX. The bulk-edit sites capture
// FIELD PATCHES and are immune by construction; what this protects is the paths
// that genuinely replace whole rows — reference-data cascades, the resource
// directory, task dedup, the alloc plan, and dependency stripping on delete. A new
// write-through field silently escapes it, which is why the patch capture is
// preferred wherever the op is a field edit.
//
// ★★ THE `satisfies` IS THE ONLY THING TYING THESE STRINGS TO A REAL FIELD.
// The engine parameter stays `readonly string[]` on purpose — the same constant
// is applied to entity types carrying NEITHER key (roles, grades), which a
// `keyof T` parameter could not accept — so the constraint has to live at the
// one place the list is AUTHORED. `keyof (A | B)` is the keys common to ALL
// members, and the tuple constrains each SLOT separately, so each entry must
// name a field every one of ITS OWN carriers still declares. A rename in
// `types.ts`, or a typo here, is then a compile error on this line rather than
// a silent loss of protection (before this, `[]` typechecked just as happily).
// A new entry must extend the tuple with its own carrier list — the tuple
// length forces that rather than letting it ride on an unrelated slot's type.
import type { Absence, ChangeItem, CommitteeMeeting, Milestone, RaidItem, Task } from "../types";

export const WRITE_THROUGH_FIELDS = ["noteLog", "outlookEventId"] as const satisfies readonly [
  keyof (Task | RaidItem | ChangeItem),
  keyof (Task | RaidItem | Milestone | ChangeItem | CommitteeMeeting | Absence),
];

/** The same list as a lookup. DERIVED — never restate the members here.
 *
 *  ★ `ReadonlySet<string>`, not a set of the literal union: the consuming engine
 *  parameter is `readonly string[]`, so the members widen to `string` here. This
 *  set is therefore NOT a second type guard — a typo is caught by the tuple's
 *  `satisfies` above or not at all. */
export const WRITE_THROUGH_KEYS: ReadonlySet<string> = new Set<string>(WRITE_THROUGH_FIELDS);
