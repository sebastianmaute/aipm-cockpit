// src/app/workspace-slice-policy.ts
//
// ★★★ THIS IS A REGISTRY, NOT THE IMPLEMENTATION.
//
// The save-time data-loss guards live in `workspace-metrics.ts`
// (`nonEmptyCollectionCount` / `workspaceRecordCount`) and they spell their own
// membership out, one slice per line, on purpose: a data-loss guard driven by a
// table is a guard whose behaviour changes when someone edits a table. Nothing
// here is read at runtime, and adding a slice here does NOT make it counted.
//
// What this file buys is the DECISION RECORD. `workspace-slice-policy.test.ts`
// parses the `Workspace` type and fails when a slice appears with no entry here
// — so a new slice cannot be added without somebody stating, in writing, whether
// the guards should count it.
//
// ★★ WHY A TEST RATHER THAN A COMMENT. `docs/open-followups.md` §98 exists
// because a slice was added and nobody decided this. A comment saying the
// omission was deliberate was ALREADY sitting in `workspace-metrics.ts` and did
// not work — the omission still went unexamined long enough to become a register
// entry. A comment is read by whoever already went looking; a red test is read
// by whoever added the slice.
//
// THE RULE, stated once: a slice counts toward the SAVE-time guards **iff it
// holds user-authored records that cannot be regenerated, AND its size is not
// driven by automatic append.**
//
// Keeping this in agreement with `workspace-metrics.ts` is the test's job for
// MEMBERSHIP (a missing or stale slice turns it red). It cannot check that a
// `counted: true` here matches a real `if (ws.x?.length) n++` there — so when you
// change a counter, change this row in the same commit, and pin the new
// behaviour in `is-workspace-empty.test.ts` in both directions.

/** One slice's recorded decision. `reason` is required in both directions: for an
 *  exclusion it is the load-bearing part (the test enforces a real one), and for a
 *  counted slice it says which half of the rule it satisfies. */
export interface SlicePolicy {
  /** True when the slice is summed by `nonEmptyCollectionCount` /
   *  `workspaceRecordCount` in `workspace-metrics.ts`. */
  readonly counted: boolean;
  /** Why. For an exclusion, state what would BREAK if it were counted — not
   *  merely that it is derived data. */
  readonly reason: string;
}

/** Every array-typed member of `Workspace`, with its save-guard decision.
 *  Twenty slices as of 2026-08-29; the test fails on any addition or removal. */
export const SLICE_POLICY: Readonly<Record<string, SlicePolicy>> = {
  // ── The thirteen entity collections. All user-authored, all unrecoverable,
  //    none auto-appended — the rule's central case.
  tasks: { counted: true, reason: "User-authored records; the primary register." },
  raid: { counted: true, reason: "User-authored risk/assumption/issue/dependency records." },
  absences: { counted: true, reason: "User-authored absence records." },
  shifts: { counted: true, reason: "User-authored shift records (dormant feature, but persisted user data)." },
  resources: { counted: true, reason: "User-authored resource directory." },
  roles: { counted: true, reason: "User-authored reference data for the resource model." },
  disciplines: { counted: true, reason: "User-authored reference data for the resource model." },
  grades: { counted: true, reason: "User-authored reference data for the resource model." },
  budgets: { counted: true, reason: "User-authored budget buckets and their period figures." },
  milestones: { counted: true, reason: "User-authored milestone records." },
  changes: { counted: true, reason: "User-authored change-control register." },
  stakeholders: { counted: true, reason: "User-authored stakeholder register (incl. the RACI map)." },
  calendarEvents: { counted: true, reason: "User-authored resource-calendar meetings." },

  // ── Counted beyond the thirteen: also user-authored and unrecoverable.
  documents: {
    counted: true,
    reason:
      "User- and AI-authored document blocks. Unrecoverable — the rendered bytes are never stored, so a lost document cannot be re-derived from anything.",
  },
  knowledgeItems: {
    counted: true,
    reason: "User-authored knowledge-library entries; nothing regenerates them.",
  },
  documentAssets: {
    counted: true,
    reason:
      "User-uploaded image METADATA. Losing a row orphans the bytes in the side table, and neither half can be re-derived.",
  },

  // ── Excluded. Each reason states what would BREAK, because each exclusion is
  //    load-bearing: counting any of these degrades a guard rather than
  //    tightening it.
  activityLog: {
    counted: false,
    reason:
      "Auto-appended by ordinary use. Counting it means nonEmptyCollectionCount can never reach 0 in a project that has ever been used — and reaching 0 is the full-wipe guard's ENTIRE trigger, so that guard would be dead for good. isWorkspaceEmpty documents the identical inversion for itself; do not 'complete' the documents precedent by adding it.",
  },
  documentVersions: {
    counted: false,
    reason:
      "Auto-captured before-images, pruned by retention. Counting it makes an ordinary retention prune read as a mass deletion and refuses a legitimate save.",
  },
  insights: {
    counted: false,
    reason: "Derived by detection and regenerable — not user-authored records, so their loss is not data loss.",
  },
  features: {
    counted: false,
    reason:
      "Per-project configuration, not records: an EMPTY list is a meaningful setting (Simple mode), so its length carries no record count to guard.",
  },
};
