import { describe, expect, it } from "vitest";
import { dueInfoReminders } from "./steering-reminders";
import type { SteeringCommittee } from "./types";

const committee = (over: Partial<SteeringCommittee> = {}): SteeringCommittee => ({
  name: "Board", memberResourceIds: [],
  meetings: [{ id: 1, date: "2026-07-10", title: "July board" }],
  infoSchedules: [{ id: 1, label: "Board pack", leadDays: 3 }],
  ...over,
});

describe("dueInfoReminders", () => {
  it("computes a due date N working days before the meeting", () => {
    const out = dueInfoReminders(committee(), "2026-07-01");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ meetingId: 1, scheduleId: 1, label: "Board pack", meetingDate: "2026-07-10" });
    // 2026-07-10 is a Friday; 3 working days before = Tue 2026-07-07
    expect(out[0].dueDate).toBe("2026-07-07");
  });
  it("skips past meetings and returns [] for an empty committee", () => {
    expect(dueInfoReminders(committee({ meetings: [] }), "2026-07-01")).toEqual([]);
    expect(dueInfoReminders(committee({ meetings: [{ id: 9, date: "2020-01-01", title: "old" }] }), "2026-07-01")).toEqual([]);
  });
  it("flags an overdue/now reminder when the due date has passed but the meeting is future", () => {
    const out = dueInfoReminders(committee(), "2026-07-09");
    expect(out[0].tier).toBe("now");
  });
  it("returns [] for undefined committee", () => {
    expect(dueInfoReminders(undefined, "2026-07-01")).toEqual([]);
  });
});
