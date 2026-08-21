# M365 Auth + Integration Toggles Foundation — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.21.0-m365-auth-foundation`
**Context:** Sub-project **M1** — first piece of a 5-sub-project Microsoft 365 + Turso request. Lays the MSAL + Graph foundation that M2 (SharePoint storage), M3 (Outlook contacts), and M4 (Outlook calendar) all depend on. T1 (Turso) is independent of this work. Ships as **0.21.0 "Jemisin"** with a new highlight key. The previous batch's S4 (PDF export) is deferred.

## Goal

Add a Microsoft 365 integration foundation to lop-app:
- An **Integrations** section in Settings with disable toggles for SharePoint, Outlook contacts, Outlook calendar — **all defaulting OFF**.
- A "Sign in with Microsoft" button that performs the MSAL browser PKCE flow when the master M365 toggle is ON.
- Lazy-loaded MSAL bundle (zero MSAL bytes at cold start when toggles are OFF).
- Config resolution: `NEXT_PUBLIC_MSAL_*` env vars at build time win; otherwise Settings inputs (Option C from brainstorm).
- Nothing functional beyond auth ships in M1 — sub-toggles for SharePoint/Contacts/Calendar render disabled with "Available in 0.22.0+" tooltips.

## Non-goals

- No SharePoint storage backend (M2).
- No contact reads (M3).
- No calendar reads (M4).
- No Turso backend (T1, separate work).
- No write-back to Microsoft 365 anything.
- No multi-account UX — single signed-in MSAL account at a time.
- No custom token-refresh logic — MSAL handles silent renewal.

## Architecture

### `@azure/msal-browser` + lazy import

Add `@azure/msal-browser` to dependencies. The MSAL `PublicClientApplication` and the whole MSAL module are **never imported statically** anywhere. A single dynamic import gate in the `useMsAuth()` hook ensures the bundle loads only when `settings.integrations?.m365?.enabled === true`:

```ts
// src/app/use-ms-auth.ts
"use client";

import { useEffect, useState } from "react";
import type { AccountInfo, PublicClientApplication } from "@azure/msal-browser";
import { getMsalConfig } from "./msal-config";

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

export function useMsAuth(enabled: boolean) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      setAccount(null);
      return;
    }
    let cancelled = false;
    getPca().then((pca) => {
      if (cancelled) return;
      const accounts = pca.getAllAccounts();
      setAccount(accounts[0] ?? null);
      setReady(true);
    }).catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [enabled]);

  async function signIn() {
    const pca = await getPca();
    const result = await pca.loginPopup({ scopes: ["User.Read"] });
    setAccount(result.account);
  }

  async function signOut() {
    const pca = await getPca();
    const current = pca.getAllAccounts()[0];
    if (current) await pca.logoutPopup({ account: current });
    setAccount(null);
  }

  async function acquireToken(scopes: readonly string[]): Promise<string | null> {
    const pca = await getPca();
    const current = pca.getAllAccounts()[0];
    if (!current) return null;
    const result = await pca.acquireTokenSilent({ scopes: scopes as string[], account: current });
    return result.accessToken;
  }

  return { account, ready, signIn, signOut, acquireToken };
}
```

The hook is the single touchpoint other components use. M2/M3/M4 will call `acquireToken(["Files.ReadWrite"])`, `acquireToken(["Contacts.Read"])`, `acquireToken(["Calendars.Read"])` to perform incremental consent.

### `src/app/msal-config.ts` (new)

```ts
// Config-resolution helper. Env vars win; Settings fall back.
export interface MsalConfig {
  clientId: string;
  tenantId: string;
}

export function getMsalConfig(settingsClientId?: string, settingsTenantId?: string): MsalConfig | null {
  const envClient = process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
  const envTenant = process.env.NEXT_PUBLIC_MSAL_TENANT_ID;
  const clientId = envClient ?? settingsClientId ?? "";
  const tenantId = envTenant ?? settingsTenantId ?? "common";
  if (!clientId) return null;
  return { clientId, tenantId };
}
```

The pure-function design makes it trivial to unit-test (just set/clear `process.env.NEXT_PUBLIC_MSAL_*` and call). The hook calls it with settings values passed in via React context (described next).

### `Settings` type extension

In `src/app/settings-menu.tsx`, extend the `Settings` type:

```ts
export type M365IntegrationsSettings = {
  enabled: boolean;
  clientId?: string;
  tenantId?: string;
  sharepoint: boolean;
  outlookContacts: boolean;
  outlookCalendar: boolean;
};

export type TursoIntegrationsSettings = {
  enabled: boolean;
};

export type Settings = {
  // ... existing fields ...
  integrations?: {
    m365?: M365IntegrationsSettings;
    turso?: TursoIntegrationsSettings;
  };
};
```

Default factory + sanitizer: when `integrations` is absent or partially shaped (older saved settings), the resolver fills in:
```ts
const DEFAULT_M365: M365IntegrationsSettings = {
  enabled: false,
  sharepoint: false,
  outlookContacts: false,
  outlookCalendar: false,
};
const DEFAULT_TURSO: TursoIntegrationsSettings = { enabled: false };
```

All booleans default `false`. No accidental "always on" path.

### Settings → Integrations UI

A new collapsible section in `settings-menu.tsx`, ordered after the existing sections, containing:

```
┌─ Integrations ─────────────────────────────────────────┐
│                                                        │
│  [ ] Microsoft 365 integration                         │
│                                                        │
│  ── (visible when toggle ON) ──────────────────────    │
│                                                        │
│   Client ID:  [a1b2…f4]                                │
│     (hidden if NEXT_PUBLIC_MSAL_CLIENT_ID set)         │
│   Tenant ID: [common]                                  │
│     (hidden if NEXT_PUBLIC_MSAL_TENANT_ID set)         │
│                                                        │
│   [Sign in with Microsoft]    ─OR─   alex@example.com  │
│                                       [Sign out]       │
│                                                        │
│   ┌─ Available after signing in ─────────────────────┐ │
│   │  [ ] SharePoint storage    (Available in 0.22.0+)│ │
│   │  [ ] Outlook contacts      (Available in 0.22.0+)│ │
│   │  [ ] Outlook calendar      (Available in 0.22.0+)│ │
│   └──────────────────────────────────────────────────┘ │
│                                                        │
│  [ ] Turso storage backend     (Available in 0.22.0+)  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

- The M365 master toggle uses the same switch/checkbox primitive already used elsewhere in Settings.
- Sub-toggles (SharePoint / Contacts / Calendar / Turso) are present but **disabled** with a `title` tooltip "Available in 0.22.0+". This communicates the upcoming feature surface without lying about availability.
- Client ID + Tenant ID inputs render **only** when the corresponding env var is absent at build time.
- Sign-in button changes to "Signed in as <email>" + Sign out when an account is present.

### What ships if M365 master toggle is OFF

- `useMsAuth(false)` returns `{ account: null, ready: false, signIn: noop, signOut: noop, acquireToken: () => null }`.
- `getPca()` is never called.
- `import("@azure/msal-browser")` is never evaluated.
- Cold-start network requests: zero new ones.

This is the testable contract for "default OFF".

### Edge cases

- **MSAL bundle fails to load** (offline, CDN-blocked). The dynamic-import promise rejects; `useMsAuth.ready` becomes `true` with `account = null`. Settings panel shows a small error toast. User can retry by toggling OFF then ON.
- **User signs in, then disables M365 toggle.** Existing token stays in localStorage (MSAL's cache). Hook returns `account: null` so the app behaves as signed-out. Toggling back ON re-discovers the cached account silently — no re-auth needed.
- **Env var partial** (clientId set, tenantId absent). `getMsalConfig` returns `{ clientId, tenantId: "common" }`. Sign-in works against `common`. Acceptable; the env-var path is admin-controlled.
- **No env vars + no settings input** (`clientId === ""`). `getMsalConfig` returns `null`. Sign-in button is disabled with tooltip "Enter Client ID in settings to sign in."
- **Multi-tab interactions.** MSAL's `localStorage` cache is shared. Signing in on tab A makes tab B see the account on next mount. Acceptable — no eventing needed in M1.
- **MSAL popup blocked.** `loginPopup` rejects with a popup-blocked error. Surface the error in a toast; user can retry after allowing popups.
- **Tenant = "common" with `organizations`-only app.** Microsoft rejects personal accounts. Standard error from Microsoft; surface as toast. No code change needed.

## Data flow

```
Settings panel
  ↓ (user toggles M365 ON)
useMsAuth(enabled=true) mounts
  ↓
Dynamic import("@azure/msal-browser")  ─── loaded once, cached on subsequent calls
  ↓
new PublicClientApplication(getMsalConfig())
  ↓ pca.initialize() + pca.getAllAccounts()
useMsAuth.ready = true; account = first cached account or null
  ↓ (user clicks Sign in)
pca.loginPopup({ scopes: ["User.Read"] })
  ↓
account stored in MSAL localStorage cache
useMsAuth.account = result.account
```

For M2/M3/M4 (later releases):
```
M2 SharePoint backend write
  ↓ acquireToken(["Files.ReadWrite"])
acquireTokenSilent — if scope not yet consented, MSAL surfaces incremental-consent popup
  ↓
access token (string)
  ↓
fetch("https://graph.microsoft.com/v1.0/...", { headers: { Authorization: "Bearer ..." } })
```

## i18n keys (EN + DE)

| Key | EN | DE |
|---|---|---|
| `integrations` | "Integrations" | "Integrationen" |
| `integrationsM365` | "Microsoft 365 integration" | "Microsoft-365-Integration" |
| `integrationsM365Hint` | "Sign in with Microsoft to enable SharePoint, Outlook contacts, and calendar features." | "Mit Microsoft anmelden, um SharePoint-, Kontakte- und Kalender-Funktionen zu aktivieren." |
| `integrationsM365ClientId` | "Azure AD Client ID" | "Azure-AD-Client-ID" |
| `integrationsM365TenantId` | "Tenant ID" | "Tenant-ID" |
| `integrationsM365ClientIdPlaceholder` | "e.g. a1b2c3d4-…-f4" | "z. B. a1b2c3d4-…-f4" |
| `integrationsM365TenantIdPlaceholder` | "common, organizations, or tenant GUID" | "common, organizations oder Tenant-GUID" |
| `integrationsM365SignIn` | "Sign in with Microsoft" | "Mit Microsoft anmelden" |
| `integrationsM365SignedInAs` | "Signed in as" | "Angemeldet als" |
| `integrationsM365SignOut` | "Sign out" | "Abmelden" |
| `integrationsM365NeedsConfig` | "Enter Client ID to sign in." | "Client-ID eingeben, um sich anzumelden." |
| `integrationsM365SignInFailed` | "Sign-in failed. Check console for details." | "Anmeldung fehlgeschlagen. Details in der Konsole." |
| `integrationsSharepoint` | "SharePoint storage" | "SharePoint-Speicher" |
| `integrationsOutlookContacts` | "Outlook contacts" | "Outlook-Kontakte" |
| `integrationsOutlookCalendar` | "Outlook calendar" | "Outlook-Kalender" |
| `integrationsTurso` | "Turso storage backend" | "Turso-Speicher" |
| `integrationsComingSoon` | "Available in 0.22.0+" | "Verfügbar ab 0.22.0" |
| `versionHighlightM365Auth` | "Microsoft 365 integration foundation: sign in with your work account to unlock upcoming SharePoint, Outlook contacts, and calendar features. All integrations default to OFF." | "Microsoft-365-Grundlage: Mit dem Arbeitskonto anmelden, um künftige SharePoint-, Outlook-Kontakte- und Kalender-Funktionen freizuschalten. Alle Integrationen sind standardmäßig deaktiviert." |

## Testing

### Unit tests

- **`msal-config.test.ts`** (new):
  - env vars present → returns `{ clientId, tenantId }`.
  - env vars absent, settings provided → returns settings values.
  - env vars + settings both present → env wins.
  - all absent + no clientId → returns `null`.
  - tenant absent → defaults to `"common"`.

- **`use-ms-auth.test.tsx`** (new):
  - mock `@azure/msal-browser` via `vi.mock`.
  - `enabled=false` → ready stays false, no PCA construction.
  - `enabled=true` → ready becomes true, account exposed from cache.
  - `signIn` calls `loginPopup` with `["User.Read"]` scopes.
  - `signOut` calls `logoutPopup` and clears account.
  - `acquireToken(scopes)` returns the token from `acquireTokenSilent`.

- **`settings-menu.test.tsx`** (extend existing):
  - Integrations section renders with M365 master toggle defaulting OFF when `settings.integrations` is undefined.
  - Toggling ON persists `settings.integrations.m365.enabled = true` to localStorage.
  - Sub-toggles (SharePoint / Contacts / Calendar / Turso) render disabled with the "Available in 0.22.0+" tooltip.
  - Client ID input is hidden when `NEXT_PUBLIC_MSAL_CLIENT_ID` is set (mock via `vi.stubEnv`).

### Lazy-load assertion

A focused test asserting that `import("@azure/msal-browser")` is NOT in the static dependency graph of the default cold-start. The cheapest way: a vitest test that imports the hook with `enabled=false` and asserts the module-scoped `pcaPromise` is `null`.

```ts
import { describe, it, expect } from "vitest";
import { __pcaPromiseForTests } from "./use-ms-auth"; // test-only export

describe("MSAL lazy load", () => {
  it("does not initialize MSAL when toggle is OFF", () => {
    expect(__pcaPromiseForTests()).toBeNull();
  });
});
```

(The test-only `__pcaPromiseForTests` getter exposes the module-scoped `pcaPromise` for assertion. Not exported in production paths.)

### Gates

- `npx tsc --noEmit` 0; `npm run lint` 0 errors; full suite green (existing 927 + ~12 new); `npm run test:coverage` ≥ 70%.

## Release

Minor → **0.21.0 "Jemisin"** (codename retained). New highlight key `versionHighlightM365Auth`.

- `src/app/version.ts`: `APP_VERSION = "0.21.0"`; `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`; new top-of-file comment; append `"versionHighlightM365Auth"` as the LAST entry of `APP_HIGHLIGHT_KEYS`.
- `src/app/i18n.ts` + `i18n.de.ts`: all new integration keys + the highlight key.
- `CHANGELOG.md` `[0.21.0] — 2026-05-28 "Jemisin"` entry with `Added` (integration foundation; defaults OFF; M2/M3/M4 gated).
- `package.json`: `@azure/msal-browser` dependency.
- No DESIGN-TOKENS change.

## Plan shape (preview — `writing-plans` skill expands)

1. Extend `Settings` type + sanitizer with `integrations` (default OFF).
2. Add `@azure/msal-browser` dependency.
3. Create `msal-config.ts` (pure helper) + unit tests.
4. Create `use-ms-auth.ts` (lazy-import hook) + unit tests + lazy-load assertion.
5. Add Integrations section to `settings-menu.tsx` (M365 master toggle + sign-in UX + disabled sub-toggles).
6. i18n EN + DE (all new keys).
7. Release 0.21.0 (version.ts, CHANGELOG).

## What this closes

After 0.21.0 ships, M1 is done. M2 (SharePoint storage), M3 (Outlook contacts), M4 (Outlook calendar) can land in any order on top of this foundation. T1 (Turso) is unblocked at any time — it doesn't depend on M1.
