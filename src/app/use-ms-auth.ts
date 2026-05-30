// src/app/use-ms-auth.ts
"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AccountInfo, PublicClientApplication } from "@azure/msal-browser";
import { getMsalConfig } from "./msal-config";

/** Module-scoped lazy promise. Stays null until enabled=true triggers the
 *  dynamic import. Test-only helpers below expose it for assertion. */
let pcaPromise: Promise<PublicClientApplication> | null = null;

async function getPca(): Promise<PublicClientApplication> {
  if (pcaPromise) return pcaPromise;
  pcaPromise = import("@azure/msal-browser").then(async ({ PublicClientApplication }) => {
    const cfg = getMsalConfig();
    if (!cfg) throw new Error("MSAL config not available");
    const pca = new PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
        redirectUri: typeof window === "undefined" ? "/" : window.location.origin,
      },
      cache: { cacheLocation: "localStorage" },
    });
    await pca.initialize();
    return pca;
  });
  return pcaPromise;
}

// --- Shared session store -------------------------------------------------
// All consumers (settings menu, sidebar footer, storage config, storage
// backend) read one source of truth so a sign-in/out anywhere propagates
// everywhere, and MSAL initializes exactly once. State lives at module scope
// and is published through useSyncExternalStore.

interface AuthState {
  account: AccountInfo | null;
  ready: boolean;
}

const INITIAL_STATE: AuthState = { account: null, ready: false };
let state: AuthState = INITIAL_STATE;
const listeners = new Set<() => void>();
/** How many mounted consumers currently request the session (enabled=true). */
let enabledCount = 0;
/** Whether the one-time readiness probe has started for the active session. */
let probeStarted = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<AuthState>): void {
  const next = { ...state, ...patch };
  if (next.account === state.account && next.ready === state.ready) return;
  state = next;
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const getSnapshot = (): AuthState => state;
const getServerSnapshot = (): AuthState => INITIAL_STATE;

/** Test-only — for asserting the lazy-load contract. Not used in production. */
export function __pcaPromiseForTests(): Promise<PublicClientApplication> | null {
  return pcaPromise;
}

/** Test-only — reset all module-scoped state between tests. */
export function __resetPcaForTests(): void {
  pcaPromise = null;
  state = INITIAL_STATE;
  listeners.clear();
  enabledCount = 0;
  probeStarted = false;
}

export interface UseMsAuthResult {
  account: AccountInfo | null;
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  acquireToken: (
    scopes: readonly string[],
    options?: { interactive?: boolean },
  ) => Promise<string | null>;
}

export function useMsAuth(enabled: boolean): UseMsAuthResult {
  const { account, ready } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!enabled) return;
    enabledCount += 1;
    if (!probeStarted) {
      probeStarted = true;
      getPca()
        .then((pca) => {
          setState({ account: pca.getAllAccounts()[0] ?? null, ready: true });
        })
        .catch(() => {
          setState({ ready: true });
        });
    }
    return () => {
      enabledCount -= 1;
      // When the last consumer disables/unmounts, tear the session state down
      // so a later re-enable re-probes the current MSAL cache.
      if (enabledCount === 0) {
        probeStarted = false;
        setState({ account: null, ready: false });
      }
    };
  }, [enabled]);

  const signIn = useCallback(async (): Promise<void> => {
    const pca = await getPca();
    const result = await pca.loginPopup({ scopes: ["User.Read"] });
    setState({ account: result.account });
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const pca = await getPca();
    const current = pca.getAllAccounts()[0];
    if (current) await pca.logoutPopup({ account: current });
    setState({ account: null });
  }, []);

  const acquireToken = useCallback(async (
    scopes: readonly string[],
    options?: { interactive?: boolean },
  ): Promise<string | null> => {
    const pca = await getPca();
    const current = pca.getAllAccounts()[0];
    if (!current) return null;
    try {
      const result = await pca.acquireTokenSilent({
        scopes: scopes as string[],
        account: current,
      });
      return result.accessToken;
    } catch (err) {
      // Silent acquisition fails when a scope hasn't been consented yet
      // (incremental consent) or the session needs interactive renewal.
      // Only callers that opt into interactivity get a popup — background
      // probes (e.g. SharePointBackend.isReady) keep the silent contract so
      // they never trigger a surprise consent dialog.
      if (!options?.interactive) throw err;
      const result = await pca.acquireTokenPopup({
        scopes: scopes as string[],
        account: current,
      });
      return result.accessToken;
    }
  }, []);

  return { account, ready, signIn, signOut, acquireToken };
}
