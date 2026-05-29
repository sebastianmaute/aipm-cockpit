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

function isPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets (e.g. "[::1]" → "::1").
  const h = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const lower = h.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "::" || lower === "0.0.0.0")
    return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) — internal-only ranges.
  if (/^f[cd][0-9a-f]*:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]*:/.test(lower)) return true;
  // IPv4-mapped IPv6 (e.g. "::ffff:10.0.0.1") — re-check the embedded IPv4.
  const ipv4 = lower.startsWith("::ffff:") ? lower.slice(7) : h;
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

function normalizeSiteUrl(siteUrl: string): string | null {
  try {
    const u = new URL(siteUrl);
    // Atlassian Cloud is always HTTPS. Rejecting plaintext avoids sending Basic
    // credentials in the clear and removes the http:// SSRF path to internal services.
    if (u.protocol !== "https:") return null;
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
