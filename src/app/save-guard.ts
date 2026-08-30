// src/app/save-guard.ts
//
// The persistence choke point's data-loss decision, extracted from
// use-storage-backend.ts's save effect so it can be tested without a React
// hook — and so that file stays under the 800-line ratchet (it sat at 799 with
// no baseline entry; see docs/open-followups.md §229).
//
// ★ PURE. No clock, no storage, no i18n. The caller owns the baselines, the
//   toast and the forensic record; this answers only "may this save proceed?".

import { isMassDeletion } from "./workspace-metrics";

export interface SaveGuardInput {
  /** Non-empty collection count of the LAST committed workspace. */
  prevCollections: number;
  /** Total record count of the LAST committed workspace. */
  prevRecords: number;
  /** Non-empty collection count of the workspace about to be written. */
  curCollections: number;
  /** Total record count of the workspace about to be written. */
  curRecords: number;
  /** True when the user took an explicit destructive action (clear-all, bulk
   *  delete, delete-all-documents) and armed the one-shot bypass. */
  allowDestructive: boolean;
}

export interface SaveGuardVerdict {
  /** Withhold the save and tell the user. */
  refuse: boolean;
  /** Let the save through, but leave a forensic record — a single-collection
   *  project emptying itself is legitimate often enough that refusing it would
   *  be worse, and rare enough to be worth recording. */
  forensic: boolean;
  /** WHICH invariant refused, so the recourse surface can pick its confirm
   *  tier. `null` whenever `refuse` is false.
   *
   *  ★ `"full-wipe"` wins when BOTH hold, which is the common case — emptying a
   *  multi-collection project is a mass deletion too. It is the larger loss and
   *  it selects the heavier type-to-confirm tier, so reporting `"mass-delete"`
   *  here would silently downgrade friction on the case that most needs it. */
  refusedBy: "full-wipe" | "mass-delete" | null;
}

/** L3 + Layer B, the two invariants at the persistence choke point.
 *
 *  L3 — a full wipe of a project that had at least TWO non-empty collections.
 *  Protects small projects, where a record-count fraction is meaningless.
 *
 *  Layer B — an unexplained MASS deletion. `isMassDeletion` owns the exact
 *  thresholds (defaults today: at least 5 records removed, leaving at most 10%
 *  of the prior total) — read them there rather than trusting this line, since
 *  they are parameters with defaults, not constants. Protects big projects,
 *  catching the partial-but-catastrophic loss L3 misses. */
export function evaluateSaveGuard(input: SaveGuardInput): SaveGuardVerdict {
  const { prevCollections, prevRecords, curCollections, curRecords, allowDestructive } = input;
  const fullWipe = curCollections === 0 && prevCollections >= 2;
  const massDelete = isMassDeletion(prevRecords, curRecords);
  if ((fullWipe || massDelete) && !allowDestructive) {
    return { refuse: true, forensic: false, refusedBy: fullWipe ? "full-wipe" : "mass-delete" };
  }
  return { refuse: false, forensic: curCollections === 0 && prevCollections === 1, refusedBy: null };
}
