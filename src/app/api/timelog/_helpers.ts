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

// Bound every upstream call so a hung Timelog endpoint cannot hold the
// serverless function (and the client's spinner) for the platform timeout.
const TIMELOG_UPSTREAM_TIMEOUT_MS = 10_000;

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
  if (!/^\/v1\//.test(path)) {
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
      signal: AbortSignal.timeout(TIMELOG_UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    // Network-level failure before any response (DNS, connection refused, TLS,
    // timeout). Log the detail server-side (status-only — never the token) and
    // hand the client a structured 502.
    console.error("Timelog upstream fetch failed:", err);
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
