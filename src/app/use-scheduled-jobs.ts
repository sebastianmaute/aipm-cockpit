// src/app/use-scheduled-jobs.ts — global scheduled-job library hook (SP5).
// Dual-backend via the store: config=null -> localStorage, else Turso (gated).
// The store persists the WHOLE job list as one unit (load/save), so every
// mutation re-reads the live list from the store (not the stale render closure)
// and writes the full mutated list back. Writes are serialized through a
// promise chain so back-to-back saves can't race the Turso pipeline.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadScheduledJobs, saveScheduledJobs } from "./scheduled-jobs-store";
import { appendRun } from "./scheduled-jobs/schedule";
import type {
  JobCadence, ScheduledJob, ScheduledJobRun,
} from "./scheduled-jobs/types";
import type { TursoConfig } from "./turso-config";

export interface CreateScheduledJobInput {
  name: string;
  cadence: JobCadence;
  enabled: boolean;
  type?: "portfolioAnalysis";
}

export interface UseScheduledJobsArgs {
  config: TursoConfig | null; // null = localStorage backend
}

export interface UseScheduledJobsResult {
  jobs: ScheduledJob[];
  busy: boolean;
  ready: boolean;
  createJob: (input: CreateScheduledJobInput) => Promise<void>;
  updateJob: (id: number, patch: Partial<Omit<ScheduledJob, "id">>) => Promise<void>;
  deleteJob: (id: number) => Promise<void>;
  recordRun: (jobId: number, run: ScheduledJobRun) => Promise<void>;
  refresh: () => Promise<void>;
}

function nextJobId(jobs: readonly ScheduledJob[]): number {
  return jobs.reduce((m, j) => Math.max(m, j.id), 0) + 1;
}

export function useScheduledJobs({ config }: UseScheduledJobsArgs): UseScheduledJobsResult {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const cfgRef = useRef(config);
  const mountedRef = useRef(true);
  // Serialize every store write behind this chain so concurrent mutations
  // can't interleave their load/save against Turso.
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { cfgRef.current = config; }, [config]);
  // ★★ Re-set on mount, not merely cleared on unmount. React StrictMode mounts,
  //    unmounts and remounts in development (Next 16 defaults reactStrictMode to
  //    true), so a cleanup-only guard is permanently false after that first cycle
  //    and every setter below it — setJobs, setBusy, setReady — is suppressed for
  //    the rest of the dev session.
  //    ★★ TWO surfaces, and the worse one is not the visible one. This hook has
  //    two consumers: `scheduled-jobs-section.tsx` (the Settings list, which
  //    renders with an empty job list) and `use-ai-orchestration.ts`, which feeds
  //    `jobs` to `useScheduledJobRunner` — so with setJobs suppressed the runner
  //    sees an empty list and NO SCHEDULED JOB EVER FIRES in dev, silently.
  //    ★ Neither consumer reads `ready`, so the symptom is never a stuck spinner.
  //    An earlier version of this comment said "the panel never leaves its
  //    loading state"; that was false and is recorded in open-followups §76.
  //    Declared BEFORE the refresh effect so the remount restores the flag before
  //    that effect re-runs. Mirrors use-storage-backend.ts (open-followups §72/§76).
  //    ★ Pinned by "still applies the loaded jobs after StrictMode's remount"
  //    in use-scheduled-jobs.test.tsx. This previously read "No test can pin
  //    this: StrictMode invokes effects ONCE under this suite". That
  //    OBSERVATION is reproducible — a child mounted under a StrictMode that
  //    is itself nested inside a wrapper is single-invoked — but the
  //    CONCLUSION was wrong: with `wrapper: StrictMode` it double-invokes and
  //    this line is pinnable. strictmode.meta.test.tsx pins that shape rule
  //    and its edges (including that the same nesting DOES double-invoke a
  //    child mounted on a later commit — the rule turns on which fiber is
  //    flagged for PLACEMENT, not on the tree or the commit number).
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await loadScheduledJobs(cfgRef.current);
      if (!mountedRef.current) return;
      setJobs(list);
    } catch {
      // optional feature — leave jobs as-is
    } finally {
      if (mountedRef.current) setReady(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, config]);

  // Run a mutation on the live store list, serialized behind the write chain.
  const mutate = useCallback(
    (transform: (list: readonly ScheduledJob[]) => ScheduledJob[]): Promise<void> => {
      if (mountedRef.current) setBusy(true);
      const run = writeChainRef.current.then(async () => {
        const existing = await loadScheduledJobs(cfgRef.current);
        const next = transform(existing);
        await saveScheduledJobs(cfgRef.current, next);
        if (mountedRef.current) setJobs(next);
      });
      // Keep the chain alive even if a link rejects, and clear busy at the end.
      writeChainRef.current = run.then(
        () => { if (mountedRef.current) setBusy(false); },
        () => { if (mountedRef.current) setBusy(false); },
      );
      return run;
    },
    [],
  );

  const createJob = useCallback((input: CreateScheduledJobInput): Promise<void> => {
    return mutate((list) => {
      const job: ScheduledJob = {
        id: nextJobId(list),
        name: input.name,
        type: input.type ?? "portfolioAnalysis",
        cadence: input.cadence,
        enabled: input.enabled,
        lastRunAt: null,
        history: [],
      };
      return [...list, job];
    });
  }, [mutate]);

  const updateJob = useCallback(
    (id: number, patch: Partial<Omit<ScheduledJob, "id">>): Promise<void> => {
      return mutate((list) =>
        list.map((j) => (j.id === id ? { ...j, ...patch, id: j.id } : j)),
      );
    },
    [mutate],
  );

  const deleteJob = useCallback((id: number): Promise<void> => {
    return mutate((list) => list.filter((j) => j.id !== id));
  }, [mutate]);

  const recordRun = useCallback((jobId: number, run: ScheduledJobRun): Promise<void> => {
    return mutate((list) =>
      list.map((j) => (j.id === jobId ? appendRun(j, run) : j)),
    );
  }, [mutate]);

  return { jobs, busy, ready, createJob, updateJob, deleteJob, recordRun, refresh };
}
