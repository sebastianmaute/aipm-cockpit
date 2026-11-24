import { useSyncExternalStore } from "react";
import type { ScheduledJob } from "./scheduled-jobs/types";

/** Per-device record of the scheduled jobs this device accepted, keyed by the job's permanent `key`. */
export const ACCEPTANCE_KEY = "aipm-cockpit:scheduled-job-acceptance";

export type AcceptanceState = "accepted" | "declined" | "changed" | "none" | "cannot-run";

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

export function acceptanceState(job: ScheduledJob): AcceptanceState {
  const key = keyOf(job);
  if (key === null) return "cannot-run";
  const stored = parse(readRaw());
  if (!Object.prototype.hasOwnProperty.call(stored, key)) return "none";
  const fingerprint = jobFingerprint(job);
  if (stored[key] === fingerprint) return "accepted";
  return stored[key] === DECLINED_PREFIX + fingerprint ? "declined" : "changed";
}

export function isAcceptedHere(job: ScheduledJob): boolean {
  return acceptanceState(job) === "accepted";
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
  return record(job, jobFingerprint(job));
}

/** Records that this device stopped the job as it stands now; a later change to it asks again. */
export function declineJob(job: ScheduledJob): boolean {
  return record(job, DECLINED_PREFIX + jobFingerprint(job));
}

export function forgetJob(key: string): void {
  try {
    const { [key]: _removed, ...rest } = parse(readRaw());
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
