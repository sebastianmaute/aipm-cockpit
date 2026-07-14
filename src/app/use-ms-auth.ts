// src/app/use-ms-auth.ts
"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AccountInfo, PublicClientApplication } from "@azure/msal-browser";
import { getMsalConfig } from "./msal-config";

/** Non-secret MSAL identifiers sourced from the Settings → Integrations panel.
 *  Env vars (NEXT_PUBLIC_MSAL_*) still win in `getMsalConfig`; this is the
 *  fallback the panel writes so a runtime-configured tenant can sign in. */
export interface MsAuthConfig {
  clientId?: string;
  tenantId?: string;
}

/** Module-scoped lazy promise. Stays null until enabled=true triggers the
 *  dynamic import. Test-only helpers below expose it for assertion. */
let pcaPromise: Promise<PublicClientApplication> | null = null;
/** Config key the cached `pcaPromise` was built with. When the resolved config
 *  changes (user fills/edits the Settings fields), the singleton rebuilds. */
let pcaConfigKey: string | null = null;
/** Latest Settings-sourced config, published by every `useMsAuth` consumer that
 *  owns it (task-manager root + the Integrations panel). getPca reads it so the
 *  panel inputs actually reach MSAL — env vars alone are no longer required. */
let sessionClientId: string | undefined;
let sessionTenantId: string | undefined;
/** Resolved (env-merged) config key currently published, so a re-publish of the
 *  same effective config is a no-op and a genuine change forces a re-probe. */
let publishedConfigKey: string | null = null;

/** Resolved config identity (env wins, else Settings). `null` when unconfigured.
 *  JSON-encoded so the two ids can't collide across a delimiter (Important #4). */
function resolvedConfigKey(clientId?: string, tenantId?: string): string | null {
  const cfg = getMsalConfig(clientId, tenantId);
  return cfg ? JSON.stringify([cfg.clientId, cfg.tenantId]) : null;
}

/**
 * Publish Settings-sourced config from an OWNER consumer (task-manager root /
 * Integrations panel). Called from a committed effect, not during render, so the
 * hook body stays pure (Important #3). A no-op when the resolved config is
 * unchanged. On a GENUINE change to an already-established/probed config it
 * discards the MSAL instance built under the old identity and bumps the store
 * `version` to force a fresh probe, so `account`/`ready` reflect the NEW tenant
 * instead of a stale "signed in" from the previous instance's cache (Important #1).
 *
 * Known trade-off (Important #2, accepted): editing an already-enabled tenant in
 * Settings re-publishes per committed keystroke, so a genuine mid-edit change
 * rebuilds the singleton AND (via the setState below) resets account/ready — so
 * any UI reading the shared store (e.g. a "Signed in as …" indicator) briefly
 * flickers to signed-out on each keystroke, and a concurrent background
 * `acquireToken` returns null for that cycle. Both self-heal on the next probe.
 * Not debounced here because the initial publish must be synchronous with mount
 * for the config-only sign-in path; the eager reset is what keeps a changed
 * tenant from showing a STALE signed-in account (Important #1).
 */
function publishMsalConfig(clientId?: string, tenantId?: string): void {
  const nextKey = resolvedConfigKey(clientId, tenantId);
  if (nextKey === publishedConfigKey) return;
  // A probe already ran for the previous (possibly empty/env-only) config → the
  // change must trigger a re-probe. First establishment on a fresh mount does
  // not: the probe effect in the same commit runs after this and probes once.
  const needsReprobe = publishedConfigKey !== null || probeStarted || state.ready;
  publishedConfigKey = nextKey;
  sessionClientId = clientId;
  sessionTenantId = tenantId;
  pcaPromise = null;
  pcaConfigKey = null;
  probeStarted = false;
  if (needsReprobe) {
    setState({ account: null, ready: false, version: state.version + 1 });
  }
}

async function getPca(): Promise<PublicClientApplication> {
  // Resolve config synchronously (env wins, else Settings) BEFORE the dynamic
  // import so a missing config throws without caching a rejected promise —
  // a later retry (after the user configures the panel) rebuilds cleanly.
  const cfg = getMsalConfig(sessionClientId, sessionTenantId);
  if (!cfg) throw new Error("MSAL config not available");
  const key = JSON.stringify([cfg.clientId, cfg.tenantId]);
  if (pcaPromise && pcaConfigKey === key) return pcaPromise;
  pcaConfigKey = key;
  pcaPromise = import("@azure/msal-browser").then(async ({ PublicClientApplication }) => {
    const pca = new PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
        // Dedicated light route (src/app/msal-redirect/page.tsx). MSAL v5 closes a
        // popup via a BroadcastChannel bridge: the popup lands here and calls
        // broadcastResponseToMainFrame, which posts the response to the opener and
        // closes the popup. A separate route keeps the full app from booting in the
        // popup (instant clean close). Register `${origin}/msal-redirect` as an SPA
        // redirect URI in the Azure app registration.
        redirectUri:
          typeof window === "undefined" ? "/" : `${window.location.origin}/msal-redirect`,
      },
      cache: { cacheLocation: "localStorage" },
    });
    await pca.initialize();
    // Required on every page load: completes a pending redirect response AND
    // releases a stale interaction lock. Without it, a timed-out/aborted popup
    // leaves MSAL wedged in `interaction_in_progress` and every later
    // loginPopup throws before opening. Popup flow leaves no hash here, so this
    // just clears the lock; swallow errors so a bad hash can't wedge init.
    await pca.handleRedirectPromise().catch(() => {});
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
  /** Bumped on a genuine config change to re-trigger the probe effect. */
  version: number;
}

const INITIAL_STATE: AuthState = { account: null, ready: false, version: 0 };
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
  if (
    next.account === state.account &&
    next.ready === state.ready &&
    next.version === state.version
  ) {
    return;
  }
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
  pcaConfigKey = null;
  sessionClientId = undefined;
  sessionTenantId = undefined;
  publishedConfigKey = null;
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

export function useMsAuth(enabled: boolean, config?: MsAuthConfig): UseMsAuthResult {
  // Only OWNER consumers (task-manager root / Integrations panel) pass a config;
  // non-owners pass nothing and must NOT clobber the published config. Hoist to
  // scalar deps (react-hooks bans obj.member deps) and gate the effect on owner
  // identity so a non-owner render never publishes.
  const isConfigOwner = config !== undefined;
  const cfgClientId = config?.clientId;
  const cfgTenantId = config?.tenantId;

  const { account, ready, version } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Publish on COMMIT (not during render → pure body). Declared BEFORE the probe
  // effect so on mount the config lands before the first probe runs. publishMsalConfig
  // no-ops on an unchanged resolved key.
  useEffect(() => {
    if (!isConfigOwner) return;
    publishMsalConfig(cfgClientId, cfgTenantId);
  }, [isConfigOwner, cfgClientId, cfgTenantId]);

  useEffect(() => {
    if (!enabled) return;
    enabledCount += 1;
    if (!probeStarted) {
      probeStarted = true;
      // Epoch-stamp this probe with the config version it started under. A
      // config change bumps `version` and starts a fresh probe; the superseded
      // probe's resolution (e.g. a throwaway no-config probe a non-owner started
      // before the owner published) must NOT write to the shared store, or it
      // races a spurious {ready:true, account:null} in ahead of the real probe.
      const startedVersion = state.version;
      getPca()
        .then((pca) => {
          if (state.version !== startedVersion) return;
          setState({ account: pca.getAllAccounts()[0] ?? null, ready: true });
        })
        .catch(() => {
          if (state.version !== startedVersion) return;
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
    // `version` re-runs the probe after a genuine config change (Important #1).
  }, [enabled, version]);

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
