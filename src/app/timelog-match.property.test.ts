import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { autoMatchUsers } from "./timelog-match";
import type { Resource } from "./types";

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
