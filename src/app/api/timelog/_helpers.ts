// Shared server-side helpers for /api/timelog/* proxy routes.
// Timelog's REST API blocks browser CORS, so these routes proxy on the
// user's behalf. Credentials are sent by the client in each request body — they
// are never persisted server-side.

import { rateLimit } from "../jira/_rate-limit";

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

/**
 * Recover the embedded IPv4 from an IPv4-mapped IPv6 suffix (the part after
 * "::ffff:"). The input may be dotted-decimal ("10.0.0.1") OR — because the URL
 * parser canonicalizes mapped addresses to hex — two hex groups ("a00:1").
 * Returns null when the suffix can't be decoded, so callers can fail closed.
 */
function mappedIpv4ToDotted(suffix: string): string | null {
  if (suffix.includes(".")) return suffix;
  const groups = suffix.split(":");
  if (groups.length !== 2) return null;
  const hi = Number.parseInt(groups[0], 16);
  const lo = Number.parseInt(groups[1], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
  if (hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets (e.g. "[::1]" → "::1").
  const h = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const lower = h.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "::" || lower === "0.0.0.0")
    return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) — internal-only ranges.
  if (/^f[cd][0-9a-f]*:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]*:/.test(lower)) return true;
  // NAT64 well-known prefix (64:ff9b::/96, RFC 6052) embeds an IPv4 address in
  // its low 32 bits and can reach internal IPv4 hosts where NAT64 is deployed.
  // No legitimate Timelog site is a NAT64 literal — block the prefix.
  if (/^64:ff9b:/.test(lower)) return true;
  // IPv4-mapped IPv6 (e.g. "::ffff:10.0.0.1", which the URL parser canonicalizes
  // to hex "::ffff:a00:1") — recover the embedded IPv4 and re-check it. A mapped
  // address we cannot decode is treated as private (fail closed) — a legitimate
  // Timelog host is always a DNS hostname, never an IP literal.
  let ipv4 = h;
  if (lower.startsWith("::ffff:")) {
    const mapped = mappedIpv4ToDotted(lower.slice(7));
    if (mapped === null) return true;
    ipv4 = mapped;
  }
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return false;
  const [a, b] = parts;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local / cloud instance metadata (e.g. 169.254.169.254)
  if (a === 169 && b === 254) return true;
  return false;
}

// Every Timelog site lives under timelog.com or *.timelog.com. The leading dot
// in the suffix check is load-bearing: it rejects lookalikes such as
// "eviltimelog.com" and "timelog.com.attacker.com" while accepting the bare apex
// and any real "<site>.timelog.com" subdomain.
function isAllowedTimelogHost(h: string): boolean {
  const l = h.toLowerCase();
  return l === "timelog.com" || l.endsWith(".timelog.com");
}

function normalizeHost(host: string): string | null {
  // A bare DNS hostname never contains userinfo ("@") or a port (":"). Reject
  // both up front so credential-injection ("evil.com@app.timelog.com") and
  // port-bearing ("app.timelog.com:8080") forms can't slip past the suffix match.
  if (host.includes("@") || host.includes(":")) return null;
  const h = host.toLowerCase();
  if (!isAllowedTimelogHost(h)) return null;
  if (isPrivateHost(h)) return null;
  return h;
}

// Bound every upstream call so a hung Timelog endpoint cannot hold the
// serverless function (and the client's spinner) for the platform timeout.
const TIMELOG_UPSTREAM_TIMEOUT_MS = 10_000;

export type TimelogRequest = {
  creds: TimelogCreds;
  path: string;
  query: Record<string, string>;
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
      ? (b.query as Record<string, string>)
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
