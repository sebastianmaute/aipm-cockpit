// src/app/chat-persist-queue.ts — the Turso WRITE bookkeeping of useChatThreads: every save and
// delete of a chat thread goes through `runPersist`, which numbers it, keeps a retry for a failed one,
// and records when it landed. No React: the hook holds one queue for its lifetime (`useState`).
import type { LandedWrite } from "./chat-thread-writes";

/** A mutable slot, shaped like a React ref so the comments below read as they did in the hook. */
function slot<T>(current: T): { current: T } {
  return { current };
}

export type ChatPersistQueue = ReturnType<typeof createChatPersistQueue>;

/** A write refused before anything was sent (the thread belongs to another database). It neither
 *  landed nor failed: `runPersist` records no landing, runs no `onLanded` (so no outbox entry is
 *  settled), keeps no retry and leaves the banner as it is. */
export class WriteRefusedError extends Error {
  constructor() {
    super("chat thread write refused: the thread belongs to another database");
    this.name = "WriteRefusedError";
  }
}

/** `setThreadsError` raises or clears the sidebar's failure banner. */
export function createChatPersistQueue(setThreadsError: (failed: boolean) => void) {
  // Holds a thunk that re-issues whatever Turso WRITE (save or delete) last
  // failed, keyed by the thread id the write targets — see runPersist.
  // retryLoad() prefers this over a fresh fetch: clicking "Retry" after a
  // failed SAVE must re-send that same payload, not pull whatever the server
  // already has (which by definition excludes the failed write) and stomp
  // the live conversation with it — that was the destructive bug this hook
  // used to have. ★ A SINGLE slot (the pre-Map shape) had a NARROWER but
  // still-destructive bug: a second failure on a DIFFERENT thread (e.g. a
  // rename landing while an earlier save's retry was still pending) silently
  // overwrote the first thread's retry thunk, so Retry only ever re-issued
  // the MOST RECENT failure and the earlier one was never retried — local
  // state diverged from the server with no way back short of losing the
  // failed write outright. Keying by id lets every distinct failure survive
  // until its own retry succeeds. Empty whenever nothing is outstanding (a
  // write just succeeded, or the only failure on record is the initial
  // FETCH, which has no payload to replay — see retryLoad).
  const pendingRetryRef = slot<Map<string, () => void>>(new Map());

  // Monotonic write counter + the latest sequence number ISSUED per thread id.
  // The counter never resets (a single number, not per key), so clearing the
  // map on a project switch cannot make a NEW write collide with a still
  // in-flight OLD one — an id reused after the clear gets a strictly higher
  // number, and the pre-clear write's own number can never match again.
  const persistSeqRef = slot(0);
  const latestSeqRef = slot<Map<string, number>>(new Map());

  // §317. How many runPersist calls have SETTLED. `persistSeqRef` counts
  // writes STARTED, so `persistSeqRef.current > persistSettledRef.current` is
  // exactly "a write is outstanding right now" — the LIVENESS question, which
  // a counter sampled at one instant cannot answer on its own. retryLoad needs
  // both: the occurrence test catches a write that BEGINS inside its window,
  // and this one catches a write already in flight when Retry was clicked.
  //
  // ★★★ BUMPED BEFORE THE `owns()` BAIL, DELIBERATELY. A superseded write
  // still settles and still runs its handler; bumping after the bail would
  // leak the count upward forever, leaving `started > settled` permanently
  // true, `preserveLive` permanently set, and the reload branch unable to
  // adopt anything ever again.
  const persistSettledRef = slot(0);

  // §626 (R11). Per thread id, the newest write that has LANDED: its `seq`, and `at`, the value of
  // `landingsRef` when it landed. `seq` keeps an older save resolving after a newer one from moving
  // the confirmed name backwards; `at` lets a load that started before that landing leave the
  // confirmed name alone, since what it read may predate the save.
  const landedRef = slot<Map<string, LandedWrite>>(new Map());
  const landingsRef = slot(0);

  // Fire a Turso WRITE (save or delete), tracking it as the retry target
  // (keyed by the thread id it targets) on failure and clearing just THAT
  // key on success — the error banner only clears once nothing is left
  // pending. Shared by the busy-persist effect, ensureThreadForSend,
  // renameThread and requestDeleteThread so "Retry" means the same thing
  // everywhere — redo exactly the write that just failed. `key` is the
  // thread id; two writes on the SAME thread (e.g. a rename immediately
  // followed by a delete) intentionally collapse to one retry slot — the
  // later write already supersedes the earlier one's intent.
  //
  // ★★ ONLY THE LATEST WRITE ISSUED FOR A KEY MAY SETTLE THAT KEY. Both of a
  // thread's writes share one key, so without this an EARLIER write resolving
  // LAST would delete a LATER write's retry thunk and clear the banner. That
  // interleaving is reachable: ensureThreadForSend's save (the user's message
  // alone) is issued at send time and the busy-persist save (the full turn) at
  // settle time, so a slow first save resolving after the second one REJECTS
  // dropped the full-turn retry — the server kept only the question, the
  // assistant's reply was never persisted, and the user was never told.
  // A superseded call therefore returns without touching either the retry map
  // or the banner; the write that owns the key decides both.
  //
  // §626 (R11). `onLanded` runs for EVERY write that resolves, superseded or not, unless a newer
  // write for the key has already landed: the server holds what a superseded save carried until a
  // later one lands, so its name must be confirmed. `owns` tells it whether this write owns the key —
  // only the owner may settle an outbox entry, which a later write may still depend on.
  //
  // `onLanded` runs LAST, and the rejection handler is the second argument of `.then`, not a `.catch`:
  // a throw inside `onLanded` must neither skip the landing's bookkeeping nor send a write that landed
  // down the failure path (a retry of a saved write, and the error banner). It surfaces as an
  // unhandled rejection instead.
  function runPersist(key: string, action: () => Promise<void>, onLanded?: (owns: boolean) => void): void {
    const seq = (persistSeqRef.current += 1);
    latestSeqRef.current.set(key, seq);
    const owns = () => latestSeqRef.current.get(key) === seq;
    action().then(
      () => {
        persistSettledRef.current += 1;
        const isNewestLanding = (landedRef.current.get(key)?.seq ?? 0) < seq;
        if (isNewestLanding) {
          landingsRef.current += 1;
          landedRef.current.set(key, { seq, at: landingsRef.current });
        }
        if (owns()) {
          pendingRetryRef.current.delete(key);
          setThreadsError(pendingRetryRef.current.size > 0);
        }
        if (isNewestLanding) onLanded?.(owns());
      },
      (err: unknown) => {
        persistSettledRef.current += 1;
        if (err instanceof WriteRefusedError || !owns()) return;
        pendingRetryRef.current.set(key, () => runPersist(key, action, onLanded));
        setThreadsError(true);
      },
    );
  }

  // Per database URL, the saves still on their way. A delete-all waits for them (`savesSettled`): an
  // insert that lands after the owner delete ran would otherwise leave its row behind.
  const inFlightByUrl = new Map<string, Set<Promise<unknown>>>();

  /** Tracks `write`, a save to `url`'s database, until it settles; returns it unchanged. */
  function track<T>(url: string, write: Promise<T>): Promise<T> {
    let pending = inFlightByUrl.get(url);
    if (!pending) {
      pending = new Set();
      inFlightByUrl.set(url, pending);
    }
    const set = pending;
    set.add(write);
    const forget = () => {
      set.delete(write);
    };
    write.then(forget, forget);
    return write;
  }

  /** Resolves once no tracked save to `url`'s database is on its way — including saves that start
   *  while it waits. Never rejects: a failed save is the save's own business. It cannot wait forever:
   *  every save goes through `runTursoPipeline`, which gives up after `DEFAULT_PIPELINE_TIMEOUT_MS`
   *  (15 s), so each tracked save settles. */
  async function savesSettled(url: string): Promise<void> {
    for (let pending = inFlightByUrl.get(url); pending && pending.size > 0; pending = inFlightByUrl.get(url)) {
      await Promise.allSettled([...pending]);
    }
  }

  /** A fresh load for (possibly) another project: the pending retries no longer apply. `latestSeqRef`
   *  is cleared with them (its counter is global and never resets, so this cannot make a later write
   *  collide with an older one). */
  function resetForLoad(): void {
    pendingRetryRef.current.clear();
    latestSeqRef.current.clear();
  }

  /** Re-issues every failed write, and says whether there was any. Snapshot before iterating:
   *  retrying re-invokes runPersist, whose async handlers mutate this same Map once each write
   *  settles — never synchronously mid-loop, but a snapshot keeps that separation explicit. */
  function retryFailed(): boolean {
    if (pendingRetryRef.current.size === 0) return false;
    for (const retry of Array.from(pendingRetryRef.current.values())) retry();
    return true;
  }

  /** Forgets the retries of deleted threads, and re-derives the banner from what is left. */
  function forgetRetries(ids: readonly string[]): void {
    for (const id of ids) pendingRetryRef.current.delete(id);
    setThreadsError(pendingRetryRef.current.size > 0);
  }

  return {
    runPersist, resetForLoad, retryFailed, forgetRetries, track, savesSettled,
    /** Writes started so far (an occurrence count). */
    startedCount: () => persistSeqRef.current,
    /** Whether a write is outstanding right now. */
    inFlight: () => persistSeqRef.current > persistSettledRef.current,
    /** The landing count so far, for `adoptConfirmedNames`. */
    landings: () => landingsRef.current,
    /** Per thread id, the newest write that has landed. */
    landed: (): ReadonlyMap<string, LandedWrite> => landedRef.current,
  };
}
