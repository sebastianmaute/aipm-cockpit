// src/app/timelog-actuals.ts — pure, i18n-free aggregation of Timelog bookings.
import type { PlanGranularity } from "./types";
import { periodKeyForDate } from "./resource-capacity";
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

export type HourCell = { hours: number; billableHours: number };
export type ActualsByBucket = Record<number, Record<string, HourCell>>;
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
    byBucket[bucketId][pk] = add(byBucket[bucketId][pk], it);
  }
  return { byBucket, byResource, unattributed };
}
