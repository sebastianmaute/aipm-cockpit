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
// the browser never learns the gateway's URL or token. "relay" (an organisation key restriction, no
// gateway) posts to the same routes the same way. The relay's own failures are not
// Anthropic-shaped; they are turned into `AiGatewayError` / `AiDeploymentError` here, so a caller
// never reads them as a verdict on the user's key. An Anthropic-shaped error (passed through by the
// relay unchanged) reaches the caller as a normal non-2xx Response.
//
// SECURITY: the api key goes only into a request header; it is never logged, echoed or put in a URL.
// No response body is logged.
//
// Time limit and retry (§798, policy in `ai-retry.ts`): every send is one ATTEMPT, timed on its own
// controller that the caller's signal and an `AI_REQUEST_TIMEOUT_MS` timer both abort. The body is
// read whole INSIDE that window (a stalled body times out too) and handed back as a fresh Response
// over the read text, so callers read a body that has already arrived. Our timer firing is an
// `AiTimeoutError`, never an `AbortError` (callers swallow those as Stop); a caller abort stays one.
// A 429 / 529, an Anthropic `rate_limit_error` / `overloaded_error` on a non-2xx, or the relay's own
// rate limit is tried again — at most `AI_MAX_ATTEMPTS` in all — after `retry-after` or a short
// backoff; a wait over `AI_RETRY_MAX_WAIT_MS` is not waited. EVERY attempt re-runs the whole guard
// chain (status confirmed, `beforeSend`, redaction) before it sends. When every attempt fails the
// caller gets what one send would have given: the last non-2xx Response, or the relay's error. The
// reply is restored and the usage tap fed once, on the final 2xx only.
//
// Usage tap: `subscribeAiUsage` listeners hear the normalised `usage` of every 2xx Messages response,
// read from `res.clone()` so the caller's body is untouched. The read runs in the background: the
// Response is handed to the caller at once, and the listeners hear the usage when the clone has been
// parsed, so a send is never held up by the tap. Every Messages call in the app today is
// non-streaming JSON (`callClaude` and `postOnce` both `await res.json()`), so the clone parses as
// JSON. A streamed (SSE) response would fail that parse, which is swallowed: no usage is reported for
// it, and streaming usage is left to the code that adds streaming. With no listener, nothing is cloned.
import { currentAiRoute, getAiDeploymentState, usesRelay, type AiStatus } from "./ai-deployment";
import { addDisabledIntegration } from "./integration-switches";
import {
  AI_GATEWAY_ERROR,
  AI_GATEWAY_INVALID,
  AI_GATEWAY_RATE_LIMITED,
  AI_RELAY_RATE_LIMITED,
  AI_GATEWAY_REJECTED,
  AI_KEY_CHECK_UNAVAILABLE,
  AI_KEY_WRONG_ORGANIZATION,
  AI_KEY_WRONG_WORKSPACE,
  AiDeploymentError,
  AiGatewayError,
  AiKeyCheckUnavailableError,
  AiKeyRefusedError,
  AiTimeoutError,
  safeAiErrorType,
  type AiGatewayErrorCode,
  type AiKeyRefusedReason,
} from "./ai-errors";
import { requestAiStatus } from "./ai-status-request";
import { AiPeopleProtectedContentError, hasUnredactableContent, type AiPrivacy } from "./ai-privacy";
import { countUnrestoredPlaceholders, redactJsonBody, restoreJsonText } from "./ai-people-redact";
import { logDiag } from "./diagnostics";
import {
  AI_MAX_ATTEMPTS,
  AI_REQUEST_TIMEOUT_MS,
  isRetryableAiAnswer,
  retryWaitMs,
  sleepAbortable,
} from "./ai-retry";
import { reportAiKeyRefused } from "./ai-key-status";

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

const GATEWAY_CODES: ReadonlySet<string> = new Set([
  AI_GATEWAY_REJECTED,
  AI_GATEWAY_ERROR,
  AI_GATEWAY_RATE_LIMITED,
  AI_RELAY_RATE_LIMITED,
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** The status answer's deployment half; `peopleForced` is checked on its own (review 5, C1). */
function isAiStatusBase(v: unknown): v is Omit<AiStatus, "peopleForced" | "chat"> & { peopleForced?: unknown } {
  return isRecord(v) && typeof v.off === "boolean" && typeof v.invalid === "boolean"
    && (v.route === "direct" || v.route === "gateway" || v.route === "relay")
    && typeof v.keyRestricted === "boolean";
}

function isAbort(e: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (isRecord(e) && e.name === "AbortError");
}

/** Ask the server for this deployment's AI setting; resolve only when AI is on and the route, and
 *  whether the key restriction is on, are the ones this page loaded with (a consent records both). Throws `AiDeploymentError` otherwise; an abort stays an abort.
 *  Resolves with whether the server forces people protection NOW (review 4, M3); a lock added since
 *  page load is folded into the page's forced state (`addDisabledIntegration`). An answer that does
 *  not say it is not trusted ("unconfirmed"), like any other malformed answer — unless it says AI is
 *  off, which is "off" either way (review 5, C1). */
export async function confirmAiDeployment(signal?: AbortSignal): Promise<{ peopleForced: boolean }> {
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
  if (!isAiStatusBase(state)) throw new AiDeploymentError("unconfirmed");
  const { peopleForced } = state;
  if (peopleForced === true) addDisabledIntegration("ai-people");
  // Review 5, C1: AI switched off sends nothing, so an "off" answer is off whatever it says about the people lock.
  if (state.off) throw new AiDeploymentError("off");
  if (typeof peopleForced !== "boolean") throw new AiDeploymentError("unconfirmed");
  if (state.invalid) throw new AiDeploymentError("invalid");
  if (state.route !== currentAiRoute()) throw new AiDeploymentError("route-changed");
  // Behind a gateway the route stays "gateway" when the restriction is switched on or off; the
  // consent this page holds was given for the old setting, so the change refuses like a new route.
  if (state.keyRestricted !== getAiDeploymentState().keyRestricted) throw new AiDeploymentError("route-changed");
  return { peopleForced };
}

/** The privacy a send uses when the server forces people protection: a protected privacy always refuses
 *  unredactable content (the unforced wizard's exemption ends), an unprotected one becomes its projects'
 *  protected privacy, and one that cannot be protected is refused before anything is sent (review 4, M3). */
function forcedPrivacy(privacy: AiPrivacy): AiPrivacy {
  if (privacy.protected) return privacy.refuseUnredactable ? privacy : { ...privacy, refuseUnredactable: true };
  if (privacy.ifForced) return privacy.ifForced();
  throw new AiDeploymentError("unconfirmed");
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

function keyRefusalReason(code: string | undefined): AiKeyRefusedReason | undefined {
  if (code === AI_KEY_WRONG_ORGANIZATION) return "organization";
  if (code === AI_KEY_WRONG_WORKSPACE) return "workspace";
  return undefined;
}

/** A relayed non-2xx that is the relay's own answer, not Anthropic's: throw the matching error.
 *  Returns normally for an Anthropic-shaped error, which the caller handles as before. */
async function throwIfRelayOwnError(res: Response, apiKey: string): Promise<void> {
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    body = undefined;
  }
  if (isAnthropicError(body)) return;
  const code = isRecord(body) && typeof body.error === "string" ? body.error : undefined;
  // The organisation key check comes FIRST: a refused key is a verdict on the user's key, not a
  // gateway failure, and an unavailable check is not an unconfirmed deployment.
  const refusal = res.status === 403 ? keyRefusalReason(code) : undefined;
  if (refusal !== undefined) {
    reportAiKeyRefused(apiKey, refusal);
    logDiag("warn", "ai.keyRefused", { reason: refusal });
    throw new AiKeyRefusedError(refusal);
  }
  if (res.status === 503 && code === AI_KEY_CHECK_UNAVAILABLE) throw new AiKeyCheckUnavailableError();
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
  /** Runs after the deployment status is confirmed and immediately before the request is sent —
   *  again before every retry; a throw stops the send. Callers pass their consent assertion here,
   *  because the consent can be revoked while the status is asked or while a retry waits. */
  beforeSend?: () => void;
  /** REQUIRED so every caller decides. Protected: the body is redacted before it is sent and the
   *  reply restored; an image or non-text document block is refused (`AiPeopleProtectedContentError`)
   *  unless the privacy says `refuseUnredactable: false` (the unforced create-project wizard). */
  privacy: AiPrivacy;
  /** Called once before each retry wait, with the wait in ms (§798). */
  onRetryWait?: (waitMs: number) => void;
}

/** Redact `body` for a protected send and log the per-send counts (numbers only, never values). */
function redactForSend(body: string, privacy: AiPrivacy): string {
  if (!privacy.protected) return body;
  if (privacy.refuseUnredactable && hasUnredactableContent(body)) throw new AiPeopleProtectedContentError();
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

/** Read a 2xx reply once and hand the caller the same response with the real names restored. A placeholder the
 *  session cannot map stays as written and is logged once per reply, as a count (review 5, S5). */
async function restoreReply(res: Response, privacy: AiPrivacy): Promise<Response> {
  if (!privacy.protected || !res.ok) return res;
  const text = await res.text();
  const unrestored = countUnrestoredPlaceholders(text, privacy.session);
  if (unrestored > 0) logDiag("warn", "ai.placeholderUnrestored", { count: unrestored });
  const restored = restoreJsonText(text, privacy.session);
  return new Response(restored, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Settle with `work`, or reject with the signal's reason the moment it aborts — so a `fetch` or a
 *  body read that ignores its signal (a stalled stream) still ends at the time limit. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Statuses a `Response` cannot be built with a body for. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

/** One sent request, read whole: a fresh Response over the read text (same status, statusText and
 *  headers), the text itself, and whether it came over the relay. */
interface ReadAnswer {
  res: Response;
  text: string;
  relayed: boolean;
}

/** Await the sent request and read its whole body under `signal`, so the time limit covers the body
 *  too. (The `fetch` call stays at each call site, where the URL is named.) */
async function readWhole(request: Promise<Response>, signal: AbortSignal, relayed: boolean): Promise<ReadAnswer> {
  const sent = await untilAborted(request, signal);
  const text = await untilAborted(sent.text(), signal);
  const res = new Response(NULL_BODY_STATUSES.has(sent.status) ? null : text, {
    status: sent.status,
    statusText: sent.statusText,
    headers: sent.headers,
  });
  return { res, text, relayed };
}

/** Run one attempt under its own controller, aborted by the caller's signal or by the time limit.
 *  Our limit firing while the caller's signal is not aborted is an `AiTimeoutError`, never an
 *  `AbortError`; anything else, the caller's abort included, is rethrown as it is. The timer and
 *  the listener are always removed. */
async function withTimeLimit<T>(signal: AbortSignal | undefined, attempt: (attemptSignal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => ctrl.abort(signal?.reason);
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, AI_REQUEST_TIMEOUT_MS);
  try {
    return await attempt(ctrl.signal);
  } catch (e) {
    if (timedOut && !signal?.aborted) throw new AiTimeoutError(AI_REQUEST_TIMEOUT_MS);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

function anthropicErrorType(text: string): string | undefined {
  try {
    return safeAiErrorType(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function isRelayRateLimit(e: unknown): boolean {
  return e instanceof AiGatewayError && (e.code === AI_RELAY_RATE_LIMITED || e.code === AI_GATEWAY_RATE_LIMITED);
}

/** A non-2xx answer judged: the relay's own error (when it raised one) and whether to try again. */
async function judgeAnswer(answer: ReadAnswer, apiKey: string): Promise<{ retryable: boolean; relayError?: { error: unknown } }> {
  if (answer.relayed) {
    try {
      await throwIfRelayOwnError(answer.res, apiKey);
    } catch (error) {
      return { retryable: isRelayRateLimit(error), relayError: { error } };
    }
  }
  return { retryable: isRetryableAiAnswer(answer.res.status, anthropicErrorType(answer.text)) };
}

/** Send `attempt` up to `AI_MAX_ATTEMPTS` times, each under the time limit. A rate-limit or overload
 *  answer (or the relay's own limit) waits and tries again while attempts remain and the wait is at
 *  most `AI_RETRY_MAX_WAIT_MS`; otherwise the answer goes back (or the relay's error is thrown)
 *  exactly as one send would. A 2xx is never sent again. */
async function sendWithRetry<T extends ReadAnswer>(
  apiKey: string,
  signal: AbortSignal | undefined,
  onRetryWait: ((waitMs: number) => void) | undefined,
  attempt: (attemptSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  for (let n = 1; ; n++) {
    const answer = await withTimeLimit(signal, attempt);
    if (answer.res.ok) return answer;
    // Read off the response before the relay's own answer is turned into an error.
    const retryAfter = answer.res.headers.get("retry-after");
    const { retryable, relayError } = await judgeAnswer(answer, apiKey);
    const waitMs = retryable && n < AI_MAX_ATTEMPTS ? retryWaitMs(n, retryAfter, Date.now(), Math.random) : null;
    if (waitMs === null) {
      if (relayError) throw relayError.error;
      return answer;
    }
    logDiag("info", "ai.retry", { status: answer.res.status, attempt: n, waitMs });
    try {
      onRetryWait?.(waitMs);
    } catch {
      // The caller's wait notice never breaks a send (like the usage listeners).
    }
    await sleepAbortable(waitMs, signal);
  }
}

/** POST a Messages request on this deployment's route. Every attempt confirms the deployment, runs
 *  `beforeSend` and redacts anew, in that order, before anything is sent. */
export async function postAiMessages({ apiKey, body, path, signal, beforeSend, privacy: asked, onRetryWait }: PostAiMessagesArgs): Promise<Response> {
  const { res, privacy } = await sendWithRetry(apiKey, signal, onRetryWait, async (attemptSignal) => {
    const { peopleForced } = await confirmAiDeployment(attemptSignal);
    throwIfAborted(attemptSignal);
    beforeSend?.();
    const sendPrivacy = peopleForced ? forcedPrivacy(asked) : asked;
    const outgoing = redactForSend(body, sendPrivacy);
    const gateway = usesRelay(currentAiRoute());
    const request = fetch(gateway ? RELAY_MESSAGES_URL : ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: gateway ? relayHeaders(apiKey, true) : directHeaders(apiKey, true),
      body: outgoing,
      signal: attemptSignal,
    });
    const answer = await readWhole(request, attemptSignal, gateway);
    return { ...answer, privacy: sendPrivacy };
  });
  const reply = await restoreReply(res, privacy);
  // Fire and forget: `tapUsage` swallows its own failures.
  if (reply.ok) void tapUsage(path, reply);
  return reply;
}

/** GET the model list on this deployment's route, timed and retried like `postAiMessages`. */
export async function getAiModels(apiKey: string, signal?: AbortSignal): Promise<Response> {
  const { res } = await sendWithRetry(apiKey, signal, undefined, async (attemptSignal) => {
    await confirmAiDeployment(attemptSignal);
    throwIfAborted(attemptSignal);
    const gateway = usesRelay(currentAiRoute());
    const request = fetch(gateway ? RELAY_MODELS_URL : ANTHROPIC_MODELS_URL, {
      headers: gateway ? relayHeaders(apiKey, false) : directHeaders(apiKey, false),
      signal: attemptSignal,
    });
    return readWhole(request, attemptSignal, gateway);
  });
  return res;
}
