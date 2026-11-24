// src/app/settings-sections/use-instruction-draft.ts — the standing instruction of a scheduled job as a draft against the
// stored job. It saves on blur and on unmount; each save is conditional, judged when it runs against the stored text
// the field showed before that edit (or what this row wrote since), so it does not write over another device's change.
// A refusal drops the draft, and every save this row queued before it is refused too, whatever the stored text has
// done since; an edit made after a refusal starts from the text then shown. A failed save keeps the draft and the
// next blur retries.
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
  /** Saves this row has sent and not yet seen settle, oldest first, each with the refusal generation it started in. */
  pending: { current: readonly { text: string; gen: number }[] };
  /** The stored text this row expects when its next save of the current generation RUNS: the text the field showed
   *  when the generation's first save started, then each text this row's save wrote (set inside the write chain). */
  expected: { current: string };
  /** Bumped by a refusal: every save started in an earlier generation is refused when it runs, whatever the stored
   *  text has done since. */
  generation: { current: number };
  mounted: { current: boolean };
  setStatus: (update: (s: DraftStatus) => DraftStatus) => void;
  setDraft: (value: string) => void;
  setBase: (value: string) => void;
  setHasPending: (value: boolean) => void;
}

/** Saves the trimmed draft, unless it equals what the store will hold: the last text this row is still saving in the
 *  current refusal generation, or else the text the field showed (`base`). The save is conditional and judged when it
 *  RUNS: a save of the current generation writes only while the stored instruction is the text the field showed
 *  before the generation's first edit or what this row wrote since, or already equals the text being saved; a save
 *  from an older generation is refused outright. A refusal starts a new generation inside the write chain
 *  (`onRefused`), so every save this row queued before it is refused too, and the row drops the draft and says so.
 *  The draft counts as saved only once the write succeeds: a failed save keeps it ("not saved", while it still
 *  differs) and the next blur retries. */
function flushDraft(r: DraftRefs): void {
  const d = r.latest.current;
  const typed = d.draft.trim();
  const gen = r.generation.current;
  const live = r.pending.current.filter((p) => p.gen === gen);
  const willHold = live.length > 0 ? live[live.length - 1].text : d.base;
  if (typed === willHold) {
    if (r.pending.current.length === 0) r.setStatus((st) => (st === "notSaved" ? "ok" : st));
    return;
  }
  // The generation's first save is judged against the stored text the field showed before this edit.
  if (live.length === 0) r.expected.current = d.base;
  const entry = { text: typed, gen };
  r.pending.current = [...r.pending.current, entry];
  r.setHasPending(true);
  const settle = () => {
    r.pending.current = r.pending.current.filter((p) => p !== entry);
    if (r.mounted.current) r.setHasPending(r.pending.current.length > 0);
  };
  // Whether this save's refusal started the new generation (as opposed to a save refused as stale).
  let startedGeneration = false;
  const options = {
    expectInstruction: () => (gen === r.generation.current ? r.expected.current : null),
    onWritten: () => { r.expected.current = typed; },
    // Inside the write chain, before the next queued save is judged: a refusal of the current generation starts a new
    // one, so no save this row queued before it can pass, however late the rejection below reaches this row.
    onRefused: () => {
      if (gen !== r.generation.current) return;
      r.generation.current = gen + 1;
      startedGeneration = true;
    },
  };
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
        if (startedGeneration) {
          // Another device changed the job since this row last wrote it: drop the draft, never write over that change
          // (the new generation refuses every save of this row started before).
          r.latest.current = { ...r.latest.current, draft: err.stored, base: err.stored };
          if (!r.mounted.current) return;
          r.setDraft(err.stored);
          r.setBase(err.stored);
          r.setStatus(() => "dropped");
          return;
        }
        // A save from before the refusal, refused as stale: the field follows the store only while it holds no edit
        // made since the refusal.
        const now = r.latest.current;
        if (now.draft.trim() !== now.base) return;
        r.latest.current = { ...now, draft: err.stored, base: err.stored };
        if (!r.mounted.current) return;
        r.setDraft(err.stored);
        r.setBase(err.stored);
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
  const pending = useRef<readonly { text: string; gen: number }[]>([]);
  const expected = useRef(stored);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = { jobId: job.id, draft, base, onUpdate };
  });
  const refs = (): DraftRefs => ({ latest, pending, expected, generation, mounted, setStatus, setDraft, setBase, setHasPending });
  useEffect(() => {
    mounted.current = true;
    const unmountRefs: DraftRefs = { latest, pending, expected, generation, mounted, setStatus, setDraft, setBase, setHasPending };
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
