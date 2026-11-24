// src/app/settings-sections/use-instruction-draft.ts — the standing instruction of a scheduled job as a draft against the
// stored job. It saves on blur and on unmount; each save is conditional, judged when it runs against the stored text
// the field showed before that edit (or what this row wrote since), so it does not write over another device's change.
// A refusal drops the draft, and every save this row queued before it is refused too, whatever the stored text has
// done since; an edit made after a refusal starts from the text then shown. A failed save keeps the draft and the
// next blur retries. Text this row could not save is offered read-only for copying, never put back into the job.
import { useEffect, useRef, useState } from "react";
import type { ScheduledJob } from "../scheduled-jobs/types";
import type { UpdateJobOptions, UseScheduledJobsResult } from "../use-scheduled-jobs";
import { JobChangedError, JobGoneError, JobNotEditableError, jobSaveId } from "../scheduled-jobs/schedule";
import {
  addLostText, peekLostDrafts, removeLostTexts, subscribeLostTexts, withLostDraft, type LostText,
} from "../scheduled-jobs/lost-draft";

/** The fields `updateJob` accepts — exactly its patch type, so a row can never write a project or key. */
export type JobPatch = Parameters<UseScheduledJobsResult["updateJob"]>[1];

/** A job write from the row; the instruction draft waits for it, so a failed save keeps the draft. The draft's save
 *  passes a precondition (`UpdateJobOptions`) so it never writes over a change made elsewhere. */
export type JobUpdate = (id: number, patch: JobPatch, options?: UpdateJobOptions) => Promise<void> | void;

/** Where the instruction draft stands against the stored job: in step, kept after a failed save (`notSaved`, the
 *  only status that blocks the answer buttons), dropped because its save found the job changed elsewhere (`dropped`),
 *  or showing on mount a text a closed editor could not save (`lostNotSaved`). */
export type DraftStatus = "ok" | "notSaved" | "dropped" | "lostNotSaved";

/** What a draft save needs, kept current by the handlers and an effect (never written during render). */
interface DraftRefs {
  latest: {
    current: { jobId: number; saveId: string; keyless: boolean; foreign: boolean; draft: string; base: string; onUpdate: JobUpdate };
  };
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
  /** Offers a text this row could not save read-only (and keeps it for later, where allowed). */
  offerLost: (text: LostText) => void;
  /** A saved text is not lost: removes the offered texts equal to it, and only those. */
  savedLost: (text: string) => void;
}

/** A refusal resets the field: text typed into it after the refused save started (still unsaved, never blurred) is
 *  offered as well, unless it is the refused text or what the job holds. Only while the editor is open. */
function offerTypedSince(r: DraftRefs, since: string, typed: string, stored: string | null, reason: LostText["reason"]): void {
  if (!r.mounted.current) return;
  const current = since.trim();
  if (current === "" || current === typed || current === stored) return;
  r.offerLost({ text: current, reason });
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
      r.savedLost(typed);
      if (!r.mounted.current) return;
      r.setBase(typed);
      r.setStatus((st) => (st === "notSaved" ? "ok" : st));
    },
    (err: unknown) => {
      // A later save of this generation carries a newer text of the same edit: only the newest one is offered.
      const later = r.pending.current.slice(r.pending.current.indexOf(entry) + 1);
      const offer = (text: LostText) => { if (!later.some((p) => p.gen === gen)) r.offerLost(text); };
      settle();
      // The job was deleted on another device: its row goes away; the section says so.
      if (err instanceof JobGoneError) return;
      if (err instanceof JobNotEditableError) {
        // A newer version rewrote the job: the text is offered while the row is shown, never kept for later.
        offer({ text: typed, reason: "newerVersion" });
        offerTypedSince(r, r.latest.current.draft, typed, null, "newerVersion");
        const now = r.latest.current;
        r.latest.current = { ...now, draft: now.base };
        if (!r.mounted.current) return;
        r.setDraft(now.base);
        r.setStatus(() => "ok");
        return;
      }
      if (!r.mounted.current) {
        // The editor has closed, so nothing here can tell the user: keep the text for the next time the row mounts.
        offer({ text: typed, reason: err instanceof JobChangedError ? "dropped" : "notSaved" });
        if (err instanceof JobChangedError) r.latest.current = { ...r.latest.current, draft: err.stored, base: err.stored };
        return;
      }
      if (err instanceof JobChangedError) {
        if (startedGeneration) {
          // Another device changed the job since this row last wrote it: drop the draft, never write over that change
          // (the new generation refuses every save of this row started before).
          const since = r.latest.current.draft;
          r.latest.current = { ...r.latest.current, draft: err.stored, base: err.stored };
          r.setDraft(err.stored);
          r.setBase(err.stored);
          r.setStatus(() => "dropped");
          offer({ text: typed, reason: "dropped" }); // read-only, to copy from
          offerTypedSince(r, since, typed, err.stored, "dropped");
          return;
        }
        // A save from before the refusal, refused as stale: its text is offered too (when it is the newest of its
        // edit); the field follows the store only while it holds no edit made since the refusal.
        offer({ text: typed, reason: "dropped" });
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

/** The notice for texts offered on mount: the newest one's reason. */
const restoreStatus = (lost: readonly LostText[]): DraftStatus =>
  lost.length === 0 ? "ok" : lost[0].reason === "dropped" ? "dropped" : "lostNotSaved";

type SetLost = (update: (prev: readonly LostText[]) => readonly LostText[]) => void;

/** The two lost-text writes a save makes. A keyed job's go through `lost-draft.ts` (one text at a time; every open row
 *  of that job is told). A keyless job's stay in this row's memory: its `id:N` save id is not unique across
 *  portfolios, so it is neither kept nor reported to other rows. */
function lostActions(latest: DraftRefs["latest"], mounted: DraftRefs["mounted"], setLost: SetLost): Pick<DraftRefs, "offerLost" | "savedLost"> {
  return {
    offerLost: (text) => {
      const now = latest.current;
      if (!now.keyless) {
        // Kept for later only for a job this version can edit.
        addLostText(now.saveId, text, { keep: !now.foreign });
        return;
      }
      if (mounted.current) setLost((prev) => withLostDraft(prev, text));
    },
    savedLost: (text) => {
      const now = latest.current;
      if (!now.keyless) {
        removeLostTexts(now.saveId, [text]);
        return;
      }
      if (mounted.current) setLost((prev) => withoutTexts(prev, [text]));
    },
  };
}

/** `list` without the texts equal (trimmed) to any of `texts` — the same array when none is there (no render). */
function withoutTexts(list: readonly LostText[], texts: readonly string[]): readonly LostText[] {
  const gone = new Set(texts.map((x) => x.trim()));
  const left = list.filter((d) => !gone.has(d.text.trim()));
  return left.length === list.length ? list : left;
}

/** `list` with the `more` texts it does not hold yet appended — the same array when there are none. */
function withMissing(list: readonly LostText[], more: readonly LostText[]): readonly LostText[] {
  const missing = more.filter((d) => !list.some((p) => p.text === d.text));
  return missing.length === 0 ? list : [...list, ...missing];
}

/** The standing instruction as a draft against the stored job. It saves on blur and on unmount (closing the dialog
 *  fires no blur on a focused node that unmounts); see `flushDraft`. When the stored instruction changes: a stored
 *  text equal to the draft rebases it (no notice); with no unsaved change AND no save of this row pending, the draft
 *  follows the store; otherwise the draft is kept and its conditional save decides.
 *  Text this row could not save (`lost`) is never put back into the job or the field: the field always starts from the
 *  stored text, and the lost texts are offered read-only for copying, newest first. They are added and removed one at
 *  a time through `lost-draft.ts` (kept per tab, so they are offered again after the editor closes), and the row
 *  follows every change it is told of — including a text a closed editor lost after this row mounted. A text the job
 *  holds is removed; a successful save removes only the texts equal to what it saved; Dismiss removes the texts shown.
 *  A job without a key keeps its texts in this row's memory only (until it is given a key); a job turned foreign keeps
 *  none for later. */
export function useInstructionDraft(job: ScheduledJob, onUpdate: JobUpdate) {
  const stored = job.instruction ?? "";
  const saveId = jobSaveId(job);
  const keyless = job.key === null;
  const foreign = job.foreign !== undefined;
  const [lost, setLost] = useState<readonly LostText[]>(() =>
    keyless ? [] : peekLostDrafts(saveId).filter((d) => d.text.trim() !== stored));
  const [draft, setDraft] = useState(stored);
  const [base, setBase] = useState(stored);
  const [seen, setSeen] = useState(stored);
  const [hasPending, setHasPending] = useState(false);
  const [status, setStatus] = useState<DraftStatus>(() => restoreStatus(lost));
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
    const left = lost.filter((d) => d.text.trim() !== stored);
    if (left.length !== lost.length) {
      // The job now holds a lost text after all: it is not lost any more.
      setLost(left);
      if (left.length === 0) setStatus((st) => (st === "dropped" || st === "lostNotSaved" ? "ok" : st));
    }
  }
  const latest = useRef({ jobId: job.id, saveId, keyless, foreign, draft, base, onUpdate });
  const pending = useRef<readonly { text: string; gen: number }[]>([]);
  const expected = useRef(stored);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = { jobId: job.id, saveId, keyless, foreign, draft, base, onUpdate };
  });
  const lostRef = useRef(lost);
  useEffect(() => { lostRef.current = lost; }, [lost]);
  // Follow every change to a keyed job's lost texts, one text at a time (never a whole list written over another).
  // Subscribing also reads what is kept now, so a text kept between the first render's read and this effect is shown.
  useEffect(() => {
    if (keyless) return undefined;
    const stop = subscribeLostTexts((id, change) => {
      if (id !== saveId) return;
      if ("added" in change) {
        const { added } = change;
        setLost((prev) => (prev[0]?.text === added.text && prev[0]?.reason === added.reason ? prev : withLostDraft(prev, added)));
        return;
      }
      if ("kept" in change) {
        const { kept } = change;
        setLost((prev) => withMissing(prev, kept));
        return;
      }
      const removed = change.removed;
      setLost((prev) => (removed === "all" ? (prev.length === 0 ? prev : []) : withoutTexts(prev, removed)));
    }, saveId);
    return stop;
  }, [saveId, keyless]);
  // A text the job holds is not lost (at mount too): remove it from what is kept.
  useEffect(() => {
    if (!keyless) removeLostTexts(saveId, [stored]);
  }, [saveId, stored, keyless]);
  // A keyless job given its key (assigning a project mints one): the texts this row shows are kept under it from now on.
  const wasKeyless = useRef(keyless);
  useEffect(() => {
    const was = wasKeyless.current;
    wasKeyless.current = keyless;
    if (!was || keyless) return;
    for (const text of [...lostRef.current].reverse()) addLostText(saveId, text, { keep: !foreign });
  }, [saveId, keyless, foreign]);
  const refs = (): DraftRefs => ({
    latest, pending, expected, generation, mounted, setStatus, setDraft, setBase, setHasPending,
    ...lostActions(latest, mounted, setLost),
  });
  useEffect(() => {
    mounted.current = true;
    const unmountRefs: DraftRefs = {
      latest, pending, expected, generation, mounted, setStatus, setDraft, setBase, setHasPending,
      ...lostActions(latest, mounted, setLost),
    };
    return () => {
      mounted.current = false;
      flushDraft(unmountRefs);
    };
  }, []);
  const endNotice = () => setStatus((st) => (st === "dropped" || st === "lostNotSaved" ? "ok" : st));
  return {
    draft,
    status,
    /** The texts this row could not save, newest first, as one read-only text (or null). */
    lostText: lost.length === 0 ? null : lost.map((d) => d.text).join("\n\n"),
    onChange: (value: string) => {
      latest.current = { ...latest.current, draft: value };
      setDraft(value);
      // A draft typed back to the stored text has nothing left unsaved; a new edit ends a dropped or restore notice.
      setStatus((st) => (value.trim() === base || st === "dropped" || st === "lostNotSaved" ? "ok" : st));
    },
    onBlur: () => flushDraft(refs()),
    /** An answer ends the dropped or restore notice; the offered text stays until dismissed. */
    clearDropped: endNotice,
    /** Removes the texts shown (a text kept since, and not shown yet, stays). */
    dismissLost: () => {
      const shown = lost.map((d) => d.text);
      if (!keyless) removeLostTexts(saveId, shown);
      setLost((prev) => withoutTexts(prev, shown));
      endNotice();
    },
  };
}
