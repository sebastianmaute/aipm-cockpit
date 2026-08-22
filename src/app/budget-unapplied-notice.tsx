"use client";
// Read-only notice over the cached TimeLog actuals.
//
// ★ Reads the actuals cache DIRECTLY rather than lifting useTimelogSync out of
//   the Timelog panel. The cache is plain localStorage and buildApplyPlan is
//   pure, so this costs one memo and no network.
// ★★ READ-ONLY BY DESIGN. Applying stays behind the confirm dialog, which
//   freezes the overlay and the budget baseline and refuses on a drifted
//   baseline. These are hand-editable money figures; nothing writes them here.
// ★★★ ATTRIBUTION IS FROZEN AT FETCH TIME, so a link fixed now changes nothing
//   until a re-fetch — while the People/Projects tables render that link as
//   healthy because they recompute live. That contradiction is the reported
//   bug, and the unattributed branch below is the only place the app admits it.
import { useMemo } from "react";
import { ExclamationTriangleIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { buildApplyPlan, bucketsMissingAllocations } from "./timelog-apply";
import { loadActualsCache } from "./timelog-actuals-store";
import { pickMatchableResources } from "./timelog-matchable";
import { TextButton } from "./text-button";
import type { BudgetBucket, Resource, Role } from "./types";

interface BudgetUnappliedNoticeProps {
  lang: Lang;
  /** Cache key — the SAME one TimelogPanel writes under (`currentProjectId ??
   *  "default"`). A different fallback reads an empty cache and says nothing. */
  projectId: string;
  buckets: readonly BudgetBucket[];
  roles: readonly Role[];
  /** The FULL directory as `workspace-section` threads it. Filtered here, never
   *  passed on raw — see `pickMatchableResources`. */
  resources: readonly Resource[];
  onGoToTimelog: () => void;
}

/** 1dp, trailing ".0" trimmed — matching the Timelog panel's own withheld-hours
 *  line. `Math.round` would print a residual -0.4 as "0h", i.e. a notice that
 *  contradicts itself. */
function formatHours(hours: number): string {
  return hours.toFixed(1).replace(/\.0$/, "");
}

/**
 * The Budget-side pointer at fetched TimeLog bookings the buckets have not
 * absorbed. FOUR signals, because they are four different states — and the two
 * middle ones are the reason this component was rewritten:
 *
 *  - READY TO APPLY — the cached overlay yields plan rows against the live
 *    buckets. Editing allocations here is exactly what creates them, and the
 *    Budget view otherwise has no affordance pointing at Timelog at all.
 *  - NO LINE TO HOLD THEM — a bucket carries booked hours but has no role or
 *    discipline allocation. `routeBucket` returns null for it and
 *    `buildApplyPlan` `continue`s, so it is not even recorded as unmatched;
 *    `bucketsMissingAllocations` is the only thing that can see it.
 *  - WITHHELD — hours DID land on a bucket but match none of its lines
 *    (unlinked person, no directory role, or a role with no line here). They
 *    are never written, so the bucket reads low by exactly that much.
 *  - STALE ATTRIBUTION — `unattributed.hours` is non-zero. Those hours were
 *    never placed on a bucket at fetch time, and the aggregate keeps no
 *    resource / project / period dimension, so nothing can re-derive them.
 *
 * ★★★ THE MIDDLE TWO PRODUCED NO SIGNAL AT ALL, which inverted the feature:
 *     they yield no plan rows, and `unattributed` is 0 for them precisely
 *     BECAUSE the hours were placed on a bucket — so the notice first appeared
 *     only once the user had added the missing line, i.e. after they had fixed
 *     the thing it existed to warn them about.
 *
 * Renders nothing when all four are zero, and never nags an untouched project:
 * a missing, empty or malformed cache is the empty state.
 *
 * ★★★ A PARTIAL cache entry REPLACES all four with a single line — see the
 *     `partial` const below for why suppressing them is the honest answer and
 *     annotating them is not.
 */
export function BudgetUnappliedNotice({
  lang, projectId, buckets, roles, resources, onGoToTimelog,
}: BudgetUnappliedNoticeProps) {
  const entry = useMemo(() => loadActualsCache(projectId), [projectId]);
  const aggregates = entry?.aggregates;
  // ★★★ A PARTIAL FETCH SUPPRESSES ALL FOUR SIGNALS — not just the first one.
  // Every one of them is DERIVED from this overlay (`affected` and `withheld`
  // by running `buildApplyPlan` over it, `missing` by
  // `bucketsMissingAllocations`, `unattributed` by having been summed during
  // the same short fetch), so on a partial entry all four describe hours that
  // the Timelog panel refuses to write. Reporting any of them here would send
  // the user down a "Go to Time bookings →" that ends on a disabled Apply, and
  // would surface the very erasure §172 exists to prevent as though it were
  // work waiting to be done. One honest line instead, and the Go button still
  // reaches the Refresh that repairs it. See open-followups §172.
  const partial = entry?.partial === true;
  // Keep the WHOLE plan. Discarding everything but `.rows` is what made this
  // notice silent in the reported state — see the WITHHELD bullet above.
  const plan = useMemo(
    () =>
      aggregates?.byBucket
        ? buildApplyPlan(buckets, aggregates.byBucket, pickMatchableResources(resources), roles)
        : null,
    [aggregates, buckets, resources, roles],
  );
  const affected = useMemo(() => new Set((plan?.rows ?? []).map((r) => r.bucketId)).size, [plan]);
  const withheld = plan?.unmatchedBuckets.length ?? 0;
  // A SEPARATE query over the same overlay, not a slice of the plan:
  // `routeBucket` returns null for a bucket with no target allocation and
  // `buildApplyPlan` `continue`s, so such a bucket never reaches
  // `unmatchedBuckets` and the plan cannot see it at all.
  const missing = useMemo(
    () => (aggregates?.byBucket ? bucketsMissingAllocations(buckets, aggregates.byBucket).length : 0),
    [aggregates, buckets],
  );

  // A hand-written or pre-upgrade cache entry can carry anything under
  // `aggregates` — `isEntry` only shallow-checks that it is an object — so an
  // absent or non-numeric total must read as "nothing to report", never NaN.
  const rawUnattributed = aggregates?.unattributed?.hours;
  const unattributed = typeof rawUnattributed === "number" && Number.isFinite(rawUnattributed)
    ? rawUnattributed
    : 0;

  if (!partial && affected === 0 && unattributed === 0 && withheld === 0 && missing === 0) return null;

  return (
    <div className="mb-2 flex shrink-0 items-start gap-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs print:hidden">
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ui-dark-blue dark:text-ui-light-grey" />
      <div className="flex-1 space-y-1">
        {partial && <p className="text-foreground">{t(lang, "timelogApplyPartial")}</p>}
        {!partial && affected > 0 && (
          <p className="text-foreground">{t(lang, "budgetUnappliedActuals", String(affected))}</p>
        )}
        {!partial && missing > 0 && (
          <p className="text-muted-foreground">
            {t(lang, "timelogApplyNoAllocation", String(missing))}
          </p>
        )}
        {!partial && withheld > 0 && (
          // Gated on the bucket LIST, not the hour total — a +40/-40 credit
          // correction nets to zero while hours are still withheld. Same
          // wording and same 1dp formatting the Timelog panel uses, so the two
          // surfaces cannot describe one cache differently.
          <p className="text-muted-foreground">
            {t(lang, "timelogApplyUnmatched", String(withheld), formatHours(plan?.unmatchedHours ?? 0))}
          </p>
        )}
        {!partial && unattributed !== 0 && (
          <p className="text-muted-foreground">
            {t(lang, "budgetUnattributedActuals", formatHours(unattributed))}
          </p>
        )}
      </div>
      <TextButton onClick={onGoToTimelog} className="shrink-0">
        {t(lang, "budgetUnappliedActualsGo")}
        <span aria-hidden="true"> →</span>
      </TextButton>
    </div>
  );
}
