import { useSyncExternalStore } from "react";
import type { ScheduledJob } from "./scheduled-jobs/types";

/** Per-device record of the scheduled jobs this device accepted, keyed by the portfolio (`acceptanceScope`) AND the
 *  job's permanent `key`: a cloned database holds the same keys, and an answer given in one portfolio never counts in
 *  another. An entry of another portfolio, or an older entry keyed by the job key alone, reads as no answer (it fails
 *  closed: the job waits for an OK). */
export const ACCEPTANCE_KEY = "aipm-cockpit:scheduled-job-acceptance";

/** The portfolio an answer belongs to: the backend the job list is read from (its database URL), or a fixed token for
 *  this device's local list — the same identity the job list itself uses. */
export function acceptanceScope(backend: string | null): string {
  return backend ?? "local";
}

/** The stored entry key of a job in a portfolio. */
const entryKey = (scope: string, key: string): string => `${scope}|${key}`;

export type AcceptanceState = "accepted" | "declined" | "declined-changed" | "changed" | "none" | "cannot-run";

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

/** Identity of what a job does: its project and instruction (a time change keeps the acceptance). */
export function jobFingerprint(job: Pick<ScheduledJob, "projectId" | "instruction">): string {
  return JSON.stringify([job.projectId, job.instruction ?? null]);
}

function readRaw(): string {
  try {
    return localStorage.getItem(ACCEPTANCE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Parses the stored map, keeping only string values of a plain object; anything else reads as empty. */
function parse(raw: string): Record<string, string> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const DECLINED_PREFIX = "declined:";

/** A job this device cannot run: a legacy one (no permanent key) or one a newer version made. Narrows `key`. */
function keyOf(job: ScheduledJob): string | null {
  return job.key === null || job.foreign !== undefined ? null : job.key;
}

/** This device's answer for the job in portfolio `scope`. */
export function acceptanceState(job: ScheduledJob, scope: string): AcceptanceState {
  const key = keyOf(job);
  if (key === null) return "cannot-run";
  const entry = storedAcceptanceEntry(key, scope);
  if (entry === null) return "none";
  const fingerprint = jobFingerprint(job);
  if (entry === fingerprint) return "accepted";
  if (entry === DECLINED_PREFIX + fingerprint) return "declined";
  // A decline of another version never reads "since you accepted it": this device never accepted anything.
  return entry.startsWith(DECLINED_PREFIX) ? "declined-changed" : "changed";
}

/** The raw stored entry for a job key in portfolio `scope` (an accepted fingerprint or a decline), or null when absent
 *  or unreadable. */
export function storedAcceptanceEntry(key: string, scope: string): string | null {
  const stored = parse(readRaw());
  const k = entryKey(scope, key);
  return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null;
}

export function isAcceptedHere(job: ScheduledJob, scope: string): boolean {
  return acceptanceState(job, scope) === "accepted";
}

/** The entry value an accept (or, with `declined`, a decline) of this job writes. */
function acceptanceEntryValue(job: ScheduledJob, declined: boolean): string {
  return declined ? DECLINED_PREFIX + jobFingerprint(job) : jobFingerprint(job);
}

/** Per portfolio and job key, the fingerprint of the version THIS DEVICE saved when it changed the job's project or instruction, until
 *  this device answers. In localStorage, so it survives a reload and is shared by this device's tabs. Display-only: it
 *  picks the wording of a "changed" row and never decides whether a job runs, so any storage failure reads as "not
 *  edited here". */
export const EDITED_HERE_KEY = "aipm-cockpit:scheduled-job-edited-here";

function readEditedRaw(): string {
  try {
    return localStorage.getItem(EDITED_HERE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeEdited(update: (marks: Record<string, string>) => Record<string, string>): void {
  try {
    localStorage.setItem(EDITED_HERE_KEY, JSON.stringify(update(parse(readEditedRaw()))));
  } catch {
    return;
  }
  notify();
}

function dropEdited(key: string): void {
  if (!Object.prototype.hasOwnProperty.call(parse(readEditedRaw()), key)) return;
  writeEdited(({ [key]: _dropped, ...rest }) => { void _dropped; return rest; });
}

/** This device's save of job `key` in portfolio `scope` landed with the version `fingerprint`. */
export function markEditedHere(key: string, fingerprint: string, scope: string): void {
  writeEdited((marks) => ({ ...marks, [entryKey(scope, key)]: fingerprint }));
}

/** Whether the job, as it stands, is the version this device saved: a later change from elsewhere is not. */
export function isEditedHere(job: ScheduledJob, scope: string): boolean {
  const key = keyOf(job);
  return key !== null && parse(readEditedRaw())[entryKey(scope, key)] === jobFingerprint(job);
}

/** Test-only: forget every mark, so test order cannot matter. */
export function __resetEditedHereForTests(): void {
  try {
    localStorage.removeItem(EDITED_HERE_KEY);
  } catch {
    return;
  }
}

/** Writes an answer. Only a user's Accept / Stop / "Not on this device" and creating a job answer, so an answer ends
 *  the "you changed this job" wording. */
function record(job: ScheduledJob, value: string, scope: string): boolean {
  const key = keyOf(job);
  if (key === null) return false;
  const k = entryKey(scope, key);
  try {
    const next = { ...parse(readRaw()), [k]: value };
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  dropEdited(k);
  notify();
  return true;
}

/** Records that this device accepted the job, as it stands now, in portfolio `scope`. */
export function acceptJob(job: ScheduledJob, scope: string): boolean {
  return record(job, acceptanceEntryValue(job, false), scope);
}

/** Records that this device stopped the job as it stands now, in portfolio `scope`; a later change to it asks again. */
export function declineJob(job: ScheduledJob, scope: string): boolean {
  return record(job, acceptanceEntryValue(job, true), scope);
}

/** Forgets this device's answer (and "edited here" mark) for job `key` in portfolio `scope` (it was deleted here). */
export function forgetJob(key: string, scope: string): void {
  const k = entryKey(scope, key);
  dropEdited(k);
  try {
    const { [k]: _removed, ...rest } = parse(readRaw());
    void _removed;
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify(rest));
  } catch {
    return;
  }
  notify();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ACCEPTANCE_KEY || e.key === EDITED_HERE_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Both stores in one snapshot, so a change to either re-renders. */
function readSnapshot(): string {
  return `${readRaw()}\u0000${readEditedRaw()}`;
}

/** Re-renders the caller when the stored acceptances (or this device's "you changed this job" marks) change; read
 *  `acceptanceState` / `isEditedHere` for the answer. */
export function useAcceptanceSnapshot(): string {
  return useSyncExternalStore(subscribe, readSnapshot, () => "");
}
