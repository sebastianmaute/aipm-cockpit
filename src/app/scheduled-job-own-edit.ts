// src/app/scheduled-job-own-edit.ts — the version this tab's own edit of a scheduled job will write, while it saves.
// The row still shows the old version until the save lands, so a Stop, an Accept or "Not on this device" clicked in
// that window means the version being saved: `ownEditTarget` names it. An edit of a job this device had answered
// keeps that answer for the new version AT CALL TIME (use-scheduled-jobs.ts); an edit of a job it had not answered
// records nothing, but its version is still the target. One entry per key (the last own edit), cleared when that
// edit settles and on delete.
// ★★ What the row SHOWS does not move while the edit saves: the edit is called from the field's blur, which a click on
// one of the row's buttons causes between its pointerdown and its click, so any change of status or buttons here
// lands under the cursor. `shownAcceptanceState` keeps the state the row showed when the edit was called until the
// user answers or the edit settles.
import {
  type AcceptanceState, acceptanceStateAt, DECLINED_PREFIX, declineJobVersion, jobFingerprint, storedAcceptanceEntry,
} from "./scheduled-job-acceptance";
import type { ScheduledJob } from "./scheduled-jobs/types";

/** The version an own edit will write, this device's entry right after the edit was called, and the state the row
 *  showed at that moment. */
export interface OwnEditNote {
  projectId: string | null;
  instruction: string | undefined;
  fingerprint: string;
  entryAtEdit: string | null;
  shownState: AcceptanceState;
}

const ownEdits = new Map<string, OwnEditNote>();
/** Notes whose version the user has answered from the row since the edit was called. */
const answeredNotes = new WeakSet<OwnEditNote>();

/** This tab's edit of the job `key` will write `version`; `entryAtEdit` is this device's entry once the edit has
 *  recorded its answer (or recorded none), `shownState` what the row showed when the edit was called. Returns the
 *  note, which `endOwnEdit` takes back. */
export function noteOwnEdit(
  key: string,
  version: Pick<ScheduledJob, "projectId" | "instruction">,
  entryAtEdit: string | null,
  shownState: AcceptanceState,
): OwnEditNote {
  const note: OwnEditNote = {
    projectId: version.projectId, instruction: version.instruction, fingerprint: jobFingerprint(version), entryAtEdit, shownState,
  };
  ownEdits.set(key, note);
  return note;
}

/** The edit `note` stands for settled: forget it, unless a later own edit replaced it. */
export function endOwnEdit(key: string, note: OwnEditNote): void {
  if (ownEdits.get(key) === note) ownEdits.delete(key);
}

export function forgetOwnEdit(key: string): void {
  ownEdits.delete(key);
}

/** Whether the user answered the version `note` stands for from the row while its edit saved. */
export function ownEditAnswered(note: OwnEditNote): boolean {
  return answeredNotes.has(note);
}

/** The job as this tab's own edit still saving will write it (the job itself when none is saving). */
export function pendingOwnEditVersion(job: ScheduledJob): ScheduledJob {
  const note = job.key === null ? undefined : ownEdits.get(job.key);
  return note === undefined ? job : { ...job, projectId: note.projectId, instruction: note.instruction };
}

/** The version an answer on this row means: the one this tab's own edit is saving, while this device's entry is still
 *  what the edit left or records that version (accepted or stopped); otherwise the version the row shows. */
export function ownEditTarget(job: ScheduledJob): string {
  if (job.key === null) return jobFingerprint(job);
  const note = ownEdits.get(job.key);
  if (note === undefined) return jobFingerprint(job);
  const entry = storedAcceptanceEntry(job.key);
  const current = entry === note.entryAtEdit || entry === note.fingerprint || entry === DECLINED_PREFIX + note.fingerprint;
  return current ? note.fingerprint : jobFingerprint(job);
}

/** What the row shows for the job: while this tab's own edit saves and nothing has been answered since it was called,
 *  the state the row showed when it was called; otherwise this device's answer for the version an answer means. */
export function shownAcceptanceState(job: ScheduledJob): AcceptanceState {
  const note = job.key === null ? undefined : ownEdits.get(job.key);
  if (note !== undefined && job.key !== null && !answeredNotes.has(note) && storedAcceptanceEntry(job.key) === note.entryAtEdit) {
    return note.shownState;
  }
  return acceptanceStateAt(job, ownEditTarget(job));
}

/** Stop / "Not on this device" from the row: stops the version an answer means, and marks an edit still saving as
 *  answered (before the write, so the re-render it causes already shows the answer). Fails closed like `declineJob`. */
export function declineShownJob(job: ScheduledJob): boolean {
  const note = job.key === null ? undefined : ownEdits.get(job.key);
  const target = ownEditTarget(job);
  if (note !== undefined) answeredNotes.add(note);
  const declined = declineJobVersion(job, target);
  if (!declined && note !== undefined) answeredNotes.delete(note);
  return declined;
}
