// src/app/meeting-report-undo.ts — AI-04: the undo fragment for one steering-committee meeting report save.
//
// ★ `before`/`after` may be THUNKS, read at undo/redo time: the save computes its report inside a functional
//   setter from the LIVE meeting (so N saves in one tick compose), and only that updater knows which pair it
//   really wrote. A thunk returning `null` means "the write did not happen" and the fragment does nothing.
// ★ It restores the WHOLE `MeetingReport` (`html`, `previous`, `updatedAt`, `sentAt`), not just the text: a save
//   also moves the replaced text into `previous`, so undoing only `html` would leave `previous` pointing at the
//   wrong version. Only the target meeting is touched, and a meeting that no longer exists is a no-op.
import type { CommitteeMeeting, MeetingReport, SteeringCommittee } from "./types";
import type { CompositeFragment } from "./undo/use-undo-stack";

type CommitteeSetter = (updater: (c: SteeringCommittee | undefined) => SteeringCommittee | undefined) => void;

/** The meeting's report becomes `report` (absent when `undefined`); every other meeting keeps its identity. */
/** A report value, or a thunk read when the fragment runs; `null` = nothing was written, so do nothing. */
export type ReportRef = MeetingReport | undefined | null | (() => MeetingReport | undefined | null);

function writeReport(setCommittee: CommitteeSetter, meetingId: number, ref: ReportRef): void {
  const report = typeof ref === "function" ? ref() : ref;
  if (report === null) return;
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
  before: ReportRef;
  after: ReportRef;
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
