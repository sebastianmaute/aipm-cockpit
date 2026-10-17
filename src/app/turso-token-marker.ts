// §715 — OFF Turso storage each keystroke commits the Turso token, but in passphrase mode nothing can
// seal it (the passphrase is never in memory), and a reload restores the OLD sealed record. This holds
// the token committed that way until a seal covers it, so every reload path (the Settings section's
// "Save & switch", the setup wizard's Finish, "Move to Turso") can refuse or seal first. MODULE scope:
// the section that sets it unmounts on a load hold or a wizard step. Keyed by VALUE: it applies only
// while the settings still hold that very token.
// It also holds the REGISTRY of token seals in flight (`trackTokenSeal` and `awaitTokenSeals` in
// `turso-token-seals.ts` are its only writer and reader).
// ★ A LEAF on purpose — no imports — so `vitest.setup.ts` can reset both without loading app modules
//   that test files mock (`turso-token-seals.ts` imports `use-settings` and `diagnostics`).
let unsealedPassphraseToken: string | null = null;
const inFlightTokenSeals = new Set<Promise<void>>();
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

/** Adds a seal to the in-flight registry until it settles. `seal` must never reject. */
export function registerTokenSeal(seal: Promise<void>): void {
  inFlightTokenSeals.add(seal);
  void seal.then(() => inFlightTokenSeals.delete(seal));
}

/** Every seal still in flight. */
export function tokenSealsInFlight(): Promise<void>[] {
  return [...inFlightTokenSeals];
}

/** Forgets any held token and every seal in flight. Test-only (`vitest.setup.ts`, before every
 *  test): both are module state, so they outlive a render, and a seal left in flight would make
 *  every later reload path in the file wait out its bound. */
export function __resetTursoTokenState(): void {
  setUnsealedPassphraseToken(null);
  inFlightTokenSeals.clear();
}
