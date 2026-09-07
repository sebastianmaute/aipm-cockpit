import { describe, it, expect } from "vitest";
import { dropUnacceptedCalendarEventFields } from "./sanitize-records";

describe("dropUnacceptedCalendarEventFields", () => {
  it("keeps the fields a model may legitimately set", () => {
    const patch = {
      title: "Kickoff",
      startDate: "2026-06-01",
      startTime: "09:00",
      durationMinutes: 60,
      location: "Room 1",
      notes: "Bring the plan",
      attendeeResourceIds: [1, 2],
    };
    expect(dropUnacceptedCalendarEventFields({ ...patch })).toEqual(patch);
  });

  it("drops the sync-owned fields", () => {
    const out = dropUnacceptedCalendarEventFields({
      title: "Kickoff",
      outlookEventId: "AAMkAD",
      localModifiedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(out).toEqual({ title: "Kickoff" });
  });

  // ★★★ THE DELIBERATE NON-DROP, and it is as load-bearing as the drops. The
  // user's scope decision is that the model MAY set sendInvitations — mailing
  // attendees is a real outward effect — and that safety comes from
  // `shouldStage` forcing such a call through the review card instead. A guard
  // that quietly dropped it would make that staging rule unreachable and the
  // feature silently inert.
  it("keeps sendInvitations, which the staging rule covers instead", () => {
    expect(dropUnacceptedCalendarEventFields({ sendInvitations: true })).toEqual({
      sendInvitations: true,
    });
  });

  it("drops exceptions, which are per-occurrence bookkeeping the UI owns", () => {
    expect(
      dropUnacceptedCalendarEventFields({ exceptions: [{ date: "2026-06-02", kind: "skip" }] }),
    ).toEqual({});
  });

  it("keeps a real recurrence rule object", () => {
    const recurrence = { freq: "weekly", interval: 1, byDay: ["MO"] };
    expect(dropUnacceptedCalendarEventFields({ recurrence })).toEqual({ recurrence });
  });

  // ★★★ `typeof [] === "object" && [] !== null` is true, so a hand-rolled
  // guard would let an array through even though `RecurrenceRule` is always a
  // plain object. The guard must use `isPlainObject`, which excludes arrays.
  it("drops an array recurrence rather than let it through as a plain object", () => {
    expect(dropUnacceptedCalendarEventFields({ recurrence: [1, 2] })).toEqual({});
  });
});
