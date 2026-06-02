// Shared server-side helpers for /api/jira/* proxy routes.
// Atlassian Cloud's REST API blocks browser CORS, so these routes proxy on the
// user's behalf. Credentials are sent by the client in each request body — they
// are never persisted server-side.

import { rateLimit } from "./_rate-limit";

export type Creds = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

export function parseCreds(body: unknown): Creds | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const siteUrl = typeof b.siteUrl === "string" ? b.siteUrl.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const apiToken = typeof b.apiToken === "string" ? b.apiToken.trim() : "";
  if (!siteUrl || !email || !apiToken) return null;
  return { siteUrl, email, apiToken };
}

export type JiraRequest = { creds: Creds; body: Record<string, unknown> };

/**
 * Shared entry point for every /api/jira/* route: applies rate limiting, parses
 * the JSON body, and extracts credentials. Returns a ready-to-return error
 * Response on any failure, or the parsed creds + body on success. This keeps the
 * rate-limit + body-parse + credential-validation logic in one place rather than
 * duplicated across every route handler.
 */
export async function parseJiraRequest(
  request: Request,
): Promise<{ error: Response } | JiraRequest> {
  const limited = rateLimit(request);
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
  return { creds, body: body as Record<string, unknown> };
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
  // No legitimate Atlassian Cloud site is a NAT64 literal — block the prefix.
  if (/^64:ff9b:/.test(lower)) return true;
  // IPv4-mapped IPv6 (e.g. "::ffff:10.0.0.1", which the URL parser canonicalizes
  // to hex "::ffff:a00:1") — recover the embedded IPv4 and re-check it. A mapped
  // address we cannot decode is treated as private (fail closed) — a legitimate
  // Atlassian Cloud site is always a DNS hostname, never an IP literal.
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

// Every Atlassian Cloud site lives under *.atlassian.net. Allowlisting that
// suffix is the strongest SSRF defense available here: the IP-literal checks in
// isPrivateHost can't catch a DNS hostname that *resolves* to an internal IP
// (e.g. a name with a valid cert whose A-record points at 169.254.169.254),
// but an allowlist sidesteps resolution entirely — only Atlassian's own domain
// is reachable, so no attacker-controlled host can be targeted at all.
function isAllowedJiraHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  // The leading dot in the suffix is load-bearing: it rejects lookalikes such
  // as "evil-atlassian.net" and "atlassian.net.attacker.com" while accepting
  // the bare apex and any real "<site>.atlassian.net" subdomain.
  return h === "atlassian.net" || h.endsWith(".atlassian.net");
}

function normalizeSiteUrl(siteUrl: string): string | null {
  try {
    const u = new URL(siteUrl);
    // Atlassian Cloud is always HTTPS. Rejecting plaintext avoids sending Basic
    // credentials in the clear and removes the http:// SSRF path to internal services.
    if (u.protocol !== "https:") return null;
    // Allowlist the Atlassian Cloud domain. isPrivateHost is kept as
    // defense-in-depth (cheap, and a guard if the allowlist is ever widened).
    if (!isAllowedJiraHost(u.hostname)) return null;
    if (isPrivateHost(u.hostname)) return null;
    // Strip trailing slash and anything past the origin.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function basicAuth(email: string, apiToken: string): string {
  return "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
}

export async function callJira(
  creds: Creds,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = normalizeSiteUrl(creds.siteUrl);
  if (!base) {
    return Response.json(
      { error: "invalid-site-url" },
      { status: 400 },
    ) as unknown as Response;
  }
  const url = base + path;
  const upstream = await fetch(url, {
    ...init,
    headers: {
      Authorization: basicAuth(creds.email, creds.apiToken),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    // Server-to-server, no credentials/cookies.
    cache: "no-store",
  });
  return upstream;
}

// Jira priority names accepted on the write path (maps to the app's 4 levels).
const JIRA_PRIORITIES = new Set(["Highest", "High", "Medium", "Low", "Lowest"]);

/**
 * Allowlist the fields the client is permitted to send to Jira.
 * Strips anything not in the set so a misbehaving client can't inject
 * arbitrary fields (custom fields, watchers, parent, etc.) under the
 * current user's credentials.
 *
 * Returns null when a required field is missing or any field is malformed.
 */
export function sanitizeIssueFields(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};

  // summary — required, non-empty string, capped at Jira's 255-char limit
  const summary = raw.summary;
  if (typeof summary !== "string" || !summary.trim()) return null;
  out.summary = summary.slice(0, 255);

  // priority — optional { name: <known-priority-name> }
  const priority = raw.priority;
  if (priority !== undefined) {
    if (
      typeof priority !== "object" ||
      priority === null ||
      Array.isArray(priority)
    )
      return null;
    const name = (priority as Record<string, unknown>).name;
    if (typeof name !== "string" || !JIRA_PRIORITIES.has(name)) return null;
    out.priority = { name };
  }

  // labels — optional string[]
  const labels = raw.labels;
  if (labels !== undefined) {
    if (!Array.isArray(labels)) return null;
    const cleaned = (labels as unknown[])
      .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
      .map((l) => l.slice(0, 255))
      .slice(0, 20);
    out.labels = cleaned;
  }

  // description — optional Atlassian Document Format object or null
  // We validate the ADF envelope (version + type) without deep-inspecting
  // the node tree, which is both complex and unnecessary here.
  const description = raw.description;
  if (description !== undefined) {
    if (description === null) {
      out.description = null;
    } else if (
      typeof description === "object" &&
      !Array.isArray(description) &&
      typeof (description as Record<string, unknown>).version === "number" &&
      typeof (description as Record<string, unknown>).type === "string"
    ) {
      out.description = description;
    } else {
      return null;
    }
  }

  // duedate — optional YYYY-MM-DD or null
  const duedate = raw.duedate;
  if (duedate !== undefined) {
    if (duedate === null) {
      out.duedate = null;
    } else if (typeof duedate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(duedate)) {
      out.duedate = duedate;
    } else {
      return null;
    }
  }

  return out;
}

/** Read body as JSON, falling back to text. Forwards Jira's status to the client. */
export async function forwardJsonResponse(upstream: Response): Promise<Response> {
  const text = await upstream.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: "non-json-response", body: text.slice(0, 500) };
  }
  return Response.json(data, { status: upstream.status });
}
