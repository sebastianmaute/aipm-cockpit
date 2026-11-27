// src/app/chat-send-errors.ts — pure, i18n-free: what the chat shows for an error a send threw.
// `chat-panel.tsx`'s `submitPrompt` applies the outcome (append a line, or set the error banner);
// the decision lives here so it is unit-tested and under the coverage gate.

import { AiPeopleProtectedContentError } from "./ai-privacy";
import { AiConsentRevokedError } from "./ai-consent";
import { AiHttpError, aiModelMessageKey, aiTransportMessageKey, classifyAiError, type AiTransportMessageKey } from "./ai-errors";
import { aiKeyMessageKeyForError, type AiKeyMessageKey } from "./ai-key-status";

/** What the transcript or the error banner shows for a thrown send.
 *  - `stopped`: append the neutral "chatStopped" assistant line, no error state.
 *  - `notice`: APPEND an advisory notice to the transcript (never replace or clear it).
 *  - `error`: set the error banner to this key.
 *  - `raw`: set the error banner to "chatError" with `message`, plus ` — safeMessage` when present. */
export type ChatSendErrorOutcome =
  | { readonly kind: "stopped" }
  | { readonly kind: "notice"; readonly key: "aiUsageLimitReached" }
  | {
      readonly kind: "error";
      readonly key: "chatPeopleProtectedContent" | "aiConsentRevokedDuringSend" | AiTransportMessageKey | AiKeyMessageKey | "aiModelUnavailable";
    }
  | { readonly kind: "raw"; readonly message: string; readonly safeMessage: string | undefined };

/** The outcome for an error a send threw. The branches run in this order: AbortError, limit,
 *  people-protected, consent, transport, key, model, generic.
 *  ★ ONLY "AbortError first" is pinned by a test (an AbortError that is also a limit, a people-protection
 *   refusal or a refused key is a stop). The order of the CLASSIFIED branches after it is NOT pinned and
 *   cannot be today, because on the current error classes no error matches two of them with different
 *   outcomes. What each one matches:
 *   - limit: an `AiHttpError` that `classifyAiError` calls "limit" (429, or a rate-limit/overloaded type);
 *   - people-protected: `AiPeopleProtectedContentError`;
 *   - consent: `AiConsentRevokedError`;
 *   - transport: `AiDeploymentError`, `AiGatewayError`, `AiKeyCheckUnavailableError`, `AiTimeoutError` and
 *     `AiConsentRevokedError` (`aiTransportMessageKey`);
 *   - key: `AiKeyRefusedError`, or an `AiHttpError` that `classifyAiError` calls "auth" (`aiKeyMessageKeyForError`);
 *   - model: an `AiHttpError` that `classifyAiError` calls "model".
 *   Every one of these classes extends `Error` directly, so an error is an instance of at most one. The three
 *   `AiHttpError` branches split by `classifyAiError`'s single answer, so they are disjoint; `AiKeyRefusedError`
 *   is not an `AiHttpError`. The one overlap is `AiConsentRevokedError`, which consent and transport both map
 *   to `aiConsentRevokedDuringSend`. So swapping any two classified branches changes no outcome. That does
 *   NOT extend to the generic fallback: it must stay last, since moving it earlier would catch every error
 *   after it. A new error class that matches two classified branches makes their order matter; pin it then.
 *  ★ A rejection that is not an object (`null`, `undefined`, a string, a number) is the generic error,
 *   with `String(err)` as its message: reading `.name` off `null` used to throw inside the panel's catch. */
export function chatSendErrorOutcome(err: unknown): ChatSendErrorOutcome {
  if (err === null || (typeof err !== "object" && typeof err !== "function")) {
    return { kind: "raw", message: String(err), safeMessage: undefined };
  }
  // AbortError is raised by fetch when the controller fires — treat as
  // a user-initiated stop, not a real error. Check .name directly because
  // DOMException may not be instanceof Error across jsdom/Node boundaries.
  const errName = err instanceof Error ? err.name : (err as { name?: string }).name;
  const keyMsg = aiKeyMessageKeyForError(err);
  const transportMsg = aiTransportMessageKey(err);
  const modelMsg = aiModelMessageKey(err);
  if (errName === "AbortError") return { kind: "stopped" };
  if (err instanceof AiHttpError && classifyAiError(err.status, err.errorType) === "limit") {
    // Anthropic's own rate/usage limit. ADVISORY — APPEND a notice to the
    // transcript (do NOT setError-replace or clear prior messages).
    return { kind: "notice", key: "aiUsageLimitReached" };
  }
  if (err instanceof AiPeopleProtectedContentError) {
    // People protection is on and the conversation holds an image or a non-text document (its
    // text cannot be redacted): the transport refused before sending. Any earlier one blocks too.
    return { kind: "error", key: "chatPeopleProtectedContent" };
  }
  if (err instanceof AiConsentRevokedError) return { kind: "error", key: "aiConsentRevokedDuringSend" };
  // The deployment's AI setting refused or could not confirm the send, or the organisation's
  // gateway failed: nothing about the user's key, so it is named as what it is.
  if (transportMsg) return { kind: "error", key: transportMsg };
  // §650 — a refused key (401/403) is named as the KEY problem, with the way out,
  // instead of "Chat failed: 401 — invalid x-api-key".
  if (keyMsg) return { kind: "error", key: keyMsg };
  // Anthropic does not know the selected model (retired or unknown): name it, with the way out.
  if (modelMsg) return { kind: "error", key: modelMsg };
  // AiHttpError.message is status-only ("400"); its `safeMessage` (the
  // sanitized RESPONSE error.message, e.g. "prompt is too long: N > M")
  // is appended so a 400 isn't just a bare status digit. Never logged.
  const message = err instanceof Error ? err.message : String(err);
  const safeMessage = err instanceof AiHttpError ? err.safeMessage : undefined;
  return { kind: "raw", message, safeMessage };
}
