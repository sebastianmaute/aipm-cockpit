import { useSyncExternalStore } from "react";
import type { ScheduledJob } from "./scheduled-jobs/types";

/** Per-device record of the scheduled jobs this device accepted, keyed by the job's permanent `key`. */
export const ACCEPTANCE_KEY = "aipm-cockpit:scheduled-job-acceptance";

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

export const DECLINED_PREFIX = "declined:";

/** A job this device cannot run: a legacy one (no permanent key) or one a newer version made. Narrows `key`. */
function keyOf(job: ScheduledJob): string | null {
  return job.key === null || job.foreign !== undefined ? null : job.key;
}

export function acceptanceState(job: ScheduledJob): AcceptanceState {
  return acceptanceStateAt(job, jobFingerprint(job));
}

/** This device's answer for the job's key, read against the version `fingerprint` names (the job's own, or the one
 *  an edit still saving will write). */
export function acceptanceStateAt(job: ScheduledJob, fingerprint: string): AcceptanceState {
  const key = keyOf(job);
  if (key === null) return "cannot-run";
  const stored = parse(readRaw());
  if (!Object.prototype.hasOwnProperty.call(stored, key)) return "none";
  if (stored[key] === fingerprint) return "accepted";
  if (stored[key] === DECLINED_PREFIX + fingerprint) return "declined";
  // A decline of another version never reads "since you accepted it": this device never accepted anything.
  return stored[key].startsWith(DECLINED_PREFIX) ? "declined-changed" : "changed";
}

/** The raw stored entry for a job key (an accepted fingerprint or a decline), or null when absent or unreadable. */
export function storedAcceptanceEntry(key: string): string | null {
  const stored = parse(readRaw());
  return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null;
}

export function isAcceptedHere(job: ScheduledJob): boolean {
  return acceptanceState(job) === "accepted";
}

/** The entry value an accept (or, with `declined`, a decline) of this job writes. */
export function acceptanceEntryValue(job: ScheduledJob, declined: boolean): string {
  return declined ? DECLINED_PREFIX + jobFingerprint(job) : jobFingerprint(job);
}

function record(job: ScheduledJob, value: string): boolean {
  const key = keyOf(job);
  if (key === null) return false;
  try {
    const next = { ...parse(readRaw()), [key]: value };
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  notify();
  return true;
}

export function acceptJob(job: ScheduledJob): boolean {
  return record(job, acceptanceEntryValue(job, false));
}

/** Records that this device stopped the job as it stands now; a later change to it asks again. */
export function declineJob(job: ScheduledJob): boolean {
  return record(job, acceptanceEntryValue(job, true));
}

/** Records a Stop of the version `fingerprint` names (the one an edit still saving will write), under the same
 *  fail-closed rules as `declineJob`. */
export function declineJobVersion(job: ScheduledJob, fingerprint: string): boolean {
  return record(job, DECLINED_PREFIX + fingerprint);
}

/** Puts a raw entry back (or removes the key for null): the undo of an edit's answer whose save failed. */
export function restoreAcceptanceEntry(key: string, value: string | null): void {
  try {
    const { [key]: _current, ...rest } = parse(readRaw());
    void _current;
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify(value === null ? rest : { ...rest, [key]: value }));
  } catch {
    return;
  }
  notify();
}

export function forgetJob(key: string): void {
  restoreAcceptanceEntry(key, null);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ACCEPTANCE_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Re-renders the caller when the stored acceptances change; read `acceptanceState` for the answer. */
export function useAcceptanceSnapshot(): string {
  return useSyncExternalStore(subscribe, readRaw, () => "");
}
