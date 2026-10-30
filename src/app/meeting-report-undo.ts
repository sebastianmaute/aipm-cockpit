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

/** A report value, or a thunk read when the fragment runs; `null` = nothing was written, so do nothing. */
export type ReportRef = MeetingReport | undefined | null | (() => MeetingReport | undefined | null);

/** The meeting's report becomes `ref` (absent when `undefined`); every other meeting keeps its identity. `onLive` sees
 *  the report that was live just before the write (inside the updater, so it must stay pure). */
function writeReport(
  setCommittee: CommitteeSetter,
  meetingId: number,
  ref: ReportRef,
  onLive?: (live: MeetingReport | undefined) => void,
): void {
  const report = typeof ref === "function" ? ref() : ref;
  if (report === null) return;
  setCommittee((c) => {
    const target = c?.meetings.find((m) => m.id === meetingId);
    if (!c || !target) return c;
    onLive?.(target.report);
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
      // A report mailed after this save carries a `sentAt` that `after` (captured at the save) lacks. Undo notes it when
      // the live text is still the saved text, and redo puts it back: the mailed text keeps its sent date.
      let sentAt: string | undefined;
      writeReport(setSteeringCommittee, meetingId, before, (live) => {
        const saved = typeof after === "function" ? after() : after;
        sentAt = live && saved && live.html === saved.html ? live.sentAt : undefined; // reset on every run (StrictMode)
      });
      return () =>
        writeReport(setSteeringCommittee, meetingId, () => {
          const saved = typeof after === "function" ? after() : after;
          return saved && sentAt ? { ...saved, sentAt } : saved;
        });
    },
  };
}
