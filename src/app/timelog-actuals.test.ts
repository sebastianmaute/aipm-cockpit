import { describe, it, expect } from "vitest";
import { aggregateActuals } from "./timelog-actuals";
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
});
