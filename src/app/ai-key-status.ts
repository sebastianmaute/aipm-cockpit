// src/app/ai-key-status.ts — §650: the ONE in-memory verdict on the live Anthropic API key.
//
// Pure, i18n-free, React-free. A module-level store (subscribe / getSnapshot / report*) that React
// reads through `useSyncExternalStore` (`use-ai-key-check.ts` `useAiKeyStatus`).
//
// ★★★ NOTHING HERE IS EVER PERSISTED. The status and the key it was measured with live only in this
// module's closure, for this page. The start-up check re-derives the status on every load, so there
// is nothing to store — and a stored verdict derived from a secret is one more thing to leak. The
// key string is held ONLY as an equality token (so a verdict measured with key A never describes
// key B); it is never logged, returned, or sent anywhere by this module.
//
// Who reports: both `/v1/messages` envelopes (`callClaude` in chat-api.ts, `runForcedToolCall` in
// ai-forced-call.ts), the `/v1/models` fetch (`anthropic-models.ts`, shared by the model picker and
// the start-up check), and the §567 mount probe in use-settings.ts (unreadable). Who syncs the live
// key: `useAiKeyCheck`, mounted once in task-manager.tsx.
import {
  AiHttpError, AiKeyRefusedError, aiTransportMessageKey, classifyAiError, isAiTransportMessageKey,
  type AiKeyRefusedReason, type AiTransportMessageKey,
} from "./ai-errors";

export type AiKeyStatus =
  | "unknown" | "ok" | "rejected" | "forbidden" | "unreadable" | "refused-organization" | "refused-workspace";

/** The i18n keys the key verdict speaks through. String literals, not `TranslationKey`, so this
 *  module stays i18n-free; each is a real key in i18n.ts (tsc checks the call sites). */
export type AiKeyMessageKey =
  | "aiKeyRejected" | "aiKeyForbidden" | "aiKeyUnreadable" | "aiKeyWrongOrganization" | "aiKeyWrongWorkspace";

let currentKey: string | null = null;
let status: AiKeyStatus = "unknown";
const listeners = new Set<() => void>();

function setStatus(next: AiKeyStatus): void {
  if (next === status) return;
  status = next;
  for (const l of listeners) l();
}

export function subscribeAiKeyStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAiKeyStatus(): AiKeyStatus {
  return status;
}

/** Tell the store which key is live now. A DIFFERENT key resets the verdict to "unknown": a
 *  verdict belongs to the key it was measured with. The same key (modulo whitespace) keeps it. */
export function syncAiKey(key: string): void {
  const k = key.trim();
  if (k === currentKey) return;
  currentKey = k;
  setStatus("unknown");
}

/** The stale-key guard every report shares: with no live key yet, the reporting key becomes the live
 *  one; a report made with any other key than the live one is stale and must be dropped (false). */
function adoptReportKey(key: string): boolean {
  const k = key.trim();
  if (currentKey === null) {
    currentKey = k;
    return true;
  }
  return k === currentKey;
}

/**
 * Report an Anthropic HTTP response made WITH `key`. 2xx → "ok"; 401 → "rejected"; 403 →
 * "forbidden" (unless its error type says it is a usage limit — `classifyAiError` decides, as it
 * does for every per-feature surface). Every other status says nothing about the key and leaves the
 * verdict unchanged. A report for a key that is no longer the live one (a request still in flight
 * across a key change) is dropped. Network failures never reach here — callers report only a
 * response they actually received.
 */
export function reportAiKeyResponse(key: string, httpStatus: number, errorType?: string): void {
  if (!adoptReportKey(key)) return;
  if (httpStatus >= 200 && httpStatus < 300) {
    setStatus("ok");
    return;
  }
  if (classifyAiError(httpStatus, errorType) !== "auth") return;
  setStatus(httpStatus === 401 ? "rejected" : "forbidden");
}

/** The relay refused the key `key`: another organisation, or a workspace not allowed. Same key
 *  guard as `reportAiKeyResponse` (a refusal for a key no longer live is dropped). */
export function reportAiKeyRefused(key: string, reason: AiKeyRefusedReason): void {
  if (!adoptReportKey(key)) return;
  setStatus(reason === "organization" ? "refused-organization" : "refused-workspace");
}

/** §567 probe: the SEALED Anthropic key exists but cannot be decrypted on this device, so the live
 *  key reads as "". Recorded against the empty key; entering any key clears it via `syncAiKey`. A
 *  non-empty live key wins — the user already replaced it. */
export function reportAiKeyUnreadable(): void {
  if (currentKey !== null && currentKey !== "") return;
  currentKey = "";
  setStatus("unreadable");
}

/** The ONE predicate for "this key is known to be refused": a rejected key (401) or one the
 *  organisation refuses. Today its one reader is `isAiKeyStatusBad`, which decides whether the
 *  key banner shows (`app-banners-block.tsx`). It guards nothing before a send. */
export function isKeyBlocked(s: AiKeyStatus): s is "rejected" | "refused-organization" | "refused-workspace" {
  return s === "rejected" || s === "refused-organization" || s === "refused-workspace";
}

export function isAiKeyStatusBad(
  s: AiKeyStatus,
): s is "rejected" | "forbidden" | "unreadable" | "refused-organization" | "refused-workspace" {
  return isKeyBlocked(s) || s === "forbidden" || s === "unreadable";
}

export function aiKeyMessageKey(s: AiKeyStatus): AiKeyMessageKey | null {
  if (s === "rejected") return "aiKeyRejected";
  if (s === "forbidden") return "aiKeyForbidden";
  if (s === "unreadable") return "aiKeyUnreadable";
  if (s === "refused-organization") return "aiKeyWrongOrganization";
  if (s === "refused-workspace") return "aiKeyWrongWorkspace";
  return null;
}

/** The key message for a thrown AI error, or null when the failure is not about the key. Mirrors
 *  `classifyAiError`'s "auth" class, split by status. */
export function aiKeyMessageKeyForError(err: unknown): AiKeyMessageKey | null {
  if (err instanceof AiKeyRefusedError) {
    return err.reason === "organization" ? "aiKeyWrongOrganization" : "aiKeyWrongWorkspace";
  }
  if (!(err instanceof AiHttpError)) return null;
  if (classifyAiError(err.status, err.errorType) !== "auth") return null;
  return err.status === 401 ? "aiKeyRejected" : "aiKeyForbidden";
}

/** The key message for a controlled status TOKEN — the digit string several hooks store as their
 *  error state ("401", "403", "network", "parse", "limit", …). Only "401"/"403" map; the hooks
 *  already turn a rate-limit 403 into "limit" before storing a token. */
export function aiKeyMessageKeyForStatusToken(token: string | undefined | null): AiKeyMessageKey | null {
  if (token === "401") return "aiKeyRejected";
  if (token === "403") return "aiKeyForbidden";
  return null;
}

/** The message for a thrown AI failure that is not the feature's own: the transport's (a
 *  switched-off or changed deployment, a refused or failing gateway) ahead of a refused key, or
 *  null. A surface asks this BEFORE its own network or generic fallback. Reading it records no key
 *  verdict, and a transport failure never maps to a key message. */
export function aiFailureMessageKey(err: unknown): AiTransportMessageKey | AiKeyMessageKey | null {
  return aiTransportMessageKey(err) ?? aiKeyMessageKeyForError(err);
}

const REFUSAL_MESSAGE_KEYS: ReadonlySet<string> = new Set<AiKeyMessageKey>(["aiKeyWrongOrganization", "aiKeyWrongWorkspace"]);

/** The token a token-keeping hook stores for a failure that is not the feature's own: the transport's message
 *  key (an unavailable key check among them) or a refused key's message key; null for anything else, which the
 *  hook maps to its own token ("401", "limit", "network", …). The one mapper those hooks share. */
export function aiFailureToken(err: unknown): AiTransportMessageKey | AiKeyMessageKey | null {
  if (err instanceof AiKeyRefusedError) return aiKeyMessageKeyForError(err);
  return aiTransportMessageKey(err);
}

/** `aiFailureMessageKey` for a stored token: a transport or refused-key message key is its own message (the
 *  token-keeping hooks store it as the token, `aiFailureToken`), "401"/"403" name the key, anything else is null. */
export function aiFailureMessageKeyForToken(
  token: string | undefined | null,
): AiTransportMessageKey | AiKeyMessageKey | null {
  if (isAiTransportMessageKey(token)) return token;
  if (typeof token === "string" && REFUSAL_MESSAGE_KEYS.has(token)) return token as AiKeyMessageKey;
  return aiKeyMessageKeyForStatusToken(token);
}

/** Test-only: forget the key token and the verdict. */
export function __resetAiKeyStatusForTests(): void {
  currentKey = null;
  status = "unknown";
  listeners.clear();
}
