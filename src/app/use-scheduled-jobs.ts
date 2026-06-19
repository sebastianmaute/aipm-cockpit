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
  useEffect(() => () => { mountedRef.current = false; }, []);

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
