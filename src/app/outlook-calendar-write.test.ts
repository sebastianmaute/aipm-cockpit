import { describe, it, expect } from "vitest";
import { milestoneToGraphEvent, categoryFor } from "./outlook-calendar-write";
import type { Milestone } from "./types";

describe("milestoneToGraphEvent", () => {
  it("builds an all-day event with end = date + 1 day, category, subject", () => {
    const m: Milestone = { id: 1, name: "Go-Live", date: "2026-08-01", linkedTaskIds: [] };
    const e = milestoneToGraphEvent(m, "proj-42");
    expect(e.subject).toBe("Go-Live");
    expect(e.isAllDay).toBe(true);
    expect(e.start).toEqual({ dateTime: "2026-08-01T00:00:00", timeZone: "UTC" });
    expect(e.end).toEqual({ dateTime: "2026-08-02T00:00:00", timeZone: "UTC" });
    expect(e.categories).toEqual(["AIPM:proj-42"]);
  });
  it("categoryFor prefixes the project id", () => {
    expect(categoryFor("p1")).toBe("AIPM:p1");
  });
  it("throws on a malformed milestone date", () => {
    expect(() => milestoneToGraphEvent({ id: 1, name: "X", date: "not-a-date", linkedTaskIds: [] }, "p")).toThrow();
  });
});
