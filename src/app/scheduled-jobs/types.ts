// scheduled-jobs/types.ts — pure, i18n-free, no React.
export type JobCadence =
  | { kind: "daily"; timeOfDay: string } // "HH:MM" local 24h
  | { kind: "weekly"; dayOfWeek: number; timeOfDay: string }; // 0=Sun..6=Sat

export interface ScheduledJobRun {
  ranAt: string; // ISO
  summary: string;
  actionCount: number;
  ok: boolean;
  error?: string; // status/token only — never key/body
}

export interface ScheduledJob {
  id: number;
  name: string;
  type: "portfolioAnalysis";
  cadence: JobCadence;
  enabled: boolean;
  /** The one Turso project the job reports on; null = not assigned yet (never runs). */
  projectId: string | null;
  /** Standing instruction the run follows; absent = the built-in default. */
  instruction?: string;
  /** IANA zone the cadence is read in; null = legacy job, never runs until assigned. */
  timeZone: string | null;
  /** Permanent identity of the job across runs and devices; null on a legacy job. */
  key: string | null;
  lastRunAt: string | null;
  history: ScheduledJobRun[]; // newest-first, capped
  /** Fields a newer version added: kept verbatim and written back unchanged, so an edit here cannot strip them. */
  extra?: Record<string, unknown>;
  /** Set when this version cannot read the job (a type or cadence it does not know). `raw` is the stored JSON, kept
   *  verbatim: the job never runs and is never edited here, only listed read-only and deletable. */
  foreign?: { raw: Record<string, unknown>; /** The stored row id, when it is not the job's numeric id (then `id` is a stable placeholder). */ rowId?: string };
}

export const JOB_HISTORY_CAP = 10;
