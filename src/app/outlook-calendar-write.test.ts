import { describe, it, expect, vi, afterEach } from "vitest";
import {
  milestoneToGraphEvent, categoryFor, taskToGraphEvent, raidToGraphEvent, changeToGraphEvent, absenceToGraphEvent, listEntityEvents, updateEvent, deleteEvent, GraphCalendarError,
} from "./outlook-calendar-write";
import type { Milestone, Task, RaidItem, Absence } from "./types";

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

describe("raidToGraphEvent", () => {
  it("builds an all-day event on targetDate with the raid category", () => {
    const raid = { id: 3, category: "R", title: "Vendor risk", status: "Open",
      raisedDate: "2026-01-01", targetDate: "2026-07-10", owner: "Ana", severity: "High",
      linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [] } as unknown as RaidItem;
    const ev = raidToGraphEvent(raid, "p1");
    expect(ev.isAllDay).toBe(true);
    expect(ev.start.dateTime).toBe("2026-07-10T00:00:00");
    expect(ev.end.dateTime).toBe("2026-07-11T00:00:00");
    expect(ev.subject).toBe("Vendor risk");
    expect(ev.categories).toEqual([categoryFor("p1", "raid")]);
    expect(ev.body.content).toContain("Owner: Ana");
    expect(ev.body.content).toContain("Severity: High");
  });
});

describe("changeToGraphEvent", () => {
  it("changeToGraphEvent: all-day on decisionDate, type-scoped category, body lines", () => {
    const ev = changeToGraphEvent(
      { id: 5, title: "Widen scope", description: "", type: "Scope", status: "Approved", impact: "High", decisionBy: "Elena", decisionDate: "2026-06-09", raisedDate: "2026-05-21", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] },
      "proj-1",
    );
    expect(ev.isAllDay).toBe(true);
    expect(ev.subject).toBe("Widen scope");
    expect(ev.start.dateTime).toBe("2026-06-09T00:00:00");
    expect(ev.end.dateTime).toBe("2026-06-10T00:00:00");
    expect(ev.categories).toEqual(["AIPM:proj-1:change"]);
    expect(ev.body.content).toContain("Type: Scope");
    expect(ev.body.content).toContain("Impact: High");
    expect(ev.body.content).toContain("Status: Approved");
    expect(ev.body.content).toContain("Decision by: Elena");
  });
});

describe("absenceToGraphEvent", () => {
  const abs: Absence = { id: 1, assignee: "Jane Doe", startDate: "2026-01-05", endDate: "2026-01-09", type: "vacation", note: "Skiing" };
  it("emits a multi-day all-day event ending the day AFTER endDate (exclusive)", () => {
    const ev = absenceToGraphEvent(abs, "proj-1");
    expect(ev.isAllDay).toBe(true);
    expect(ev.start).toEqual({ dateTime: "2026-01-05T00:00:00", timeZone: "UTC" });
    expect(ev.end).toEqual({ dateTime: "2026-01-10T00:00:00", timeZone: "UTC" });
  });
  it("keeps the reconcile category first and adds the type as a secondary tag", () => {
    const cats = absenceToGraphEvent(abs, "proj-1").categories;
    expect(cats[0]).toBe("AIPM:proj-1:absence");
    expect(cats).toContain("vacation");
    expect(cats).toEqual(["AIPM:proj-1:absence", "vacation"]);
  });
  it("puts assignee and type in the subject", () => {
    expect(absenceToGraphEvent(abs, "proj-1").subject).toBe("Jane Doe – vacation");
  });
  it("shows out-of-office for vacation/sick/other and busy for training", () => {
    expect(absenceToGraphEvent({ ...abs, type: "vacation" }, "p").showAs).toBe("oof");
    expect(absenceToGraphEvent({ ...abs, type: "sick" }, "p").showAs).toBe("oof");
    expect(absenceToGraphEvent({ ...abs, type: "other" }, "p").showAs).toBe("oof");
    expect(absenceToGraphEvent({ ...abs, type: "training" }, "p").showAs).toBe("busy");
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
