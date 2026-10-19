// §715 — OFF Turso storage each keystroke commits the Turso token, but in passphrase mode nothing can
// seal it (the passphrase is never in memory), and a reload restores the OLD sealed record. This holds
// the token committed that way until a seal covers it, so every reload path (the Settings section's
// "Save & switch", the setup wizard's Finish, "Move to Turso") can refuse or seal first. MODULE scope:
// the section that sets it unmounts on a load hold or a wizard step. Keyed by VALUE: it applies only
// while the settings still hold that very token.
// §749 — the same hazard holds for the Claude API key (a keystroke under its passphrase lock commits it
// to settings, unsealed until "Save passphrase"), so the marker is kept PER SECRET ID; the Turso-named
// functions below are the `"tursoAuthToken"` case.
// It also holds the REGISTRY of seals in flight (`trackTokenSeal` / `trackSecretSeal` and
// `tokenSealsSettled` in `turso-token-seals.ts` are its only writers and reader).
// ★ A LEAF on purpose — no runtime imports — so `vitest.setup.ts` can reset both without loading app
//   modules that test files mock (`turso-token-seals.ts` imports `use-settings` and `diagnostics`).
import type { SecretId } from "./secrets";

const unsealedPassphraseSecrets = new Map<SecretId, string>();
const inFlightTokenSeals = new Set<Promise<void>>();
const listeners = new Set<() => void>();

function setUnsealed(id: SecretId, value: string | null): void {
  if ((unsealedPassphraseSecrets.get(id) ?? null) === value) return;
  if (value === null) unsealedPassphraseSecrets.delete(id);
  else unsealedPassphraseSecrets.set(id, value);
  for (const listener of listeners) listener();
}

/** True when `value` was committed for `id` in passphrase mode and no seal covers it yet, so a reload
 *  would lose it. */
export function hasUnsealedPassphraseSecret(id: SecretId, value: string | undefined): boolean {
  const held = unsealedPassphraseSecrets.get(id);
  return held !== undefined && held === value;
}

/** Records `value` as committed for `id` in passphrase mode with no seal over it; `null` forgets it. */
export function markUnsealedPassphraseSecret(id: SecretId, value: string | null): void {
  setUnsealed(id, value);
}

/** A seal of `value` for `id` landed, so a reload restores it: it is no longer at risk. */
export function noteSecretSealed(id: SecretId, value: string | undefined): void {
  if (hasUnsealedPassphraseSecret(id, value)) setUnsealed(id, null);
}

/** For `useSyncExternalStore`: the value held for `id`, or `null`. */
export function unsealedPassphraseSecretSnapshot(id: SecretId): string | null {
  return unsealedPassphraseSecrets.get(id) ?? null;
}

/** True when `authToken` was committed in passphrase mode and no seal covers it yet, so a reload
 *  would lose it. */
export function hasUnsealedPassphraseToken(authToken: string | undefined): boolean {
  return hasUnsealedPassphraseSecret("tursoAuthToken", authToken);
}

/** Records `token` as committed in passphrase mode with no seal over it; `null` forgets it. */
export function markUnsealedPassphraseToken(token: string | null): void {
  setUnsealed("tursoAuthToken", token);
}

/** A seal of `token` landed, so a reload restores it: it is no longer at risk. */
export function noteTokenSealed(token: string | undefined): void {
  noteSecretSealed("tursoAuthToken", token);
}

/** For `useSyncExternalStore`: notifies on every marker change, of any id. */
export function subscribeUnsealedPassphraseToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For `useSyncExternalStore`: the held token, or `null`. */
export function unsealedPassphraseTokenSnapshot(): string | null {
  return unsealedPassphraseSecretSnapshot("tursoAuthToken");
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

/** Forgets every held secret and every seal in flight. Test-only (`vitest.setup.ts`, after every
 *  test): both are module state, so they outlive a render, and a seal left in flight would make
 *  every later reload path in the file wait out its bound. */
export function __resetTursoTokenState(): void {
  if (unsealedPassphraseSecrets.size > 0) {
    unsealedPassphraseSecrets.clear();
    for (const listener of listeners) listener();
  }
  inFlightTokenSeals.clear();
}
