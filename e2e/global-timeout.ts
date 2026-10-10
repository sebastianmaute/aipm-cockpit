// The whole-run wall clock for a Playwright run, from E2E_GLOBAL_TIMEOUT_MS (§215).
// live-turso.yml's two test steps set it under each step's own timeout, so Playwright stops
// itself and still writes its HTML report (written only when a run ends), where the step's
// timeout would kill it with none. playwright.config.ts passes the result to globalTimeout.

// Node clamps a timer delay above this to 1 ms, so a larger value would end the run at once.
export const MAX_GLOBAL_TIMEOUT_MS = 2_147_483_647;

/** A positive integer number of ms up to MAX_GLOBAL_TIMEOUT_MS; anything else means no limit. */
export function globalTimeoutFrom(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const ms = Number(value);
  return ms > 0 && ms <= MAX_GLOBAL_TIMEOUT_MS ? ms : undefined;
}
