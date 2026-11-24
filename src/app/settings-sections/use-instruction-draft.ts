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
  mounted: { current: boolean };
  setStatus: (update: (s: DraftStatus) => DraftStatus) => void;
  setDraft: (value: string) => void;
  setBase: (value: string) => void;
}

/** Saves the trimmed draft when it differs from what the store will hold (the text the draft started from, or the
 *  last text this row is still saving). The save is conditional: it writes only while the stored instruction is the
 *  text the draft started from or one this row is saving, so it never overwrites another device's change; a refused
 *  save drops the draft and says so. The draft counts as saved only once the write succeeds: a failed save keeps it
 *  ("not saved", while it still differs) and the next blur retries. */
function flushDraft(r: DraftRefs): void {
  const d = r.latest.current;
  const typed = d.draft.trim();
  const expected = r.pending.current.length > 0 ? r.pending.current[r.pending.current.length - 1] : d.base;
  if (typed === expected) {
    if (r.pending.current.length === 0) r.setStatus((st) => (st === "notSaved" ? "ok" : st));
    return;
  }
  const allowed = [d.base, ...r.pending.current];
  r.pending.current = [...r.pending.current, typed];
  const settle = () => {
    const sent = r.pending.current.indexOf(typed);
    r.pending.current = r.pending.current.filter((_, i) => i !== sent);
  };
  Promise.resolve(d.onUpdate(d.jobId, { instruction: typed === "" ? undefined : typed }, { ifInstructionIn: allowed })).then(
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
        // Another device changed the job since the draft started: drop the draft, never write over that change.
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
 *  fires no blur on a focused node that unmounts); see `flushDraft`. When the stored instruction changes and the field
 *  holds no unsaved change, the draft follows the store; an unsaved draft is kept, and its conditional save decides. */
export function useInstructionDraft(job: ScheduledJob, onUpdate: JobUpdate) {
  const stored = job.instruction ?? "";
  const [draft, setDraft] = useState(stored);
  const [base, setBase] = useState(stored);
  const [seen, setSeen] = useState(stored);
  const [status, setStatus] = useState<DraftStatus>("ok");
  if (stored !== seen) {
    setSeen(stored);
    if (draft.trim() === base) {
      setDraft(stored);
      setBase(stored);
    }
  }
  const latest = useRef({ jobId: job.id, draft, base, onUpdate });
  const pending = useRef<readonly string[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = { jobId: job.id, draft, base, onUpdate };
  });
  useEffect(() => {
    mounted.current = true;
    const refs: DraftRefs = { latest, pending, mounted, setStatus, setDraft, setBase };
    return () => {
      mounted.current = false;
      flushDraft(refs);
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
    onBlur: () => flushDraft({ latest, pending, mounted, setStatus, setDraft, setBase }),
    clearDropped: () => setStatus((st) => (st === "dropped" ? "ok" : st)),
  };
}
