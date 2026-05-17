// In-memory sliding-window rate limiter for the /api/jira/* proxy routes.
// Suitable for single-process deployments (local dev, single-instance server).
// For multi-instance deployments, replace the Map with a shared store (Redis).

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 60; // per IP per window

type WindowRecord = { count: number; windowStart: number };
const store = new Map<string, WindowRecord>();

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
 */
export function rateLimit(request: Request): Response | null {
  const ip = getClientIp(request);
  const now = Date.now();
  const rec = store.get(ip);

  if (!rec || now - rec.windowStart >= WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
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
