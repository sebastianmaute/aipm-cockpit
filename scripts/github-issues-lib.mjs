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

/** How long to wait before retrying a rate-limited GitHub response, or null when the
 *  response isn't a rate limit at all (only 403/429 ever are). Covers both shapes
 *  GitHub uses: a `retry-after` header in seconds, or the primary limit's
 *  `x-ratelimit-remaining: 0` + `x-ratelimit-reset` (a Unix seconds timestamp) — the
 *  clock is an explicit parameter so the test is not time-dependent. */
export function retryAfterMs(status, headers, now = Date.now()) {
  if (status !== 403 && status !== 429) return null;
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
