import { describe, it, expect } from "vitest";
import { dropUnacceptedAbsenceFields } from "./sanitize-records";

describe("dropUnacceptedAbsenceFields", () => {
  it("keeps the fields a model may legitimately set", () => {
    const patch = {
      assignee: "Ada",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      type: "vacation",
      note: "Leave",
    };
    expect(dropUnacceptedAbsenceFields({ ...patch })).toEqual(patch);
  });

  // ★★★ THE POINT OF THE GUARD. Both fields are sync bookkeeping: a
  // model-written outlookEventId re-points or orphans a real Outlook item, and
  // a model-written localModifiedAt lies to conflict detection about when this
  // row last changed.
  it("drops the sync-owned fields", () => {
    const out = dropUnacceptedAbsenceFields({
      assignee: "Ada",
      outlookEventId: "AAMkAD",
      localModifiedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(out).toEqual({ assignee: "Ada" });
  });

  it("drops an unrecognised absence type rather than letting the sanitizer reset it", () => {
    expect(dropUnacceptedAbsenceFields({ type: "sabbatical" })).toEqual({});
    expect(dropUnacceptedAbsenceFields({ type: "sick" })).toEqual({ type: "sick" });
  });
});
