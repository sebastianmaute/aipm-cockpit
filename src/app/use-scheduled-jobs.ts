// src/app/use-scheduled-jobs.ts — global scheduled-job library hook (SP5).
// Dual-backend via the store: config=null -> localStorage, else Turso (gated).
// The store persists the WHOLE job list as one unit (load/save), so every
// mutation re-reads the live list from the store (not the stale render closure)
// and writes the full mutated list back. Writes are serialized through a
// promise chain so back-to-back saves can't race the Turso pipeline.
// §750 — the hook has two instances (the runner in use-ai-orchestration.ts and
// the Settings list in scheduled-jobs-section.tsx). The chain is MODULE-level, so
// two instances writing at once cannot both read the list before either saves,
// and a write tells every other mounted instance to re-read the store: a job made
// in Settings reaches the runner, and a run the runner records shows in Settings.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadScheduledJobs, saveScheduledJobs } from "./scheduled-jobs-store";
import { appendRun, normalizeJobFields } from "./scheduled-jobs/schedule";
import type {
  JobCadence, ScheduledJob, ScheduledJobRun,
} from "./scheduled-jobs/types";
import type { TursoConfig } from "./turso-config";

export interface CreateScheduledJobInput {
  name: string;
  cadence: JobCadence;
  enabled: boolean;
  type?: "portfolioAnalysis";
  projectId?: string;
  timeZone?: string;
  instruction?: string;
}

export interface UseScheduledJobsArgs {
  config: TursoConfig | null; // null = localStorage backend
}

export interface UseScheduledJobsResult {
  jobs: ScheduledJob[];
  /** The backend `jobs` was read from (`backendOf`): undefined before the first read. After a config change `jobs`
   *  still belongs to the previous backend until the new read lands. */
  jobsSource: string | null | undefined;
  busy: boolean;
  ready: boolean;
  createJob: (input: CreateScheduledJobInput) => Promise<void>;
  /** projectId and key are set only by assignProject, so a patch can never save a project without them. */
  updateJob: (id: number, patch: Partial<Omit<ScheduledJob, "id" | "projectId" | "key">>, key?: string) => Promise<void>;
  deleteJob: (id: number, key?: string) => Promise<void>;
  /** Names the project (and zone) of a job; mints the permanent key in the same save when it has none. */
  assignProject: (id: number, projectId: string, timeZone: string, key?: string) => Promise<void>;
  /** §772 — the runner found the job's project hard-deleted: back to "Choose a project" (the key stays). */
  clearProject: (id: number, key?: string) => Promise<void>;
  /** §772 — switch a job off (its project was archived). */
  disableJob: (id: number, key?: string) => Promise<void>;
  /** With `key`, only the job carrying that permanent key is written: ids collide across portfolios. */
  recordRun: (jobId: number, run: ScheduledJobRun, key?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function nextJobId(jobs: readonly ScheduledJob[]): number {
  return jobs.reduce((m, j) => Math.max(m, j.id), 0) + 1;
}

/** §750 — shared by every instance: one write chain, and each mounted instance's re-read. */
let writeChain: Promise<void> = Promise.resolve();
const instances = new Set<() => void>();
/** The backend a config names: its database URL, or null for localStorage. NOT the config object — an equal one is
 *  minted whenever the URL or token is set again (typing it, hydration), and a new token for the same database is
 *  the same backend. */
const backendOf = (config: TursoConfig | null): string | null => (config ? config.httpUrl : null);

/** Bumped by every completed save, PER BACKEND (`backendOf`). A read
 *  started before the latest save to its own backend may answer after a newer list was applied (a slow Turso
 *  round trip), so its result is dropped: a newer list always follows it — the write's own list, or the
 *  re-read that write starts in every other instance. A save to the OTHER backend drops nothing. */
const savedGenerations = new Map<string | null, number>();
const generationOf = (config: TursoConfig | null): number => savedGenerations.get(backendOf(config)) ?? 0;

/** The job a keyed write means: same id, and — when the caller knows it — the same permanent key. */
function matches(j: ScheduledJob, id: number, key: string | undefined): boolean {
  return j.id === id && (key === undefined || j.key === key);
}

export function useScheduledJobs({ config }: UseScheduledJobsArgs): UseScheduledJobsResult {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [jobsSource, setJobsSource] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const cfgRef = useRef(config);
  const mountedRef = useRef(true);
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
      const config = cfgRef.current;
      const startedAt = generationOf(config);
      const list = await loadScheduledJobs(config);
      if (!mountedRef.current || startedAt !== generationOf(config) || backendOf(cfgRef.current) !== backendOf(config)) return;
      setJobs(list);
      setJobsSource(backendOf(config));
    } catch {
      // optional feature — leave jobs as-is
    } finally {
      if (mountedRef.current) setReady(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, config]);

  // §750 — this instance's re-read, which another instance's write calls.
  const rereadRef = useRef<() => void>(() => {});
  useEffect(() => {
    const reread = () => { void refresh(); };
    rereadRef.current = reread;
    instances.add(reread);
    return () => { instances.delete(reread); };
  }, [refresh]);

  // Run a mutation on the live store list, serialized behind the write chain.
  const mutate = useCallback(
    (transform: (list: readonly ScheduledJob[]) => ScheduledJob[]): Promise<void> => {
      if (mountedRef.current) setBusy(true);
      const run = writeChain.then(async () => {
        // ONE backend per write: read the config once, so a switch mid-write cannot load from one and save
        // to the other. The list reaches this instance only while it is still on that backend.
        const config = cfgRef.current;
        const existing = await loadScheduledJobs(config);
        const next = transform(existing);
        await saveScheduledJobs(config, next);
        savedGenerations.set(backendOf(config), generationOf(config) + 1);
        if (mountedRef.current && backendOf(cfgRef.current) === backendOf(config)) { setJobs(next); setJobsSource(backendOf(config)); }
        for (const reread of instances) if (reread !== rereadRef.current) reread();
      });
      // Keep the chain alive even if a link rejects, and clear busy at the end.
      writeChain = run.then(
        () => { if (mountedRef.current) setBusy(false); },
        () => { if (mountedRef.current) setBusy(false); },
      );
      return run;
    },
    [],
  );

  const createJob = useCallback((input: CreateScheduledJobInput): Promise<void> => {
    return mutate((list) => {
      const { instruction, timeZone } = normalizeJobFields(input.instruction, input.timeZone);
      const job: ScheduledJob = {
        id: nextJobId(list),
        name: input.name,
        type: input.type ?? "portfolioAnalysis",
        cadence: input.cadence,
        enabled: input.enabled,
        projectId: input.projectId ?? null,
        ...(instruction !== undefined ? { instruction } : {}),
        timeZone,
        key: crypto.randomUUID(),
        lastRunAt: null,
        history: [],
      };
      return [...list, job];
    });
  }, [mutate]);

  const updateJob = useCallback(
    (id: number, patch: Partial<Omit<ScheduledJob, "id" | "projectId" | "key">>, key?: string): Promise<void> => {
      return mutate((list) =>
        list.map((j) => (matches(j, id, key) ? { ...j, ...patch, id: j.id } : j)),
      );
    },
    [mutate],
  );

  const deleteJob = useCallback((id: number, key?: string): Promise<void> => {
    return mutate((list) => list.filter((j) => !matches(j, id, key)));
  }, [mutate]);

  const assignProject = useCallback(
    (id: number, projectId: string, timeZone: string, key?: string): Promise<void> => {
      return mutate((list) =>
        list.map((j) => (matches(j, id, key)
          ? { ...j, projectId, timeZone: j.timeZone ?? normalizeJobFields(undefined, timeZone).timeZone, key: j.key ?? crypto.randomUUID() }
          : j)),
      );
    },
    [mutate],
  );

  const clearProject = useCallback((id: number, key?: string): Promise<void> => {
    return mutate((list) => list.map((j) => (matches(j, id, key) ? { ...j, projectId: null } : j)));
  }, [mutate]);

  const disableJob = useCallback((id: number, key?: string): Promise<void> => {
    return mutate((list) => list.map((j) => (matches(j, id, key) ? { ...j, enabled: false } : j)));
  }, [mutate]);

  const recordRun = useCallback((jobId: number, run: ScheduledJobRun, key?: string): Promise<void> => {
    return mutate((list) =>
      list.map((j) => (matches(j, jobId, key) ? appendRun(j, run) : j)),
    );
  }, [mutate]);

  return { jobs, jobsSource, busy, ready, createJob, updateJob, deleteJob, assignProject, clearProject, disableJob, recordRun, refresh };
}
