// §715 — OFF Turso storage each keystroke commits the Turso token, but in passphrase mode nothing can
// seal it (the passphrase is never in memory), and a reload restores the OLD sealed record. This holds
// the token committed that way until a seal covers it, so every reload path (the Settings section's
// "Save & switch", the setup wizard's Finish, "Move to Turso") can refuse or seal first. MODULE scope:
// the section that sets it unmounts on a load hold or a wizard step. Keyed by VALUE: it applies only
// while the settings still hold that very token.
// ★ A LEAF on purpose — no imports — so `vitest.setup.ts` can reset it without loading app modules
//   that test files mock (the in-flight seals and the React hook live in `turso-token-seals.ts`).
let unsealedPassphraseToken: string | null = null;
const listeners = new Set<() => void>();

function setUnsealedPassphraseToken(token: string | null): void {
  if (unsealedPassphraseToken === token) return;
  unsealedPassphraseToken = token;
  for (const listener of listeners) listener();
}

/** True when `authToken` was committed in passphrase mode and no seal covers it yet, so a reload
 *  would lose it. */
export function hasUnsealedPassphraseToken(authToken: string | undefined): boolean {
  return unsealedPassphraseToken !== null && unsealedPassphraseToken === authToken;
}

/** Records `token` as committed in passphrase mode with no seal over it; `null` forgets it. */
export function markUnsealedPassphraseToken(token: string | null): void {
  setUnsealedPassphraseToken(token);
}

/** A seal of `token` landed, so a reload restores it: it is no longer at risk. */
export function noteTokenSealed(token: string | undefined): void {
  if (unsealedPassphraseToken === token) setUnsealedPassphraseToken(null);
}

/** For `useSyncExternalStore`: notifies on every marker change. */
export function subscribeUnsealedPassphraseToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For `useSyncExternalStore`: the held token, or `null`. */
export function unsealedPassphraseTokenSnapshot(): string | null {
  return unsealedPassphraseToken;
}

/** Forgets any held token. Test-only (reset in `vitest.setup.ts`): the marker is module state, so
 *  it outlives a render. */
export function __forgetUnsealedPassphraseToken(): void {
  setUnsealedPassphraseToken(null);
}
