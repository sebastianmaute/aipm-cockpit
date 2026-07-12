import { describe, it, expect, beforeEach } from "vitest";
import { readBaselineDate, writeBaselineDate, removeBaselineEntry, loadBaseline } from "./calendar-sync-baseline";

beforeEach(() => window.localStorage.clear());

describe("calendar-sync-baseline", () => {
  it("writes and reads a date by project/entity/event", () => {
    writeBaselineDate("p1", "milestone", "e1", "2026-03-01");
    expect(readBaselineDate("p1", "milestone", "e1")).toBe("2026-03-01");
  });
  it("returns undefined for an unknown key", () => {
    expect(readBaselineDate("p1", "milestone", "nope")).toBeUndefined();
  });
  it("removes an entry", () => {
    writeBaselineDate("p1", "milestone", "e1", "2026-03-01");
    removeBaselineEntry("p1", "milestone", "e1");
    expect(readBaselineDate("p1", "milestone", "e1")).toBeUndefined();
  });
  it("loadBaseline returns an eventId->date slice for a project+entity", () => {
    writeBaselineDate("p1", "milestone", "e1", "2026-03-01");
    writeBaselineDate("p1", "milestone", "e2", "2026-03-05");
    writeBaselineDate("p2", "milestone", "e3", "2026-03-09");
    expect(loadBaseline("p1", "milestone")).toEqual({ e1: "2026-03-01", e2: "2026-03-05" });
  });
  it("tolerates malformed storage (returns empty)", () => {
    window.localStorage.setItem("aipm-cockpit:calendar-sync-baseline", "{not json");
    expect(readBaselineDate("p1", "milestone", "e1")).toBeUndefined();
  });
});
