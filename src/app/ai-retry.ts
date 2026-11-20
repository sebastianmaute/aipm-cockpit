// src/app/ai-retry.ts — pure, i18n-free, React-free policy for the AI transport's time limit and
// its bounded retry of rate-limit / overload answers (§798). No fetch, no logging.

/** Per-attempt time limit for one AI request, headers and body included. The message `aiRequestTimedOut`
 *  (EN + DE) names it in minutes; `ai-retry.test.ts` fails when the two disagree. */
export const AI_REQUEST_TIMEOUT_MS = 300_000;
/** Attempts in all: the first send plus at most two retries. */
export const AI_MAX_ATTEMPTS = 3;
/** A wait longer than this is not waited: the answer goes back to the caller at once. */
export const AI_RETRY_MAX_WAIT_MS = 60_000;

const BASE_BACKOFF_MS = 2_000;
const JITTER_SPREAD = 0.2;
const MS_PER_SECOND = 1_000;
const RETRYABLE_ERROR_TYPES: ReadonlySet<string> = new Set(["rate_limit_error", "overloaded_error"]);
const SECONDS_FORM = /^\d+(\.\d+)?$/;

/** True for the answers worth one more try: HTTP 429 / 529, or an Anthropic limit error type
 *  on a non-2xx answer (the transport only ever passes non-2xx answers here; a 2xx is never
 *  re-sent). Never a timeout, a network failure, 400, 401, 403 or a plain 500. */
export function isRetryableAiAnswer(status: number, errorType: string | undefined): boolean {
  if (status === 429 || status === 529) return true;
  return errorType !== undefined && RETRYABLE_ERROR_TYPES.has(errorType);
}

/** A `retry-after` header as milliseconds: delay-seconds, or an HTTP date relative to `nowMs`
 *  (a past date is 0). null = absent or unparseable. */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const text = header.trim();
  if (text === "") return null;
  if (SECONDS_FORM.test(text)) return Math.round(Number(text) * MS_PER_SECOND);
  // Any other number-looking form ("-5") is not a date either.
  if (/^[-+]?[\d.]+$/.test(text)) return null;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/** The wait before retry number `retryNumber` (1 = the first retry): the server's `retry-after`
 *  when valid, else 2 s then 4 s with a 0.8–1.2 jitter. null = longer than the cap, do not wait. */
export function retryWaitMs(
  retryNumber: number,
  retryAfter: string | null,
  nowMs: number,
  random: () => number,
): number | null {
  const asked = parseRetryAfterMs(retryAfter, nowMs);
  const wait =
    asked ??
    Math.round(
      BASE_BACKOFF_MS * 2 ** (retryNumber - 1) * (1 - JITTER_SPREAD + 2 * JITTER_SPREAD * random()),
    );
  return wait > AI_RETRY_MAX_WAIT_MS ? null : wait;
}

/** Wait `ms`, ending at once (rejecting with the signal's reason, else an AbortError) when the
 *  signal aborts. The timer is cleared on abort. */
export function sleepAbortable(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
