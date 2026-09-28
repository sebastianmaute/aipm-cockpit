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
//   contains the ones before it. The replaced save never runs and resolves as
//   "superseded" — only once the save that replaced it has settled, so a caller
//   awaiting it (the pre-switch flush) still waits until its content has been
//   written or has failed. It never rejects: the replacing save reports its own
//   failure through its own caller.
// ★ Per backend INSTANCE (a WeakMap), so a rebuilt backend starts idle and a
//   save to one target never waits for another's.

export type SaveResult = "saved" | "superseded";

type Waiting = {
  run: () => Promise<void>;
  resolve: (result: SaveResult) => void;
  reject: (err: unknown) => void;
};

type Queue = { running: boolean; waiting: Waiting | null };

const queues = new WeakMap<object, Queue>();

function start(queue: Queue, entry: Waiting): void {
  queue.running = true;
  let result: Promise<void>;
  try {
    result = entry.run();
  } catch (err) {
    result = Promise.reject(err);
  }
  // ★ The queue is released BEFORE this save's promise settles, so a caller that awaits it and
  //   saves again finds the backend idle and starts at once rather than a tick later.
  const release = () => {
    const next = queue.waiting;
    queue.waiting = null;
    if (next) start(queue, next);
    else queue.running = false;
  };
  result.then(
    () => { release(); entry.resolve("saved"); },
    (err: unknown) => { release(); entry.reject(err); },
  );
}

/** Run `save` for `backend` now if nothing is saving to it, else after the save
 *  in progress, replacing any save still waiting. Resolves "saved" when this save
 *  landed, "superseded" when a newer one replaced it (after that one settled);
 *  rejects with this save's own error. */
export function enqueueSave(backend: object, save: () => Promise<void>): Promise<SaveResult> {
  let queue = queues.get(backend);
  if (!queue) {
    queue = { running: false, waiting: null };
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
      const superseded = () => replaced.resolve("superseded");
      entry.resolve = (result) => { resolve(result); superseded(); };
      entry.reject = (err) => { reject(err); superseded(); };
    }
  });
}
