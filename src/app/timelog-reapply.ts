// src/app/timelog-reapply.ts — the pure decision behind "Refresh & re-apply".
//
// Pure and i18n-free: the panel awaits the re-fetch, hands the RESULT here, and
// does exactly what comes back. Extracted from `timelog-panel.tsx` both because
// that file sits against the 800-line ratchet and because the decision has three
// outcomes with a data-loss trap in one of them — a shape worth unit-testing
// without a render.
//
// WHY the button exists at all: attribution is baked at FETCH time.
// `aggregateActuals` resolves BOTH dimensions while aggregating, from TWO maps
// built out of the link table at that moment:
//   • TimeLog user id → `resourceId`   (`links.userLinks`)
//   • TimeLog project id → `bucketId`  (`links.projectLinks`)
// A miss on EITHER folds the booking into the dimensionless `unattributed`
// scalar, which keeps no resource / project / period, so nothing downstream can
// re-derive it. Fixing one of those two links afterwards therefore changes
// nothing in the cached aggregate, and re-applying cannot recover those hours —
// only a re-fetch re-resolves them.
//
// ★★ SCOPE THAT TO THE TWO LINK MAPS AND NOTHING ELSE. Everything the BUDGET
//    side owns is re-evaluated live from the cached overlay on every render:
//    `buildApplyPlan` reads the CURRENT buckets, so adding an allocation line to
//    a bucket, or naming a resource on one, changes the plan with no re-fetch at
//    all. An earlier revision of this note offered "adding a resource to a
//    bucket" as its example of something a re-fetch is needed for, which is a
//    counter-example to the very claim it was illustrating.
import { buildApplyPlan } from "./timelog-apply";
import type { ActualsAggregate, ActualsByBucket } from "./timelog-actuals";
import type { BudgetBucket, Resource, Role } from "./types";

/** What `fetchBookingsForProjects` hands back. `aggregates` is absent whenever
 *  `finish()` was deliberately not run (no projects picked, abort, error). */
export interface ReapplyFetchResult {
  failedProjects: number;
  projectCount: number;
  aggregates?: ActualsAggregate;
}

export type ReapplyOutcome =
  /** Say nothing further — the refresh already surfaced why. */
  | { kind: "abort" }
  /** Fetched cleanly; the buckets already hold what it resolved. */
  | { kind: "nothing" }
  /** Open the confirm dialog on THIS overlay. */
  | { kind: "confirm"; overlay: ActualsByBucket };

/**
 * Decide what a completed re-fetch should do.
 *
 * ★★★ A PARTIAL FETCH ABORTS, and this is the data-loss guard, not tidiness.
 * `applyActualsToBuckets` OWNS every allocation line of a period it routes and
 * writes the non-booking ones to `0` — that ownership is what lets a re-apply
 * clear a stale total. But `use-timelog-sync`'s `finish()` runs on whatever WAS
 * fetched, so when one of several TimeLog projects feeding a bucket throws, the
 * aggregate is well-formed, yields rows, and is simply missing that project's
 * hours. Confirming it re-applies the bucket at the smaller figure and the
 * difference is ERASED — real booked hours gone, one click behind a dialog that
 * opened on top of a toast saying the refresh finished. The caller already
 * toasted the partial failure (`guardTimelogPartialProjectFetch`), so there is
 * nothing to add here; there is simply no aggregate fit to write from.
 *
 * ★★ "Present and non-empty" is NOT the test — a partial aggregate passes both.
 * Gate on `failedProjects`, which is the only thing that knows.
 */
export function decideReapply(
  result: ReapplyFetchResult | undefined,
  buckets: readonly BudgetBucket[],
  /** Already narrowed by `pickMatchableResources` — the plan and the write must
   *  resolve people identically, so hand this the SAME list the panel memo does. */
  resources: readonly Resource[],
  roles: readonly Role[],
): ReapplyOutcome {
  if (!result || result.failedProjects > 0) return { kind: "abort" };
  const overlay = result.aggregates?.byBucket;
  // Absent on the no-projects-picked branch, on an abort, and on any error — in
  // each of those nothing was re-attributed, so there is no fresh diff and the
  // dialog must not open on the stale one.
  if (!overlay) return { kind: "abort" };
  // An empty plan would open the dialog reading "Apply 0 bucket changes" over an
  // empty list, with a live Apply button and Fetch/Refresh/Clear-all disabled
  // behind it — the failure state of the exact journey this button serves.
  if (buildApplyPlan(buckets, overlay, resources, roles).rows.length === 0) return { kind: "nothing" };
  return { kind: "confirm", overlay };
}
