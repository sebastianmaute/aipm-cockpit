// src/app/peer-revision-deferral.ts
//
// §666 — a peer's revision that arrives while this window's own save is queued or running. Adopting it
// at once is unsafe: the save in the queue was built before the message, so it may lack the peer's slices
// and would write over them. Ignoring it (the old rule) made that save meet the peer's revision and pause,
// even when nothing stood between the two windows but timing. So it is DEFERRED:
//
// - `defer` records it and bumps `seq`, which `useStorageBackend` keeps in state and lists as a dep of its
//   save effect. ★★ STATE, NOT A REF: React applies updates in the order they were queued, so a render that
//   carries the new `seq` also carries every slice the peer broadcast before its revision (the peer posts
//   its slices on commit and its revision only once its write landed). A snapshot taken in such a render
//   holds the peer's write. A counter read from a ref in the effect cannot prove that: a passive effect can
//   run after the message handler while still holding the snapshot of an earlier render.
// - `settle`, at the start of every autosave job: a job whose snapshot predates the message is SKIPPED (the
//   effect run the bump caused carries its content); a job built after it adopts the peer's revision and
//   writes. A stale entry (another base, or another backend instance) is dropped and changes nothing.
// - `covers`, when a job that was already RUNNING meets the conflict: the same deferral explains it, so the
//   pause is not raised and the newer job retries. It may conflict again (a third writer); the entry was
//   consumed by then, so that one pauses. It never loops.
// ★★ A skipped or covered job KEEPS its unload-journal entry (the caller does not drop it): the successor
//   it leaves the write to is an effect run that a gate can still stop, and until a successor's write
//   confirms (which clears every older entry) the journal is the only other copy of those edits.
// ★★ CONTESTED SLICES OPT OUT OF BOTH (`contested`, from the mirror ledger). A slice both windows edited
//   within one delivery shows the PEER's value here, so a fresh snapshot would write the peer's copy over
//   this window's lost edit, silently. Such a save keeps the old base and meets the revision check: a
//   reported conflict, never a silent drop.
// ★ This module holds no React and no I/O; `useStorageBackend` owns the state and the calls.
import { announcedRevision, type StorageBackend } from "./workspace";

type Pending = { backend: StorageBackend; revision: string; base: string; seq: number };

export type PeerRevisionDeferral = {
  /** A peer announced `revision`, written from `base`, while `backend` had a save queued or running. Kept
   *  when it continues the pending entry or starts from `backend`'s own revision; otherwise ignored. */
  defer(backend: StorageBackend, revision: string, base: string): void;
  /** At the start of an autosave job on `backend` whose snapshot was taken at `snapshotSeq`. "skip" writes nothing. */
  settle(backend: StorageBackend, snapshotSeq: number, contested: boolean): "write" | "skip";
  /** A job on `backend` that read `base` and took its snapshot at `snapshotSeq` was refused: true when a newer job will retry it. */
  covers(backend: StorageBackend, base: string | null | undefined, snapshotSeq: number, contested: boolean): boolean;
};

/** `onDeferred` receives the new sequence number (the React state setter). */
export function createPeerRevisionDeferral(onDeferred: (seq: number) => void): PeerRevisionDeferral {
  let seq = 0;
  let pending: Pending | null = null;
  // ★★ The entry the last `settle` ADOPTED. The save queue starts the next job BEFORE the refused job's
  //   rejection handler runs, so the successor's `settle` can consume `pending` first; `covers` must still
  //   explain that refusal, or it raises the very pause the successor is already retrying past.
  let adopted: Pending | null = null;
  return {
    // ★★ A CHAIN, not one slot: a peer that saves twice while this window is busy posts R1 (from B) and then
    //   R2 (from R1). Overwriting kept only {R2, from R1}, which this window, still at B, never matches. So a
    //   revision whose base is the pending one's revision extends that entry: {R2, from B}. Every write in
    //   the chain posted its slices before its revision, so a snapshot taken after R2's message holds them all.
    // ★ A revision that neither continues the pending one nor starts from what this window holds is a write
    //   this window cannot reach (it missed one in between, or another writer's): ignored, so it cannot
    //   displace a usable entry. The caller defers BEFORE any base check, so that decision is made here.
    defer(backend, revision, base) {
      const p = pending;
      const chained = p !== null && p.backend === backend && p.revision === base;
      if (!chained && announcedRevision(backend) !== base) return;
      seq += 1;
      pending = { backend, revision, base: chained ? p.base : base, seq };
      onDeferred(seq);
    },

    settle(backend, snapshotSeq, contested) {
      const p = pending;
      if (p === null || p.backend !== backend) return "write"; // ★ another instance's entry is not this job's to drop
      if (contested || announcedRevision(backend) !== p.base) {
        pending = null;
        return "write";
      }
      if (snapshotSeq < p.seq) return "skip";
      pending = null;
      adopted = p;
      backend.adoptRevision?.(p.revision);
      return "write";
    },

    covers(backend, base, snapshotSeq, contested) {
      const explains = (p: Pending | null) => p !== null && p.backend === backend && p.base === base && snapshotSeq < p.seq;
      return !contested && (explains(pending) || explains(adopted));
    },
  };
}
