import { TEXTAREA_MAX } from "../sanitize-core";
import { isValidTimeZone, isoInZone, todayInZone } from "../timezone";
import { JOB_HISTORY_CAP, type JobCadence, type ScheduledJob, type ScheduledJobRun } from "./types";

const DAY_MS = 86_400_000;

/** Offset of `tz` at the instant `ms`, in ms (isoInZone ends in "+HH:MM"). */
function offsetMs(ms: number, tz: string): number {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(isoInZone(new Date(ms).toISOString(), tz));
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/**
 * The UTC instant whose wall time in `tz` is `ymd timeOfDay`. A wall time that occurs twice (fall-back)
 * resolves to the earlier instant; one that does not exist (spring-forward gap) resolves to the first
 * instant after the gap.
 */
export function zonedInstant(ymd: string, timeOfDay: string, tz: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const { h, m } = parseHM(timeOfDay);
  const naive = Date.UTC(y, mo - 1, d, h, m, 0, 0);
  const before = offsetMs(naive - DAY_MS, tz);
  const after = offsetMs(naive + DAY_MS, tz);
  const valid = [before, after]
    .map((o) => naive - o)
    .filter((c) => c + offsetMs(c, tz) === naive);
  if (valid.length > 0) return new Date(Math.min(...valid));
  // Gap: find the first instant whose offset differs from the one before the gap.
  let lo = naive - Math.max(before, after);
  let hi = naive - Math.min(before, after);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMs(mid, tz) === before) lo = mid; else hi = mid;
  }
  return new Date(hi);
}

function weekdayOf(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function addDays(ymd: string, n: number): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** The UTC instant of the job's slot today in its own zone, or null: no zone, not the weekday, not reached. */
export function slotFor(job: ScheduledJob, now: Date): Date | null {
  if (job.timeZone === null) return null;
  const ymd = todayInZone(now, job.timeZone);
  if (job.cadence.kind === "weekly" && weekdayOf(ymd) !== job.cadence.dayOfWeek) return null;
  const slot = zonedInstant(ymd, job.cadence.timeOfDay, job.timeZone);
  return now >= slot ? slot : null;
}

/** The one normalisation of the free fields a job carries — sanitizeJob (load) and every write path use it. */
export function normalizeJobFields(
  instruction: string | undefined,
  timeZone: string | null | undefined,
): { instruction?: string; timeZone: string | null } {
  const trimmed = (instruction ?? "").trim().slice(0, TEXTAREA_MAX);
  return {
    ...(trimmed !== "" ? { instruction: trimmed } : {}),
    timeZone: typeof timeZone === "string" && isValidTimeZone(timeZone) ? timeZone : null,
  };
}

export function isRunnable(job: ScheduledJob): boolean {
  return job.enabled && job.projectId !== null && job.key !== null && job.timeZone !== null;
}

function parseHM(timeOfDay: string): { h: number; m: number } {
  const [h, m] = timeOfDay.split(":").map((n) => Number(n));
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

function currentSlot(cadence: JobCadence, now: Date): Date | null {
  // `now` and the slot use LOCAL time (setHours). `lastRunAt` is persisted as an
  // ISO (UTC) string but isDue compares it via Date epoch-ms, so the local/UTC
  // mix is correct — both sides resolve to the same absolute instant.
  const { h, m } = parseHM(cadence.timeOfDay);
  const slot = new Date(now);
  slot.setHours(h, m, 0, 0);
  if (cadence.kind === "daily") return now >= slot ? slot : null;
  if (now.getDay() === cadence.dayOfWeek && now >= slot) return slot;
  return null;
}

/** The next slot strictly after `from`, read in the job's zone; null when the job has no zone. */
export function nextRunAt(job: ScheduledJob, from: Date): Date | null {
  if (job.timeZone === null) return null;
  const today = todayInZone(from, job.timeZone);
  for (let i = 0; i <= 8; i++) {
    const ymd = addDays(today, i);
    if (job.cadence.kind === "weekly" && weekdayOf(ymd) !== job.cadence.dayOfWeek) continue;
    const slot = zonedInstant(ymd, job.cadence.timeOfDay, job.timeZone);
    if (slot > from) return slot;
  }
  return null;
}

export function isDue(job: ScheduledJob, now: Date): boolean {
  if (!job.enabled) return false;
  const slot = currentSlot(job.cadence, now);
  if (slot === null) return false;
  if (job.lastRunAt === null) return true;
  return new Date(job.lastRunAt) < slot;
}

export function dueJobs(jobs: readonly ScheduledJob[], now: Date): ScheduledJob[] {
  return jobs.filter((j) => isDue(j, now));
}

export function appendRun(job: ScheduledJob, run: ScheduledJobRun): ScheduledJob {
  return { ...job, lastRunAt: run.ranAt, history: [run, ...job.history].slice(0, JOB_HISTORY_CAP) };
}
