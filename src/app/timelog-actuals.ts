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

/** Can this ROW be attributed to a day or to a period at all?
 *
 *  ★★ DELIBERATELY LOCAL, and deliberately NOT `timelog-types.ts`'s
 *  `KEY_DATE_RE`. That one is a KEY rule — "is this daily-roll key usable?" —
 *  and its docstring argues at length why the identical `^\d{4}-\d{2}-\d{2}$`
 *  shape declared in several modules must stay several constants: each answers
 *  a different question and the answers are free to move apart. This one is a
 *  ROW rule, applied before a key or a period is minted at all. One constant
 *  serves BOTH consumers IN THIS FILE, so `buildDailyRoll` and
 *  `aggregateActuals` cannot drift from each other — which is the only coupling
 *  worth having here.
 *
 *  ★ SHAPE, never existence — `9999-99-99` is admitted, matching the sibling
 *  rule. The point is to reject a date that is not a calendar day at all, not
 *  to certify that the day happened.
 *
 *  Why rows arrive malformed: `timelog-api.ts` coerces every API field through
 *  `dateOnly = (v) => s(v).slice(0, 10)` where `s` yields "" for a non-string.
 *  So an absent, null or numeric `Date` becomes `""`, and a regionally
 *  formatted `"05/01/2026"` is exactly ten characters and survives the slice
 *  untouched. Neither is a day. */
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    // ★★★ PLACEMENT IS LOAD-BEARING: this MUST stay above the `byResource`
    // write. `periodKeyForDate` is only reached further down, so the intuitive
    // spot — beside the call whose output is junk — is AFTER that write, and a
    // guard there counts the same hours in `byResource` AND in `unattributed`.
    // A row is unattributable to a PERIOD exactly as an unlinked row is
    // unattributable to a BUCKET, so it takes the same exit, for the same
    // reason, at the same point. Measured on the malformed dates this file's
    // ISO_DAY_RE docstring lists: month keys "" and "05/01/2", week key
    // "NaN-WNaN" for both — phantom buckets matching no rendered column, so the
    // hours silently disappear from the Budget view rather than being surfaced.
    if (resourceId === undefined || bucketId === undefined || bucketId === null || !ISO_DAY_RE.test(it.date)) {
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
    // Drop the unidentified-booker SENTINEL. `mapV2TimeItem` (timelog-api.ts)
    // resolves `EmployeeInitials` against the directory and falls back to
    // `userId: 0` via its `|| 0`, so without this every employee the directory
    // could not identify sums into ONE `0|<date>` cell — three unresolved
    // people booking 8h each become a 24h day, and the guardrail rules report
    // a cap violation for a person who does not exist. `use-timelog-sync.ts`
    // already filters `id > 0` when it builds the People table; the roll
    // honours the same convention.
    // ★ NARROW ON PURPOSE: an UNLINKED booker (a real positive userId with no
    // TimelogUserLink) must still be measured — see the "deliberately
    // links-independent" comment at the buildDailyRoll call site. Only the
    // non-positive sentinel is excluded.
    if (it.userId <= 0) continue;
    // Drop a row that carries no calendar day. The rules ask "did this person
    // exceed a cap ON THIS DAY", and such a row has no day to test against —
    // there is no correct cell for it, and the alternative to dropping it is
    // not counting it correctly but counting it on a phantom one. A blank date
    // mints `"7|"`, which `parseDailyKey` rejects, which sets
    // `evaluateTimelogPolicy`'s per-roll `skipped` flag and withholds all four
    // guardrail rules from `evaluated` for EVERY user in the roll until a clean
    // fetch — one junk row freezing the whole surface.
    if (!ISO_DAY_RE.test(it.date)) continue;
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
