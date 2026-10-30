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
// read from `res.clone()` so the caller's body is untouched. The read runs in the background: the
// Response is handed to the caller at once, and the listeners hear the usage when the clone has been
// parsed, so a send is never held up by the tap. Every Messages call in the app today is
// non-streaming JSON (`callClaude` and `postOnce` both `await res.json()`), so the clone parses as
// JSON. A streamed (SSE) response would fail that parse, which is swallowed: no usage is reported for
// it, and streaming usage is left to the code that adds streaming. With no listener, nothing is cloned.
import { currentAiRoute, type AiDeploymentState } from "./ai-deployment";
import {
  AI_GATEWAY_ERROR,
  AI_GATEWAY_INVALID,
  AI_GATEWAY_RATE_LIMITED,
  AI_GATEWAY_REJECTED,
  AiDeploymentError,
  AiGatewayError,
  type AiGatewayErrorCode,
} from "./ai-errors";
import { requestAiStatus } from "./ai-status-request";
import { AiPeopleProtectedContentError, hasUnredactableContent, type AiPrivacy } from "./ai-privacy";
import { redactJsonBody, restoreJsonText } from "./ai-people-redact";
import { logDiag } from "./diagnostics";

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
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
const RELAY_MESSAGES_URL = "/api/ai/messages";
const RELAY_MODELS_URL = "/api/ai/models";

/** The relay's switched-off 503 body (`refuseIfDisabled`), duplicated here because that module is
 *  server-only; `api/ai/_relay.wire.test.ts` pins it against the relay's real answer. */
const RELAY_DISABLED = "integration-disabled";

const GATEWAY_CODES: ReadonlySet<string> = new Set([AI_GATEWAY_REJECTED, AI_GATEWAY_ERROR, AI_GATEWAY_RATE_LIMITED]);

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
  if (state.route !== currentAiRoute()) throw new AiDeploymentError("route-changed");
}

const JSON_BODY: Readonly<Record<string, string>> = { "content-type": "application/json" };

function baseHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION };
}

function directHeaders(apiKey: string, withBody: boolean): Record<string, string> {
  return {
    ...baseHeaders(apiKey),
    "anthropic-dangerous-direct-browser-access": "true",
    ...(withBody ? JSON_BODY : {}),
  };
}

function relayHeaders(apiKey: string, withBody: boolean): Record<string, string> {
  return { ...baseHeaders(apiKey), ...(withBody ? JSON_BODY : {}) };
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
  if (res.status === 503 && code === AI_GATEWAY_INVALID) throw new AiDeploymentError("invalid");
  // 404: the relay answers a direct deployment with an empty 404 (it has no code to send), and only
  // the relay answers 404 at this URL, so the route changed under the page.
  if (res.status === 404) throw new AiDeploymentError("route-changed");
  // A 503 without the relay's code is not the relay's answer (e.g. a proxy in front of the app):
  // nothing says what the deployment's setting is, so it is unconfirmed, never a route change.
  if (res.status === 503) throw new AiDeploymentError("unconfirmed");
  // The relay's own 400 (`bad-request`, `missing-api-key`) is a client error, not a gateway failure, and
  // never a key verdict: it reaches the caller as it is, whose usual non-2xx handling shows its error.
  // (The relay's 413 is Anthropic-shaped, so it already returned above, like a direct 413.)
  if (res.status === 400) return;
  // The relay's own 403 (not same-origin) and anything else unshaped: never a key verdict, so never
  // handed back as a plain 401/403.
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

export interface PostAiMessagesArgs {
  apiKey: string;
  /** The JSON request body, already serialised. */
  body: string;
  path: AiPathId;
  signal?: AbortSignal;
  /** Runs after the deployment status is confirmed and immediately before the request is sent; a
   *  throw stops the send. Callers pass their consent assertion here, because the consent can be
   *  revoked while the status is asked. */
  beforeSend?: () => void;
  /** REQUIRED so every caller decides. Protected: the body is redacted before it is sent and the
   *  reply restored; an image or non-text document block is refused (`AiPeopleProtectedContentError`). */
  privacy: AiPrivacy;
}

/** Redact `body` for a protected send and log the per-send counts (numbers only, never values). */
function redactForSend(body: string, privacy: AiPrivacy): string {
  if (!privacy.protected) return body;
  if (hasUnredactableContent(body)) throw new AiPeopleProtectedContentError();
  const before = privacy.session.counts();
  const redacted = redactJsonBody(body, privacy.session);
  const after = privacy.session.counts();
  logDiag("info", "ai.peopleRedacted", {
    person: after.person - before.person,
    email: after.email - before.email,
    phone: after.phone - before.phone,
    iban: after.iban - before.iban,
  });
  return redacted;
}

/** Read a 2xx reply once and hand the caller the same response with the real names restored. */
async function restoreReply(res: Response, privacy: AiPrivacy): Promise<Response> {
  if (!privacy.protected || !res.ok) return res;
  const restored = restoreJsonText(await res.text(), privacy.session);
  return new Response(restored, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** POST a Messages request on this deployment's route, after `confirmAiDeployment`. */
export async function postAiMessages({ apiKey, body, path, signal, beforeSend, privacy }: PostAiMessagesArgs): Promise<Response> {
  await confirmAiDeployment(signal);
  throwIfAborted(signal);
  beforeSend?.();
  const outgoing = redactForSend(body, privacy);
  const gateway = currentAiRoute() === "gateway";
  const res = await fetch(gateway ? RELAY_MESSAGES_URL : ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: gateway ? relayHeaders(apiKey, true) : directHeaders(apiKey, true),
    body: outgoing,
    signal,
  });
  if (gateway && !res.ok) await throwIfRelayOwnError(res);
  const reply = await restoreReply(res, privacy);
  // Fire and forget: `tapUsage` swallows its own failures.
  if (reply.ok) void tapUsage(path, reply);
  return reply;
}

/** GET the model list on this deployment's route, after `confirmAiDeployment`. */
export async function getAiModels(apiKey: string, signal?: AbortSignal): Promise<Response> {
  await confirmAiDeployment(signal);
  throwIfAborted(signal);
  const gateway = currentAiRoute() === "gateway";
  const res = await fetch(gateway ? RELAY_MODELS_URL : ANTHROPIC_MODELS_URL, {
    headers: gateway ? relayHeaders(apiKey, false) : directHeaders(apiKey, false),
    signal,
  });
  if (gateway && !res.ok) await throwIfRelayOwnError(res);
  return res;
}
