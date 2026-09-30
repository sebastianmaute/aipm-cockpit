// src/app/mirror-ledger.ts
//
// §4 — which of a window's workspace changes it only MIRRORED from a peer window on the same storage.
// A window that only mirrors a peer's edit must not autosave it: both windows would write the same
// content from the same revision and one would be refused as a conflict. `useStorageBackend` keeps one
// ledger per window; this module holds no React and no I/O.
//
// - `saved` is what the window last loaded (the suppressed run after a load or op) or last WROTE (a landed
//   save); `markSaved` (a load) sets it and clears everything else. `mirrored` holds, per slice, the last value
//   applied from a peer since then. A run in which each slice either holds its mirrored value or is still
//   `saved`'s, at least one mirrored, writes nothing (`isMirroredOnly`). A live `mirrored` entry means "the
//   peer wrote this and this window has written nothing since", so a value equal to it is what storage holds.
// - ★★ CONTESTED: a peer value that lands on an own UNSAVED value of the same slice (both windows edited it
//   within one delivery) is not mirrored — each window would show the other's copy and neither would save
//   it. A contested slice counts as own, so the run writes and meets the revision check (a reported
//   conflict, never a silent drop).
// - ★★ A WRITE IS NOT A LOAD (`markWritten`). A save's snapshot is taken before its write lands, so a peer
//   value applied meanwhile is not in it. Forgetting that value on the landing made it this window's own:
//   the window saved the peer's part again, from the revision the peer was saving from too (the §4 e2e,
//   CPU-throttled — A's insights reached B during B's save). The write clears only the slices it holds.

import type { Workspace } from "./storage";

type Kind = keyof Workspace;

export type MirrorLedger = {
  /** The window loaded `ws`: storage holds it, so nothing is mirrored or contested any more. */
  markSaved(ws: Workspace): void;
  /** The window's write of `ws` landed. A slice whose mirrored value is not `ws`'s keeps its entry (and its
   *  contested mark): that peer value arrived after the snapshot, so its writer still saves it. */
  markWritten(ws: Workspace): void;
  /** A peer's `value` is being applied over `live` (the updater's `prev`). */
  judge(kind: Kind, live: unknown, value: unknown): void;
  /** Once per commit: forget peer values that can no longer arrive as `live`. */
  prune(ws: Workspace): void;
  /** True when every change since `saved` is a value mirrored from a peer. */
  isMirroredOnly(ws: Workspace): boolean;
  /** How many peer values `judge` still remembers for `kind` (read-only; for tests and diagnostics). */
  peerValueCount(kind: Kind): number;
};

export function createMirrorLedger(): MirrorLedger {
  let saved: Workspace | null = null;
  let mirrored = new Map<Kind, unknown>();
  let contested = new Set<Kind>();
  // Per slice, the peer values applied since `saved` that can still arrive as `live` (see `prune`).
  let peerValues = new Map<Kind, Set<unknown>>();

  return {
    markSaved(ws) {
      saved = ws;
      mirrored = new Map();
      contested = new Set();
      peerValues = new Map();
    },

    markWritten(ws) {
      saved = ws;
      for (const [kind, value] of [...mirrored]) {
        if (!Object.is(value, ws[kind])) continue;
        mirrored.delete(kind);
        contested.delete(kind);
        peerValues.delete(kind);
      }
    },

    // `live` is the updater's `prev`: the slice with every update queued before this one applied — an own
    // edit a setter queued but React has not committed yet included — so it is current where committed
    // state can lag.
    // ★★ The SAME ANSWER HOWEVER OFTEN REACT RUNS IT: StrictMode runs an updater processed in render twice.
    //   `live` is own-unsaved when it is neither the saved value nor a remembered peer value; the set only
    //   gains `value`, never `live`, so a second run judges `live` exactly as the first. Every write repeats
    //   harmlessly. Judging against the LATEST mirrored entry instead flipped the second run to contested, as
    //   the first had just moved that entry to `value`. No early return on "entry already === value": a
    //   replayed render may carry an own edit in `live` that the first run did not see.
    judge(kind, live, value) {
      const values = peerValues.get(kind) ?? new Set<unknown>();
      if (!Object.is(live, saved?.[kind]) && !values.has(live)) contested.add(kind);
      peerValues.set(kind, values.add(value));
      mirrored.set(kind, value);
    },

    // ★★ Keeps at most TWO values per slice — the committed one if it is a peer value, and the latest
    //   mirrored one — so a window that only mirrors does not keep a copy of every peer value all session.
    //   Safe for `judge`, because an updater in the NEXT render sees as `live` either the committed value
    //   (kept here) or a value an earlier updater in that same render just added (added after this prune).
    //   An older peer value is gone, which is also what makes an own edit back to it, once committed, read
    //   as own-unsaved when a newer peer value crosses it.
    prune(ws) {
      for (const [kind, values] of peerValues) {
        const kept = new Set<unknown>();
        if (values.has(ws[kind])) kept.add(ws[kind]);
        kept.add(mirrored.get(kind)); // `judge` writes a kind's mirrored entry with its first peer value
        peerValues.set(kind, kept);
      }
    },

    // ★ False when nothing differs: a run with no change still writes (the incomplete-load "save anyway", an
    //   opened save gate), and false before any load or save, so only a mirror can ever skip a write.
    // ★ A slice with a mirrored entry is judged against THAT entry, not against the saved value: storage holds
    //   the peer's value there now, so putting back exactly the last-saved reference is an own change.
    isMirroredOnly(ws) {
      if (saved === null) return false;
      let changed = false;
      for (const key of Object.keys(ws) as Kind[]) {
        if (contested.has(key)) return false;
        if (mirrored.has(key)) {
          if (!Object.is(mirrored.get(key), ws[key])) return false;
          changed = true;
          continue;
        }
        if (!Object.is(ws[key], saved[key])) return false;
      }
      return changed;
    },

    peerValueCount(kind) {
      return peerValues.get(kind)?.size ?? 0;
    },
  };
}
