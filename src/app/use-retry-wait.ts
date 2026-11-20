// §798 — the countdown of an AI retry wait (a rate-limit or overload answer the transport waits out before it
// tries again), for a busy indicator. `start` is handed the wait the transport announces (`onRetryWait`), `clear`
// ends it early (the send settled, or Stop). `secondsLeft` is null when no wait is running, else the seconds
// still to go, rounded up.
//
// ★ The clock is read only in `start` and in the interval's callback, never in render, and the state is set only
// from those callbacks (`react-hooks/set-state-in-effect`).
import { useCallback, useEffect, useState } from "react";

/** How often the countdown re-reads the clock. Below a second so a whole-second step shows on time. */
export const RETRY_WAIT_TICK_MS = 250;

type Wait = { end: number; now: number };

export type RetryWait = {
  secondsLeft: number | null;
  start: (waitMs: number) => void;
  clear: () => void;
};

export function useRetryWait(): RetryWait {
  const [wait, setWait] = useState<Wait | null>(null);
  const waiting = wait !== null;

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      const now = Date.now();
      setWait((w) => (w !== null && now < w.end ? { end: w.end, now } : null));
    }, RETRY_WAIT_TICK_MS);
    return () => clearInterval(id);
  }, [waiting]);

  const start = useCallback((waitMs: number) => {
    const now = Date.now();
    setWait({ end: now + waitMs, now });
  }, []);
  const clear = useCallback(() => setWait(null), []);

  const secondsLeft = wait !== null && wait.now < wait.end ? Math.ceil((wait.end - wait.now) / 1000) : null;
  return { secondsLeft, start, clear };
}
