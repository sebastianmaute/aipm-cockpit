// src/app/ai-errors.ts — pure, i18n-free classification of Anthropic API failures.
// No fetch, no logging, no React. The ONLY thing ever read from a response body is
// the safe token `error.type` (e.g. "rate_limit_error"); the body's human message
// text is never surfaced or logged (semgrep/security constraint).

/** A typed HTTP failure from an Anthropic call. `Error.message` is status-only
 *  (never the body) so it can be logged/echoed safely; `errorType` is the safe
 *  body token. `safeMessage` is the sanitized RESPONSE `error.message` — safe to
 *  SURFACE to the user (it carries no secret: the api key lives only in the
 *  request header, which is never read) but it must NOT be logged. */
export class AiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorType?: string,
    public readonly safeMessage?: string,
  ) {
    super(String(status));
    this.name = "AiHttpError";
  }
}

/** Why the AI transport (`ai-transport.ts`) sent nothing: the deployment's AI setting, asked
 *  before every send, is switched off or invalid, differs from the route this page loaded with,
 *  or could not be confirmed (server down, non-200, unreadable answer). Never a key problem. */
export type AiDeploymentErrorReason = "off" | "invalid" | "route-changed" | "unconfirmed";

export class AiDeploymentError extends Error {
  constructor(public readonly reason: AiDeploymentErrorReason) {
    super(reason);
    this.name = "AiDeploymentError";
  }
}

export const AI_GATEWAY_REJECTED = "ai-gateway-rejected";
export const AI_GATEWAY_ERROR = "ai-gateway-error";
export type AiGatewayErrorCode = typeof AI_GATEWAY_REJECTED | typeof AI_GATEWAY_ERROR;

/** The organisation's AI gateway (reached through the same-origin relay) refused the app's
 *  gateway token or failed. Never a verdict on the user's own Anthropic key. */
export class AiGatewayError extends Error {
  constructor(public readonly code: AiGatewayErrorCode) {
    super(code);
    this.name = "AiGatewayError";
  }
}

export type AiTransportMessageKey =
  | "aiDeploymentOff"
  | "aiDeploymentInvalid"
  | "aiDeploymentChanged"
  | "aiDeploymentUnconfirmed"
  | "aiGatewayRejected"
  | "aiGatewayFailed";

const DEPLOYMENT_MESSAGE: Record<AiDeploymentErrorReason, AiTransportMessageKey> = {
  off: "aiDeploymentOff",
  invalid: "aiDeploymentInvalid",
  "route-changed": "aiDeploymentChanged",
  unconfirmed: "aiDeploymentUnconfirmed",
};

const GATEWAY_MESSAGE: Record<AiGatewayErrorCode, AiTransportMessageKey> = {
  [AI_GATEWAY_REJECTED]: "aiGatewayRejected",
  [AI_GATEWAY_ERROR]: "aiGatewayFailed",
};

/** The i18n key naming a transport failure, or null for any other error. */
export function aiTransportMessageKey(err: unknown): AiTransportMessageKey | null {
  if (err instanceof AiDeploymentError) return DEPLOYMENT_MESSAGE[err.reason];
  if (err instanceof AiGatewayError) return GATEWAY_MESSAGE[err.code];
  return null;
}

/** Strip ASCII control chars from untrusted text (hex escapes — never literal
 *  control bytes). Shared regex form used across the app's sanitizers. */
const CONTROL_CHARS = /[\x00-\x1f]/g;

/** Cap on the surfaced error message length. */
const MAX_AI_ERROR_MESSAGE = 500;

export type AiErrorClass = "limit" | "auth" | "network" | "parse" | "generic";

/** Anthropic error `type` values that mean "you hit a usage/rate limit". */
const LIMIT_ERROR_TYPES = new Set(["rate_limit_error", "overloaded_error"]);

/**
 * Classify an AI call failure from its HTTP status + optional safe body token.
 *   - 429, or errorType rate_limit_error / overloaded_error → "limit"
 *   - 401 / 403 → "auth"
 *   - everything else → "generic"
 * ("network" / "parse" are produced by callers for non-HTTP failures, not here.)
 */
export function classifyAiError(status: number, errorType?: string): AiErrorClass {
  if (status === 429 || (errorType !== undefined && LIMIT_ERROR_TYPES.has(errorType))) {
    return "limit";
  }
  if (status === 401 || status === 403) return "auth";
  return "generic";
}

/**
 * Safely extract `error.type` (a string) from a parsed JSON error body. Guards
 * every access with typeof checks and NEVER throws — returns undefined on any
 * shape that isn't `{ error: { type: string } }`. Only the `type` token is read;
 * the body's `message` is deliberately ignored.
 */
export function safeAiErrorType(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return undefined;
  const type = (err as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

/**
 * Safely extract the human-readable `error.message` from a parsed JSON error
 * body (e.g. a 400 invalid_request_error like "prompt is too long: N > M").
 *
 * SECURITY: only the RESPONSE body's message is read — it carries no secret (the
 * api key is only ever in the request header, which is never read/logged). The
 * text is control-char-stripped (a single scrub can't corrupt logs/markup) and
 * length-capped. Guards every access and NEVER throws — returns undefined for
 * any shape that isn't `{ error: { message: <non-empty string> } }`. This value
 * may be SURFACED to the user but must NOT be logged.
 */
export function safeAiErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return undefined;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return undefined;
  const cleaned = message.replace(CONTROL_CHARS, " ").trim().slice(0, MAX_AI_ERROR_MESSAGE);
  return cleaned.length > 0 ? cleaned : undefined;
}
