// The key check the relay runs before forwarding anything when the deployment restricts keys to
// its Anthropic organisation (AIPM_AI_ORGANIZATION_ID, optionally AIPM_AI_WORKSPACE_IDS).
//
// A free pre-flight `GET <base>/v1/models?limit=1` with the caller's key goes through the same
// upstream as the real request (the gateway, with its token, or Anthropic itself; a gateway must pass
// Anthropic's answer headers back, docs/RUNBOOK.md "Restricting AI to the organisation's Anthropic
// keys" step 5), and the `anthropic-organization-id` and `anthropic-workspace-id` answer headers decide:
//   - organisation matches and (when workspaces are listed) the workspace is listed → pass;
//   - another organisation → wrong-organization; a workspace not listed → wrong-workspace, and so
//     is an answer with no workspace header at all while workspaces are listed (Anthropic sends
//     none when the key is not tied to a workspace);
//   - Anthropic's own 401/403 → its answer is passed through unchanged (an invalid key is not
//     a policy verdict). The 401 is remembered for `rejectedTtlMs` (60 s) so repeated calls with
//     one invalid key do not each send a pre-flight; the 403 never is;
//   - anything else (network error, timeout, 3xx, 404, 429, 5xx, a 2xx without the organisation
//     header, or with an empty or repeated header) → unavailable, and the caller forwards nothing.
//     Fails closed.
//
// Through a gateway the pre-flight sends `cf-aig-skip-cache: true` (Cloudflare AI Gateway's
// per-request cache bypass; checked 2026-10-31 at
// https://developers.cloudflare.com/ai-gateway/features/caching/). The gateway cache is off by
// default, but an organisation can turn it on, and a cached 2xx answered to a FOREIGN key would
// carry another key's organisation headers and let it pass. A direct pre-flight never sends it.
//
// Verdicts are cached in memory by an HMAC-SHA-256 of the key under a secret drawn at random
// when this module loads, so a fingerprint means nothing outside this process. A pass is kept for
// the life of the entry, a refusal for `refusalTtlMs`, Anthropic's own 401 for `rejectedTtlMs`;
// "unavailable", a 403 and a gateway's refusal never. A change of the
// restriction (its `signature`) clears the cache. The key itself is never logged, returned or
// stored; it lives only in the pre-flight while that runs.

import { createHmac, randomBytes } from "node:crypto";
import type { RequestOptions } from "node:http";
import type { AiKeyRestriction } from "../../ai-key-restriction-config";
import { AI_GATEWAY_REJECTED } from "../../ai-errors";
import type { RelaySend, UpstreamRequest, UpstreamResponse } from "./_relay";
import { ANTHROPIC_API_BASE, discard, fail, isAnthropicError, MAX_ERROR_BODY_BYTES, readCapped } from "./_upstream-answer";

export type KeyVerdict =
  | { kind: "pass" }
  | { kind: "wrong-organization" }
  | { kind: "wrong-workspace" }
  | { kind: "unavailable" }
  | { kind: "upstream-error"; response: Response };

type Restricted = Extract<AiKeyRestriction, { kind: "restricted" }>;
/** Where the pre-flight goes: the same upstream as the real request. */
type Upstream = { baseUrl: string; token: string | null };

export interface KeyChecker {
  check(key: string, restriction: Restricted, upstream: Upstream, send: RelaySend, anthropicVersion?: string): Promise<KeyVerdict>;
  /** Cached verdicts (pass, refusals and a remembered 401); never more than `maxEntries`. */
  size(): number;
}

export const KEY_CHECK_DEFAULT_MAX_ENTRIES = 1000;
export const KEY_CHECK_DEFAULT_REFUSAL_TTL_MS = 5 * 60 * 1000;
// How long Anthropic's own 401 for a key is remembered: short, so a key fixed upstream is tried again soon.
export const KEY_CHECK_DEFAULT_REJECTED_TTL_MS = 60 * 1000;
// Idle timeout on the pre-flight's socket: past it the check is unavailable.
export const KEY_CHECK_TIMEOUT_MS = 30 * 1000;
// Used only when the browser sent no `anthropic-version` (the app always sends one).
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

const ORGANIZATION_HEADER = "anthropic-organization-id";
const WORKSPACE_HEADER = "anthropic-workspace-id";

type CachedKind = "pass" | "wrong-organization" | "wrong-workspace";

type UpstreamErrorFinding = { kind: "upstream-error"; status: number; contentType: string | null; body: Uint8Array };
type Kept = { kind: CachedKind } | UpstreamErrorFinding;
type CacheEntry = Kept & { at: number };

/** What one pre-flight found, shared by every caller coalesced onto it. A passed-through error
 *  keeps its bytes, so each caller gets a Response of its own (a body is readable once). */
type Finding =
  | { kind: CachedKind | "unavailable" | "gateway-rejected" }
  | UpstreamErrorFinding;

const UNAVAILABLE: Finding = { kind: "unavailable" };

const FINGERPRINT_SECRET = randomBytes(32);

function hashKey(key: string): string {
  return createHmac("sha256", FINGERPRINT_SECRET).update(key).digest("hex");
}

type HeaderRead = { kind: "value"; value: string } | { kind: "absent" } | { kind: "ambiguous" };

/** A header, whatever the case of its name: `absent` when no such header came back, `ambiguous`
 *  when it is empty, not a string, or repeated. Node folds a repeated non-standard header into one
 *  comma-joined string ("a, b"), so a value with a comma counts as repeated (no id contains one).
 *  The value is trimmed, never case-folded. */
function headerValue(headers: UpstreamResponse["headers"], name: string): HeaderRead {
  const values = Object.entries(headers)
    .filter(([k]) => k.toLowerCase() === name)
    .map(([, v]) => v);
  if (values.length === 0) return { kind: "absent" };
  const value = values.length === 1 && typeof values[0] === "string" ? values[0].trim() : "";
  if (!value || value.includes(",")) return { kind: "ambiguous" };
  return { kind: "value", value };
}

function verdictFromHeaders(headers: UpstreamResponse["headers"], restriction: Restricted): Finding {
  const organization = headerValue(headers, ORGANIZATION_HEADER);
  if (organization.kind !== "value") return UNAVAILABLE;
  // A UUID: compared in lower case, like the setting.
  if (organization.value.toLowerCase() !== restriction.organizationId) return { kind: "wrong-organization" };
  if (restriction.workspaceIds === null) return { kind: "pass" };
  const workspace = headerValue(headers, WORKSPACE_HEADER);
  if (workspace.kind === "ambiguous") return UNAVAILABLE;
  // No header: the key is not tied to a workspace, so it is in none of the listed ones.
  if (workspace.kind === "absent") return { kind: "wrong-workspace" };
  // Workspace ids are case-sensitive: compared exactly.
  return restriction.workspaceIds.includes(workspace.value) ? { kind: "pass" } : { kind: "wrong-workspace" };
}

async function findingFrom(
  res: UpstreamResponse,
  request: UpstreamRequest | null,
  restriction: Restricted,
  upstream: Upstream,
): Promise<Finding> {
  const status = res.statusCode ?? 0;
  if (status >= 200 && status < 300) {
    // Only the headers matter; the (small) list body is dropped unread.
    discard(res, request);
    return verdictFromHeaders(res.headers, restriction);
  }
  if (status !== 401 && status !== 403) {
    discard(res, request);
    return UNAVAILABLE;
  }
  const bytes = await readCapped(res, MAX_ERROR_BODY_BYTES);
  if (bytes && isAnthropicError(bytes)) {
    const type = res.headers["content-type"];
    return { kind: "upstream-error", status, contentType: typeof type === "string" ? type : null, body: bytes };
  }
  // Not Anthropic's own: the gateway refusing its token, which only a call carrying one can get.
  return upstream.token ? { kind: "gateway-rejected" } : UNAVAILABLE;
}

/** Runs the pre-flight; always resolves, never rejects, never echoes an error. */
function preflight(
  key: string,
  restriction: Restricted,
  upstream: Upstream,
  send: RelaySend,
  anthropicVersion: string,
): Promise<Finding> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (finding: Finding) => {
      if (settled) return;
      settled = true;
      resolve(finding);
    };
    const headers: Record<string, string> = { "x-api-key": key, "anthropic-version": anthropicVersion };
    if (upstream.token) headers["cf-aig-authorization"] = `Bearer ${upstream.token}`;
    // Any upstream other than Anthropic itself is a gateway: never answer the check from its cache.
    if (upstream.token || upstream.baseUrl !== ANTHROPIC_API_BASE) headers["cf-aig-skip-cache"] = "true";
    const options: RequestOptions = { method: "GET", headers, timeout: KEY_CHECK_TIMEOUT_MS };
    let request: UpstreamRequest | null = null;
    try {
      request = send(new URL(`${upstream.baseUrl}/v1/models?limit=1`), options, (res) => {
        findingFrom(res, request, restriction, upstream).then(finish, () => {
          discard(res, request);
          finish(UNAVAILABLE);
        });
      });
    } catch {
      finish(UNAVAILABLE);
      return;
    }
    const req = request;
    req.on("error", () => finish(UNAVAILABLE));
    req.on("timeout", () => {
      req.destroy();
      finish(UNAVAILABLE);
    });
    req.end();
  });
}

function toVerdict(finding: Finding): KeyVerdict {
  switch (finding.kind) {
    case "upstream-error": {
      const headers = new Headers({ "cache-control": "no-store" });
      if (finding.contentType) headers.set("content-type", finding.contentType);
      return { kind: "upstream-error", response: new Response(new Uint8Array(finding.body), { status: finding.status, headers }) };
    }
    case "gateway-rejected":
      return { kind: "upstream-error", response: fail(502, AI_GATEWAY_REJECTED) };
    default:
      return { kind: finding.kind };
  }
}

/** What may be kept: a pass, a refusal, and Anthropic's own 401 (never its 403). */
function rememberable(finding: Finding): Kept | null {
  switch (finding.kind) {
    case "pass":
    case "wrong-organization":
    case "wrong-workspace":
      return { kind: finding.kind };
    case "upstream-error":
      return finding.status === 401 ? finding : null;
    default:
      return null;
  }
}

export function createKeyChecker(
  opts: { maxEntries?: number; refusalTtlMs?: number; rejectedTtlMs?: number; now?: () => number } = {},
): KeyChecker {
  const maxEntries = opts.maxEntries ?? KEY_CHECK_DEFAULT_MAX_ENTRIES;
  const refusalTtlMs = opts.refusalTtlMs ?? KEY_CHECK_DEFAULT_REFUSAL_TTL_MS;
  const rejectedTtlMs = opts.rejectedTtlMs ?? KEY_CHECK_DEFAULT_REJECTED_TTL_MS;
  const now = opts.now ?? Date.now;
  // Insertion order is age order: the first entry is the oldest.
  const cache = new Map<string, CacheEntry>();
  // In-flight pre-flights by signature, hash and version: concurrent callers with one new key share one.
  const inFlight = new Map<string, Promise<Finding>>();
  let signature: string | null = null;

  const cached = (hash: string): Finding | null => {
    const entry = cache.get(hash);
    if (!entry) return null;
    const ttl = entry.kind === "upstream-error" ? rejectedTtlMs : refusalTtlMs;
    if (entry.kind !== "pass" && now() - entry.at >= ttl) {
      cache.delete(hash);
      return null;
    }
    return entry.kind === "upstream-error"
      ? { kind: entry.kind, status: entry.status, contentType: entry.contentType, body: entry.body }
      : { kind: entry.kind };
  };

  const remember = (hash: string, finding: Finding, forSignature: string) => {
    // A verdict reached under a restriction that has since changed is never kept.
    if (forSignature !== signature) return;
    const entry = rememberable(finding);
    if (!entry) return;
    cache.delete(hash);
    cache.set(hash, { ...entry, at: now() });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  };

  return {
    async check(key, restriction, upstream, send, anthropicVersion = DEFAULT_ANTHROPIC_VERSION) {
      if (restriction.signature !== signature) {
        cache.clear();
        signature = restriction.signature;
      }
      const hash = hashKey(key);
      const hit = cached(hash);
      if (hit) return toVerdict(hit);
      // The version header goes upstream with the pre-flight, so callers sending different ones never share one.
      const flightKey = `${restriction.signature}\n${hash}\n${anthropicVersion}`;
      let flight = inFlight.get(flightKey);
      if (!flight) {
        const forSignature = restriction.signature;
        flight = preflight(key, restriction, upstream, send, anthropicVersion).then((finding) => {
          inFlight.delete(flightKey);
          remember(hash, finding, forSignature);
          return finding;
        });
        inFlight.set(flightKey, flight);
      }
      return toVerdict(await flight);
    },
    size: () => cache.size,
  };
}

/** The relay's instance: one cache per server process. */
export const defaultKeyChecker = createKeyChecker();
