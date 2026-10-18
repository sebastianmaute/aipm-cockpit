// §715 demo recorder: waiting for an AI call by its UI state, shared by take.mjs and the step modules
// (which take.mjs imports, so it cannot be their home). See README.md.

export const AI_TIMEOUT_MS = 120000;

/** Runs `fn`, an AI wait, and notes its span in seconds since the recording started (`ctx.recordingStartedAt`,
 *  set by take.mjs once the screencast runs), so a short AI clip can trim it (trim.mjs). Off camera it notes nothing. */
export async function timedAiWait(ctx, fn) {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    if (ctx.recordingStartedAt != null) {
      const at = (t) => (t - ctx.recordingStartedAt) / 1000;
      (ctx.aiWaits ??= []).push({ start: at(t0), end: at(performance.now()) });
    }
  }
}

/** Waits for an AI call by its UI state — the busy state ending, then the result showing — never by
 *  its text. Fails with the clip id once `timeoutMs` passes. */
export async function waitForAi(ctx, { busy, done, timeoutMs = AI_TIMEOUT_MS, label }) {
  try {
    await timedAiWait(ctx, async () => {
      await busy.waitFor({ state: 'hidden', timeout: timeoutMs });
      await done.waitFor({ state: 'visible', timeout: timeoutMs });
    });
  } catch {
    throw new Error(`${ctx.clipId}: AI step ${label} timed out`);
  }
}
