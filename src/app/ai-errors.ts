// src/app/ai-errors.ts — pure, i18n-free classification of Anthropic API failures.
// No fetch, no logging, no React. The ONLY thing ever read from a response body is
// the safe token `error.type` (e.g. "rate_limit_error"); the body's human message
// text is never surfaced or logged (semgrep/security constraint).

/** A typed HTTP failure from an Anthropic call. Message is status-only (never the
 *  body) so it can be logged/echoed safely; `errorType` is the safe body token. */
export class AiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorType?: string,
  ) {
    super(String(status));
    this.name = "AiHttpError";
  }
}

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
