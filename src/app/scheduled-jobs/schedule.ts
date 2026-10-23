import { TEXTAREA_MAX } from "../sanitize-core";
import { isValidTimeZone, isoInZone, todayInZone } from "../timezone";
import { JOB_HISTORY_CAP, type ScheduledJob, type ScheduledJobRun } from "./types";

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

export function appendRun(job: ScheduledJob, run: ScheduledJobRun): ScheduledJob {
  return { ...job, lastRunAt: run.ranAt, history: [run, ...job.history].slice(0, JOB_HISTORY_CAP) };
}
