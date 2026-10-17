// The Turso token's seal state, shared by every path that reloads the page: the Settings
// section's "Save & switch", the setup wizard's Finish and "Move to Turso" (§715). Module
// scope on purpose — the section that starts a seal can unmount before it lands (the load
// hold remounts it after Apply, the wizard unmounts it on Next), and the reload paths live in
// other modules.
import { useSyncExternalStore } from "react";
import { logDiag } from "./diagnostics";
import { SECRET_MERGE_TIMEOUT_MS } from "./use-settings";

// ★★ §548 — IN-FLIGHT TURSO TOKEN SEALS. Apply on Turso storage rebuilds the backend and the load
// hold remounts the section, so a per-instance ref would forget a seal started by the instance that
// just went away. A reload before the seal settles loses the token (`writeSettings` blanks it), so
// each reload path waits on `awaitTokenSeals` first — BOUNDED, so a seal that never settles cannot
// hang it. A failed seal is logged, never rethrown: the reload must still happen, exactly as it did
// before this wait existed.
const inFlightTokenSeals = new Set<Promise<void>>();

export function trackTokenSeal(seal: Promise<unknown>): void {
  const settled = seal.then(
    () => undefined,
    (err: unknown) => {
      logDiag("error", "settings.tursoTokenSealFailed", {
        message: err instanceof Error ? err.message : String(err),
      });
    },
  );
  inFlightTokenSeals.add(settled);
  void settled.then(() => inFlightTokenSeals.delete(settled));
}

/** Resolves once every seal in flight settles, or after `SECRET_MERGE_TIMEOUT_MS`, whichever comes
 *  first — the same bound the settings hydration puts on the secret store. A seal is a local
 *  IndexedDB + WebCrypto write that normally takes well under a second; one that never settles (an
 *  IDB open queued behind another tab's connection) must not leave a reload path busy forever. On
 *  timeout the caller proceeds and a diagnostic is logged — the token may then be lost to the
 *  reload, which beats a button that never finishes. Resolves at once when nothing is in flight. */
export async function awaitTokenSeals(): Promise<void> {
  if (inFlightTokenSeals.size === 0) return;
  const seals = Promise.all([...inFlightTokenSeals]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), SECRET_MERGE_TIMEOUT_MS);
  });
  const outcome = await Promise.race([seals.then(() => "settled" as const), timeout]);
  clearTimeout(timer);
  if (outcome === "timeout") {
    logDiag("warn", "settings.tursoTokenSealWaitTimedOut", { ms: SECRET_MERGE_TIMEOUT_MS });
  }
}

// §715 — OFF Turso storage each keystroke commits the token, but in passphrase mode nothing can seal
// it (the passphrase is never in memory), and a reload restores the OLD sealed record. This holds the
// token committed that way until a seal covers it. Keyed by VALUE: it applies only while the settings
// still hold that very token.
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => unsealedPassphraseToken;

/** `hasUnsealedPassphraseToken` for a render: re-renders when the marker changes, so a seal that
 *  lands after the section remounted clears its blocked state without a keystroke. */
export function useHasUnsealedPassphraseToken(authToken: string | undefined): boolean {
  const token = useSyncExternalStore(subscribe, snapshot, snapshot);
  return token !== null && token === authToken;
}

/** Forgets any held token. Test-only (reset in `vitest.setup.ts`): the marker is module state, so
 *  it outlives a render. */
export function __forgetUnsealedPassphraseToken(): void {
  setUnsealedPassphraseToken(null);
}
