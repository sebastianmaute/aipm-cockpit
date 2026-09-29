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
import { AiHttpError, classifyAiError } from "./ai-errors";

export type AiKeyStatus = "unknown" | "ok" | "rejected" | "forbidden" | "unreadable";

/** The i18n keys the key verdict speaks through. String literals, not `TranslationKey`, so this
 *  module stays i18n-free; each is a real key in i18n.ts (tsc checks the call sites). */
export type AiKeyMessageKey = "aiKeyRejected" | "aiKeyForbidden" | "aiKeyUnreadable";

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

/**
 * Report an Anthropic HTTP response made WITH `key`. 2xx → "ok"; 401 → "rejected"; 403 →
 * "forbidden" (unless its error type says it is a usage limit — `classifyAiError` decides, as it
 * does for every per-feature surface). Every other status says nothing about the key and leaves the
 * verdict unchanged. A report for a key that is no longer the live one (a request still in flight
 * across a key change) is dropped. Network failures never reach here — callers report only a
 * response they actually received.
 */
export function reportAiKeyResponse(key: string, httpStatus: number, errorType?: string): void {
  const k = key.trim();
  if (currentKey === null) currentKey = k;
  else if (k !== currentKey) return;
  if (httpStatus >= 200 && httpStatus < 300) {
    setStatus("ok");
    return;
  }
  if (classifyAiError(httpStatus, errorType) !== "auth") return;
  setStatus(httpStatus === 401 ? "rejected" : "forbidden");
}

/** §567 probe: the SEALED Anthropic key exists but cannot be decrypted on this device, so the live
 *  key reads as "". Recorded against the empty key; entering any key clears it via `syncAiKey`. A
 *  non-empty live key wins — the user already replaced it. */
export function reportAiKeyUnreadable(): void {
  if (currentKey !== null && currentKey !== "") return;
  currentKey = "";
  setStatus("unreadable");
}

export function isAiKeyStatusBad(s: AiKeyStatus): boolean {
  return s === "rejected" || s === "forbidden" || s === "unreadable";
}

export function aiKeyMessageKey(s: AiKeyStatus): AiKeyMessageKey | null {
  if (s === "rejected") return "aiKeyRejected";
  if (s === "forbidden") return "aiKeyForbidden";
  if (s === "unreadable") return "aiKeyUnreadable";
  return null;
}

/** The key message for a thrown AI error, or null when the failure is not about the key. Mirrors
 *  `classifyAiError`'s "auth" class, split by status. */
export function aiKeyMessageKeyForError(err: unknown): AiKeyMessageKey | null {
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

/** Test-only: forget the key token and the verdict. */
export function __resetAiKeyStatusForTests(): void {
  currentKey = null;
  status = "unknown";
  listeners.clear();
}
