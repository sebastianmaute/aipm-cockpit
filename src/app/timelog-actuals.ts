// src/app/timelog-actuals.ts — pure, i18n-free aggregation of Timelog bookings.
import type { PlanGranularity } from "./types";
import { periodKeyForDate } from "./resource-capacity";
import { dailyKey, type TimelogDailyRoll } from "./timelog-types";
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

export type HourCell = { hours: number; billableHours: number };
/** A bucket·period total PLUS the per-resource breakdown that produced it.
 *  The breakdown is what lets apply attribute hours to the right role line —
 *  without it apply can only guess, and it guessed allocations[0], costing
 *  every person at the first role's rate. Structural SUPERSET of HourCell, so
 *  readers of `.hours`/`.billableHours` (the overlay display) are unchanged.
 *  Invariant: the breakdown sums to the total (pinned by a test).
 *
 *  OPTIONAL on purpose: the actuals cache (`aipm-cockpit:timelog-actuals`) is
 *  persisted per-device and its guard only shallow-checks `aggregates`, so an
 *  entry written before this field existed deserializes without it. Aggregation
 *  always writes it; readers must tolerate its absence (apply treats those hours
 *  as unattributable and surfaces them rather than guessing). */
export type BucketPeriodCell = HourCell & { byResource?: Record<number, HourCell> };
export type ActualsByBucket = Record<number, Record<string, BucketPeriodCell>>;
export type ActualsByResource = Record<number, HourCell>;
export type ActualsAggregate = {
  byBucket: ActualsByBucket;
  byResource: ActualsByResource;
  unattributed: HourCell;
};

const add = (cell: HourCell | undefined, it: TimelogTimeItem): HourCell => ({
  hours: (cell?.hours ?? 0) + it.hours,
  billableHours: (cell?.billableHours ?? 0) + it.billableHours,
});

export function aggregateActuals(
  items: readonly TimelogTimeItem[],
  links: TimelogLinks,
  // Required (no default): the period key MUST be derived with the SAME
  // granularity the budget report sums over (plan.granularity), or applied
  // hours land under keys the report never reads and drop silently from EVM.
  // A missing arg is a tsc error, not a silent month fallback.
  granularity: PlanGranularity,
): ActualsAggregate {
  const userToRes = new Map(links.userLinks.map((l) => [l.timelogUserId, l.resourceId]));
  const projToBucket = new Map(links.projectLinks.map((l) => [l.timelogProjectId, l.bucketId]));
  const byBucket: ActualsByBucket = {};
  const byResource: ActualsByResource = {};
  let unattributed: HourCell = { hours: 0, billableHours: 0 };

  for (const it of items) {
    const resourceId = userToRes.get(it.userId);
    const bucketId = projToBucket.get(it.projectId);
    if (resourceId === undefined || bucketId === undefined || bucketId === null) {
      unattributed = add(unattributed, it);
      continue;
    }
    byResource[resourceId] = add(byResource[resourceId], it);
    const pk = periodKeyForDate(it.date, granularity);
    byBucket[bucketId] ??= {};
    const cur = byBucket[bucketId][pk];
    // Keep the resource dimension ON the cell. It was computed above and then
    // discarded here, which is where per-role attribution became impossible.
    byBucket[bucketId][pk] = {
      ...add(cur, it),
      byResource: { ...cur?.byResource, [resourceId]: add(cur?.byResource?.[resourceId], it) },
    };
  }
  return { byBucket, byResource, unattributed };
}

/**
 * Per-(user, date) roll — the input to the guardrail rules.
 *
 * ★★★ SEPARATE FROM `aggregateActuals` ON PURPOSE, and the difference is the
 * point. Aggregation answers "how do these hours attribute to budget buckets",
 * so it collapses the date to a period key, sums per-entry hours away, and
 * folds every unlinked item into `unattributed`. The rules ask "what did this
 * PERSON book that day", so the roll keeps the calendar date, keeps the largest
 * single entry, and keeps non-project time — it is still their time.
 *
 * Sparse: only (user, date) pairs that carry bookings get a key.
 */
export function buildDailyRoll(items: readonly TimelogTimeItem[]): TimelogDailyRoll {
  const out: TimelogDailyRoll = {};
  for (const it of items) {
    const k = dailyKey(it.userId, it.date);
    const cur = out[k];
    if (cur === undefined) {
      out[k] = { hours: it.hours, maxEntryHours: it.hours, entryCount: 1 };
      continue;
    }
    cur.hours += it.hours;
    if (it.hours > cur.maxEntryHours) cur.maxEntryHours = it.hours;
    cur.entryCount += 1;
  }
  return out;
}
