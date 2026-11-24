// src/app/settings-sections/use-instruction-draft.ts — the standing instruction of a scheduled job as a draft against the
// stored job: saved on blur and on unmount, conditionally (never over another device's change), kept after a failed
// save. Extracted from scheduled-job-row.tsx unchanged.
import { useEffect, useRef, useState } from "react";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { UpdateJobOptions, UseScheduledJobsResult } from "../use-scheduled-jobs";
import { JobChangedError } from "../scheduled-jobs/schedule";

/** The fields `updateJob` accepts — exactly its patch type, so a row can never write a project or key. */
export type JobPatch = Parameters<UseScheduledJobsResult["updateJob"]>[1];

/** A job write from the row; the instruction draft waits for it, so a failed save keeps the draft. The draft's save
 *  passes a precondition (`UpdateJobOptions`) so it never writes over a change made elsewhere. */
export type JobUpdate = (id: number, patch: JobPatch, options?: UpdateJobOptions) => Promise<void> | void;

/** Where the instruction draft stands against the stored job: in step, kept after a failed save (`notSaved`), or
 *  dropped because its save found the job changed elsewhere (`dropped`). */
export type DraftStatus = "ok" | "notSaved" | "dropped";

/** What a draft save needs, kept current by the handlers and an effect (never written during render). */
interface DraftRefs {
  latest: { current: { jobId: number; draft: string; base: string; onUpdate: JobUpdate } };
  /** Texts this row has sent and not yet seen settle, oldest first. */
  pending: { current: readonly string[] };
  /** The stored text this row expects when its next save RUNS: the text the draft started from, then each text this
   *  row's save wrote (set inside the write chain), or the text a refusal found. */
  expected: { current: string };
  mounted: { current: boolean };
  setStatus: (update: (s: DraftStatus) => DraftStatus) => void;
  setDraft: (value: string) => void;
  setBase: (value: string) => void;
  setHasPending: (value: boolean) => void;
}

/** Saves the trimmed draft when it differs from what the store will hold (the text the draft started from, or the
 *  last text this row is still saving). The save is conditional and judged when it RUNS: it writes only while the
 *  stored instruction is the text this row last wrote or started from, or already equals the text being saved, so it
 *  never overwrites another device's change; a refused save drops the draft and says so. The draft counts as saved
 *  only once the write succeeds: a failed save keeps it ("not saved", while it still differs) and the next blur
 *  retries. */
function flushDraft(r: DraftRefs): void {
  const d = r.latest.current;
  const typed = d.draft.trim();
  const willHold = r.pending.current.length > 0 ? r.pending.current[r.pending.current.length - 1] : d.base;
  if (typed === willHold) {
    if (r.pending.current.length === 0) r.setStatus((st) => (st === "notSaved" ? "ok" : st));
    return;
  }
  if (r.pending.current.length === 0) r.expected.current = d.base;
  r.pending.current = [...r.pending.current, typed];
  r.setHasPending(true);
  const settle = () => {
    const sent = r.pending.current.indexOf(typed);
    r.pending.current = r.pending.current.filter((_, i) => i !== sent);
    if (r.mounted.current) r.setHasPending(r.pending.current.length > 0);
  };
  const options = { expectInstruction: () => r.expected.current, onWritten: () => { r.expected.current = typed; } };
  Promise.resolve(d.onUpdate(d.jobId, { instruction: typed === "" ? undefined : typed }, options)).then(
    () => {
      settle();
      r.latest.current = { ...r.latest.current, base: typed };
      if (!r.mounted.current) return;
      r.setBase(typed);
      r.setStatus((st) => (st === "notSaved" ? "ok" : st));
    },
    (err: unknown) => {
      settle();
      if (err instanceof JobChangedError) {
        // Another device changed the job since this row last wrote it: drop the draft, never write over that change.
        r.expected.current = err.stored;
        r.latest.current = { ...r.latest.current, draft: err.stored, base: err.stored };
        if (!r.mounted.current) return;
        r.setDraft(err.stored);
        r.setBase(err.stored);
        r.setStatus(() => "dropped");
        return;
      }
      const now = r.latest.current;
      if (r.mounted.current && now.draft.trim() !== now.base) r.setStatus(() => "notSaved");
    },
  );
}

/** The standing instruction as a draft against the stored job. It saves on blur and on unmount (closing the dialog
 *  fires no blur on a focused node that unmounts); see `flushDraft`. When the stored instruction changes: a stored
 *  text equal to the draft rebases it (no notice); with no unsaved change AND no save of this row pending, the draft
 *  follows the store; otherwise the draft is kept and its conditional save decides. */
export function useInstructionDraft(job: ScheduledJob, onUpdate: JobUpdate) {
  const stored = job.instruction ?? "";
  const [draft, setDraft] = useState(stored);
  const [base, setBase] = useState(stored);
  const [seen, setSeen] = useState(stored);
  const [hasPending, setHasPending] = useState(false);
  const [status, setStatus] = useState<DraftStatus>("ok");
  if (stored !== seen) {
    setSeen(stored);
    const typed = draft.trim();
    if (typed === stored) {
      setBase(stored);
      setStatus((st) => (st === "notSaved" ? "ok" : st));
    } else if (!hasPending && typed === base) {
      setDraft(stored);
      setBase(stored);
    }
  }
  const latest = useRef({ jobId: job.id, draft, base, onUpdate });
  const pending = useRef<readonly string[]>([]);
  const expected = useRef(stored);
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = { jobId: job.id, draft, base, onUpdate };
  });
  const refs = (): DraftRefs => ({ latest, pending, expected, mounted, setStatus, setDraft, setBase, setHasPending });
  useEffect(() => {
    mounted.current = true;
    const unmountRefs: DraftRefs = { latest, pending, expected, mounted, setStatus, setDraft, setBase, setHasPending };
    return () => {
      mounted.current = false;
      flushDraft(unmountRefs);
    };
  }, []);
  return {
    draft,
    status,
    onChange: (value: string) => {
      latest.current = { ...latest.current, draft: value };
      setDraft(value);
      // A draft typed back to the stored text has nothing left unsaved; a new edit ends the dropped notice.
      setStatus((st) => (value.trim() === base || st === "dropped" ? "ok" : st));
    },
    onBlur: () => flushDraft(refs()),
    clearDropped: () => setStatus((st) => (st === "dropped" ? "ok" : st)),
  };
}
