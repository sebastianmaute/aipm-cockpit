# M365 Auth + Integration Toggles Foundation (0.21.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Microsoft 365 integration foundation to lop-app — Settings.integrations type + Integrations panel + `useMsAuth()` hook with lazy-loaded MSAL bundle + config resolver (env vars → settings fallback). Sub-toggles for SharePoint / Outlook contacts / Outlook calendar render disabled with "Available in 0.22.0+" tooltips.

**Architecture:** Pure config helper (`msal-config.ts`) resolves `NEXT_PUBLIC_MSAL_CLIENT_ID` / `NEXT_PUBLIC_MSAL_TENANT_ID` first, then Settings inputs. `useMsAuth(enabled)` hook hides all MSAL behind a `dynamic import("@azure/msal-browser")` gate; when `enabled=false` the import never fires. `Settings.integrations` extension defaults every boolean to `false` via the sanitizer — no persisted shape ⇒ everything OFF.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest, `@azure/msal-browser` (new dep).

**Spec:** `docs/superpowers/specs/2026-05-28-m365-auth-foundation-design.md`
**Branch:** `feat/0.21.0-m365-auth-foundation` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts. Before EVERY Edit/Write, in SAME message print 4 facts — (a) importers (Grep new symbol name), (b) symbols affected, (c) data fields (settings shape), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.
> 4. **Lazy-load contract:** the test in Task 4 verifies MSAL is NOT loaded at cold start. Don't shortcut this — if it ever fails, the "default OFF = zero MSAL bytes" guarantee is broken.

---

## Task 1: Extend `Settings` type with `integrations`

**Files:** Modify `src/app/settings-menu.tsx`. Create `src/app/integrations-settings.test.ts`.

- [ ] **Step 1: Add the integration sub-types and defaults**

READ `src/app/settings-menu.tsx` around L85–110 to see the `Settings` type + `defaultSettings`. Edit by inserting BEFORE the existing `export type Settings = { ... }` block (~L89):

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

export type IntegrationsSettings = {
  m365?: M365IntegrationsSettings;
  turso?: TursoIntegrationsSettings;
};

export const defaultM365Integrations: M365IntegrationsSettings = {
  enabled: false,
  sharepoint: false,
  outlookContacts: false,
  outlookCalendar: false,
};

export const defaultTursoIntegrations: TursoIntegrationsSettings = {
  enabled: false,
};

export const defaultIntegrations: IntegrationsSettings = {
  m365: defaultM365Integrations,
  turso: defaultTursoIntegrations,
};

export function sanitizeIntegrations(raw: unknown): IntegrationsSettings {
  if (!raw || typeof raw !== "object") return { ...defaultIntegrations };
  const obj = raw as Record<string, unknown>;
  const m365Raw = obj.m365 as Record<string, unknown> | undefined;
  const tursoRaw = obj.turso as Record<string, unknown> | undefined;
  return {
    m365: {
      enabled: typeof m365Raw?.enabled === "boolean" ? m365Raw.enabled : false,
      clientId: typeof m365Raw?.clientId === "string" ? m365Raw.clientId : undefined,
      tenantId: typeof m365Raw?.tenantId === "string" ? m365Raw.tenantId : undefined,
      sharepoint: typeof m365Raw?.sharepoint === "boolean" ? m365Raw.sharepoint : false,
      outlookContacts: typeof m365Raw?.outlookContacts === "boolean" ? m365Raw.outlookContacts : false,
      outlookCalendar: typeof m365Raw?.outlookCalendar === "boolean" ? m365Raw.outlookCalendar : false,
    },
    turso: {
      enabled: typeof tursoRaw?.enabled === "boolean" ? tursoRaw.enabled : false,
    },
  };
}
```

- [ ] **Step 2: Add `integrations` to `Settings` and `defaultSettings`**

- Find:
```ts
export type Settings = {
  language: Lang;
  holidayCountries: string[];
  storageConfig: StorageConfig;
  ai: AiConfig;
  notifications: NotificationsConfig;
  jira: JiraConfig;
  popout: { reuseWindow: boolean };
  resources: { workdayHours: number };
};
```
- Replace:
```ts
export type Settings = {
  language: Lang;
  holidayCountries: string[];
  storageConfig: StorageConfig;
  ai: AiConfig;
  notifications: NotificationsConfig;
  jira: JiraConfig;
  popout: { reuseWindow: boolean };
  resources: { workdayHours: number };
  integrations?: IntegrationsSettings;
};
```

- Find:
```ts
export const defaultSettings: Settings = {
  language: "en-US",
  holidayCountries: [],
  storageConfig: defaultStorageConfig,
  ai: defaultAiConfig,
  notifications: defaultNotificationsConfig,
  jira: defaultJiraConfig,
  popout: { reuseWindow: false },
  resources: { workdayHours: 8 },
};
```
- Replace:
```ts
export const defaultSettings: Settings = {
  language: "en-US",
  holidayCountries: [],
  storageConfig: defaultStorageConfig,
  ai: defaultAiConfig,
  notifications: defaultNotificationsConfig,
  jira: defaultJiraConfig,
  popout: { reuseWindow: false },
  resources: { workdayHours: 8 },
  integrations: defaultIntegrations,
};
```

- [ ] **Step 3: Wire the sanitizer into the settings-load path (if one exists)**

Grep `lop-app:settings` in `src/app` to find the localStorage settings read site. If found, at the parse site, after the existing parsed object is constructed, run:

```ts
parsedSettings.integrations = sanitizeIntegrations(parsedSettings.integrations);
```

If no parse site is found via Grep, the SettingsMenu function will default the field via `settings.integrations ?? defaultIntegrations` at the destructure site (added in Task 6). Skip this step in that case.

- [ ] **Step 4: Write the unit test**

Create `src/app/integrations-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
  sanitizeIntegrations,
} from "./settings-menu";

describe("sanitizeIntegrations", () => {
  it("returns defaults for undefined input", () => {
    expect(sanitizeIntegrations(undefined)).toEqual(defaultIntegrations);
  });

  it("returns defaults for null input", () => {
    expect(sanitizeIntegrations(null)).toEqual(defaultIntegrations);
  });

  it("returns defaults for non-object input", () => {
    expect(sanitizeIntegrations(42)).toEqual(defaultIntegrations);
    expect(sanitizeIntegrations("hello")).toEqual(defaultIntegrations);
  });

  it("fills missing m365 fields with false defaults", () => {
    const result = sanitizeIntegrations({});
    expect(result.m365).toEqual(defaultM365Integrations);
    expect(result.turso).toEqual(defaultTursoIntegrations);
  });

  it("preserves provided booleans", () => {
    const result = sanitizeIntegrations({ m365: { enabled: true, sharepoint: true } });
    expect(result.m365?.enabled).toBe(true);
    expect(result.m365?.sharepoint).toBe(true);
    expect(result.m365?.outlookContacts).toBe(false);
    expect(result.m365?.outlookCalendar).toBe(false);
  });

  it("preserves provided string fields", () => {
    const result = sanitizeIntegrations({
      m365: { enabled: true, clientId: "abc123", tenantId: "common" },
    });
    expect(result.m365?.clientId).toBe("abc123");
    expect(result.m365?.tenantId).toBe("common");
  });

  it("rejects non-string clientId / tenantId", () => {
    const result = sanitizeIntegrations({ m365: { enabled: true, clientId: 42 } });
    expect(result.m365?.clientId).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run tests + gates**

```bash
npx vitest run integrations-settings
npx tsc --noEmit
npm run lint
```
Expected: 7/7 PASS; tsc 0; lint 0. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-menu.tsx src/app/integrations-settings.test.ts
git commit -m "feat(integrations): Settings.integrations type + sanitizer (defaults OFF)"
```

---

## Task 2: Add `@azure/msal-browser` dependency

**Files:** Modify `package.json`, `package-lock.json`.

- [ ] **Step 1: Install the dependency**

```bash
npm install @azure/msal-browser@^4
```
Expected: package + lockfile updated. `@azure/msal-browser` appears in `dependencies`.

- [ ] **Step 2: Verify**

Read `package.json`. Confirm `@azure/msal-browser` is in `dependencies` with a ^4.x.x version.

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(deps): add @azure/msal-browser for M365 auth foundation"
```

---

## Task 3: Create `msal-config.ts` pure helper + tests (TDD)

**Files:**
- Create `src/app/msal-config.ts`
- Create `src/app/msal-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/msal-config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMsalConfig } from "./msal-config";

describe("getMsalConfig", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when no clientId is available", () => {
    expect(getMsalConfig()).toBeNull();
    expect(getMsalConfig("", "")).toBeNull();
  });

  it("uses env var when set", () => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "env-client");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "env-tenant");
    expect(getMsalConfig()).toEqual({ clientId: "env-client", tenantId: "env-tenant" });
  });

  it("falls back to settings when env vars absent", () => {
    expect(getMsalConfig("settings-client", "settings-tenant")).toEqual({
      clientId: "settings-client",
      tenantId: "settings-tenant",
    });
  });

  it("env var wins over settings", () => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "env-client");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "env-tenant");
    expect(getMsalConfig("settings-client", "settings-tenant")).toEqual({
      clientId: "env-client",
      tenantId: "env-tenant",
    });
  });

  it("defaults tenantId to 'common' when neither env nor settings provide it", () => {
    expect(getMsalConfig("settings-client")).toEqual({
      clientId: "settings-client",
      tenantId: "common",
    });
  });

  it("partial env (clientId only) uses 'common' for tenant", () => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "env-client");
    expect(getMsalConfig()).toEqual({ clientId: "env-client", tenantId: "common" });
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

```bash
npx vitest run msal-config
```
Expected: FAIL with "Cannot find module './msal-config'".

- [ ] **Step 3: Implement**

Create `src/app/msal-config.ts`:

```ts
// Config resolver for the MSAL browser bundle.
// Env vars (NEXT_PUBLIC_MSAL_*) win when set at build time; Settings
// (Integrations panel inputs) are the fallback. Returns null if no clientId
// is available from either source — the Sign-in button surfaces this state
// to the user.

export interface MsalConfig {
  clientId: string;
  tenantId: string;
}

export function getMsalConfig(
  settingsClientId?: string,
  settingsTenantId?: string,
): MsalConfig | null {
  const envClient = process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
  const envTenant = process.env.NEXT_PUBLIC_MSAL_TENANT_ID;
  const clientId = (envClient && envClient !== "" ? envClient : settingsClientId) ?? "";
  const tenantId = (envTenant && envTenant !== "" ? envTenant : settingsTenantId) ?? "common";
  if (!clientId) return null;
  return { clientId, tenantId };
}
```

- [ ] **Step 4: Confirm PASS**

```bash
npx vitest run msal-config
```
Expected: 6/6 PASS.

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/msal-config.ts src/app/msal-config.test.ts
git commit -m "feat(msal): pure config resolver — env vars then Settings fallback"
```

---

## Task 4: Create `use-ms-auth.ts` hook with lazy import + tests

**Files:**
- Create `src/app/use-ms-auth.ts`
- Create `src/app/use-ms-auth.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/app/use-ms-auth.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loginPopupMock = vi.fn();
const logoutPopupMock = vi.fn();
const acquireTokenSilentMock = vi.fn();
const getAllAccountsMock = vi.fn();
const initializeMock = vi.fn();

vi.mock("@azure/msal-browser", () => ({
  PublicClientApplication: vi.fn().mockImplementation(() => ({
    initialize: initializeMock,
    getAllAccounts: getAllAccountsMock,
    loginPopup: loginPopupMock,
    logoutPopup: logoutPopupMock,
    acquireTokenSilent: acquireTokenSilentMock,
  })),
}));

import { __pcaPromiseForTests, __resetPcaForTests, useMsAuth } from "./use-ms-auth";

const FAKE_ACCOUNT = { username: "alex@example.com", homeAccountId: "abc" } as const;

describe("useMsAuth", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MSAL_CLIENT_ID", "test-client");
    vi.stubEnv("NEXT_PUBLIC_MSAL_TENANT_ID", "common");
    __resetPcaForTests();
    loginPopupMock.mockReset();
    logoutPopupMock.mockReset();
    acquireTokenSilentMock.mockReset();
    getAllAccountsMock.mockReset();
    initializeMock.mockReset();
    initializeMock.mockResolvedValue(undefined);
    getAllAccountsMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not initialize MSAL when enabled is false (lazy-load contract)", async () => {
    const { result } = renderHook(() => useMsAuth(false));
    expect(__pcaPromiseForTests()).toBeNull();
    expect(result.current.account).toBeNull();
    expect(result.current.ready).toBe(false);
  });

  it("initializes MSAL when enabled flips to true", async () => {
    const { result, rerender } = renderHook(({ on }) => useMsAuth(on), {
      initialProps: { on: false },
    });
    expect(__pcaPromiseForTests()).toBeNull();
    rerender({ on: true });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(__pcaPromiseForTests()).not.toBeNull();
    expect(initializeMock).toHaveBeenCalledTimes(1);
  });

  it("exposes cached account on init", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
  });

  it("signIn calls loginPopup with User.Read scope", async () => {
    loginPopupMock.mockResolvedValue({ account: FAKE_ACCOUNT });
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.signIn(); });
    expect(loginPopupMock).toHaveBeenCalledWith({ scopes: ["User.Read"] });
    expect(result.current.account).toEqual(FAKE_ACCOUNT);
  });

  it("signOut calls logoutPopup and clears the account", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    logoutPopupMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    await act(async () => { await result.current.signOut(); });
    expect(logoutPopupMock).toHaveBeenCalledWith({ account: FAKE_ACCOUNT });
    expect(result.current.account).toBeNull();
  });

  it("acquireToken returns null when no account", async () => {
    getAllAccountsMock.mockReturnValue([]);
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const token = await result.current.acquireToken(["Files.ReadWrite"]);
    expect(token).toBeNull();
  });

  it("acquireToken returns access token from acquireTokenSilent", async () => {
    getAllAccountsMock.mockReturnValue([FAKE_ACCOUNT]);
    acquireTokenSilentMock.mockResolvedValue({ accessToken: "fake-token" });
    const { result } = renderHook(() => useMsAuth(true));
    await waitFor(() => expect(result.current.account).toEqual(FAKE_ACCOUNT));
    const token = await result.current.acquireToken(["Files.ReadWrite"]);
    expect(token).toBe("fake-token");
    expect(acquireTokenSilentMock).toHaveBeenCalledWith({
      scopes: ["Files.ReadWrite"],
      account: FAKE_ACCOUNT,
    });
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

```bash
npx vitest run use-ms-auth
```
Expected: FAIL — "Cannot find module './use-ms-auth'".

- [ ] **Step 3: Implement the hook**

Create `src/app/use-ms-auth.ts`:

```ts
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
      setReady(false);
      setAccount(null);
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
```

- [ ] **Step 4: Confirm PASS**

```bash
npx vitest run use-ms-auth
```
Expected: 7/7 PASS.

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-ms-auth.ts src/app/use-ms-auth.test.tsx
git commit -m "feat(msal): useMsAuth() hook with lazy MSAL import + token API"
```

---

## Task 5: i18n EN + DE

**Files:**
- Modify `src/app/i18n.ts`
- Modify `src/app/i18n.de.ts`

Runs BEFORE Task 6 (UI integration) so the i18n key union closes before the Settings panel renders any new keys.

- [ ] **Step 1: Add EN entries to `i18n.ts`**

READ. Add the following keys near other Settings-related keys (match existing indentation, quote style, trailing comma):

```ts
integrations: "Integrations",
integrationsM365: "Microsoft 365 integration",
integrationsM365Hint: "Sign in with Microsoft to enable SharePoint, Outlook contacts, and calendar features.",
integrationsM365ClientId: "Azure AD Client ID",
integrationsM365TenantId: "Tenant ID",
integrationsM365ClientIdPlaceholder: "e.g. a1b2c3d4-…-f4",
integrationsM365TenantIdPlaceholder: "common, organizations, or tenant GUID",
integrationsM365SignIn: "Sign in with Microsoft",
integrationsM365SignedInAs: "Signed in as",
integrationsM365SignOut: "Sign out",
integrationsM365NeedsConfig: "Enter Client ID to sign in.",
integrationsM365SignInFailed: "Sign-in failed. Check console for details.",
integrationsSharepoint: "SharePoint storage",
integrationsOutlookContacts: "Outlook contacts",
integrationsOutlookCalendar: "Outlook calendar",
integrationsTurso: "Turso storage backend",
integrationsComingSoon: "Available in 0.22.0+",
versionHighlightM365Auth: "Microsoft 365 integration foundation: sign in with your work account to unlock upcoming SharePoint, Outlook contacts, and calendar features. All integrations default to OFF.",
```

Do NOT touch `APP_HIGHLIGHT_KEYS` here — it lives in `version.ts`; Task 7 handles it.

- [ ] **Step 2: Add DE entries to `i18n.de.ts`**

```ts
integrations: "Integrationen",
integrationsM365: "Microsoft-365-Integration",
integrationsM365Hint: "Mit Microsoft anmelden, um SharePoint-, Kontakte- und Kalender-Funktionen zu aktivieren.",
integrationsM365ClientId: "Azure-AD-Client-ID",
integrationsM365TenantId: "Tenant-ID",
integrationsM365ClientIdPlaceholder: "z. B. a1b2c3d4-…-f4",
integrationsM365TenantIdPlaceholder: "common, organizations oder Tenant-GUID",
integrationsM365SignIn: "Mit Microsoft anmelden",
integrationsM365SignedInAs: "Angemeldet als",
integrationsM365SignOut: "Abmelden",
integrationsM365NeedsConfig: "Client-ID eingeben, um sich anzumelden.",
integrationsM365SignInFailed: "Anmeldung fehlgeschlagen. Details in der Konsole.",
integrationsSharepoint: "SharePoint-Speicher",
integrationsOutlookContacts: "Outlook-Kontakte",
integrationsOutlookCalendar: "Outlook-Kalender",
integrationsTurso: "Turso-Speicher",
integrationsComingSoon: "Verfügbar ab 0.22.0",
versionHighlightM365Auth: "Microsoft-365-Grundlage: Mit dem Arbeitskonto anmelden, um künftige SharePoint-, Outlook-Kontakte- und Kalender-Funktionen freizuschalten. Alle Integrationen sind standardmäßig deaktiviert.",
```

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```
Expected: tsc 0; lint 0; full suite green. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(integrations): i18n EN + DE for M365 auth foundation"
```

---

## Task 6: Add Integrations section to `settings-menu.tsx`

**Files:** Modify `src/app/settings-menu.tsx` and `src/app/settings-menu.test.tsx`.

- [ ] **Step 1: Add hook import**

READ `src/app/settings-menu.tsx`. Add import near the top of the file:

```ts
import { useMsAuth } from "./use-ms-auth";
```

- [ ] **Step 2: Derive integrations + connect auth hook**

Inside the `SettingsMenu` function, after the existing `useTheme` line (~L132), add:

```ts
const integrations = settings.integrations ?? defaultIntegrations;
const m365 = integrations.m365 ?? defaultM365Integrations;
const turso = integrations.turso ?? defaultTursoIntegrations;
const auth = useMsAuth(m365.enabled);
const envClientIdSet = !!process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
const envTenantIdSet = !!process.env.NEXT_PUBLIC_MSAL_TENANT_ID;

function updateM365(patch: Partial<M365IntegrationsSettings>) {
  onChange({
    ...settings,
    integrations: {
      ...integrations,
      m365: { ...m365, ...patch },
    },
  });
}
```

- [ ] **Step 3: Add the Integrations section JSX**

In the rendered JSX, after the existing last section in the menu's vertical stack and BEFORE the menu's closing wrapper, insert:

```tsx
<div className="rounded-md border border-line bg-surface p-3">
  <h3 className="mb-2 text-sm font-semibold text-foreground">
    {t(lang, "integrations")}
  </h3>

  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={m365.enabled}
      onChange={(e) => updateM365({ enabled: e.target.checked })}
      className="h-4 w-4"
    />
    <span>{t(lang, "integrationsM365")}</span>
  </label>
  <p className="mt-1 text-xs text-muted-foreground">
    {t(lang, "integrationsM365Hint")}
  </p>

  {m365.enabled && (
    <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
      {!envClientIdSet && (
        <label className="block text-xs">
          <span className="text-muted-foreground">
            {t(lang, "integrationsM365ClientId")}
          </span>
          <input
            type="text"
            value={m365.clientId ?? ""}
            onChange={(e) => updateM365({ clientId: e.target.value })}
            placeholder={t(lang, "integrationsM365ClientIdPlaceholder")}
            className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
          />
        </label>
      )}
      {!envTenantIdSet && (
        <label className="block text-xs">
          <span className="text-muted-foreground">
            {t(lang, "integrationsM365TenantId")}
          </span>
          <input
            type="text"
            value={m365.tenantId ?? ""}
            onChange={(e) => updateM365({ tenantId: e.target.value })}
            placeholder={t(lang, "integrationsM365TenantIdPlaceholder")}
            className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
          />
        </label>
      )}

      <div className="flex items-center gap-2">
        {auth.account ? (
          <>
            <span className="text-xs text-foreground">
              {t(lang, "integrationsM365SignedInAs")} {auth.account.username}
            </span>
            <button
              type="button"
              onClick={() => { void auth.signOut(); }}
              className="rounded border border-line bg-surface px-2 py-1 text-xs hover:bg-surface-muted"
            >
              {t(lang, "integrationsM365SignOut")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => { void auth.signIn(); }}
            disabled={!envClientIdSet && !m365.clientId}
            title={
              !envClientIdSet && !m365.clientId
                ? t(lang, "integrationsM365NeedsConfig")
                : undefined
            }
            className="rounded border border-AIPM-dark-blue bg-AIPM-dark-blue px-2 py-1 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "integrationsM365SignIn")}
          </button>
        )}
      </div>

      <fieldset className="mt-3 border-t border-line pt-2">
        <legend className="text-xs text-muted-foreground">
          {t(lang, "integrationsComingSoon")}
        </legend>
        {(
          [
            ["integrationsSharepoint"],
            ["integrationsOutlookContacts"],
            ["integrationsOutlookCalendar"],
          ] as const
        ).map(([labelKey]) => (
          <label
            key={labelKey}
            className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"
            title={t(lang, "integrationsComingSoon")}
          >
            <input
              type="checkbox"
              disabled
              checked={false}
              className="h-4 w-4 cursor-not-allowed"
              readOnly
            />
            <span>{t(lang, labelKey)}</span>
          </label>
        ))}
      </fieldset>
    </div>
  )}

  <label
    className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"
    title={t(lang, "integrationsComingSoon")}
  >
    <input
      type="checkbox"
      disabled
      checked={turso.enabled}
      readOnly
      className="h-4 w-4 cursor-not-allowed"
    />
    <span>{t(lang, "integrationsTurso")}</span>
  </label>
</div>
```

- [ ] **Step 4: Add tests**

READ `src/app/settings-menu.test.tsx`. Append:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsMenu, defaultSettings } from "./settings-menu";

vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({
    account: null,
    ready: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    acquireToken: async () => null,
  }),
}));

const baseProps = {
  settings: defaultSettings,
  onChange: vi.fn(),
  storageDescription: null,
  storageReady: true,
  onPickStorageFile: async () => {},
  onOpenStorageFile: async () => {},
  onGrantStorageWrite: async () => {},
};

describe("SettingsMenu — Integrations section", () => {
  it("renders the M365 master toggle defaulting OFF", async () => {
    const user = userEvent.setup();
    render(<SettingsMenu {...baseProps} />);
    // The menu may be collapsed by default; if so, open it first.
    const openers = screen.queryAllByRole("button");
    if (openers[0]) await user.click(openers[0]);
    const checkbox = await screen.findByRole("checkbox", { name: /microsoft 365 integration/i });
    expect(checkbox).not.toBeChecked();
  });

  it("renders sub-toggles disabled when M365 is enabled", async () => {
    const user = userEvent.setup();
    const settings = {
      ...defaultSettings,
      integrations: {
        m365: {
          enabled: true,
          sharepoint: false,
          outlookContacts: false,
          outlookCalendar: false,
        },
        turso: { enabled: false },
      },
    };
    render(<SettingsMenu {...baseProps} settings={settings} />);
    const openers = screen.queryAllByRole("button");
    if (openers[0]) await user.click(openers[0]);
    const sharepointCheckbox = await screen.findByRole("checkbox", { name: /sharepoint storage/i });
    expect(sharepointCheckbox).toBeDisabled();
    const tursoCheckbox = await screen.findByRole("checkbox", { name: /turso storage backend/i });
    expect(tursoCheckbox).toBeDisabled();
  });
});
```

If `SettingsMenu`'s open mechanism differs (e.g. it's controlled by the `open` state internally with a specific button label), inspect the existing tests in `settings-menu.test.tsx` for the canonical opener pattern and adapt.

- [ ] **Step 5: Run tests + gates**

```bash
npx vitest run settings-menu
npx tsc --noEmit
npm run lint
```
Expected: PASS, 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-menu.tsx src/app/settings-menu.test.tsx
git commit -m "feat(integrations): Integrations panel — M365 toggle + sign-in + disabled sub-toggles"
```

---

## Task 7: Release 0.21.0

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.21.0"` (currently `"0.20.0"`). Keep `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`. Add a new top-of-file comment block ABOVE the existing `// 0.20.0 …` block:

```ts
// 0.21.0 lays the Microsoft 365 integration foundation — an Integrations
// panel in Settings, a Sign in with Microsoft button gated behind a master
// toggle that defaults OFF, and the lazy-loaded MSAL bundle that future
// SharePoint storage, Outlook contacts, and Outlook calendar features
// (0.22.0+) will build on. The MSAL bundle is NEVER loaded at cold start
// when integrations are off.
```

Append `"versionHighlightM365Auth"` as the LAST entry of `APP_HIGHLIGHT_KEYS`. Match the tuple's `as const` style.

- [ ] **Step 2: CHANGELOG** — READ to match style; add a new `[0.21.0] — 2026-05-28 "Jemisin"` entry ABOVE the `[0.20.0]` entry:

```markdown
## [0.21.0] — 2026-05-28 "Jemisin"

### Added
- Microsoft 365 integration foundation: a new Integrations section in Settings with a "Sign in with Microsoft" button gated behind a master toggle (defaults OFF). When the toggle is OFF, the `@azure/msal-browser` bundle is not loaded — zero cold-start cost. Configuration resolves from `NEXT_PUBLIC_MSAL_CLIENT_ID` / `NEXT_PUBLIC_MSAL_TENANT_ID` env vars first, then falls back to Client ID / Tenant inputs in the panel. Sub-toggles for SharePoint storage, Outlook contacts, and Outlook calendar render disabled with "Available in 0.22.0+" — they will be wired in subsequent minor releases.
- A Turso storage-backend toggle is present in the Integrations panel (disabled, "Available in 0.22.0+") — the Turso backend itself is the T1 sub-project, tracked separately.
- New version highlight: "Microsoft 365 auth foundation" (`versionHighlightM365Auth`) in both EN and DE.
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
```
Expected: tsc 0; lint 0; all suites pass; coverage ≥ 70%. Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "docs(release): 0.21.0 Jemisin — M365 auth foundation (defaults OFF)"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Confirm:

1. **Scope:** only `src/app/settings-menu.tsx`, `src/app/settings-menu.test.tsx`, `src/app/integrations-settings.test.ts`, `src/app/msal-config.ts`, `src/app/msal-config.test.ts`, `src/app/use-ms-auth.ts`, `src/app/use-ms-auth.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json` touched. Anything else = flag.
2. **Settings type:** `Settings.integrations` field present; sanitizer fills missing with `false` defaults.
3. **Helpers:** `msal-config.ts` returns `null` when no clientId; env-then-settings; 6 tests pass.
4. **Hook:** `useMsAuth(enabled)` does NOT trigger `import("@azure/msal-browser")` when `enabled=false` — verified by the `__pcaPromiseForTests` assertion. 7 tests pass.
5. **UI:** Integrations panel renders the M365 master toggle defaulting OFF; sub-toggles (SharePoint / Contacts / Calendar / Turso) render disabled with the "Available in 0.22.0+" tooltip; Client ID / Tenant ID inputs only render when env vars are absent.
6. **i18n:** EN and DE both contain every new key + `versionHighlightM365Auth`.
7. **Release metadata:** `APP_VERSION === "0.21.0"`; `APP_BUILD_DATE` and `// Jemisin milestone` UNCHANGED; `APP_HIGHLIGHT_KEYS` ends with `"versionHighlightM365Auth"`; CHANGELOG `[0.21.0]` entry present.
8. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0 errors; `npx vitest run` ≥ 940 passing (927 + ~13 new); coverage ≥ 70%.

After approval, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Settings.integrations type + sanitizer → Task 1 ✓
- `@azure/msal-browser` dependency → Task 2 ✓
- `msal-config.ts` pure helper + tests → Task 3 ✓
- `use-ms-auth.ts` lazy-import hook + tests + lazy-load assertion → Task 4 ✓
- i18n EN + DE → Task 5 ✓
- Integrations panel UI (M365 master, sign-in, disabled sub-toggles) → Task 6 ✓
- Release 0.21.0 → Task 7 ✓
- Non-goals (no M2/M3/M4 functionality, no Turso, no multi-account, no custom token refresh) → none touched ✓

**Placeholder scan:** No TBD/TODO. Test code is complete and runnable. Task 6 Step 4 includes a "if menu opener differs, adapt" note — that's adaptive guidance, not a placeholder. Task 1 Step 3 conditionalizes on whether a Grep finds the parse site — that's investigation, not a stub.

**Type consistency:** `M365IntegrationsSettings`, `TursoIntegrationsSettings`, `IntegrationsSettings`, `MsalConfig`, `UseMsAuthResult` all defined once, reused consistently. Every boolean default is `false`. `getMsalConfig` always returns `null` or `{ clientId: string; tenantId: string }` — never undefined `tenantId` (defaults to `"common"`).

**Ordering note:** Task 5 (i18n) runs after Tasks 1–4 (which don't reference i18n keys) and BEFORE Task 6 (the UI). This closes the i18n key union before the panel renders the new keys. Task 6 depends on Task 1's types + Task 4's hook + Task 5's keys. Task 7 (release) is last. Subagent-driven runs sequentially → correct.
