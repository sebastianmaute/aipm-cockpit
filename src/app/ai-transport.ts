// src/app/ai-transport.ts — the ONE module in the browser that talks to Anthropic. Every AI
// request in the app (the chat's `callClaude`, every forced-tool call's `postOnce`, the model list
// and key check in `anthropic-models.ts`) sends through `postAiMessages` / `getAiModels`;
// `ai-transport-sites.test.ts` fails when another file under `src/app` names the Anthropic host or
// fetches an Anthropic URL.
//
// Before EVERY send it asks the server (`GET /api/ai/status`) whether this deployment's AI setting
// is still the one the page loaded with (`ai-deployment.ts`). Switched off, invalid, a different
// route, or no answer at all (server down, non-200, unreadable) → `AiDeploymentError`, and nothing is
// sent anywhere. An unconfirmed setting never falls back to a direct call.
//
// Routes: "direct" posts to Anthropic exactly as the app always has (same URL, same headers,
// including the browser-access header). "gateway" posts to the same-origin relay
// (`/api/ai/messages`, `/api/ai/models`), which adds the organisation's gateway token server side;
// the browser never learns the gateway's URL or token. The relay's own failures are not
// Anthropic-shaped; they are turned into `AiGatewayError` / `AiDeploymentError` here, so a caller
// never reads them as a verdict on the user's key. An Anthropic-shaped error (passed through by the
// relay unchanged) reaches the caller as a normal non-2xx Response.
//
// SECURITY: the api key goes only into a request header; it is never logged, echoed or put in a URL.
// No response body is logged.
//
// Usage tap: `subscribeAiUsage` listeners hear the normalised `usage` of every 2xx Messages response,
// read from `res.clone()` so the caller's body is untouched. Every Messages call in the app today is
// non-streaming JSON (`callClaude` and `postOnce` both `await res.json()`), so the clone parses as
// JSON. A streamed (SSE) response would fail that parse, which is swallowed: no usage is reported for
// it, and streaming usage is left to the code that adds streaming. With no listener, nothing is cloned.
import { getAiDeploymentState, type AiDeploymentState, type AiRoute } from "./ai-deployment";
import {
  AI_GATEWAY_ERROR,
  AI_GATEWAY_REJECTED,
  AiDeploymentError,
  AiGatewayError,
  type AiGatewayErrorCode,
} from "./ai-errors";
import { requestAiStatus } from "./ai-status-request";

export { AiDeploymentError, AiGatewayError } from "./ai-errors";

/** ★★★ FOUR FIELDS, NOT TWO, AND `input_tokens` IS NOT THE TOTAL.
 *  Anthropic bills cached input separately and EXCLUDES it from `input_tokens`:
 *  `cache_creation_input_tokens` is a cache WRITE (billed at 1.25x base) and
 *  `cache_read_input_tokens` is a cache READ (0.1x). Counting only the first two
 *  fields — which this type did before the cache-token widening — makes every
 *  cached token invisible to the session and weekly caps in `ai-usage-context.tsx`,
 *  so the under-count grows with exactly how well the cache is working.
 *  ★ Both cache fields are ABSENT from the response when no breakpoint was sent,
 *  so they are optional on the wire and defaulted to 0 at the parse. Downstream
 *  code must never see `undefined` here: `undefined + n` is NaN, and NaN defeats
 *  every threshold comparison silently. */
export type ApiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

/** The same shape as it arrives on the wire — both cache fields optional. */
export type WireUsage = Partial<ApiUsage>;

/** Normalise a raw API `usage` object into the fully-populated `ApiUsage`
 *  shape, defaulting any absent/non-finite field to 0 rather than leaving it
 *  `undefined` (see the `ApiUsage` doc comment for why that matters). */
export function normalizeApiUsage(raw: WireUsage | undefined): ApiUsage {
  const n = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    input_tokens: n(raw?.input_tokens),
    output_tokens: n(raw?.output_tokens),
    cache_creation_input_tokens: n(raw?.cache_creation_input_tokens),
    cache_read_input_tokens: n(raw?.cache_read_input_tokens),
  };
}

export const ANTHROPIC_VERSION = "2023-06-01";

/** The caller's stable label for a request: "chat", "models", or a forced call's tool name. */
export type AiPathId = string;

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
const RELAY_MESSAGES_URL = "/api/ai/messages";
const RELAY_MODELS_URL = "/api/ai/models";

/** The relay's 503 bodies (`refuseIfDisabled`, `relay` in `api/ai/_relay.ts`), duplicated here
 *  because that module is server-only. */
const RELAY_DISABLED = "integration-disabled";
const RELAY_INVALID = "ai-gateway-invalid";

const GATEWAY_CODES: ReadonlySet<string> = new Set([AI_GATEWAY_REJECTED, AI_GATEWAY_ERROR]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isDeploymentState(v: unknown): v is AiDeploymentState {
  return isRecord(v) && typeof v.off === "boolean" && typeof v.invalid === "boolean"
    && (v.route === "direct" || v.route === "gateway");
}

function isAbort(e: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (isRecord(e) && e.name === "AbortError");
}

/** Ask the server for this deployment's AI setting; resolve only when AI is on and the route is
 *  the one this page loaded with. Throws `AiDeploymentError` otherwise; an abort stays an abort. */
export async function confirmAiDeployment(signal?: AbortSignal): Promise<void> {
  let state: unknown;
  try {
    const res = await requestAiStatus(signal);
    if (res.status !== 200) throw new AiDeploymentError("unconfirmed");
    state = await res.json();
  } catch (e) {
    if (e instanceof AiDeploymentError) throw e;
    if (isAbort(e, signal)) throw e;
    throw new AiDeploymentError("unconfirmed");
  }
  if (!isDeploymentState(state)) throw new AiDeploymentError("unconfirmed");
  if (state.off) throw new AiDeploymentError("off");
  if (state.invalid) throw new AiDeploymentError("invalid");
  if (state.route !== getAiDeploymentState().route) throw new AiDeploymentError("route-changed");
}

function directHeaders(apiKey: string, withBody: boolean): Record<string, string> {
  return withBody
    ? {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      }
    : {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      };
}

function relayHeaders(apiKey: string, withBody: boolean): Record<string, string> {
  return withBody
    ? { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" }
    : { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION };
}

/** `{ type: "error", error: { type: <string> } }` — Anthropic's own error, passed through. */
function isAnthropicError(body: unknown): boolean {
  return isRecord(body) && body.type === "error" && isRecord(body.error) && typeof body.error.type === "string";
}

/** A relayed non-2xx that is the relay's own answer, not Anthropic's: throw the matching error.
 *  Returns normally for an Anthropic-shaped error, which the caller handles as before. */
async function throwIfRelayOwnError(res: Response): Promise<void> {
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    body = undefined;
  }
  if (isAnthropicError(body)) return;
  const code = isRecord(body) && typeof body.error === "string" ? body.error : undefined;
  if (code !== undefined && GATEWAY_CODES.has(code)) throw new AiGatewayError(code as AiGatewayErrorCode);
  if (res.status === 503 && code === RELAY_DISABLED) throw new AiDeploymentError("off");
  if (res.status === 503 && code === RELAY_INVALID) throw new AiDeploymentError("invalid");
  // 404: the relay answers that this deployment is direct, so the route changed under the page.
  if (res.status === 404 || res.status === 503) throw new AiDeploymentError("route-changed");
  // The relay's own 400/403 (bad request, not same-origin) and anything else unshaped: never a key
  // verdict, so never handed back as a plain 401/403.
  throw new AiGatewayError(AI_GATEWAY_ERROR);
}

type UsageListener = (path: AiPathId, usage: ApiUsage) => void;
const usageListeners = new Set<UsageListener>();

/** Hear the normalised usage of every 2xx Messages response. Returns the unsubscribe. */
export function subscribeAiUsage(listener: UsageListener): () => void {
  usageListeners.add(listener);
  return () => {
    usageListeners.delete(listener);
  };
}

async function tapUsage(path: AiPathId, res: Response): Promise<void> {
  if (usageListeners.size === 0) return;
  let usage: ApiUsage;
  try {
    const body: unknown = await res.clone().json();
    usage = normalizeApiUsage(isRecord(body) && isRecord(body.usage) ? (body.usage as WireUsage) : undefined);
  } catch {
    return; // not JSON (e.g. a stream): no usage reported
  }
  for (const listener of [...usageListeners]) {
    try {
      listener(path, usage);
    } catch {
      // A listener never breaks a send.
    }
  }
}

/** An abort that landed while the status was asked stops here, as `fetch` itself would. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function route(): AiRoute {
  return getAiDeploymentState().route;
}

export interface PostAiMessagesArgs {
  apiKey: string;
  /** The JSON request body, already serialised. */
  body: string;
  path: AiPathId;
  signal?: AbortSignal;
}

/** POST a Messages request on this deployment's route, after `confirmAiDeployment`. */
export async function postAiMessages({ apiKey, body, path, signal }: PostAiMessagesArgs): Promise<Response> {
  await confirmAiDeployment(signal);
  throwIfAborted(signal);
  const gateway = route() === "gateway";
  const res = await fetch(gateway ? RELAY_MESSAGES_URL : ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: gateway ? relayHeaders(apiKey, true) : directHeaders(apiKey, true),
    body,
    signal,
  });
  if (gateway && !res.ok) await throwIfRelayOwnError(res);
  if (res.ok) await tapUsage(path, res);
  return res;
}

/** GET the model list on this deployment's route, after `confirmAiDeployment`. */
export async function getAiModels(apiKey: string, signal?: AbortSignal): Promise<Response> {
  await confirmAiDeployment(signal);
  throwIfAborted(signal);
  const gateway = route() === "gateway";
  const res = await fetch(gateway ? RELAY_MODELS_URL : ANTHROPIC_MODELS_URL, {
    headers: gateway ? relayHeaders(apiKey, false) : directHeaders(apiKey, false),
    signal,
  });
  if (gateway && !res.ok) await throwIfRelayOwnError(res);
  return res;
}
