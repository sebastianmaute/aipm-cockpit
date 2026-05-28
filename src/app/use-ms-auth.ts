// src/app/use-ms-auth.ts
"use client";

import { useEffect, useState } from "react";
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

/** Test-only — for asserting the lazy-load contract. Not used in production. */
export function __pcaPromiseForTests(): Promise<PublicClientApplication> | null {
  return pcaPromise;
}

/** Test-only — reset module-scoped state between tests. */
export function __resetPcaForTests(): void {
  pcaPromise = null;
}

export interface UseMsAuthResult {
  account: AccountInfo | null;
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  acquireToken: (scopes: readonly string[]) => Promise<string | null>;
}

export function useMsAuth(enabled: boolean): UseMsAuthResult {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      void Promise.resolve().then(() => {
        setReady(false);
        setAccount(null);
      });
      return;
    }
    let cancelled = false;
    getPca()
      .then((pca) => {
        if (cancelled) return;
        const accounts = pca.getAllAccounts();
        setAccount(accounts[0] ?? null);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  async function signIn(): Promise<void> {
    const pca = await getPca();
    const result = await pca.loginPopup({ scopes: ["User.Read"] });
    setAccount(result.account);
  }

  async function signOut(): Promise<void> {
    const pca = await getPca();
    const current = pca.getAllAccounts()[0];
    if (current) await pca.logoutPopup({ account: current });
    setAccount(null);
  }

  async function acquireToken(scopes: readonly string[]): Promise<string | null> {
    const pca = await getPca();
    const current = pca.getAllAccounts()[0];
    if (!current) return null;
    const result = await pca.acquireTokenSilent({
      scopes: scopes as string[],
      account: current,
    });
    return result.accessToken;
  }

  return { account, ready, signIn, signOut, acquireToken };
}
