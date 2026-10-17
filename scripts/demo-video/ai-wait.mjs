// §715 demo recorder: waiting for an AI call by its UI state, shared by take.mjs and the step modules
// (which take.mjs imports, so it cannot be their home). See README.md.

export const AI_TIMEOUT_MS = 120000;

/** Waits for an AI call by its UI state — the busy state ending, then the result showing — never by
 *  its text. Fails with the clip id once `timeoutMs` passes. */
export async function waitForAi(ctx, { busy, done, timeoutMs = AI_TIMEOUT_MS, label }) {
  try {
    await busy.waitFor({ state: 'hidden', timeout: timeoutMs });
    await done.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    throw new Error(`${ctx.clipId}: AI step ${label} timed out`);
  }
}
