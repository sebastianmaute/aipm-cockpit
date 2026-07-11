"use client";
// SP5 baseline scheduler: while the app is open this hook runs any DUE scheduled
// Claude jobs (on mount, on tab re-focus, and every 5 minutes). It owns NO state —
// jobs/store/context are injected by the caller (task-manager wires them). The
// hook holds args behind refs so the tick callback is stable and the interval /
// visibility listener never re-subscribe on a render (also keeps us clear of the
// banned react-hooks/set-state-in-effect rule — no render state here).
import { useEffect, useRef } from "react";
import { dueJobs } from "./scheduled-jobs/schedule";
import { runJobAnalysis } from "./scheduled-job-analysis";
import { AiHttpError, classifyAiError } from "./ai-errors";
import type { ScheduledJob, ScheduledJobRun } from "./scheduled-jobs/types";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface ScheduledJobRunnerArgs {
  /** Caller passes ai.scheduledJobs===true && key present && !isPopout. */
  enabled: boolean;
  jobs: readonly ScheduledJob[];
  recordRun: (jobId: number, run: ScheduledJobRun) => void;
  /** Closes over the live workspace (SP4 buildAnalysisContext). */
  buildContext: () => string;
  ai: { apiKey: string; model: string };
  /** Caller wires the desktop-notification path; already formats title/body. */
  notify: (title: string, body: string) => void;
  /** Injectable for tests; default () => new Date(). */
  now?: () => Date;
}

export function useScheduledJobRunner(args: ScheduledJobRunnerArgs): void {
  // Mirror every arg into a ref so the tick callback can stay stable (no deps
  // that change each render) and the listener/interval subscribe exactly once.
  const enabledRef = useRef(args.enabled);
  const jobsRef = useRef(args.jobs);
  const recordRunRef = useRef(args.recordRun);
  const buildContextRef = useRef(args.buildContext);
  const aiRef = useRef(args.ai);
  const notifyRef = useRef(args.notify);
  const nowRef = useRef(args.now);
  useEffect(() => { enabledRef.current = args.enabled; }, [args.enabled]);
  useEffect(() => { jobsRef.current = args.jobs; }, [args.jobs]);
  useEffect(() => { recordRunRef.current = args.recordRun; }, [args.recordRun]);
  useEffect(() => { buildContextRef.current = args.buildContext; }, [args.buildContext]);
  useEffect(() => { aiRef.current = args.ai; }, [args.ai]);
  useEffect(() => { notifyRef.current = args.notify; }, [args.notify]);
  useEffect(() => { nowRef.current = args.now; }, [args.now]);

  // Overlap guard: skip a tick while a previous async run is still in flight.
  const isRunningRef = useRef(false);

  useEffect(() => {
    const tick = async () => {
      if (!enabledRef.current) return;
      if (isRunningRef.current) return; // a run is already in flight
      const at = (nowRef.current ?? (() => new Date()))();
      const due = dueJobs(jobsRef.current, at);
      if (due.length === 0) return;

      isRunningRef.current = true;
      try {
        // recordRun sets lastRunAt = ranAt for BOTH success and failure, so a
        // job runs at most once per cadence slot even if it fails
        // (fail-once-per-slot) — deliberate: a persistent failure (bad key,
        // outage) must NOT re-spam a billed API call every tick. A transient
        // failure waits for the next slot; the failed run stays visible in the
        // job's history.
        const ranAt = at.toISOString();
        for (const job of due) {
          try {
            const analysis = await runJobAnalysis(buildContextRef.current(), aiRef.current);
            recordRunRef.current(job.id, {
              ranAt,
              summary: analysis.summary,
              actionCount: analysis.actions.length,
              ok: true,
            });
            notifyRef.current(job.name, analysis.summary);
          } catch (e) {
            // Record the failure but do NOT notify — avoid failure-notification spam.
            recordRunRef.current(job.id, {
              ranAt,
              summary: "",
              actionCount: 0,
              ok: false,
              error:
                e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit"
                  ? "limit"
                  : e instanceof Error
                    ? e.message
                    : "error",
            });
          }
        }
      } finally {
        isRunningRef.current = false;
      }
    };

    // Fire on mount.
    void tick();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(interval);
    };
  }, []);
}
