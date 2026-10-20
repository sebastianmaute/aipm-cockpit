// src/app/session-ai-key.ts — the Anthropic API key unlocked with its passphrase, held in memory for this page
// only (§717).
//
// A key sealed behind a passphrase reads "" in settings (`hydrateSecretsInto` leaves it empty until unlock), and
// the unlock form lives in the AI chat. Until §717 the unlocked value stayed in the chat panel's own state, so
// every other AI feature (the forecast import, Suggest RACI, the digest, insights…) read "" and showed as
// unavailable. The chat now puts it here, and `liveAiKey` (`settings-types.ts`) falls back to it.
//
// ★ SECURITY: memory only. Never written to localStorage, IndexedDB, an export or Turso; a reload drops it, as
// it dropped the chat panel's state. Editing or removing the key in Settings clears it (`clearSessionAiKey`), so
// a key the user replaced cannot linger. Pure: no React, no storage, so `settings-types.ts` can import it;
// `useSessionAiKey` (`use-session-ai-key.ts`) re-renders a subscriber when it changes.

let sessionKey = "";
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The unlocked key, "" when none was unlocked on this page. */
export function getSessionAiKey(): string {
  return sessionKey;
}

/** Hold the key the user just unlocked, for the rest of this page's life. */
export function setSessionAiKey(key: string): void {
  const next = key.trim();
  if (next === sessionKey) return;
  sessionKey = next;
  emit();
}

/** Forget the unlocked key: the stored key was edited, replaced or removed. */
export function clearSessionAiKey(): void {
  if (sessionKey === "") return;
  sessionKey = "";
  emit();
}

/** Called whenever the unlocked key is set or cleared; returns the unsubscribe. */
export function subscribeSessionAiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
