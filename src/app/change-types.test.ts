import { describe, expect, it } from "vitest";
import { CHANGE_STATUSES, CHANGE_TYPES } from "./types";

describe("change enums", () => {
  it("lists the 5 change types", () => {
    expect(CHANGE_TYPES).toEqual(["Scope", "Schedule", "Cost", "Quality", "Other"]);
  });
  it("lists the 6 statuses in lifecycle order", () => {
    expect(CHANGE_STATUSES).toEqual(["Proposed", "Under Review", "Approved", "Rejected", "Implemented", "Deferred"]);
  });
});
