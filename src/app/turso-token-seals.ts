// The Turso token's in-flight seals, shared by every path that reloads the page: the Settings
// section's "Save & switch", the setup wizard's Finish and "Move to Turso" (§715). Module scope on
// purpose — the section that starts a seal can unmount before it lands (the load hold remounts it
// after Apply), and the reload paths live in other modules. The unsealed passphrase-token marker is
// in `turso-token-marker.ts`; `useHasUnsealedPassphraseToken` below is its render-time reader.
import { useSyncExternalStore } from "react";
import { logDiag } from "./diagnostics";
import {
  registerTokenSeal,
  subscribeUnsealedPassphraseToken,
  tokenSealsInFlight,
  unsealedPassphraseTokenSnapshot,
} from "./turso-token-marker";
import { SECRET_MERGE_TIMEOUT_MS } from "./use-settings";

// ★★ §548 — IN-FLIGHT TURSO TOKEN SEALS. Apply on Turso storage rebuilds the backend and the load
// hold remounts the section, so a per-instance ref would forget a seal started by the instance that
// just went away. A reload before the seal settles loses the token (`writeSettings` blanks it), so
// each reload path waits on `tokenSealsSettled` first — BOUNDED, so a seal that never settles cannot
// hang it. A failed seal is logged, never rethrown, so the wait itself never throws; what follows
// is the caller's choice ("Save & switch" still reloads; "Move to Turso" refuses while the
// token stays unsealed). The registry lives in `turso-token-marker.ts`, so the test reset reaches it.

export function trackTokenSeal(seal: Promise<unknown>): void {
  const settled = seal.then(
    () => undefined,
    (err: unknown) => {
      logDiag("error", "settings.tursoTokenSealFailed", {
        message: err instanceof Error ? err.message : String(err),
      });
    },
  );
  registerTokenSeal(settled);
}

/** A promise that resolves once every seal in flight settles, or after `SECRET_MERGE_TIMEOUT_MS`,
 *  whichever comes first — the same bound the settings hydration puts on the secret store. A seal
 *  is a local IndexedDB + WebCrypto write that normally takes well under a second; one that never
 *  settles (an IDB open queued behind another tab's connection) must not leave a reload path busy
 *  forever. On timeout the caller proceeds and a diagnostic is logged — the token may then be lost
 *  to the reload, which beats a button that never finishes. It also waits for a seal that STARTS
 *  while it waits (a keystroke during a switch), each batch under its own bound, and stops once
 *  only seals it already waited out remain.
 *  ★ `null` when nothing is in flight, so the caller stays SYNCHRONOUS in the common case: an
 *    `await` on an empty wait still yields, which moved "Save & switch"'s settings write past the
 *    click (`integrations-snapshots.test.tsx` pins it). Write `const w = …; if (w) await w;`. */
export function tokenSealsSettled(): Promise<void> | null {
  const inFlight = tokenSealsInFlight();
  return inFlight.length === 0 ? null : settleAll(inFlight);
}

async function settleAll(first: Promise<void>[]): Promise<void> {
  const seen = new Set(first);
  for (let batch = first; batch.length > 0; ) {
    await waitBounded(Promise.all(batch));
    batch = tokenSealsInFlight().filter((seal) => !seen.has(seal));
    for (const seal of batch) seen.add(seal);
  }
}

async function waitBounded(seals: Promise<unknown>): Promise<void> {
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

/** `hasUnsealedPassphraseToken` for a render: re-renders when the marker changes, so a seal that
 *  lands after the section remounted clears its blocked state without a keystroke. */
export function useHasUnsealedPassphraseToken(authToken: string | undefined): boolean {
  const token = useSyncExternalStore(
    subscribeUnsealedPassphraseToken,
    unsealedPassphraseTokenSnapshot,
    unsealedPassphraseTokenSnapshot,
  );
  return token !== null && token === authToken;
}
