import { describe, expect, it } from "vitest";
import { planCommitteeReconcile } from "./committee-calendar-reconcile";
import type { SteeringCommittee } from "./types";

const base: SteeringCommittee = {
  name: "B", memberResourceIds: [],
  meetings: [{ id: 1, date: "2026-07-10", title: "M1" }, { id: 2, date: "2026-08-10", title: "M2", outlookEventId: "ev2" }],
  infoSchedules: [{ id: 1, label: "Pack", leadDays: 3 }],
  infoReminderEventIds: { "2:1": "old-info", "9:1": "stale-removed" },
};

describe("planCommitteeReconcile", () => {
  it("creates meetings without an eventId, updates those with one", () => {
    const r = planCommitteeReconcile(base, "2026-07-01");
    expect(r.meetingCreate.map((m) => m.id)).toContain(1);
    expect(r.meetingUpdate.map((u) => u.eventId)).toContain("ev2");
  });
  it("creates info-instances for current meeting x schedule, updates known, deletes stale ids", () => {
    const r = planCommitteeReconcile(base, "2026-07-01");
    expect(r.infoCreate.map((i) => i.key)).toContain("1:1");
    expect(r.infoUpdate.map((i) => i.eventId)).toContain("old-info");
    expect(r.deleteEventIds).toContain("stale-removed"); // "9:1" no longer desired
  });
});
