import { describe, it, expect } from "vitest";
import { aggregateActuals } from "./timelog-actuals";
import { periodKeyForDate, generatePeriods } from "./resource-capacity";
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
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-06-20", 2)], links);
    expect(out.byBucket[7]["2026-06"]).toEqual({ hours: 6, billableHours: 6 });
  });
  it("splits hours across distinct period keys", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-07-01", 3)], links);
    expect(out.byBucket[7]["2026-06"].hours).toBe(4);
    expect(out.byBucket[7]["2026-07"].hours).toBe(3);
  });
  it("aggregates per resource", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)], links);
    expect(out.byResource[2]).toEqual({ hours: 4, billableHours: 4 });
  });
  it("routes unmapped user OR unmapped project hours to unattributed (never dropped)", () => {
    const out = aggregateActuals([item(5, 999, "2026-06-10", 3), item(404, 9, "2026-06-10", 5)], links);
    expect(out.unattributed.hours).toBe(8);
    expect(out.byBucket[7]).toBeUndefined();
    expect(Object.keys(out.byResource).length).toBe(0);
  });
  it("maps a bucketId:null project link to unattributed", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)],
      { userLinks: links.userLinks, projectLinks: [{ timelogProjectId: 9, bucketId: null, manual: true }] });
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
    expect(out.byBucket[7][expectedKey]).toEqual({ hours: 6, billableHours: 6 });
    expect(out.byBucket[7]["2026-06"]).toBeUndefined();
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

  it("default granularity (month) is backward-compatible", () => {
    // Calling without granularity arg must still produce monthly keys
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)], links);
    expect(out.byBucket[7]["2026-06"]).toEqual({ hours: 4, billableHours: 4 });
  });
});
