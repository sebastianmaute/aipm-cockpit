import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { autoMatchUsers, autoMatchProjects } from "./timelog-match";
import type { Resource, BudgetBucket } from "./types";

describe("autoMatchUsers property", () => {
  it("never overrides a manual link regardless of inputs", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 50 }), fc.integer({ min: 51, max: 99 }),
      (tlId, autoRes, manualRes) => {
        const resources = [{ id: autoRes, firstName: "A", lastName: "B", email: "x@y.z" } as Resource];
        const out = autoMatchUsers(
          [{ userId: tlId, email: "x@y.z", initials: "", firstName: "", lastName: "", isActive: true }],
          resources,
          { userLinks: [{ timelogUserId: tlId, resourceId: manualRes, manual: true }], projectLinks: [] },
        );
        const link = out.find((l) => l.timelogUserId === tlId);
        expect(link).toEqual({ timelogUserId: tlId, resourceId: manualRes, manual: true });
      },
    ));
  });
});

describe("autoMatchProjects property", () => {
  it("never overrides a manual project link regardless of inputs", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 50 }), fc.integer({ min: 51, max: 99 }),
      (tlId, autoBucket, manualBucket) => {
        const buckets = [{ id: autoBucket, name: "ForgeOps" } as BudgetBucket];
        const out = autoMatchProjects(
          [{ id: tlId, name: "ForgeOps", no: "" }],
          buckets,
          { userLinks: [], projectLinks: [{ timelogProjectId: tlId, bucketId: manualBucket, manual: true }] },
        );
        const link = out.find((l) => l.timelogProjectId === tlId);
        expect(link).toEqual({ timelogProjectId: tlId, bucketId: manualBucket, manual: true });
      },
    ));
  });
});
