import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { aggregateActuals } from "./timelog-actuals";
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

describe("aggregateActuals conservation", () => {
  it("never loses hours", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        userId: fc.integer({ min: 1, max: 5 }), projectId: fc.integer({ min: 1, max: 5 }),
        hours: fc.integer({ min: 0, max: 8 }),
      })),
      (raw) => {
        const items: TimelogTimeItem[] = raw.map((r) => ({
          timeRegistrationId: 0, userId: r.userId, projectId: r.projectId, projectName: "", projectNo: "",
          taskId: 0, date: "2026-06-10", hours: r.hours, billableHours: r.hours, isBillable: true,
        }));
        const links: TimelogLinks = {
          userLinks: [{ timelogUserId: 1, resourceId: 1, manual: false }],
          projectLinks: [{ timelogProjectId: 1, bucketId: 1, manual: false }],
        };
        const out = aggregateActuals(items, links, "month");
        const bucketSum = Object.values(out.byBucket).flatMap((p) => Object.values(p)).reduce((s, c) => s + c.hours, 0);
        const resourceSum = Object.values(out.byResource).reduce((s, c) => s + c.hours, 0);
        const total = items.reduce((s, i) => s + i.hours, 0);
        expect(bucketSum + out.unattributed.hours).toBe(total);
        expect(resourceSum).toBe(bucketSum);
      },
    ));
  });
});
