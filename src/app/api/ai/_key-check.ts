// The key check the relay runs before forwarding anything when the deployment restricts keys to
// its Anthropic organisation (AIPM_AI_ORGANIZATION_ID, optionally AIPM_AI_WORKSPACE_IDS).
//
// A free pre-flight `GET <base>/v1/models?limit=1` with the caller's key goes through the same
// upstream as the real request (the gateway, with its token, or Anthropic itself; spec K9), and
// the `anthropic-organization-id` and `anthropic-workspace-id` answer headers decide:
//   - organisation matches and (when workspaces are listed) the workspace is listed → pass;
//   - another organisation → wrong-organization; a workspace not listed → wrong-workspace;
//   - Anthropic's own 401/403 → its answer is passed through unchanged (an invalid key is not
//     a policy verdict);
//   - anything else (network error, timeout, 3xx, 404, 429, 5xx, a 2xx without the header the
//     verdict needs) → unavailable, and the caller forwards nothing. Fails closed.
//
// Verdicts are cached in memory by SHA-256 of the key: a pass for the life of the entry, a
// refusal for `refusalTtlMs`, "unavailable" and passed-through errors never. A change of the
// restriction (its `signature`) clears the cache. The key itself is never logged, returned or
// stored; it lives only in the pre-flight while that runs.

import { createHash } from "node:crypto";
import type { RequestOptions } from "node:http";
import type { AiKeyRestriction } from "../../ai-key-restriction-config";
import { AI_GATEWAY_REJECTED } from "../../ai-errors";
import type { RelaySend, UpstreamRequest, UpstreamResponse } from "./_relay";
import { discard, fail, isAnthropicError, MAX_ERROR_BODY_BYTES, readCapped } from "./_upstream-answer";

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
  /** Cached verdicts (pass and refusals); never more than `maxEntries`. */
  size(): number;
}

export const KEY_CHECK_DEFAULT_MAX_ENTRIES = 1000;
export const KEY_CHECK_DEFAULT_REFUSAL_TTL_MS = 5 * 60 * 1000;
// Idle timeout on the pre-flight's socket: past it the check is unavailable.
export const KEY_CHECK_TIMEOUT_MS = 30 * 1000;
// Used only when the browser sent no `anthropic-version` (the app always sends one).
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

const ORGANIZATION_HEADER = "anthropic-organization-id";
const WORKSPACE_HEADER = "anthropic-workspace-id";

type CachedKind = "pass" | "wrong-organization" | "wrong-workspace";

/** What one pre-flight found, shared by every caller coalesced onto it. A passed-through error
 *  keeps its bytes, so each caller gets a Response of its own (a body is readable once). */
type Finding =
  | { kind: CachedKind | "unavailable" | "gateway-rejected" }
  | { kind: "upstream-error"; status: number; contentType: string | null; body: Uint8Array };

const UNAVAILABLE: Finding = { kind: "unavailable" };

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The one value of a header, whatever the case of its name; null when absent, empty, repeated
 *  or not a string (ambiguous answers fail closed). Ids compare in lower case. */
function headerValue(headers: UpstreamResponse["headers"], name: string): string | null {
  const values = Object.entries(headers)
    .filter(([k]) => k.toLowerCase() === name)
    .map(([, v]) => v);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  return values[0].trim().toLowerCase() || null;
}

function verdictFromHeaders(headers: UpstreamResponse["headers"], restriction: Restricted): Finding {
  const organization = headerValue(headers, ORGANIZATION_HEADER);
  if (organization === null) return UNAVAILABLE;
  if (organization !== restriction.organizationId) return { kind: "wrong-organization" };
  if (restriction.workspaceIds === null) return { kind: "pass" };
  const workspace = headerValue(headers, WORKSPACE_HEADER);
  if (workspace === null) return UNAVAILABLE;
  return restriction.workspaceIds.includes(workspace) ? { kind: "pass" } : { kind: "wrong-workspace" };
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

export function createKeyChecker(
  opts: { maxEntries?: number; refusalTtlMs?: number; now?: () => number } = {},
): KeyChecker {
  const maxEntries = opts.maxEntries ?? KEY_CHECK_DEFAULT_MAX_ENTRIES;
  const refusalTtlMs = opts.refusalTtlMs ?? KEY_CHECK_DEFAULT_REFUSAL_TTL_MS;
  const now = opts.now ?? Date.now;
  // Insertion order is age order: the first entry is the oldest.
  const cache = new Map<string, { kind: CachedKind; at: number }>();
  // In-flight pre-flights by signature and hash: concurrent callers with one new key share one.
  const inFlight = new Map<string, Promise<Finding>>();
  let signature: string | null = null;

  const cached = (hash: string): CachedKind | null => {
    const entry = cache.get(hash);
    if (!entry) return null;
    if (entry.kind !== "pass" && now() - entry.at >= refusalTtlMs) {
      cache.delete(hash);
      return null;
    }
    return entry.kind;
  };

  const remember = (hash: string, kind: CachedKind, forSignature: string) => {
    // A verdict reached under a restriction that has since changed is never kept.
    if (forSignature !== signature) return;
    cache.delete(hash);
    cache.set(hash, { kind, at: now() });
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
      if (hit) return { kind: hit };
      const flightKey = `${restriction.signature}\n${hash}`;
      let flight = inFlight.get(flightKey);
      if (!flight) {
        const forSignature = restriction.signature;
        flight = preflight(key, restriction, upstream, send, anthropicVersion).then((finding) => {
          inFlight.delete(flightKey);
          if (finding.kind === "pass" || finding.kind === "wrong-organization" || finding.kind === "wrong-workspace") {
            remember(hash, finding.kind, forSignature);
          }
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
