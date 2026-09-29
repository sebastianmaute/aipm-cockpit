// src/app/fetch-with-timeout.ts
//
// ONE bounded fetch for backend reads. Extracted from turso-pipeline.ts `postPipeline` (§548) so the
// SharePoint load gets the same bound and the same body-read rule instead of a second copy.

/** A backend LOAD fails after this long. load() blocks the app — the §548 load hold is up until it
 *  settles — so loads fail faster than the save-oriented Turso pipeline default. Shared by Turso
 *  (`turso-pipeline.ts` re-exports it) and SharePoint. */
export const LOAD_TIMEOUT_MS = 10_000;

/** Thrown when OUR timer aborted the request, as distinct from any other network failure. */
export class FetchTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`No response within ${timeoutMs} ms`);
    this.name = "FetchTimeoutError";
  }
}

export interface FetchTextResult {
  status: number;
  ok: boolean;
  text: string;
}

/** True only for the abort OUR timer raises (a real `AbortError`, from either `fetch` or the body
 *  read) — never for a coincidental non-abort failure that merely arrives after the timer fired. The
 *  timer flips `timedOut` and calls `abort()` in the same tick, so there is no window where `timedOut`
 *  is true and the abort has not been requested; but the transport can still reject with an unrelated
 *  error around the same moment (§548 fix round 2), and that must not be misreported as a timeout. */
function isAbortError(err: unknown): boolean {
  // Checked by `name`, not `instanceof Error` / `instanceof DOMException`: a real abort can surface
  // as either (fetch implementations vary, and a DOMException does not reliably share a realm's Error
  // prototype under jsdom), so the class check is unreliable where the `name` field is not.
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/** `fetch` with an AbortController-based timeout that ALSO covers reading the response body.
 *  ★★★ THE BODY READ IS THE POINT. `fetch` resolves when the HEADERS arrive, so clearing the timer on its
 *  return leaves the body read unbounded: a server that sends headers and then stalls the body hung
 *  forever. Returning the text rather than the `Response` makes that structural — a caller cannot forget
 *  to read the body in the window, because there is no `Response` to hand it.
 *  ★ The body is read UNCONDITIONALLY, on a 401 or any other non-ok status too — a caller that only
 *  wants the status discards it, but draining it inside the armed window keeps a stalled error body
 *  from hanging and releases the connection instead of leaving it undrained.
 *  ★ AbortController + setTimeout (rather than `AbortSignal.timeout`) so fake-timer tests can drive the
 *  abort deterministically.
 *  ★★ THE BOUND IS THE PLATFORM'S, NOT OURS. The timer calls `abort()`, and nothing here rejects unless
 *  the transport ERRORS in response. Real `fetch` does (headers and body alike), and the test doubles
 *  model it; a transport that accepted the signal and ignored it would silently restore the hang with
 *  every test still green, because the tests assert on the rejection the double raises. Re-verify
 *  against the new transport, not against the double. */
export async function fetchTextWithTimeout(url: string, init: Omit<RequestInit, "signal">, timeoutMs: number): Promise<FetchTextResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (err) {
    // Only OUR abort is a timeout. A non-abort error that happens to arrive after the timer fired
    // (e.g. a coincidental network failure) must pass through unchanged, not be misreported.
    if (timedOut && isAbortError(err)) throw new FetchTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
