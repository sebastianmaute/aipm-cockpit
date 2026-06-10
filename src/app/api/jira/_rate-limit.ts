// In-memory sliding-window rate limiter for the /api/* proxy routes (Jira,
// ECB). Suitable for single-process deployments (local dev, single-instance
// server). For multi-instance deployments, replace the Map with a shared
// store (Redis).

const WINDOW_MS = 60_000; // 1 minute
export const MAX_REQUESTS = 60; // per IP per window

type WindowRecord = { count: number; windowStart: number };
const store = new Map<string, WindowRecord>();

/** Number of tracked rate-limit buckets — exposed for eviction tests. */
export function storeSize(): number {
  return store.size;
}

// Drop every bucket whose window has fully elapsed so unique client IPs do
// not accumulate for the process lifetime. Called only when a request starts
// a fresh window, so the O(n) sweep is amortised across quiet periods.
function evictElapsed(now: number): void {
  for (const [key, rec] of store) {
    if (now - rec.windowStart >= WINDOW_MS) store.delete(key);
  }
}

function getClientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0].trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Check whether the request is within the rate limit.
 * Returns a 429 Response if the limit is exceeded, null if the request is allowed.
 *
 * `scope` namespaces the per-IP bucket so distinct routes importing this
 * helper (e.g. the Jira proxy vs /api/ecb) do not drain each other's quota.
 */
export function rateLimit(request: Request, scope = "jira"): Response | null {
  const key = `${scope}:${getClientIp(request)}`;
  const now = Date.now();
  const rec = store.get(key);

  if (!rec || now - rec.windowStart >= WINDOW_MS) {
    evictElapsed(now);
    store.set(key, { count: 1, windowStart: now });
    return null;
  }

  if (rec.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((rec.windowStart + WINDOW_MS - now) / 1000);
    return Response.json(
      { error: "too-many-requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  rec.count++;
  return null;
}
