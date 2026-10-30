import { describe, it, expect } from "vitest";
import { meetingReportUndoFragment, type ReportRef } from "./meeting-report-undo";
import { buildUndoLabel } from "./undo/use-undo-stack";
import type { SteeringCommittee, MeetingReport } from "./types";

const BEFORE: MeetingReport = { html: "<p>old</p>", updatedAt: "t0" };
const AFTER: MeetingReport = { html: "<p>new</p>", updatedAt: "t1", previous: { html: "<p>old</p>", savedAt: "t0" } };

function committee(): SteeringCommittee {
  return {
    name: "SC",
    memberResourceIds: [],
    infoSchedules: [],
    meetings: [
      { id: 1, date: "2026-11-02", title: "A", report: AFTER },
      { id: 2, date: "2026-11-09", title: "B", report: { html: "<p>other</p>", updatedAt: "t5" } },
    ],
  };
}

function run(initial: SteeringCommittee, meetingId: number, before: ReportRef, after: ReportRef) {
  let state: SteeringCommittee | undefined = initial;
  const fragment = meetingReportUndoFragment({
    setSteeringCommittee: (u) => {
      state = u(state);
    },
    meetingId,
    before,
    after,
  });
  return { fragment, get: () => state! };
}

describe("meetingReportUndoFragment", () => {
  it("undo writes the whole before report and redo the whole after report, touching only the target meeting", () => {
    const h = run(committee(), 1, BEFORE, AFTER);
    const other = h.get().meetings[1];
    const redo = h.fragment.restore({ current: new Map() }, false);
    expect(h.get().meetings[0].report).toEqual(BEFORE);
    expect(h.get().meetings[0].report?.previous).toBeUndefined();
    expect(h.get().meetings[1]).toBe(other);
    redo();
    expect(h.get().meetings[0].report).toEqual(AFTER);
    expect(h.get().meetings[1]).toBe(other);
  });

  it("thunks returning null mean nothing was written: undo and redo leave the report alone", () => {
    const c = committee();
    const h = run(c, 1, () => null, () => null);
    const redo = h.fragment.restore({ current: new Map() }, false);
    expect(h.get().meetings[0].report).toEqual(AFTER);
    redo();
    expect(h.get().meetings[0].report).toEqual(AFTER);
  });

  it("an undefined before removes the report", () => {
    const h = run(committee(), 1, undefined, AFTER);
    h.fragment.restore({ current: new Map() }, false);
    expect("report" in h.get().meetings[0]).toBe(false);
  });

  it("a meeting that no longer exists is a no-op", () => {
    const c = committee();
    const h = run(c, 7, BEFORE, AFTER);
    const redo = h.fragment.restore({ current: new Map() }, false);
    expect(h.get()).toBe(c);
    redo();
    expect(h.get()).toBe(c);
  });
});

describe("meetingReport.updated undo label", () => {
  it("names the report and the meeting date, not the generic fallback", () => {
    const label = buildUndoLabel("en-US", "meetingReport.updated", 1, { name: "2026-11-02" });
    expect(label).toContain("2026-11-02");
    expect(label).toContain("report");
  });
});
