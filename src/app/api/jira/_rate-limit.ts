// In-memory fixed-window rate limiter for the /api/* proxy routes (Jira,
// Confluence, Timelog, ECB, the AI relay and dictation).
//
// WHO IS "THE CLIENT". A Next 16 route handler cannot see the socket address:
// Next's base server sets `x-forwarded-for` from the socket only when the
// header is ABSENT, so a value the client sent survives untouched. Reading the
// leftmost entry (or `x-real-ip`) therefore lets any caller pick a fresh
// bucket per request and bypass the limit. The key is built from a trusted hop
// count instead: `AIPM_TRUSTED_PROXY_HOPS=N` names how many reverse proxies in
// front of the app each APPEND the address they saw to `x-forwarded-for`; the
// entry N from the right is the one the outermost trusted proxy appended, and
// everything to its left is client-controlled and ignored. The default, 0 (or
// any invalid value), trusts no header at all and puts every caller of a scope
// into ONE shared bucket.
//
// SINGLE PROCESS. The store is a per-process Map. For a multi-instance
// deployment each instance enforces its own limit; replace the Map with a
// shared store (Redis) once more than one instance serves traffic.

export const TRUSTED_PROXY_HOPS_ENV = "AIPM_TRUSTED_PROXY_HOPS";
const MAX_TRUSTED_HOPS = 10;
const SHARED_KEY = "shared";

const WINDOW_MS = 60_000; // 1 minute
export const MAX_REQUESTS = 60; // per client key per window

type WindowRecord = { count: number; windowStart: number };
const store = new Map<string, WindowRecord>();

/** Number of tracked rate-limit buckets — exposed for eviction tests. */
export function storeSize(): number {
  return store.size;
}

// Drop every bucket whose window has fully elapsed so unique client keys do
// not accumulate for the process lifetime. Called only when a request starts
// a fresh window, so the O(n) sweep is amortised across quiet periods.
function evictElapsed(now: number): void {
  for (const [key, rec] of store) {
    if (now - rec.windowStart >= WINDOW_MS) store.delete(key);
  }
}

/** The hop count a raw setting gives, with no side effect. Unset, empty or `0` is 0 and valid; a value that is set
 *  but not a whole number from 0 to `MAX_TRUSTED_HOPS` is 0 (every caller shares one count) and `invalid`. */
export function parseTrustedHops(raw: string | undefined): { hops: number; invalid: boolean } {
  const value = raw?.trim() ?? "";
  if (value === "") return { hops: 0, invalid: false };
  if (!/^\d+$/.test(value)) return { hops: 0, invalid: true };
  const n = Number(value);
  if (n === 0) return { hops: 0, invalid: false };
  return n >= 1 && n <= MAX_TRUSTED_HOPS ? { hops: n, invalid: false } : { hops: 0, invalid: true };
}

/** Whether this server process already said the setting is invalid: once per process, not on every request. Mutable
 *  module state on purpose, as `request-limit-config.ts` keeps for the relay and dictation limits. */
let reportedInvalid = false;

function trustedHops(env: Record<string, string | undefined>): number {
  const { hops, invalid } = parseTrustedHops(env[TRUSTED_PROXY_HOPS_ENV]);
  if (invalid && !reportedInvalid) {
    reportedInvalid = true;
    // The setting's name only, never its value; the operator reads this in the server log (RUNBOOK).
    console.warn(`trusted proxy hops setting invalid, every caller of a route shares one count: ${TRUSTED_PROXY_HOPS_ENV}`);
  }
  return hops;
}

/**
 * The bucket key for a request: the `x-forwarded-for` entry `hops` places from
 * the right (see the file header), or "shared" when no hop is trusted or the
 * header is shorter than the hop count.
 */
export function clientKey(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): string {
  const hops = trustedHops(env);
  if (hops === 0) return SHARED_KEY;
  const entries = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  return entries.length >= hops ? entries[entries.length - hops] : SHARED_KEY;
}

/**
 * Check whether the request is within the rate limit.
 * Returns a 429 Response if the limit is exceeded, null if the request is allowed.
 *
 * `scope` namespaces the per-client bucket so distinct routes importing this
 * helper (e.g. the Jira proxy vs /api/ecb) do not drain each other's quota.
 * `max` is the number of requests a caller may send per window in that scope.
 */
export function rateLimit(request: Request, scope = "jira", max = MAX_REQUESTS): Response | null {
  const key = `${scope}:${clientKey(request)}`;
  const now = Date.now();
  const rec = store.get(key);

  if (!rec || now - rec.windowStart >= WINDOW_MS) {
    evictElapsed(now);
    store.set(key, { count: 1, windowStart: now });
    return null;
  }

  if (rec.count >= max) {
    const retryAfter = Math.ceil((rec.windowStart + WINDOW_MS - now) / 1000);
    return Response.json(
      { error: "too-many-requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  rec.count++;
  return null;
}
