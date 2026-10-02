// src/app/peer-revision-deferral.ts
//
// §662 — a peer's revision that arrives while this window's own save is queued or running. Adopting it
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
// ★★ CONTESTED SLICES OPT OUT OF BOTH (`contested`, from the mirror ledger). A slice both windows edited
//   within one delivery shows the PEER's value here, so a fresh snapshot would write the peer's copy over
//   this window's lost edit, silently. Such a save keeps the old base and meets the revision check: a
//   reported conflict, never a silent drop.
// ★ This module holds no React and no I/O; `useStorageBackend` owns the state and the calls.
import { announcedRevision, type StorageBackend } from "./workspace";

type Pending = { backend: StorageBackend; revision: string; base: string; seq: number };

export type PeerRevisionDeferral = {
  /** A peer announced `revision`, written from `base`, while `backend` had a save queued or running. */
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
  return {
    defer(backend, revision, base) {
      seq += 1;
      pending = { backend, revision, base, seq };
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
      backend.adoptRevision?.(p.revision);
      return "write";
    },

    covers(backend, base, snapshotSeq, contested) {
      const p = pending;
      return p !== null && p.backend === backend && !contested && p.base === base && snapshotSeq < p.seq;
    },
  };
}
