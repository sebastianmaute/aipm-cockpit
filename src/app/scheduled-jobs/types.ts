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
  lastRunAt: string | null;
  history: ScheduledJobRun[]; // newest-first, capped
}

export const JOB_HISTORY_CAP = 10;
