// src/app/save-queue.ts
//
// §627 — one full save at a time per backend, newest snapshot last.
//
// Several dirty drafts committing at `pagehide` each re-run the workspace save
// effect, and while the page is hiding each run flushes a full `backend.save`
// at once (debounced-save.ts). React state is right (each snapshot contains the
// earlier commits), but nothing ordered the WRITES: on the file and SharePoint
// backends an older snapshot could finish last and overwrite the newer one.
//
// ★★ AT MOST ONE RUNNING AND ONE WAITING. A save queued behind a running one
//   waits; a newer save queued behind THAT replaces it, because every snapshot
//   contains the ones before it. The replaced save never runs. How it settles
//   depends on who replaced it:
//   - by default it resolves "superseded", after the replacing save has settled,
//     and never rejects: the replacing save is another autosave, whose own caller
//     reports its outcome;
//   - with `settleReplacedAsOwn` (the pre-switch flush, `guardedWrite`), it
//     settles EXACTLY as the replacing save does — "saved", or that save's error.
//     Those callers swallow or report their own failures differently, so without
//     this nobody would put back the replaced autosave's baselines or toast its
//     loss (review I2 on §627).
// ★★ A SAVE THAT NEVER SETTLES MUST NOT STALL THE QUEUE FOR GOOD (review I1).
//   After `SAVE_STALL_MS` the queue is released anyway, logged as
//   `storage.saveStalled`, and the next save starts — which is what happened
//   before this queue existed. The stalled save still settles its own promise
//   whenever it finishes.
// ★ Per backend INSTANCE (a WeakMap), so a rebuilt backend starts idle and a
//   save to one target never waits for another's.
// ★★ §641 — `whenSaved` lets a READ wait for every save queued before it. The
//   waiting slot starts its save later, possibly after a reload's read has
//   returned; that save would then write the pre-reload snapshot over what the
//   reload just showed. It drops nothing: the queued saves land first, and the
//   read sees them.

import { logDiag } from "./diagnostics";

export type SaveResult = "saved" | "superseded";

export type EnqueueOptions = {
  /** The replaced waiting save settles exactly as this one does ("saved" or its error). */
  settleReplacedAsOwn?: boolean;
};

/** How long a running save may hold the queue before the next one starts anyway. */
export const SAVE_STALL_MS = 30_000;

/** What a queued save reports: nothing (it wrote), or "superseded" (it chose NOT to write, e.g. its backend was
 *  replaced while it waited) — which settles the entry, and any save it replaced as its own, as NOT saved. */
type SaveRun = () => Promise<void | SaveResult>;

type Waiting = {
  run: SaveRun;
  resolve: (result: SaveResult) => void;
  reject: (err: unknown) => void;
};

type Queue = { running: boolean; waiting: Waiting | null; idle: Array<() => void> };

const queues = new WeakMap<object, Queue>();

function start(queue: Queue, entry: Waiting): void {
  queue.running = true;
  let result: Promise<void | SaveResult>;
  try {
    result = Promise.resolve(entry.run());
  } catch (err) {
    result = Promise.reject(err);
  }
  // ★ The queue is released BEFORE this save's promise settles, so a caller that awaits it and
  //   saves again finds the backend idle and starts at once rather than a tick later. Released
  //   ONCE: by the settle, or by the stall timer, whichever comes first.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(stall);
    const next = queue.waiting;
    queue.waiting = null;
    if (next) {
      start(queue, next);
      return;
    }
    queue.running = false;
    const idle = queue.idle.splice(0);
    for (const notify of idle) notify();
  };
  const stall = setTimeout(() => {
    logDiag("warn", "storage.saveStalled", { afterMs: SAVE_STALL_MS });
    release();
  }, SAVE_STALL_MS);
  result.then(
    (outcome) => { release(); entry.resolve(outcome === "superseded" ? "superseded" : "saved"); },
    (err: unknown) => { release(); entry.reject(err); },
  );
}

/** Run `save` for `backend` now if nothing is saving to it, else after the save
 *  in progress, replacing any save still waiting. Resolves "saved" when this save
 *  landed, "superseded" when a newer one replaced it (after that one settled);
 *  rejects with this save's own error. See the header for `settleReplacedAsOwn`.
 *  §603 — a `save` that resolves "superseded" wrote nothing: this call resolves "superseded" and a save it
 *  replaced under `settleReplacedAsOwn` inherits that, so no caller mistakes the skip for a landed write. */
export function enqueueSave(backend: object, save: SaveRun, options: EnqueueOptions = {}): Promise<SaveResult> {
  let queue = queues.get(backend);
  if (!queue) {
    queue = { running: false, waiting: null, idle: [] };
    queues.set(backend, queue);
  }
  return new Promise<SaveResult>((resolve, reject) => {
    const entry: Waiting = { run: save, resolve, reject };
    if (!queue.running) {
      start(queue, entry);
      return;
    }
    const replaced = queue.waiting;
    queue.waiting = entry;
    if (replaced) {
      logDiag("info", "storage.saveSuperseded", {});
      const asOwn = options.settleReplacedAsOwn === true;
      entry.resolve = (result) => { resolve(result); replaced.resolve(asOwn ? result : "superseded"); };
      entry.reject = (err) => { reject(err); if (asOwn) replaced.reject(err); else replaced.resolve("superseded"); };
    }
  });
}

/** A promise that resolves once nothing is saving to `backend`: the running save
 *  and the one waiting behind it have settled (or the stall timer released them).
 *  Never rejects. `null` when nothing is saving, so a caller can stay synchronous
 *  on the idle path (the §588 reload tests pin `load()` starting in the click's own
 *  tick). §641 — see the header. */
export function whenSaved(backend: object): Promise<void> | null {
  const queue = queues.get(backend);
  if (!queue || !queue.running) return null;
  return new Promise<void>((resolve) => { queue.idle.push(resolve); });
}
