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

/** `fetch` with an AbortController-based timeout that ALSO covers reading the response body.
 *  ★★★ THE BODY READ IS THE POINT. `fetch` resolves when the HEADERS arrive, so clearing the timer on its
 *  return leaves the body read unbounded: a server that sends headers and then stalls the body hung
 *  forever. Returning the text rather than the `Response` makes that structural — a caller cannot forget
 *  to read the body in the window, because there is no `Response` to hand it.
 *  ★ AbortController + setTimeout (rather than `AbortSignal.timeout`) so fake-timer tests can drive the
 *  abort deterministically.
 *  ★★ THE BOUND IS THE PLATFORM'S, NOT OURS. The timer calls `abort()`, and nothing here rejects unless
 *  the transport ERRORS in response. Real `fetch` does (headers and body alike), and the test doubles
 *  model it; a transport that accepted the signal and ignored it would silently restore the hang. */
export async function fetchTextWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<FetchTextResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (err) {
    if (timedOut) throw new FetchTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
