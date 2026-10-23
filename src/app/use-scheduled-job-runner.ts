"use client";
// SP5 baseline scheduler: while the app is open this hook runs any DUE scheduled
// Claude jobs (on mount, on tab re-focus, and every 5 minutes). It owns NO state —
// the jobs and the job-store writers are injected by the caller (use-ai-orchestration.ts
// wires them); the run deps (portfolio lists, project load, AI call) are built here per
// tick and handed to `runScheduledJob` (§772). The hook holds args behind refs so the tick callback is stable and the interval /
// visibility listener never re-subscribe on a render (also keeps us clear of the
// banned react-hooks/set-state-in-effect rule — no render state here).
import { useEffect, useRef } from "react";
import { isRunnable, slotFor } from "./scheduled-jobs/schedule";
import { hasReportAtOrAfter } from "./scheduled-reports-store";
import { runJobAnalysis } from "./scheduled-job-analysis";
import { runScheduledJob, type RunDeps, type RunOutcome } from "./scheduled-job-run";
import { getDeviceLabel } from "./device-label";
import { listProjectRefs } from "./turso-portfolio";
import { TursoBackend } from "./turso-backend";
import type { TursoConfig } from "./turso-config";
import type { Settings } from "./settings-types";
import type { Lang } from "./i18n";
import type { ScheduledJob, ScheduledJobRun } from "./scheduled-jobs/types";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
/** Fired on `window` after a run wrote a report row, so the Scheduled reports view can reload (§772). */
export const SCHEDULED_REPORT_EVENT = "aipm-cockpit:scheduled-report";
const REPORT_WRITTEN: ReadonlySet<RunOutcome> = new Set<RunOutcome>(["done", "failed", "project-archived"]);

export interface ScheduledJobRunnerArgs {
  /** Caller passes ai.scheduledJobs===true && key present && !isPopout. */
  enabled: boolean;
  jobs: readonly ScheduledJob[];
  /** The backend `jobs` was read from. After a config change `jobs` is still the previous portfolio's until the
   *  new read lands, and a tick on it would run (and write) against the wrong list: it waits. */
  jobsSource: string | null | undefined;
  recordRun: (jobId: number, run: ScheduledJobRun, jobKey: string) => void | Promise<void>;
  /** §772 — the portfolio's Turso config; a run loads ITS job's project from it, not the open one. */
  config: TursoConfig | null;
  /** §772 — true only on a Turso portfolio with a config; a run reports on a stored project, so nothing
   *  runs otherwise (and the file-mode fallback store never reaches here with a project). */
  available: boolean;
  /** Device settings the digest merges the loaded project's overrides into. */
  deviceSettings: Settings;
  lang: Lang;
  /** Clear a job's project (hard-deleted) / switch a job off (archived project). */
  clearProject: (jobId: number, jobKey: string) => Promise<void>;
  disableJob: (jobId: number, jobKey: string) => Promise<void>;
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
  // Mirror the args into ONE ref so the tick callback can stay stable (no deps that change each render)
  // and the listener/interval subscribe exactly once.
  const argsRef = useRef(args);
  const enabledRef = useRef(args.enabled);
  // The tick, reachable from the switched-on and guides-ready effects as well
  // as the mount effect. Assigned in the mount effect (not during render); the
  // two edge effects act only on a LATER commit, by which time it is set.
  const tickRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { argsRef.current = args; }, [args]);
  const guidesReady = args.guidesReady;
  const guidesReadyRef = useRef(guidesReady);

  // Overlap guard: skip a tick while a previous async run is still in flight.
  const isRunningRef = useRef(false);

  // ★★ THE TWO EDGE EFFECTS BELOW MUST STAY AFTER THE REF-SYNC EFFECT ABOVE.
  // Effects run in declaration order, and `tick` builds the first request
  // synchronously, before its first await: declared above the `argsRef` sync, an
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
      const a = argsRef.current;
      if (!enabledRef.current || !guidesReadyRef.current) return;
      if (!a.available || a.config === null) return;
      if (a.jobsSource !== a.config.httpUrl) return;
      if (isRunningRef.current) return; // a run is already in flight
      const at = (a.now ?? (() => new Date()))();
      const due = a.jobs
        .filter(isRunnable)
        .flatMap((job) => {
          const slot = slotFor(job, at);
          if (slot === null) return [];
          // A job that already ran for this slot (a legacy job given its project today, or a record the report
          // table does not know about) is not run again.
          const lastRun = job.lastRunAt === null ? Number.NaN : Date.parse(job.lastRunAt);
          return Number.isFinite(lastRun) && lastRun >= slot.getTime() ? [] : [{ job, slot }];
        });
      if (due.length === 0) return;

      isRunningRef.current = true;
      try {
        const config = a.config;
        // Jobs whose slot already has (or is older than) a report are skipped by the run anyway: only those that
        // will really run decide whether the guide prefix is worth caching. A failed read counts as pending.
        const checks = await Promise.allSettled(due.map(({ job, slot }) =>
          job.key === null ? Promise.resolve(false) : hasReportAtOrAfter(config, job.key, slot.toISOString())));
        const pending = due.filter((_, i) => {
          const c = checks[i];
          return c.status !== "fulfilled" || !c.value;
        });
        if (pending.length === 0) return;
        // The guard against a repeat is the slot's report row in Turso (claimed before any billed call,
        // shared by every device), not `lastRunAt`: a failed run still writes its row, so a persistent
        // failure (bad key, outage) is not re-billed every tick. A transient storage failure writes
        // nothing and is simply tried again on the next tick.
        // A run outlives a portfolio switch (the load and the AI call take seconds). The job-store writers
        // always write to the CURRENT portfolio, so after a switch they would hit an unrelated job that
        // shares this job's numeric id: drop them unless the portfolio is still the one the tick began on.
        // (They also match by the job's permanent key inside the store.)
        const identity = config.httpUrl;
        const samePortfolio = () => argsRef.current.config?.httpUrl === identity;
        const deps: RunDeps = {
          config,
          listProjects: () => listProjectRefs(config),
          // The latest args, read at call time: the job list, the switches and the key may have changed since the
          // tick began, and a run is billed.
          stillRunnable: (job) => {
            const now = argsRef.current;
            if (!now.enabled || !now.available || !samePortfolio() || now.jobsSource !== identity) return false;
            if (now.ai.apiKey === "") return false;
            const live = now.jobs.find((j) => j.key !== null && j.key === job.key);
            return live !== undefined && isRunnable(live) && live.projectId === job.projectId;
          },
          loadWorkspace: (projectId) => new TursoBackend(config, projectId).load(),
          // Cache the guide prefix only when this tick sends more than one request: a lone request
          // would pay the cache write and never read it.
          analyse: (context) => runJobAnalysis(context, { ...argsRef.current.ai, cacheGuides: pending.length > 1 }),
          deviceSettings: a.deviceSettings,
          lang: a.lang,
          now: a.now ?? (() => new Date()),
          newId: () => crypto.randomUUID(),
          deviceLabel: getDeviceLabel(),
          clearProject: async (jobId, key) => { if (samePortfolio()) await argsRef.current.clearProject(jobId, key); },
          disableJob: async (jobId, key) => { if (samePortfolio()) await argsRef.current.disableJob(jobId, key); },
          recordRun: async (jobId, run, key) => { if (samePortfolio()) await argsRef.current.recordRun(jobId, run, key); },
          notify: a.notify,
        };
        for (const { job, slot } of pending) {
          try {
            const outcome = await runScheduledJob(job, slot, deps);
            if (REPORT_WRITTEN.has(outcome)) window.dispatchEvent(new CustomEvent(SCHEDULED_REPORT_EVENT));
          } catch {
            // The store or the project list was unreachable before anything was claimed or billed.
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
