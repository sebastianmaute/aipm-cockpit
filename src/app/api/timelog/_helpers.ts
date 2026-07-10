// Shared server-side helpers for /api/timelog/* proxy routes.
// Timelog's REST API blocks browser CORS, so these routes proxy on the
// user's behalf. Credentials are sent by the client in each request body — they
// are never persisted server-side.

import { rateLimit } from "../jira/_rate-limit";
import { isPrivateHost, isAllowedHostSuffix } from "../_shared/proxy-ssrf";

export type TimelogCreds = { host: string; tenant: string; token: string };

export function parseCreds(body: unknown): TimelogCreds | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const host = typeof b.host === "string" ? b.host.trim() : "";
  const tenant = typeof b.tenant === "string" ? b.tenant.trim() : "";
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (!host || !tenant || !token) return null;
  return { host, tenant, token };
}

// Every Timelog site lives under timelog.com or *.timelog.com. The shared
// isAllowedHostSuffix enforces that (the leading-dot check rejects lookalikes
// such as "eviltimelog.com" and "timelog.com.attacker.com" while accepting the
// bare apex and any real "<site>.timelog.com" subdomain).
function normalizeHost(host: string): string | null {
  // A bare DNS hostname never contains userinfo ("@") or a port (":"). Reject
  // both up front so credential-injection ("evil.com@app.timelog.com") and
  // port-bearing ("app.timelog.com:8080") forms can't slip past the suffix match.
  if (host.includes("@") || host.includes(":")) return null;
  const h = host.toLowerCase();
  if (!isAllowedHostSuffix(h, "timelog.com")) return null;
  if (isPrivateHost(h)) return null;
  return h;
}

// Bound every upstream call so a hung Timelog endpoint cannot hold the request
// (and the client's spinner) indefinitely. Default 10s for the light v1 calls.
const TIMELOG_UPSTREAM_TIMEOUT_MS = 10_000;
// The v2 per-project time-registrations endpoint returns a project's ENTIRE
// registration history in ONE unpaged response (it ignores $pagesize/date
// params — verified against the reference impl, which gives this exact call
// 30s and never pages it). A large project (esp. closed history) legitimately
// takes >10s, so the customer-scoped fetch was tripping the 10s cap and dropping
// that project's data. Give this one heavy call a 30s budget; v1 stays 10s so
// light calls still fail fast. Safe because the app is self-hosted (`next
// start`) — there is no serverless function-timeout ceiling above this.
const TIMELOG_V2_PROJECT_REG_TIMEOUT_MS = 30_000;
const V2_PROJECT_REG_RE = /^\/v2\/projects\/\d+\/time-registrations/;

/** Per-call upstream timeout: heavy v2 per-project registrations get 30s, else 10s. */
function upstreamTimeoutFor(pathOnly: string): number {
  return V2_PROJECT_REG_RE.test(pathOnly)
    ? TIMELOG_V2_PROJECT_REG_TIMEOUT_MS
    : TIMELOG_UPSTREAM_TIMEOUT_MS;
}

export type TimelogRequest = {
  creds: TimelogCreds;
  path: string;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
};

/**
 * Shared entry point for every /api/timelog/* route: applies rate limiting,
 * parses the JSON body, validates credentials and path. Returns a ready-to-return
 * error Response on any failure, or the parsed request on success.
 */
export async function parseTimelogRequest(
  request: Request,
): Promise<{ error: Response } | TimelogRequest> {
  const limited = rateLimit(request, "timelog");
  if (limited) return { error: limited };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: Response.json({ error: "invalid-json" }, { status: 400 }) };
  }

  const creds = parseCreds(body);
  if (!creds) {
    return { error: Response.json({ error: "missing-credentials" }, { status: 400 }) };
  }

  const b = body as Record<string, unknown>;
  const path = typeof b.path === "string" ? b.path : "";
  // Reject traversal ("..") and any CRLF/fragment that could smuggle a second
  // request line or escape the /v1/ namespace before the prefix check.
  if (
    path.includes("..") ||
    path.includes("\r") ||
    path.includes("\n") ||
    path.includes("#")
  ) {
    return { error: Response.json({ error: "invalid-path" }, { status: 400 }) };
  }
  // Allow the v1 REST API and the v2 per-project time-registrations endpoint
  // (customer-scoped booking fetch). Host allowlist + private-IP block +
  // traversal/CRLF/# guards above are unchanged — only the API-version namespace
  // widens, on the same *.timelog.com host.
  if (!/^\/v(1|2)\//.test(path)) {
    return { error: Response.json({ error: "invalid-path" }, { status: 400 }) };
  }

  const query =
    b.query && typeof b.query === "object" && !Array.isArray(b.query)
      ? (b.query as Record<string, unknown>)
      : {};

  return { creds, path, query, body: b };
}

export async function callTimelog(
  creds: TimelogCreds,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const host = normalizeHost(creds.host);
  if (!host) {
    return Response.json(
      { error: "invalid-host" },
      { status: 400 },
    ) as unknown as Response;
  }

  const url = `https://${host}/${encodeURIComponent(creds.tenant)}/api${path}`;
  // Query-stripped path drives BOTH the per-call timeout selection and the
  // attributable error log below (secret-free: the token lives only in the
  // Authorization header; the query can carry ids).
  const pathOnly = path.split("?")[0];
  const startedAt = Date.now();
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(upstreamTimeoutFor(pathOnly)),
    });
  } catch (err) {
    // Network-level failure before any response (DNS, connection refused, TLS,
    // timeout). Log enough to ATTRIBUTE it — the failure class, the elapsed time
    // (a value near the call's budget => a genuine upstream timeout, not a fast
    // DNS/TLS reject) and the request PATH with its query stripped
    // (the query can carry ids like employeeUserId; the token lives only in the
    // Authorization header, never the path, so the bare path is secret-free).
    // Never log `creds`, the token, the url (has the tenant), or a response body.
    // Read `.name` structurally, not via `instanceof Error`: AbortSignal.timeout
    // throws a DOMException (name "TimeoutError") which is NOT reliably an Error
    // instance across runtimes — gating on instanceof would log "unknown" for
    // the very timeout we most need to attribute.
    const failureClass =
      err && typeof err === "object" && typeof (err as { name?: unknown }).name === "string"
        ? (err as { name: string }).name
        : "unknown";
    const elapsedMs = Date.now() - startedAt;
    console.error(
      `Timelog upstream fetch failed: ${failureClass} after ${elapsedMs}ms (path ${pathOnly})`,
    );
    return Response.json(
      { error: "upstream-unreachable" },
      { status: 502 },
    ) as unknown as Response;
  }
}

/** Read body as JSON, falling back to a structured error. Forwards Timelog's status to the client. */
export async function forwardJsonResponse(upstream: Response): Promise<Response> {
  const text = await upstream.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: "non-json-response" };
  }
  return Response.json(data, { status: upstream.status });
}
