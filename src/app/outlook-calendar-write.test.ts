import { describe, it, expect, vi, afterEach } from "vitest";
import {
  milestoneToGraphEvent, categoryFor, updateEvent, deleteEvent, GraphCalendarError,
} from "./outlook-calendar-write";
import type { Milestone } from "./types";

const EVENT = milestoneToGraphEvent({ id: 1, name: "X", date: "2026-08-01", linkedTaskIds: [] }, "p");

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

describe("graph() 404 handling", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("updateEvent THROWS GraphCalendarError(404) when the event was deleted in Outlook", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(updateEvent("tok", "gone", EVENT)).rejects.toMatchObject({ status: 404 });
    await expect(updateEvent("tok", "gone", EVENT)).rejects.toBeInstanceOf(GraphCalendarError);
  });

  it("deleteEvent TOLERATES 404 (already gone = success)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(deleteEvent("tok", "gone")).resolves.toBeUndefined();
  });

  it("updateEvent resolves on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(updateEvent("tok", "ev", EVENT)).resolves.toBeUndefined();
  });
});
