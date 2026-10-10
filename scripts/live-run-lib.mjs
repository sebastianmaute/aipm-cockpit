// Judges one live-Turso Playwright run from its JSON report's `stats` (§215). Pure, so it is
// unit-tested; scripts/check-live-run.mjs owns the file I/O and the exit codes.
//
// Every live spec SKIPS when a setting it needs is missing (the throwaway pair, the app pointed at
// it, E2E_LIVE_DESTRUCTIVE), and a run in which everything skipped exits 0. In live-turso.yml that
// would be a green run that proved nothing, so there a run passes only if at least one test ran
// and none was skipped.

/**
 * @param {{ expected?: number, unexpected?: number, flaky?: number, skipped?: number } | undefined} stats
 * @returns {{ ok: boolean, ran: number, skipped: number, message: string }}
 */
export function judgeLiveRun(stats) {
  if (!stats || typeof stats !== "object") {
    return { ok: false, ran: 0, skipped: 0, message: "the report has no stats" };
  }
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const ran = n(stats.expected) + n(stats.unexpected) + n(stats.flaky);
  const skipped = n(stats.skipped);
  if (skipped > 0) {
    return { ok: false, ran, skipped, message: `${skipped} test(s) skipped: a live run must run every test (a setting is missing)` };
  }
  if (ran === 0) {
    return { ok: false, ran, skipped, message: "no test ran" };
  }
  return { ok: true, ran, skipped, message: `${ran} test(s) ran, none skipped` };
}
