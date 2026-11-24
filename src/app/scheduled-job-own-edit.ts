// src/app/scheduled-job-own-edit.ts — the version this tab's own edit of a scheduled job will write, while it saves.
// An edit records this device's answer for the new version AT CALL TIME (use-scheduled-jobs.ts), before the
// save resolves, so the row still shows the old version while the entry already names the new one. A Stop, an
// Accept or "Not on this device" clicked in that window means the version being saved: `ownEditTarget` names it.
// One entry per key (the last own edit), cleared when that edit settles, on rollback and on delete.
import { jobFingerprint, storedAcceptanceEntry, DECLINED_PREFIX } from "./scheduled-job-acceptance";
import type { ScheduledJob } from "./scheduled-jobs/types";

const ownEditFingerprint = new Map<string, string>();

/** This tab's edit of the job `key` will write the version `fingerprint`. */
export function noteOwnEdit(key: string, fingerprint: string): void {
  ownEditFingerprint.set(key, fingerprint);
}

/** The edit that would write `fingerprint` settled: forget it, unless a later own edit replaced it. */
export function endOwnEdit(key: string, fingerprint: string): void {
  if (ownEditFingerprint.get(key) === fingerprint) ownEditFingerprint.delete(key);
}

export function forgetOwnEdit(key: string): void {
  ownEditFingerprint.delete(key);
}

/** The version an answer on this row means: the one this tab's own edit is saving, while this device's entry still
 *  records that version (accepted or stopped); otherwise the version the row shows. */
export function ownEditTarget(job: ScheduledJob): string {
  if (job.key === null) return jobFingerprint(job);
  const own = ownEditFingerprint.get(job.key);
  if (own === undefined) return jobFingerprint(job);
  const entry = storedAcceptanceEntry(job.key);
  return entry === own || entry === DECLINED_PREFIX + own ? own : jobFingerprint(job);
}
