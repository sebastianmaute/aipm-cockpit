/** Pure GitHub REST/GraphQL helpers, reused by `import-issues.mjs`'s real GitHub client
 *  and by Task 7's weekly sync check. No fetch, no shebang here — a `#!` on an imported
 *  `.mjs` makes vitest throw naming the WRONG file (see identifier-leak-lib.mjs's header
 *  for the same shape). */

const LINK_RE = /<([^>]+)>\s*;\s*rel="([^"]+)"/g;

/** Parse a `Link` response header and return the `rel="next"` URL, or null when there
 *  is none (the header is missing, or every part names a different rel). */
export function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const m of linkHeader.matchAll(LINK_RE)) {
    if (m[2] === "next") return m[1];
  }
  return null;
}

/** Normalise a raw GitHub (or GitLab) issue object into the tracker-neutral shape used
 *  for cross-tracker comparison: `{iid, title, labels}`. Returns null for a pull
 *  request (a GitHub `issues` listing includes them; they carry a `pull_request` key
 *  even when its value is `{}`). Throws when a non-PR raw issue is missing an integer
 *  number/iid or a string title — a silently-dropped field would otherwise surface as
 *  a confusing downstream mismatch instead of here, at the boundary. */
export function toTrackerIssue(raw) {
  if (raw && typeof raw === "object" && "pull_request" in raw) return null;
  const iid = raw?.number ?? raw?.iid;
  if (!Number.isInteger(iid)) {
    throw new Error("issue is missing an integer number/iid");
  }
  if (typeof raw.title !== "string") {
    throw new Error(`issue #${iid} is missing a title`);
  }
  const labels = Array.isArray(raw.labels) ? raw.labels.map((l) => (typeof l === "string" ? l : l.name)) : [];
  return { iid, title: raw.title, labels };
}

/** The shared header-reading half of a rate-limit wait: a `retry-after` header in
 *  seconds, or the primary limit's `x-ratelimit-remaining: 0` + `x-ratelimit-reset` (a
 *  Unix seconds timestamp). Returns null when neither header says anything. Not
 *  exported — `retryAfterMs` gates it on the response status; `graphQLRateLimitMs` below
 *  needs it un-gated, since GitHub answers a rate-limited GraphQL call with HTTP 200. */
function retryAfterFromHeaders(headers, now) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return secs * 1000;
  }
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining === "0" && reset !== null) {
    const resetMs = Number(reset) * 1000;
    if (Number.isFinite(resetMs)) return Math.max(0, resetMs - now);
  }
  return null;
}

/** How long to wait before retrying a rate-limited GitHub response, or null when the
 *  response isn't a rate limit at all (only 403/429 ever are). Covers both shapes
 *  GitHub uses: a `retry-after` header in seconds, or the primary limit's
 *  `x-ratelimit-remaining: 0` + `x-ratelimit-reset` (a Unix seconds timestamp) — the
 *  clock is an explicit parameter so the test is not time-dependent. */
export function retryAfterMs(status, headers, now = Date.now()) {
  if (status !== 403 && status !== 429) return null;
  return retryAfterFromHeaders(headers, now);
}

const SECONDARY_RATE_LIMIT_DEFAULT_MS = 60_000;
const SECONDARY_RATE_LIMIT_RE = /secondary rate limit/i;

/** `retryAfterMs`, plus the one shape it cannot see from headers alone: a 403 whose body
 *  names GitHub's SECONDARY rate limit but carries neither `retry-after` nor
 *  `x-ratelimit-remaining: 0`. GitHub's docs say to wait at least one minute then, so this
 *  answers 60 s instead of null (which would stop the run with exit 2). A bare 403 with
 *  neither a header nor that text is still NOT a rate limit — it is a permission error,
 *  and retrying it would only burn the budget. `bodyText` is the raw response body. */
export function rateLimitRetryMs(status, headers, bodyText, now = Date.now()) {
  const fromHeaders = retryAfterMs(status, headers, now);
  if (fromHeaders !== null) return fromHeaders;
  if (status === 403 && SECONDARY_RATE_LIMIT_RE.test(bodyText ?? "")) return SECONDARY_RATE_LIMIT_DEFAULT_MS;
  return null;
}

const GRAPHQL_RATE_LIMIT_DEFAULT_MS = 60_000;

/** Whether a GraphQL response's `errors` array reports a rate limit, and how long to
 *  wait: GitHub answers a rate-limited GraphQL request with HTTP 200 and an
 *  `errors[].type === "RATE_LIMITED"` entry, never 403/429, so `retryAfterMs`'s status
 *  gate never fires for it. Uses the response's own retry-after-style headers when
 *  present, else a 60 s default (GitHub does not document a header for this case).
 *  Returns null when `errors` isn't a rate limit at all. */
export function graphQLRateLimitMs(errors, headers, now = Date.now()) {
  if (!Array.isArray(errors) || !errors.some((e) => e && e.type === "RATE_LIMITED")) return null;
  return retryAfterFromHeaders(headers, now) ?? GRAPHQL_RATE_LIMIT_DEFAULT_MS;
}

/** Redact a GitHub token out of response-body text, THEN cap it to `capLength`
 *  characters — in that order. Capping first and redacting second (the bug this fixes)
 *  can leave a token's tail exposed when it straddles the cut point. */
export function redactAndCap(text, token, capLength = 500) {
  const redacted = token ? text.split(token).join("[REDACTED]") : text;
  return redacted.slice(0, capLength);
}
