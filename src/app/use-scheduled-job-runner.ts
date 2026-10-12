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
  ai: { apiKey: string; model: string; guideText?: string };
  /** Caller wires the desktop-notification path; already formats title/body. */
  notify: (title: string, body: string) => void;
  /** Injectable for tests; default () => new Date(). */
  now?: () => Date;
  /** §701 — false while the operating guides the runs need are still loading
   *  (only when guide grounding is on). A tick waits for it, and the runner
   *  ticks once the moment it turns true, so the run on app open is delayed by
   *  the load, not skipped until the next interval. REQUIRED, so tsc proves a
   *  caller decided it (pass true when there is nothing to wait for). */
  guidesReady: boolean;
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
  // The tick, reachable from the switched-on and guides-ready effects as well
  // as the mount effect. Assigned in the mount effect (not during render); the
  // two edge effects act only on a LATER commit, by which time it is set.
  const tickRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { jobsRef.current = args.jobs; }, [args.jobs]);
  useEffect(() => { recordRunRef.current = args.recordRun; }, [args.recordRun]);
  useEffect(() => { buildContextRef.current = args.buildContext; }, [args.buildContext]);
  useEffect(() => { aiRef.current = args.ai; }, [args.ai]);
  useEffect(() => { notifyRef.current = args.notify; }, [args.notify]);
  useEffect(() => { nowRef.current = args.now; }, [args.now]);
  const guidesReady = args.guidesReady;
  const guidesReadyRef = useRef(guidesReady);

  // Overlap guard: skip a tick while a previous async run is still in flight.
  const isRunningRef = useRef(false);

  // ★★ THE TWO EDGE EFFECTS BELOW MUST STAY AFTER EVERY REF-SYNC EFFECT ABOVE.
  // Effects run in declaration order, and `tick` builds the first request
  // synchronously, before its first await: declared above the `aiRef` sync, an
  // edge tick sends the PREVIOUS commit's key and guide text. At app open that
  // is the empty key from before decryption — a 401 that `recordRun` books as
  // this slot's failed run, so the job then waits for its next slot (§701
  // review 8). Pinned by "the switch-on run carries the key and guide text that
  // arrived with it".

  // §701 — tick once when the runner is switched ON. At app open the AI
  // settings (the key is a sealed secret, decrypted asynchronously) usually
  // arrive AFTER the guides, so the guides-ready tick below finds the runner
  // still off; without this the first run waited for the next interval.
  // Safe here because a tick runs only jobs that are due, and this runner's
  // `enabled` does not flip on project loads. ★ Do NOT copy this into the
  // insight runner: its `enabled` includes `!loadPending` (§548), so it would
  // add a billed round on every project switch. Ref initialised from the
  // mount value, so mount itself is not an edge (the mount effect ticks).
  useEffect(() => {
    const was = enabledRef.current;
    enabledRef.current = args.enabled;
    if (!was && args.enabled) void tickRef.current();
  }, [args.enabled]);

  // §701 — tick once when the guides finish loading: the mount tick skipped
  // while they loaded, and the next interval may be minutes away. It fires once
  // per load; turning grounding on while the guides are still loading can flip
  // it true→false→true and add one more tick, which is harmless (a tick runs
  // only jobs that are due).
  useEffect(() => {
    const was = guidesReadyRef.current;
    guidesReadyRef.current = guidesReady;
    if (!was && guidesReady) void tickRef.current();
  }, [guidesReady]);

  useEffect(() => {
    const tick = async () => {
      if (!enabledRef.current || !guidesReadyRef.current) return;
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
            // Cache the guide prefix only when this tick sends more than one
            // request: a lone request would pay the cache write and never read it.
            const analysis = await runJobAnalysis(buildContextRef.current(), { ...aiRef.current, cacheGuides: due.length > 1 });
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

    tickRef.current = tick;
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
