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
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { buildApplyPlan } from "./timelog-apply";
import { loadActualsCache } from "./timelog-actuals-store";
import { pickMatchableResources } from "./timelog-matchable";
import { INTERACTIVE } from "./interaction-styles";
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
 * absorbed. Two signals, because they are two different states:
 *
 *  - READY TO APPLY — the cached overlay yields plan rows against the live
 *    buckets. Editing allocations here is exactly what creates them, and the
 *    Budget view otherwise has no affordance pointing at Timelog at all.
 *  - STALE ATTRIBUTION — `unattributed.hours` is non-zero. Those hours were
 *    never placed on a bucket at fetch time, and the aggregate keeps no
 *    resource / project / period dimension, so nothing can re-derive them.
 *
 * Renders nothing when both are zero, and never nags an untouched project: a
 * missing, empty or malformed cache is the empty state.
 */
export function BudgetUnappliedNotice({
  lang, projectId, buckets, roles, resources, onGoToTimelog,
}: BudgetUnappliedNoticeProps) {
  const aggregates = useMemo(() => loadActualsCache(projectId)?.aggregates, [projectId]);
  const affected = useMemo(() => {
    if (!aggregates?.byBucket) return 0;
    const rows = buildApplyPlan(buckets, aggregates.byBucket, pickMatchableResources(resources), roles).rows;
    return new Set(rows.map((r) => r.bucketId)).size;
  }, [aggregates, buckets, resources, roles]);

  // A hand-written or pre-upgrade cache entry can carry anything under
  // `aggregates` — `isEntry` only shallow-checks that it is an object — so an
  // absent or non-numeric total must read as "nothing to report", never NaN.
  const rawUnattributed = aggregates?.unattributed?.hours;
  const unattributed = typeof rawUnattributed === "number" && Number.isFinite(rawUnattributed)
    ? rawUnattributed
    : 0;

  if (affected === 0 && unattributed === 0) return null;

  return (
    <div className="mb-2 flex shrink-0 items-start gap-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs print:hidden">
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ui-dark-blue dark:text-ui-light-grey" />
      <div className="flex-1 space-y-1">
        {affected > 0 && (
          <p className="text-foreground">{t(lang, "budgetUnappliedActuals", String(affected))}</p>
        )}
        {unattributed !== 0 && (
          <p className="text-muted-foreground">
            {t(lang, "budgetUnattributedActuals", formatHours(unattributed))}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onGoToTimelog}
        className={`shrink-0 font-medium text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-light-grey ${INTERACTIVE}`}
      >
        {t(lang, "budgetUnappliedActualsGo")}
        <span aria-hidden="true"> →</span>
      </button>
    </div>
  );
}
