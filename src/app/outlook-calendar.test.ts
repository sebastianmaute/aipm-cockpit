import { describe, it, expect, beforeEach } from "vitest";
import {
  isTimeAway,
  mapGraphEvent,
  eventsToAbsences,
  dedupeKey,
  type GraphEvent,
  type OutlookEvent,
} from "./outlook-calendar";
import { mintId, __resetMintStateForTests } from "./id-mint-session";
import type { Absence } from "./types";

// eventsToAbsences now mints via the session minter; reset its high-water so
// per-test id assertions are deterministic.
beforeEach(__resetMintStateForTests);

const allDay: GraphEvent = {
  id: "e1",
  subject: "Vacation",
  start: { dateTime: "2026-06-01T00:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-06-04T00:00:00.0000000", timeZone: "UTC" },
  isAllDay: true,
  showAs: "oof",
};
const oofTimed: GraphEvent = {
  id: "e2",
  subject: "Doctor",
  start: { dateTime: "2026-06-10T09:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-06-10T12:00:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  showAs: "oof",
};
const busyMeeting: GraphEvent = {
  id: "e3",
  subject: "Standup",
  start: { dateTime: "2026-06-10T09:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-06-10T09:30:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  showAs: "busy",
};

describe("isTimeAway", () => {
  it("accepts all-day and oof, rejects busy/free", () => {
    expect(isTimeAway(allDay)).toBe(true);
    expect(isTimeAway(oofTimed)).toBe(true);
    expect(isTimeAway(busyMeeting)).toBe(false);
    expect(isTimeAway({ isAllDay: false, showAs: "free" })).toBe(false);
  });
});

describe("mapGraphEvent", () => {
  it("maps an all-day event with exclusive-end correction", () => {
    expect(mapGraphEvent(allDay, 0)).toEqual<OutlookEvent>({
      sourceId: "e1",
      subject: "Vacation",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      isAllDay: true,
      showAs: "oof",
    });
  });
  it("maps an oof timed event to a single day", () => {
    const m = mapGraphEvent(oofTimed, 1)!;
    expect(m.startDate).toBe("2026-06-10");
    expect(m.endDate).toBe("2026-06-10");
    expect(m.isAllDay).toBe(false);
  });
  it("drops non-time-away events", () => {
    expect(mapGraphEvent(busyMeeting, 2)).toBeNull();
  });
  it("drops events with no start", () => {
    expect(mapGraphEvent({ isAllDay: true }, 3)).toBeNull();
  });
  it("falls back sourceId and blank subject", () => {
    const m = mapGraphEvent(
      { start: { dateTime: "2026-07-01T00:00:00" }, end: { dateTime: "2026-07-02T00:00:00" }, isAllDay: true },
      7,
    )!;
    expect(m.sourceId).toBe("event-7");
    expect(m.subject).toBe("");
  });
  it("handles all-day exclusive-end across a year boundary", () => {
    const m = mapGraphEvent(
      { id: "ny", start: { dateTime: "2026-12-31T00:00:00" }, end: { dateTime: "2027-01-01T00:00:00" }, isAllDay: true, showAs: "oof" },
      0,
    )!;
    expect(m.startDate).toBe("2026-12-31");
    expect(m.endDate).toBe("2026-12-31"); // exclusive end 2027-01-01 → inclusive 2026-12-31
  });
});

describe("dedupeKey", () => {
  it("normalizes assignee case", () => {
    expect(dedupeKey("Alex Doe", "2026-06-01", "2026-06-03")).toBe(
      dedupeKey("alex doe", "2026-06-01", "2026-06-03"),
    );
  });
});

describe("eventsToAbsences", () => {
  const ev: OutlookEvent = {
    sourceId: "e1", subject: "Vacation", startDate: "2026-06-01", endDate: "2026-06-03",
    isAllDay: true, showAs: "oof",
  };
  const target = { assignee: "Alex Doe", assigneeEmail: "alex@x.com", resourceId: 3 };
  const STAMP = "2026-05-29T10:00:00.000Z";

  it("creates a typed absence carrying target + subject note", () => {
    const out = eventsToAbsences([{ event: ev, type: "vacation" }], [], target, STAMP);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 1,
      assignee: "Alex Doe",
      assigneeEmail: "alex@x.com",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      type: "vacation",
      note: "Vacation",
      resourceId: 3,
      localModifiedAt: STAMP,
    });
  });
  it("never reuses a freed absence id within a session", () => {
    // Mint id 5 this session, then import against a list whose max is 4
    // (id 5 was 'deleted'). The session minter must NOT hand out 5 again.
    mintId("absence", [{ id: 4 } as Absence]); // high-water -> 5
    const shrunk: Absence[] = [
      { id: 4, assignee: "Y", startDate: "2026-01-01", endDate: "2026-01-01", type: "other" },
    ];
    const out = eventsToAbsences([{ event: ev, type: "vacation" }], shrunk, target, STAMP);
    expect(out.map((a) => a.id)).not.toContain(5);
    expect(out[out.length - 1].id).toBe(6);
  });
  it("assigns session-minted ids above max(existing) incrementing", () => {
    const existing: Absence[] = [{ id: 9, assignee: "X", startDate: "2026-01-01", endDate: "2026-01-01", type: "other" }];
    const out = eventsToAbsences(
      [
        { event: { ...ev, sourceId: "a" }, type: "vacation" },
        { event: { ...ev, sourceId: "b", startDate: "2026-08-01", endDate: "2026-08-02" }, type: "sick" },
      ],
      existing,
      target,
      STAMP,
    );
    expect(out.map((a) => a.id)).toEqual([9, 10, 11]);
    expect(out[2].type).toBe("sick");
  });
  it("dedups against an existing absence with same assignee+dates", () => {
    const existing: Absence[] = [
      { id: 1, assignee: "alex doe", startDate: "2026-06-01", endDate: "2026-06-03", type: "vacation" },
    ];
    const out = eventsToAbsences([{ event: ev, type: "vacation" }], existing, target, STAMP);
    expect(out).toHaveLength(1);
  });
  it("omits note when subject is blank", () => {
    const out = eventsToAbsences([{ event: { ...ev, subject: "" }, type: "other" }], [], target, STAMP);
    expect(out[0].note).toBeUndefined();
  });
  it("dedups when the existing absence has mixed-case assignee", () => {
    const existing: Absence[] = [
      { id: 1, assignee: "Alex Doe", startDate: "2026-06-01", endDate: "2026-06-03", type: "vacation" },
    ];
    const out = eventsToAbsences([{ event: ev, type: "vacation" }], existing, target, STAMP);
    expect(out).toHaveLength(1); // duplicate skipped despite case difference
  });
});
