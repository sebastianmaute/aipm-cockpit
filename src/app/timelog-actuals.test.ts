import { describe, it, expect } from "vitest";
import { aggregateActuals, buildDailyRoll } from "./timelog-actuals";
import { periodKeyForDate, generatePeriods } from "./resource-capacity";
import { parseDailyKey } from "./timelog-types";
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

// timeRegistrationId/taskId are ignored scaffolding — the engine keys only on userId/projectId/date/hours.
const item = (userId: number, projectId: number, date: string, hours: number, billable = hours): TimelogTimeItem =>
  ({ timeRegistrationId: 0, userId, projectId, projectName: "", projectNo: "", taskId: 0, date, hours, billableHours: billable, isBillable: billable > 0 });

const links: TimelogLinks = {
  userLinks: [{ timelogUserId: 5, resourceId: 2, manual: false }],
  projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }],
};

describe("aggregateActuals", () => {
  it("sums mapped hours into byBucket[bucketId][period]", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-06-20", 2)], links, "month");
    // toMatchObject, not toEqual: the cell also carries the per-resource
    // breakdown apply needs. This assertion is about the TOTALS.
    expect(out.byBucket[7]["2026-06"]).toMatchObject({ hours: 6, billableHours: 6 });
  });
  it("splits hours across distinct period keys", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-07-01", 3)], links, "month");
    expect(out.byBucket[7]["2026-06"].hours).toBe(4);
    expect(out.byBucket[7]["2026-07"].hours).toBe(3);
  });
  // The bucket·period TOTAL alone cannot be attributed to a role downstream:
  // apply had to guess, and guessed allocations[0], costing everyone at the
  // first role's rate. The breakdown that makes attribution possible must
  // survive aggregation — it is available here and was being discarded.
  it("keeps the per-resource breakdown inside each bucket·period cell", () => {
    const twoPeople: TimelogLinks = {
      userLinks: [
        { timelogUserId: 5, resourceId: 2, manual: false },
        { timelogUserId: 6, resourceId: 3, manual: false },
      ],
      projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }],
    };
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(6, 9, "2026-06-11", 2), item(5, 9, "2026-06-12", 1)],
      twoPeople,
      "month",
    );
    const cell = out.byBucket[7]["2026-06"];
    expect(cell.hours).toBe(7); // total unchanged
    // The field is optional on the TYPE (a pre-breakdown persisted cache has no
    // such key), so assert aggregation actually produced it.
    expect(cell.byResource).toBeDefined();
    expect(cell.byResource?.[2]).toEqual({ hours: 5, billableHours: 5 });
    expect(cell.byResource?.[3]).toEqual({ hours: 2, billableHours: 2 });
  });

  // The breakdown must always reconcile to the total it sits on, or apply and
  // the overlay display would disagree about the same bucket.
  it("breakdown sums to the cell total", () => {
    const twoPeople: TimelogLinks = {
      userLinks: [
        { timelogUserId: 5, resourceId: 2, manual: false },
        { timelogUserId: 6, resourceId: 3, manual: false },
      ],
      projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }],
    };
    // Person 5 books TWICE in the period on purpose: with one booking each, an
    // implementation that OVERWRITES per resource instead of accumulating still
    // sums correctly, so the invariant this test is named for would go unguarded.
    const out = aggregateActuals(
      [
        item(5, 9, "2026-06-10", 4, 4),
        item(6, 9, "2026-06-11", 2, 0),
        item(5, 9, "2026-06-12", 3, 3),
      ],
      twoPeople,
      "month",
    );
    const cell = out.byBucket[7]["2026-06"];
    expect(cell.byResource).toBeDefined();
    const summed = Object.values(cell.byResource ?? {}).reduce(
      (acc, c) => ({ hours: acc.hours + c.hours, billableHours: acc.billableHours + c.billableHours }),
      { hours: 0, billableHours: 0 },
    );
    expect(summed).toEqual({ hours: cell.hours, billableHours: cell.billableHours });
  });

  it("aggregates per resource", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)], links, "month");
    expect(out.byResource[2]).toEqual({ hours: 4, billableHours: 4 });
  });
  it("routes unmapped user OR unmapped project hours to unattributed (never dropped)", () => {
    const out = aggregateActuals([item(5, 999, "2026-06-10", 3), item(404, 9, "2026-06-10", 5)], links, "month");
    expect(out.unattributed.hours).toBe(8);
    expect(out.byBucket[7]).toBeUndefined();
    expect(Object.keys(out.byResource).length).toBe(0);
  });
  it("maps a bucketId:null project link to unattributed", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)],
      { userLinks: links.userLinks, projectLinks: [{ timelogProjectId: 9, bucketId: null, manual: true }] }, "month");
    expect(out.unattributed.hours).toBe(4);
    expect(Object.keys(out.byResource).length).toBe(0);
  });

  it("week granularity: aggregates under YYYY-Www key, NOT YYYY-MM", () => {
    // 2026-06-10 is Wednesday; belongs to ISO week 2026-W24
    const expectedKey = periodKeyForDate("2026-06-10", "week");
    // Verify via generatePeriods that the key is correct
    const periods = generatePeriods("2026-06-08", "2026-06-14", "week");
    const containingPeriod = periods.find((p) => p.start <= "2026-06-10" && "2026-06-10" <= p.end);
    expect(expectedKey).toBe(containingPeriod?.key);

    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-06-11", 2)], links, "week");
    // Hours must land under the weekly key, not the monthly key
    expect(out.byBucket[7][expectedKey]).toMatchObject({ hours: 6, billableHours: 6 });
    expect(out.byBucket[7]["2026-06"]).toBeUndefined();
  });

  // `timelog-api.ts` coerces `Date` through `dateOnly = s(v).slice(0, 10)`, and
  // `s` returns "" for anything non-string — so an absent, null or numeric Date
  // arrives as `date: ""`, and a regionally formatted "05/01/2026" is exactly
  // ten characters and survives the slice intact. `periodKeyForDate` then mints
  // a key no rendered column matches (measured: month "" and "05/01/2", week
  // "NaN-WNaN" for both), so real hours vanish from the Budget view with no
  // diagnostic. Unattributable to a period ⇒ `unattributed`, like an unlinked row.
  it("routes a malformed-date row to unattributed instead of a phantom month key", () => {
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(5, 9, "", 3), item(5, 9, "05/01/2026", 2)],
      links,
      "month",
    );
    expect(out.unattributed).toEqual({ hours: 5, billableHours: 5 });
    // The junk keys `periodKeyForDate` would have minted must not exist at all.
    expect(Object.keys(out.byBucket[7])).toEqual(["2026-06"]);
    expect(out.byBucket[7][""]).toBeUndefined();
    expect(out.byBucket[7]["05/01/2"]).toBeUndefined();
  });

  // ★★ THE DOUBLE-COUNT GUARD. `byResource[resourceId] = add(...)` is written
  // BEFORE `periodKeyForDate` is reached, so a date guard placed after that
  // write counts the same hours in `byResource` AND in `unattributed` — a
  // silent inflation of every per-resource total. The good row alongside is
  // what makes the assertion say "only the good hours", not merely "non-zero".
  it("does not double-count a malformed-date row into byResource", () => {
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(5, 9, "", 3)],
      links,
      "month",
    );
    expect(out.unattributed).toEqual({ hours: 3, billableHours: 3 });
    expect(out.byResource[2]).toEqual({ hours: 4, billableHours: 4 });
  });

  it("week granularity: a malformed date does not mint the NaN-WNaN key", () => {
    const good = periodKeyForDate("2026-06-10", "week");
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(5, 9, "", 3), item(5, 9, "05/01/2026", 2)],
      links,
      "week",
    );
    expect(Object.keys(out.byBucket[7])).toEqual([good]);
    expect(out.byBucket[7]["NaN-WNaN"]).toBeUndefined();
    expect(out.unattributed.hours).toBe(5);
  });

  // Anti-vacuity control: a guard that fired unconditionally would satisfy every
  // assertion above. A wholly well-formed fixture must still attribute in full,
  // with nothing diverted.
  it("leaves a wholly well-formed fixture fully attributed", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-07-01", 3)], links, "month");
    expect(out.unattributed).toEqual({ hours: 0, billableHours: 0 });
    expect(out.byBucket[7]["2026-06"].hours).toBe(4);
    expect(out.byBucket[7]["2026-07"].hours).toBe(3);
    expect(out.byResource[2]).toEqual({ hours: 7, billableHours: 7 });
  });

  it("week granularity: items in different weeks get distinct keys", () => {
    // 2026-06-10 (Wed, W24) and 2026-06-15 (Mon, W25)
    const keyW24 = periodKeyForDate("2026-06-10", "week");
    const keyW25 = periodKeyForDate("2026-06-15", "week");
    expect(keyW24).not.toBe(keyW25);

    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-06-15", 3)], links, "week");
    expect(out.byBucket[7][keyW24].hours).toBe(4);
    expect(out.byBucket[7][keyW25].hours).toBe(3);
  });
});

describe("buildDailyRoll", () => {
  const item = (userId: number, date: string, hours: number): TimelogTimeItem => ({
    timeRegistrationId: Math.round(Math.random() * 1e9),
    userId, projectId: 1, projectName: "P", projectNo: "1", taskId: 1,
    date, hours, billableHours: hours, isBillable: true,
  });

  it("sums hours per user and date and records the largest single entry", () => {
    const roll = buildDailyRoll([
      item(7, "2026-09-01", 3),
      item(7, "2026-09-01", 4.5),
      item(7, "2026-09-02", 8),
      item(9, "2026-09-01", 2),
    ]);
    expect(roll).toEqual({
      "7|2026-09-01": { hours: 7.5, maxEntryHours: 4.5, entryCount: 2 },
      "7|2026-09-02": { hours: 8, maxEntryHours: 8, entryCount: 1 },
      "9|2026-09-01": { hours: 2, maxEntryHours: 2, entryCount: 1 },
    });
  });

  // ★★ The roll must NOT reproduce aggregateActuals' attribution: it is the
  // input to rules about a PERSON's day, and an unlinked project is still that
  // person's time. Dropping ProjectID 0 (absence / non-project time) here would
  // make the daily total under-report against the very cap it is checked by.
  it("keeps non-project time, which aggregation folds into unattributed", () => {
    const zero = { ...item(7, "2026-09-01", 5), projectId: 0, projectName: "", projectNo: "" };
    expect(buildDailyRoll([zero])["7|2026-09-01"]).toEqual({
      hours: 5, maxEntryHours: 5, entryCount: 1,
    });
  });

  // ★★ `mapV2TimeItem` (timelog-api.ts) maps an employee whose EmployeeInitials
  // do not resolve against the directory to `userId: 0`. Unfiltered, every one
  // of them merges into a single `0|<date>` cell holding summed hours no
  // individual booked, and the guardrail rules then report a cap violation for
  // a person who does not exist — persisted into the shared insights slice.
  // TWO sentinel items share a date ON PURPOSE: with only one, "dropped" and
  // "kept but not summed" are indistinguishable. The real booker alongside them
  // is the anti-vacuity control — "no 0 key" is also true of an empty roll.
  it("drops the unidentified-booker sentinel instead of summing it into a phantom day", () => {
    const roll = buildDailyRoll([
      item(0, "2026-09-01", 8),
      item(0, "2026-09-01", 8),
      item(7, "2026-09-01", 6),
    ]);
    expect(roll["0|2026-09-01"]).toBeUndefined();
    // The identified booker is untouched — the filter must not widen past the sentinel.
    expect(roll["7|2026-09-01"]).toEqual({ hours: 6, maxEntryHours: 6, entryCount: 1 });
    expect(Object.keys(roll)).toEqual(["7|2026-09-01"]);
  });

  // ★★★ THESE TWO PIN A KEY THAT LOOKS LIKE A BUG AND IS THE SAFETY PROPERTY.
  // A malformed date must reach the roll as an UNPARSEABLE KEY, because that key
  // is the only production signal that the roll is not fully readable:
  // `parseDailyKey` rejects it → `evaluateTimelogPolicy` sets its per-roll
  // `skipped` flag → the guardrail rules are withheld from `evaluated` →
  // `reconcileInsights` freezes instead of resolving. Filtering these rows out
  // makes the rules certify a clean day for hours nobody could place, and the
  // reconcile then writes a fabricated "improved" into exported data. That
  // filter was written, shipped and reverted on 2026-09-07 (open-followups
  // §431); these tests exist so it cannot come back quietly.
  // ★ `parseDailyKey` is asserted directly rather than trusting the key's shape:
  // the claim is "the policy engine cannot read this", and that predicate IS the
  // policy engine's reader. Asserting only `roll["7|"]` would still pass if the
  // parser were later loosened to accept it.
  it("keeps a blank-date row as an unparseable key, so the roll reads as incomplete", () => {
    const roll = buildDailyRoll([
      item(7, "", 8),
      item(7, "2026-09-01", 6),
    ]);
    expect(roll["7|"]).toEqual({ hours: 8, maxEntryHours: 8, entryCount: 1 });
    expect(parseDailyKey("7|")).toBeNull();
    // The good row still rolls up normally — the bad key must not cost it.
    expect(roll["7|2026-09-01"]).toEqual({ hours: 6, maxEntryHours: 6, entryCount: 1 });
  });

  // The ten-character regional case: `dateOnly`'s `.slice(0, 10)` is a no-op on
  // it, so it reaches the roll looking like a date and is not one.
  it("keeps a regionally formatted date as an unparseable key", () => {
    const roll = buildDailyRoll([
      item(7, "05/01/2026", 8),
      item(7, "2026-09-01", 6),
    ]);
    expect(roll["7|05/01/2026"]).toEqual({ hours: 8, maxEntryHours: 8, entryCount: 1 });
    expect(parseDailyKey("7|05/01/2026")).toBeNull();
    expect(roll["7|2026-09-01"]).toEqual({ hours: 6, maxEntryHours: 6, entryCount: 1 });
  });

  it("returns an empty roll for no items", () => {
    expect(buildDailyRoll([])).toEqual({});
  });
});
