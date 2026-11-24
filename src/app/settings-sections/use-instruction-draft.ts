// src/app/settings-sections/use-instruction-draft.ts — the standing instruction of a scheduled job as a draft against the
// stored job. It saves on blur and on unmount; each save is conditional, judged when it runs against the stored text
// the field showed before that edit (or what this row wrote since), so it does not write over another device's change.
// A refusal drops the draft, and every save this row queued before it is refused too, whatever the stored text has
// done since; an edit made after a refusal starts from the text then shown. A failed save keeps the draft and the
// next blur retries.
import { useEffect, useRef, useState } from "react";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { UpdateJobOptions, UseScheduledJobsResult } from "../use-scheduled-jobs";
import { JobChangedError, JobGoneError, jobSaveId } from "../scheduled-jobs/schedule";
import { forgetLostDraft, keepLostDraft, peekLostDraft } from "../scheduled-jobs/lost-draft";

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
  latest: { current: { jobId: number; saveId: string; keyless: boolean; draft: string; base: string; onUpdate: JobUpdate } };
  /** Saves this row has sent and not yet seen settle, oldest first, each with the refusal generation it started in. */
  pending: { current: readonly { text: string; gen: number }[] };
  /** The stored text this row expects when its next save of the current generation RUNS: the text the field showed
   *  when the generation's first save started, then each text this row's save wrote (set inside the write chain). */
  expected: { current: string };
  /** For a restored "notSaved" text: what its first save is judged against, then cleared. */
  oneShotExpect: { current: string | null };
  /** Bumped by a refusal: every save started in an earlier generation is refused when it runs, whatever the stored
   *  text has done since. */
  generation: { current: number };
  mounted: { current: boolean };
  setStatus: (update: (s: DraftStatus) => DraftStatus) => void;
  setDraft: (value: string) => void;
  setBase: (value: string) => void;
  setHasPending: (value: boolean) => void;
  /** A saved edit ends the read-only offer of text lost earlier. */
  clearLostText: () => void;
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
  if (live.length === 0) {
    r.expected.current = r.oneShotExpect.current ?? d.base;
    r.oneShotExpect.current = null;
  }
  const entry = { text: typed, gen };
  r.pending.current = [...r.pending.current, entry];
  r.setHasPending(true);
  const settle = () => {
    r.pending.current = r.pending.current.filter((p) => p !== entry);
    if (r.mounted.current) r.setHasPending(r.pending.current.length > 0);
  };
  // Whether this save's refusal started the new generation (as opposed to a save refused as stale).
  let startedGeneration = false;
  // The stored text this save was judged against (kept with its text if it is lost).
  let judgedAgainst: string | null = null;
  const options = {
    expectInstruction: () => {
      const expectation = gen === r.generation.current ? r.expected.current : null;
      if (expectation !== null) judgedAgainst = expectation;
      return expectation;
    },
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
      r.clearLostText();
      if (!r.mounted.current) return;
      r.setBase(typed);
      r.setStatus((st) => (st === "notSaved" ? "ok" : st));
    },
    (err: unknown) => {
      settle();
      // The job was deleted on another device: its row goes away; the section says so.
      if (err instanceof JobGoneError) return;
      if (!r.mounted.current) {
        // The editor has closed, so nothing here can tell the user: keep the text for the next time the row mounts.
        const reason = err instanceof JobChangedError ? "dropped" : "notSaved";
        // A job without a key keeps none: ids collide across portfolios.
        if (!r.latest.current.keyless) {
          keepLostDraft(r.latest.current.saveId, { text: typed, reason, base: judgedAgainst ?? r.expected.current });
        }
        if (err instanceof JobChangedError) r.latest.current = { ...r.latest.current, draft: err.stored, base: err.stored };
        return;
      }
      if (err instanceof JobChangedError) {
        if (startedGeneration) {
          // Another device changed the job since this row last wrote it: drop the draft, never write over that change
          // (the new generation refuses every save of this row started before).
          r.latest.current = { ...r.latest.current, draft: err.stored, base: err.stored };
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
        r.setDraft(err.stored);
        r.setBase(err.stored);
        return;
      }
      const now = r.latest.current;
      if (now.draft.trim() !== now.base) r.setStatus(() => "notSaved");
    },
  );
}

/** The standing instruction as a draft against the stored job. It saves on blur and on unmount (closing the dialog
 *  fires no blur on a focused node that unmounts); see `flushDraft`. When the stored instruction changes: a stored
 *  text equal to the draft rebases it (no notice); with no unsaved change AND no save of this row pending, the draft
 *  follows the store; otherwise the draft is kept and its conditional save decides.
 *  Text a closed editor could not save (`lost-draft.ts`) is restored on mount, never acting on anything unseen:
 *  - "notSaved": back in the field as an unsaved draft with its notice; its first save is judged against the stored text
 *    the lost save was judged against, so a change made elsewhere meanwhile is refused (the dropped flow).
 *  - "dropped": the field shows the stored text; the lost text is offered read-only (`lostText`) beside the notice, to
 *    copy from; nothing is saved or answered from it. It goes with the next answer or saved edit, or when the job
 *    already holds that text.
 *  Restoring never saves or answers; closing again without touching it keeps it for next time. A job without a key
 *  keeps no lost text (ids collide across portfolios). */
export function useInstructionDraft(job: ScheduledJob, onUpdate: JobUpdate) {
  const stored = job.instruction ?? "";
  const saveId = jobSaveId(job);
  const keyless = job.key === null;
  const [mountEntry] = useState(() => (keyless ? null : peekLostDraft(saveId)));
  // A dropped entry whose text the job already holds is nothing to show (it is still forgotten on mount).
  const [restored] = useState(() =>
    mountEntry !== null && !(mountEntry.reason === "dropped" && mountEntry.text.trim() === stored) ? mountEntry : null);
  const [draft, setDraft] = useState(restored?.reason === "notSaved" ? restored.text : stored);
  const [base, setBase] = useState(stored);
  const [seen, setSeen] = useState(stored);
  const [hasPending, setHasPending] = useState(false);
  const [status, setStatus] = useState<DraftStatus>(restored?.reason ?? "ok");
  const [lostText, setLostText] = useState<string | null>(restored?.reason === "dropped" ? restored.text : null);
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
    if (lostText !== null && lostText.trim() === stored) {
      // The job now holds the lost text after all: nothing is lost any more.
      setLostText(null);
      setStatus((st) => (st === "dropped" ? "ok" : st));
    }
  }
  const latest = useRef({ jobId: job.id, saveId, keyless, draft, base, onUpdate });
  // The restored "notSaved" text, until the user edits or leaves the field (then it is the user's draft like any other).
  const untouchedRestore = useRef<string | null>(restored?.reason === "notSaved" ? restored.text : null);
  const lostTextRef = useRef<string | null>(lostText);
  const pending = useRef<readonly { text: string; gen: number }[]>([]);
  const expected = useRef(stored);
  // A restored "notSaved" text's first save is judged against what its lost save was judged against (one-shot).
  const oneShotExpect = useRef<string | null>(restored?.reason === "notSaved" ? restored.base : null);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = { jobId: job.id, saveId, keyless, draft, base, onUpdate };
    lostTextRef.current = lostText;
  });
  const clearLostText = () => {
    lostTextRef.current = null;
    setLostText(null);
  };
  const refs = (): DraftRefs => ({
    latest, pending, expected, oneShotExpect, generation, mounted, setStatus, setDraft, setBase, setHasPending, clearLostText,
  });
  useEffect(() => {
    mounted.current = true;
    const unmountRefs: DraftRefs = {
      latest, pending, expected, oneShotExpect, generation, mounted, setStatus, setDraft, setBase, setHasPending,
      clearLostText: () => { lostTextRef.current = null; },
    };
    const entryOnMount = mountEntry;
    const restoredOnMount = restored;
    if (entryOnMount !== null) forgetLostDraft(latest.current.saveId); // shown now (or nothing to show)
    return () => {
      mounted.current = false;
      const id = latest.current.saveId;
      const kept = untouchedRestore.current;
      if (restoredOnMount?.reason === "notSaved" && kept !== null && latest.current.draft === kept) {
        // Closed again without touching the restored text: keep it for next time, never save it by itself.
        keepLostDraft(id, { text: kept, reason: "notSaved", base: restoredOnMount.base });
        return;
      }
      const shownLost = lostTextRef.current;
      if (restoredOnMount !== null && shownLost !== null) keepLostDraft(id, { text: shownLost, reason: "dropped", base: restoredOnMount.base });
      flushDraft(unmountRefs);
    };
  }, [mountEntry, restored]);
  return {
    draft,
    status,
    /** Text a closed editor could not save over another device's change, offered read-only (or null). */
    lostText,
    onChange: (value: string) => {
      untouchedRestore.current = null;
      latest.current = { ...latest.current, draft: value };
      setDraft(value);
      // A draft typed back to the stored text has nothing left unsaved; a new edit ends the dropped notice.
      setStatus((st) => (value.trim() === base || st === "dropped" ? "ok" : st));
    },
    onBlur: () => {
      untouchedRestore.current = null;
      flushDraft(refs());
    },
    clearDropped: () => {
      setStatus((st) => (st === "dropped" ? "ok" : st));
      clearLostText();
    },
  };
}
