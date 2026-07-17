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
  it("folds pendingDeleteEventIds (orphaned deleted-meeting events) into deleteEventIds, deduped", () => {
    const r = planCommitteeReconcile(
      { ...base, pendingDeleteEventIds: ["orphan-meeting-ev", "stale-removed"] },
      "2026-07-01",
    );
    expect(r.deleteEventIds).toContain("orphan-meeting-ev");
    // "stale-removed" appears via both paths but is deduped to a single entry.
    expect(r.deleteEventIds.filter((id) => id === "stale-removed")).toHaveLength(1);
  });

  // --- Scoped (per-row) targets ---------------------------------------------
  it("scoped to a single meeting reconciles ONLY that meeting and no info/deletes", () => {
    const r = planCommitteeReconcile(
      { ...base, pendingDeleteEventIds: ["orphan-meeting-ev"] },
      "2026-07-01",
      { kind: "meeting", id: 1 },
    );
    expect(r.meetingCreate.map((m) => m.id)).toEqual([1]);
    expect(r.meetingUpdate).toEqual([]); // meeting 2 (has eventId) untouched
    expect(r.infoCreate).toEqual([]);
    expect(r.infoUpdate).toEqual([]);
    // Critically: a scoped meeting push must NOT delete stale info ids or the
    // pending orphaned-meeting event (that accounting belongs to "push all").
    expect(r.deleteEventIds).toEqual([]);
  });

  it("scoped to a meeting-with-eventId updates only it", () => {
    const r = planCommitteeReconcile(base, "2026-07-01", { kind: "meeting", id: 2 });
    expect(r.meetingUpdate.map((u) => u.eventId)).toEqual(["ev2"]);
    expect(r.meetingCreate).toEqual([]);
    expect(r.deleteEventIds).toEqual([]);
  });

  it("scoped to a schedule reconciles ONLY that schedule's info instances (no meetings, no pending-delete)", () => {
    const r = planCommitteeReconcile(
      { ...base, pendingDeleteEventIds: ["orphan-meeting-ev"] },
      "2026-07-01",
      { kind: "schedule", id: 1 },
    );
    expect(r.meetingCreate).toEqual([]);
    expect(r.meetingUpdate).toEqual([]);
    expect(r.infoCreate.map((i) => i.key)).toContain("1:1");
    expect(r.infoUpdate.map((i) => i.eventId)).toContain("old-info"); // "2:1"
    // Stale "9:1" (schedule 1) is deleted; the orphaned meeting event is NOT.
    expect(r.deleteEventIds).toContain("stale-removed");
    expect(r.deleteEventIds).not.toContain("orphan-meeting-ev");
  });

  it("scoped to a schedule ignores stale ids belonging to OTHER schedules", () => {
    const c: SteeringCommittee = {
      ...base,
      infoSchedules: [{ id: 1, label: "Pack", leadDays: 3 }],
      // "5:2" is a stale id for schedule 2 (not the target) — must stay untouched.
      infoReminderEventIds: { "9:1": "stale-s1", "5:2": "stale-s2" },
    };
    const r = planCommitteeReconcile(c, "2026-07-01", { kind: "schedule", id: 1 });
    expect(r.deleteEventIds).toContain("stale-s1");
    expect(r.deleteEventIds).not.toContain("stale-s2");
  });
});
