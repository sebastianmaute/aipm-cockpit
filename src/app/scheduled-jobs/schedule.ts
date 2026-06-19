import { JOB_HISTORY_CAP, type JobCadence, type ScheduledJob, type ScheduledJobRun } from "./types";

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

export function nextRunAt(cadence: JobCadence, from: Date): Date {
  const { h, m } = parseHM(cadence.timeOfDay);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (cadence.kind === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }
  let delta = (cadence.dayOfWeek - next.getDay() + 7) % 7;
  if (delta === 0 && next <= from) delta = 7;
  next.setDate(next.getDate() + delta);
  return next;
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
