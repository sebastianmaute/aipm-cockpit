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
import { snapshotSealedRestore } from "./secrets-store";
import type { SealedSecret } from "./secrets";

// ★★ §548 — IN-FLIGHT TURSO TOKEN SEALS. Apply on Turso storage rebuilds the backend and the load
// hold remounts the section, so a per-instance ref would forget a seal started by the instance that
// just went away. A reload before the seal settles loses the token (`writeSettings` blanks it), so
// each reload path waits on `tokenSealsSettled` first — BOUNDED, so a seal that never settles cannot
// hang it. A failed seal is logged, never rethrown, so the wait itself never throws; every reload
// path then runs the same durability gate and refuses while the token stays unsealed
// (`commitPortfolioModeSwitch`, `migrateCurrentProjectToTurso`). The registry lives in
// `turso-token-marker.ts`, so the test reset reaches it.

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
 *  forever. On timeout a diagnostic is logged and the caller's durability gate decides: a token
 *  still held in passphrase mode, or a passphrase seal of a Turso-storage draft still running, is
 *  refused; only a device seal that has not landed can be lost
 *  to the reload, which beats a button that never finishes. It also waits for a seal that STARTS
 *  while it waits (a keystroke during a switch), under the SAME deadline: the bound is on the
 *  whole wait, however many seals start meanwhile.
 *  ★ `null` when nothing is in flight, so the caller stays SYNCHRONOUS in the common case: an
 *    `await` on an empty wait still yields, which moved "Save & switch"'s settings write past the
 *    click (`integrations-snapshots.test.tsx` pins it). Write `const w = …; if (w) await w;`. */
export function tokenSealsSettled(): Promise<void> | null {
  const inFlight = tokenSealsInFlight();
  return inFlight.length === 0 ? null : settleAll(inFlight);
}

async function settleAll(first: Promise<void>[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), SECRET_MERGE_TIMEOUT_MS);
  });
  const seen = new Set(first);
  let timedOut = false;
  for (let batch = first; batch.length > 0; ) {
    const outcome = await Promise.race([Promise.all(batch).then(() => "settled" as const), deadline]);
    if (outcome === "timeout") {
      timedOut = true;
      break;
    }
    batch = tokenSealsInFlight().filter((seal) => !seen.has(seal));
    for (const seal of batch) seen.add(seal);
  }
  clearTimeout(timer);
  if (timedOut) logDiag("warn", "settings.tursoTokenSealWaitTimedOut", { ms: SECRET_MERGE_TIMEOUT_MS });
}

/** A "Save & switch"'s own seal of the token, read after the gate's wait. */
export interface OwnSealProbe {
  /** True (refuse) when the seal failed, was superseded, or — with `unsettledRefuses` — is still
   *  running, while a token is still there to lose; false when it landed or when the token was
   *  cleared meanwhile (§609: the clear wins). */
  refuses: () => boolean;
  /** Runs `fn` once the seal has landed — at once if it already has — with a restore snapshotted
   *  AT THE LANDING (`snapshotSealedRestore`), so whatever was written after it wins. At most one
   *  callback; it never runs if the seal fails or is superseded. */
  whenLanded: (fn: (restore: (record: SealedSecret | null) => boolean) => void) => void;
}

/** Tracks `seal` (`trackTokenSeal`) and returns its probe. `tokenNow` reads the field's live token. */
export function probeOwnSeal(
  seal: Promise<boolean>,
  unsettledRefuses: boolean,
  tokenNow: () => string,
): OwnSealProbe {
  let landed: boolean | undefined;
  let restoreAtLanding: ((record: SealedSecret | null) => boolean) | null = null;
  let onLanded: ((restore: (record: SealedSecret | null) => boolean) => void) | null = null;
  trackTokenSeal(
    seal.then(
      (ok) => {
        landed = ok;
        if (!ok) return;
        const restore = snapshotSealedRestore("tursoAuthToken");
        restoreAtLanding = restore;
        onLanded?.(restore);
      },
      (err: unknown) => {
        landed = false;
        throw err;
      },
    ),
  );
  return {
    refuses: () => (landed === undefined ? unsettledRefuses : !landed) && tokenNow().trim() !== "",
    whenLanded: (fn) => {
      if (restoreAtLanding) fn(restoreAtLanding);
      else onLanded = fn;
    },
  };
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
