// src/app/asset-load-limiter.ts — caps how many asset byte loads run at once.
//
// The asset library's row thumbnails (open-followups §482) each fetch the
// asset's FULL stored bytes through the same loader the preview lightbox uses
// (a Turso round trip, up to `ASSET_STORED_MAX_BYTES` each). A library scrolled
// into view would otherwise fire one request per row at the same moment; this
// queue keeps at most `max` in flight and starts the next as one settles.
//
// Pure and i18n-free: no React, no DOM. A task that the caller no longer wants
// (its row unmounted while queued) still takes its turn — the caller's task
// checks its own cancelled flag and returns at once, which frees the slot.

export interface LoadLimiter {
  /** Runs `task` once fewer than `max` tasks are in flight; settles with it. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createLoadLimiter(max: number): LoadLimiter {
  // A cap below 1 would queue every task forever.
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active += 1;
          // `Promise.resolve().then(task)` turns a synchronous throw into a
          // rejection, so the slot is released on every path.
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(release);
        };
        if (active < limit) start();
        else waiting.push(start);
      });
    },
  };
}
