import { describe, it, expect, vi, afterEach } from "vitest";
import {
  milestoneToGraphEvent, categoryFor, taskToGraphEvent, listEntityEvents, updateEvent, deleteEvent, GraphCalendarError,
} from "./outlook-calendar-write";
import type { Milestone, Task } from "./types";

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

describe("categoryFor entityType", () => {
  it("is bare for milestones/committee (back-compat)", () => {
    expect(categoryFor("p1")).toBe("AIPM:p1");
  });
  it("is type-scoped for new entities", () => {
    expect(categoryFor("p1", "task")).toBe("AIPM:p1:task");
  });
});

describe("taskToGraphEvent", () => {
  const task = { id: 3, taskName: "Ship SP1", dueDate: "2026-07-10", status: "In Progress", assignee: "Alice" } as Task;
  it("all-day event on the due date with the task-scoped category", () => {
    const e = taskToGraphEvent(task, "p1");
    expect(e.isAllDay).toBe(true);
    expect(e.subject).toBe("Ship SP1");
    expect(e.start.dateTime).toBe("2026-07-10T00:00:00");
    expect(e.end.dateTime).toBe("2026-07-11T00:00:00");
    expect(e.categories).toEqual(["AIPM:p1:task"]);
  });
});

describe("listEntityEvents", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("filters on the TYPE-SCOPED category (never the bare milestone tag)", async () => {
    let requested = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested = url;
      return new Response(JSON.stringify({ value: [{ id: "E1" }] }), { status: 200 });
    }));
    const events = await listEntityEvents("tok", "p1", "task");
    expect(events).toEqual([{ id: "E1" }]);
    const decoded = decodeURIComponent(requested);
    expect(decoded).toContain("categories/any(c:c eq 'AIPM:p1:task')");
    // Must NOT reuse the bare project tag (would cross-match milestone events).
    expect(decoded).not.toContain("c eq 'AIPM:p1')");
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
