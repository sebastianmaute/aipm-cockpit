// Wait until the server answers, or give up loudly.
//
// ★★ Deliberately NOT a fixed sleep. On a slow laptop a sleep is either a hang
// (too long) or a race (too short); both present as "the app didn't open".
// Clock and sleep are injected so this is testable without real time.
export type ReadyResult = { ready: true } | { ready: false; reason: "timeout" };

export interface WaitForReadyOptions {
  probe: () => Promise<boolean>;
  timeoutMs: number;
  intervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export async function waitForReady(opts: WaitForReadyOptions): Promise<ReadyResult> {
  const { probe, timeoutMs, intervalMs, now, sleep } = opts;
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      if (await probe()) return { ready: true };
    } catch {
      // A refused connection is the normal state while the server boots.
      // Treat it as "not yet" and let the deadline decide.
    }
    if (now() >= deadline) return { ready: false, reason: "timeout" };
    // A zero interval must still advance the clock, or a fake clock (and a
    // real busy loop) would spin without end.
    await sleep(Math.max(intervalMs, 1));
  }
}
