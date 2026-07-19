// Shared server-side helpers for /api/jira/* proxy routes.
// Atlassian Cloud's REST API blocks browser CORS, so these routes proxy on the
// user's behalf. Credentials are sent by the client in each request body — they
// are never persisted server-side.

import { rateLimit } from "./_rate-limit";
import { isPrivateHost, isAllowedHostSuffix } from "../_shared/proxy-ssrf";

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

// Every Atlassian Cloud site lives under *.atlassian.net. Allowlisting that
// suffix (via the shared isAllowedHostSuffix) is the strongest SSRF defense
// available here: the IP-literal checks in isPrivateHost can't catch a DNS
// hostname that *resolves* to an internal IP (e.g. a name with a valid cert
// whose A-record points at 169.254.169.254), but an allowlist sidesteps
// resolution entirely — only Atlassian's own domain is reachable.
function normalizeSiteUrl(siteUrl: string): string | null {
  try {
    const u = new URL(siteUrl);
    // Atlassian Cloud is always HTTPS. Rejecting plaintext avoids sending Basic
    // credentials in the clear and removes the http:// SSRF path to internal services.
    if (u.protocol !== "https:") return null;
    // Allowlist the Atlassian Cloud domain. isPrivateHost is kept as
    // defense-in-depth (cheap, and a guard if the allowlist is ever widened).
    if (!isAllowedHostSuffix(u.hostname, "atlassian.net")) return null;
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

// Bound every upstream call so a hung Atlassian endpoint cannot hold the
// serverless function (and the client's spinner) for the platform timeout.
// A timeout rejects the fetch, which the catch below turns into the same
// structured 502 the client already classifies as a network failure.
const JIRA_UPSTREAM_TIMEOUT_MS = 10_000;

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
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: basicAuth(creds.email, creds.apiToken),
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      // Server-to-server, no credentials/cookies.
      cache: "no-store",
      signal: AbortSignal.timeout(JIRA_UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    // Network-level failure before any response (DNS, connection refused, TLS,
    // timeout). Log the detail server-side and hand the client the app's error
    // envelope with a 502 — a structured response the client already classifies
    // as "network" — rather than letting the rejection surface as a generic 500.
    console.error("Jira upstream fetch failed:", err);
    return Response.json(
      { error: "upstream-unreachable" },
      { status: 502 },
    ) as unknown as Response;
  }
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

/**
 * Extract and sanitize the issue `fields` payload shared by the create-issue and
 * update-issue routes. Returns a ready-to-return error Response when `fields` is
 * missing/malformed, or the allowlisted `fields` object on success. Route-specific
 * concerns (project/issuetype attachment, issue-key validation) stay in each route.
 */
export function parseIssueFields(
  body: Record<string, unknown>,
): { error: Response } | { fields: Record<string, unknown> } {
  const rawFields =
    body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? (body.fields as Record<string, unknown>)
      : null;
  if (!rawFields) {
    return { error: Response.json({ error: "missing-fields" }, { status: 400 }) };
  }
  const fields = sanitizeIssueFields(rawFields);
  if (!fields) {
    return { error: Response.json({ error: "invalid-fields" }, { status: 400 }) };
  }
  return { fields };
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
