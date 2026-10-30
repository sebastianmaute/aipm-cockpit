// src/app/meeting-report-undo.ts — AI-04: the undo fragment for one steering-committee meeting report save.
//
// ★ It restores the WHOLE `MeetingReport` (`html`, `previous`, `updatedAt`, `sentAt`), not just the text: a save
//   also moves the replaced text into `previous`, so undoing only `html` would leave `previous` pointing at the
//   wrong version. Only the target meeting is touched, and a meeting that no longer exists is a no-op.
import type { CommitteeMeeting, MeetingReport, SteeringCommittee } from "./types";
import type { CompositeFragment } from "./undo/use-undo-stack";

type CommitteeSetter = (updater: (c: SteeringCommittee | undefined) => SteeringCommittee | undefined) => void;

/** The meeting's report becomes `report` (absent when `undefined`); every other meeting keeps its identity. */
function writeReport(setCommittee: CommitteeSetter, meetingId: number, report: MeetingReport | undefined): void {
  setCommittee((c) => {
    if (!c || !c.meetings.some((m) => m.id === meetingId)) return c;
    return {
      ...c,
      meetings: c.meetings.map((m) => {
        if (m.id !== meetingId) return m;
        if (report) return { ...m, report };
        const rest: CommitteeMeeting = { ...m };
        delete rest.report;
        return rest;
      }),
    };
  });
}

export function meetingReportUndoFragment(args: {
  setSteeringCommittee: CommitteeSetter;
  meetingId: number;
  before: MeetingReport | undefined;
  after: MeetingReport | undefined;
}): CompositeFragment {
  const { setSteeringCommittee, meetingId, before, after } = args;
  return {
    isPrimary: false,
    followsPrimary: false, // one meeting by id, nothing a re-mint could move
    restore: () => {
      writeReport(setSteeringCommittee, meetingId, before);
      return () => writeReport(setSteeringCommittee, meetingId, after);
    },
  };
}
