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
import { getDeviceLabel } from "./device-label";
import { acceptJob, forgetJob, jobFingerprint, markEditedHere } from "./scheduled-job-acceptance";
import { loadScheduledJobs, saveScheduledJobs } from "./scheduled-jobs-store";
import { appendRun, JobChangedError, JobGoneError, JobNotEditableError, jobSaveId, normalizeJobFields } from "./scheduled-jobs/schedule";
import { forgetLostDraft } from "./scheduled-jobs/lost-draft";
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
  /** Read the list again when the tab becomes visible or the window regains focus (the Settings list; not the
   *  always-mounted runner instance). */
  refreshOnFocus?: boolean;
  /** Keep `savingJobs` current (the Settings list, whose answer buttons wait for saves). Without it the set stays
   *  empty and a save adds no re-render. */
  trackSaving?: boolean;
}

/** A precondition judged when the write RUNS, on the FRESH store list inside the write chain. The write happens only
 *  while the stored instruction ("" for none) is `expectInstruction()` at that moment, or already equals the text being
 *  written (the same text from both sides is a success). Otherwise — and ALWAYS when `expectInstruction()` returns
 *  `null` (the caller no longer wants this write) — nothing is written and the write rejects with a `JobChangedError`
 *  (the list is read again). Both callbacks run inside the chain, before any later write's precondition is judged:
 *  `onWritten` once the write landed, `onRefused` when the precondition refused it. */
export interface UpdateJobOptions {
  expectInstruction: () => string | null;
  onWritten?: () => void;
  onRefused?: () => void;
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
  updateJob: (
    id: number, patch: Partial<Omit<ScheduledJob, "id" | "projectId" | "key">>, key?: string, options?: UpdateJobOptions,
  ) => Promise<void>;
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
  /** The current backend's list, read AFTER the writes in progress settle (a rejected link does not reject the read). */
  readFresh: () => Promise<ScheduledJob[]>;
  /** `jobSaveId`s of the jobs this instance is saving: from the call until every save of that job settled (success or
   *  failure). The Settings row disables its answer buttons meanwhile, so an answer never races this device's edit. */
  savingJobs: ReadonlySet<string>;
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

/** An edit reaches only a job this version can read: a foreign one is carried through untouched. */
const editable = (j: ScheduledJob): boolean => j.foreign === undefined;

/** The job a keyed write means: same id, and — when the caller knows it — the same permanent key. */
function matches(j: ScheduledJob, id: number, key: string | undefined): boolean {
  return j.id === id && (key === undefined || j.key === key);
}

/** An unrecognised zone is left out of the patch, so the stored zone stays. */
function normalizeZonePatch(timeZone: string | null | undefined): { timeZone?: string | null } {
  const zone = normalizeJobFields(undefined, timeZone).timeZone;
  return zone === null && typeof timeZone === "string" ? {} : { timeZone: zone };
}

/** The free fields of a patch go through the same normalisation as a create and a load. */
function normalizePatch<P extends { instruction?: string; timeZone?: string | null }>(patch: P): P {
  // An unrecognised zone is left out of the patch (the stored zone stays) instead of making the job unrunnable.
  const rest: P = { ...patch };
  delete rest.timeZone;
  return {
    ...rest,
    ...("instruction" in patch ? { instruction: normalizeJobFields(patch.instruction, undefined).instruction } : {}),
    ...("timeZone" in patch ? normalizeZonePatch(patch.timeZone) : {}),
  } as P;
}

/** How `writeJob` treats one write: mark a saved change of project or instruction as this device's (`markEdit`), run
 *  `afterSave` inside the chain once it landed, and — for a user's edits (`rejectIfGone`) — reject with `JobGoneError`
 *  when the job is gone or `JobNotEditableError` when it is no longer editable here, then read the list again (also
 *  after a `JobChangedError`). */
interface WriteJobHow {
  markEdit?: boolean;
  afterSave?: () => void;
  rejectIfGone?: boolean;
}

/** A failed read (a busy database while another tab migrates, a dropped connection) is retried a few times, so a tab
 *  that lost the race does not stay empty for the session. */
const MAX_LOAD_RETRIES = 3;
const LOAD_RETRY_MS = 5_000;

export function useScheduledJobs({ config, refreshOnFocus = false, trackSaving = false }: UseScheduledJobsArgs): UseScheduledJobsResult {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [jobsSource, setJobsSource] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [savingJobs, setSavingJobs] = useState<ReadonlySet<string>>(new Set());
  const savingCounts = useRef<ReadonlyMap<string, number>>(new Map());
  const cfgRef = useRef(config);
  const mountedRef = useRef(true);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  // What this tab displays: a write names its job (and its save-in-flight identity) by what the user saw.
  const jobsRef = useRef<ScheduledJob[]>([]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  const jobsSourceRef = useRef<string | null | undefined>(undefined);
  useEffect(() => { jobsSourceRef.current = jobsSource; }, [jobsSource]);
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
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const config = cfgRef.current;
      const startedAt = generationOf(config);
      const list = await loadScheduledJobs(config);
      if (!mountedRef.current || startedAt !== generationOf(config) || backendOf(cfgRef.current) !== backendOf(config)) return;
      // A job this tab showed from the same backend and now gone was deleted elsewhere: forget any text kept for it.
      if (jobsSourceRef.current === backendOf(config)) {
        const keys = new Set(list.map((j) => j.key));
        for (const gone of jobsRef.current) if (gone.key !== null && !keys.has(gone.key)) forgetLostDraft(jobSaveId(gone));
      }
      setJobs(list);
      setJobsSource(backendOf(config));
      retriesRef.current = 0;
    } catch {
      // Optional feature: leave jobs as they are, and try again a few times.
      if (mountedRef.current && retriesRef.current < MAX_LOAD_RETRIES) {
        retriesRef.current += 1;
        if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void refreshRef.current();
        }, LOAD_RETRY_MS * retriesRef.current);
      }
    } finally {
      if (mountedRef.current) setReady(true);
    }
  }, []);

  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    retriesRef.current = 0; // a new backend starts with a fresh budget
    if (retryTimerRef.current !== null) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    void refresh();
  }, [refresh, config]);

  // Another device may have changed a job while this tab was in the background: read again when it is looked at.
  useEffect(() => {
    if (!refreshOnFocus) return;
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onFocus = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, refreshOnFocus]);

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
    (transform: (list: readonly ScheduledJob[]) => ScheduledJob[], onSaved?: () => void): Promise<void> => {
      if (mountedRef.current) setBusy(true);
      const run = writeChain.then(async () => {
        // ONE backend per write: read the config once, so a switch mid-write cannot load from one and save
        // to the other. The list reaches this instance only while it is still on that backend.
        const config = cfgRef.current;
        const existing = await loadScheduledJobs(config);
        const next = transform(existing);
        await saveScheduledJobs(config, next);
        savedGenerations.set(backendOf(config), generationOf(config) + 1);
        onSaved?.(); // before the new list renders, so the row reads it with the new list
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

  // Counts a save of the job `saveId` from the call until it settles; overlapping saves keep it saving until all settle.
  const trackSave = useCallback((saveId: string, write: Promise<void>): Promise<void> => {
    if (!trackSaving) return write;
    const bump = (delta: number) => {
      const next = new Map(savingCounts.current);
      const count = (next.get(saveId) ?? 0) + delta;
      if (count > 0) next.set(saveId, count);
      else next.delete(saveId);
      savingCounts.current = next;
      if (mountedRef.current) setSavingJobs(new Set(next.keys()));
    };
    bump(1);
    const settle = () => bump(-1);
    write.then(settle, settle);
    return write;
  }, [trackSaving]);

  /** Writes one job (by id, and key when known). With `markEdit`, a saved change of its project or instruction marks it
   *  edited here (display only). An edit NEVER writes an acceptance answer: this device answers only by creating a job
   *  or by the user's Accept / Stop / "Not on this device". */
  const writeJob = useCallback(
    (id: number, key: string | undefined, edit: (j: ScheduledJob) => ScheduledJob, how: WriteJobHow = {}): Promise<void> => {
      const displayed = jobsRef.current.find((j) => matches(j, id, key));
      let edited: ScheduledJob | null = null;
      let matched = false;
      const transform = (list: readonly ScheduledJob[]) => {
        const next = list.map((j) => {
          if (!(editable(j) && matches(j, id, key))) return j;
          matched = true;
          const written = edit(j);
          edited = how.markEdit && jobFingerprint(written) !== jobFingerprint(j) ? written : null;
          return written;
        });
        // A user's edit of a job deleted elsewhere writes nothing and says so; the runner's writes stay quiet.
        // A user's edit that reached no job never resolves as written: gone (deleted elsewhere), or no longer editable
        // here (it turned foreign).
        if (!matched && how.rejectIfGone) throw list.some((j) => matches(j, id, key)) ? new JobNotEditableError() : new JobGoneError();
        return next;
      };
      const onSaved = () => {
        if (!matched) return; // nothing of this job was written
        const saved: ScheduledJob | null = edited;
        if (saved !== null && saved.key !== null) markEditedHere(saved.key, jobFingerprint(saved));
        how.afterSave?.();
      };
      const write = mutate(transform, onSaved).catch((err: unknown) => {
        // A user's edit refused, or whose job is gone or no longer editable: read the list again, so the row shows what
        // the store holds now (or goes away) whichever write path it came from.
        const stale = err instanceof JobChangedError || err instanceof JobGoneError || err instanceof JobNotEditableError;
        if (how.rejectIfGone && stale) void refresh();
        throw err;
      });
      return trackSave(jobSaveId(displayed ?? { id, key: key ?? null }), write);
    },
    [mutate, trackSave, refresh],
  );

  const readFresh = useCallback(
    (): Promise<ScheduledJob[]> =>
      writeChain.then(
        () => loadScheduledJobs(cfgRef.current),
        () => loadScheduledJobs(cfgRef.current),
      ),
    [],
  );

  const createJob = useCallback((input: CreateScheduledJobInput): Promise<void> => {
    let written: ScheduledJob | undefined;
    return mutate((list) => {
      const { instruction, timeZone } = normalizeJobFields(input.instruction, input.timeZone);
      const label = getDeviceLabel();
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
        ...(label !== "unknown" ? { createdBy: label } : {}),
        lastRunAt: null,
        history: [],
      };
      written = job;
      return [...list, job];
    }).then(() => { if (written) acceptJob(written); });
  }, [mutate]);

  const updateJob = useCallback(
    (id: number, patch: Partial<Omit<ScheduledJob, "id" | "projectId" | "key">>, key?: string, options?: UpdateJobOptions): Promise<void> => {
      const normalized = normalizePatch(patch);
      const edit = (j: ScheduledJob): ScheduledJob => {
        const stored = j.instruction ?? "";
        const writing = normalized.instruction ?? "";
        if (options !== undefined) {
          const expected = options.expectInstruction();
          if (expected === null || (stored !== expected && stored !== writing)) {
            options.onRefused?.();
            throw new JobChangedError(stored);
          }
        }
        return { ...j, ...normalized, id: j.id };
      };
      return writeJob(id, key, edit, { markEdit: true, afterSave: options?.onWritten, rejectIfGone: true });
    },
    [writeJob],
  );

  const deleteJob = useCallback((id: number, key?: string): Promise<void> => {
    let removedKey: string | null | undefined;
    const displayed = jobsRef.current.find((j) => matches(j, id, key));
    const write = mutate((list) => {
      removedKey = list.find((j) => matches(j, id, key))?.key;
      return list.filter((j) => !matches(j, id, key));
    }).then(() => {
      if (typeof removedKey === "string") forgetJob(removedKey);
      forgetLostDraft(jobSaveId({ id, key: removedKey ?? key ?? null }));
    });
    return trackSave(jobSaveId(displayed ?? { id, key: key ?? null }), write);
  }, [mutate, trackSave]);

  const assignProject = useCallback(
    (id: number, projectId: string, timeZone: string, key?: string): Promise<void> =>
      writeJob(id, key, (j) => ({
        ...j, projectId, timeZone: j.timeZone ?? normalizeJobFields(undefined, timeZone).timeZone, key: j.key ?? crypto.randomUUID(),
      }), { markEdit: true, rejectIfGone: true }),
    [writeJob],
  );

  const clearProject = useCallback((id: number, key?: string): Promise<void> =>
    writeJob(id, key, (j) => ({ ...j, projectId: null })), [writeJob]);

  const disableJob = useCallback((id: number, key?: string): Promise<void> =>
    writeJob(id, key, (j) => ({ ...j, enabled: false })), [writeJob]);

  const recordRun = useCallback((jobId: number, run: ScheduledJobRun, key?: string): Promise<void> =>
    writeJob(jobId, key, (j) => appendRun(j, run)), [writeJob]);

  return {
    jobs, jobsSource, busy, ready, createJob, updateJob, deleteJob, assignProject, clearProject, disableJob, recordRun, refresh, readFresh,
    savingJobs,
  };
}
