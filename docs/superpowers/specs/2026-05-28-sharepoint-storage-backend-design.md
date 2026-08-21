# SharePoint Storage Backend — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.22.0-sharepoint-storage-backend`
**Context:** Sub-project **M2** — second of the 5-piece Microsoft 365 + Turso request (M1 M365 auth foundation shipped at 0.21.0; M3 Outlook contacts and M4 Outlook calendar follow; T1 Turso is independent). Implements the `sp-json` and `sp-csv` StorageKinds that were already sketched as types in `storage.ts:116–144` but have no backend implementation. Builds directly on M1's `useMsAuth()` + `acquireToken()`. Ships as **0.22.0 "Jemisin"** with a new highlight key.

## Goal

Let the user store their lop-app workspace as a single JSON or CSV file on SharePoint via Microsoft Graph, reusing the M1 MSAL foundation. The flow:

1. User toggles M365 master ON in Settings → Integrations (M1).
2. User toggles SharePoint sub-toggle ON (M2 makes it interactive — was disabled in M1).
3. User signs in to Microsoft (M1's `signIn()` flow).
4. User opens Storage Configuration, picks `SharePoint JSON` or `SharePoint CSV` from the StorageKind picker, pastes the SharePoint file URL.
5. Subsequent loads/saves go through Graph (no user interaction beyond an incremental-consent popup for `Files.ReadWrite` on first SP access).

## Non-goals

- No Graph drive picker UI (drive list, folder tree browser) — paste-URL only.
- No OneDrive-for-Business support (`{tenant}-my.sharepoint.com` URLs) — SharePoint Sites only.
- No ETag-based optimistic concurrency — last-write-wins, matching the existing local-json semantics.
- No multi-file workspace shape — single JSON/CSV mirror of the existing local-json/local-csv shape.
- No migration tooling between storage backends — user manually moves data if switching kinds (today's lop-app behavior).
- No write-back of OneDrive-style paths.

## Architecture

### `src/app/sharepoint-backend.ts` (new)

```ts
import type { StorageBackend, Workspace } from "./storage";

export interface SpFileLocation {
  hostname: string;     // contoso.sharepoint.com
  sitePath: string;     // /sites/Alpha
  itemPath: string;     // lop/workspace.json
}

/** Parse a SharePoint file URL into Graph-addressable components.
 *  Supports the standard SharePoint Sites pattern:
 *    https://<host>/sites/<site>/<library>/<path>/<file>
 *  Decodes %20 / + escapes. Strips query string. Returns null on malformed
 *  input or unsupported URL shape (e.g. *-my.sharepoint.com OneDrive). */
export function parseSharePointFileUrl(url: string): SpFileLocation | null;

export class SharePointBackend implements StorageBackend {
  constructor(
    config: { kind: "sp-json" | "sp-csv" } & SpFileLocation,
    acquireToken: (scopes: readonly string[]) => Promise<string | null>,
  );

  readonly kind: "sp-json" | "sp-csv";
  async load(): Promise<Workspace>;
  async save(workspace: Workspace): Promise<void>;
  async describe(): Promise<string | null>;
  async isReady(): Promise<boolean>;
}
```

**HTTP details:**

- Load: `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}:/drive/root:/{itemPath}:/content`
  - 200 → response body is the raw file. Parse JSON (sp-json) or CSV (sp-csv via existing `workspaceFromCsv` decoder). Return `Workspace`.
  - 404 → return default empty Workspace (first save will create the file).
  - 401 → throw `StorageNotReadyError("Sign-in expired. Re-authenticate from Settings.")`.
  - 403 → throw `StorageNotReadyError("Permission denied. The signed-in user lacks read access to this file.")`.
  - 5xx → throw `Error("SharePoint returned {status}. Try again later.")`.
- Save: `PUT` to the same URL.
  - Body: `JSON.stringify(workspace)` (sp-json) or `workspaceToCsv(workspace)` (sp-csv). Content-Type: `application/json` or `text/csv;charset=utf-8`.
  - 200/201 → success. No ETag tracking.
  - 401/403/5xx → same as load.
- Authorization: `Bearer ${await acquireToken(["Files.ReadWrite"])}`.

The `acquireToken` callback is M1's `useMsAuth().acquireToken`. MSAL handles incremental consent — first SP access pops the Files.ReadWrite consent dialog; subsequent calls use the cached token.

### Update `src/app/storage.ts`

- **Drop pre-existing fields** from sp-* StorageConfig variants (these were sketched before M1):
  - Before: `{ kind, clientId, tenantId, siteUrl, filePath }`
  - After: `{ kind, hostname, sitePath, itemPath }`
- **`createBackend(config, deps?)`**: gain optional `deps: { acquireToken: (scopes: readonly string[]) => Promise<string | null> }`. SharePoint cases require it; throws `StorageNotReadyError("M365 sign-in required")` if absent OR if `acquireToken` returns null at call time.
- **`useStorageBackend`** hook: pulls `useMsAuth(integrations.m365.enabled)` and passes `acquireToken` into `createBackend`.

### Update `src/app/storage-config.tsx`

- Add `{ kind: "sp-json", labelKey: "storageSpJson" }` and `{ kind: "sp-csv", labelKey: "storageSpCsv" }` to the `STORAGE_OPTIONS` list.
- Gate: sp-* options render only when `integrations.m365.enabled && integrations.m365.sharepoint`. Otherwise, show a hint pointing the user to Settings → Integrations.
- When picked and not signed in: show "Sign in to Microsoft to use SharePoint storage" with a button that triggers `signIn()`.
- When picked and signed in: single text input for the SharePoint file URL.
  - Parse on blur (`parseSharePointFileUrl`).
  - On success: green checkmark + "Will sync to {filename} on {sitePath}".
  - On failure: red "Could not parse this URL. Use the full SharePoint file URL." with example.
  - Persist parsed components into the StorageConfig — discard the raw URL.

### Update `src/app/settings-menu.tsx`

- SharePoint sub-toggle becomes interactive — remove M1's `disabled` + "Available in 0.22.0+" tooltip.
- Toggle reflects/persists `integrations.m365.sharepoint`.
- The other two sub-toggles (Outlook contacts, Outlook calendar) stay disabled (M3/M4 not yet shipped).
- Turso toggle stays disabled (T1 not yet shipped).

### Concurrency

**Last-write-wins, no If-Match.** Reasoning:
- The existing local-json backend is last-write-wins.
- lop-app is single-user-mostly local-first; multi-tab editing is the only conflict path.
- Adding ETag tracking is non-trivial state across load/save cycles (need to remember last-seen ETag, retry on 412 Precondition Failed, decide reload vs overwrite).

Acceptable trade-off for MVP. Future enhancement if multi-tab editing causes lost updates.

### Error model

- **Parse failure** → inline form error, no save attempt.
- **Token unavailable** (signed out) → `StorageNotReadyError("Sign in to Microsoft first")`.
- **401 from Graph** → `StorageNotReadyError("Sign-in expired. Re-authenticate from Settings.")`.
- **403 from Graph** → `StorageNotReadyError("Permission denied. The signed-in user lacks access to this file.")`.
- **404 on load** → return default empty Workspace. First save creates the file.
- **5xx / network** → throw with friendly hint; existing storage error boundary handles UX.

## URL parsing details

Supported pattern (the URL shown in the SharePoint browser address bar after navigating to a file's container folder, then clicking the file):

```
https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/lop/workspace.json
                ↓
{
  hostname: "contoso.sharepoint.com",
  sitePath: "/sites/Alpha",
  itemPath: "Shared Documents/lop/workspace.json"
}
```

Implementation:

1. `new URL(input)` — validate it's a real URL. Catch SyntaxError → return null.
2. Reject if hostname doesn't end in `.sharepoint.com`.
3. Reject if hostname matches `*-my.sharepoint.com` (OneDrive for Business is out of scope).
4. Pathname split: first 3 segments form sitePath (`/sites/<name>`); remainder forms itemPath.
5. Reject if first segment isn't `sites`.
6. `decodeURIComponent` each segment to handle %20 / + escapes.
7. Strip query + fragment. (Some SharePoint URLs add `?web=1` or similar.)

Edge cases:
- Trailing slash → reject (must point at a file).
- Empty itemPath → reject.
- `https` only — reject `http://`.

## i18n keys (EN + DE)

| Key | EN | DE |
|---|---|---|
| `storageSpJson` | "SharePoint JSON" | "SharePoint JSON" |
| `storageSpCsv` | "SharePoint CSV" | "SharePoint CSV" |
| `spStorageHint` | "Paste the full URL of the SharePoint file you want to use." | "Vollständige URL der SharePoint-Datei einfügen." |
| `spStorageUrlPlaceholder` | "https://your-tenant.sharepoint.com/sites/.../workspace.json" | "https://your-tenant.sharepoint.com/sites/.../workspace.json" |
| `spStorageUrlLabel` | "SharePoint file URL" | "SharePoint-Datei-URL" |
| `spStorageNeedsM365` | "Enable Microsoft 365 in Settings → Integrations first." | "Microsoft 365 zuerst in Einstellungen → Integrationen aktivieren." |
| `spStorageNeedsSignIn` | "Sign in to Microsoft to use SharePoint storage." | "Bei Microsoft anmelden, um SharePoint-Speicher zu nutzen." |
| `spStorageNeedsToggle` | "Enable SharePoint storage in Settings → Integrations first." | "SharePoint-Speicher zuerst in Einstellungen → Integrationen aktivieren." |
| `spStorageInvalidUrl` | "Could not parse this URL. Use the full SharePoint file URL." | "URL konnte nicht ausgewertet werden. Vollständige SharePoint-Datei-URL verwenden." |
| `spStorageDescribe` | "{filename} on {sitePath}" | "{filename} auf {sitePath}" |
| `spStoragePermissionDenied` | "Permission denied. The signed-in user lacks access to this file." | "Zugriff verweigert. Der angemeldete Benutzer hat keinen Zugriff auf diese Datei." |
| `spStorageSignInExpired` | "Sign-in expired. Re-authenticate from Settings." | "Anmeldung abgelaufen. Erneut in den Einstellungen anmelden." |
| `versionHighlightSharepointStorage` | "SharePoint storage backend: save your workspace as a JSON or CSV file in a SharePoint Sites library — paste the file URL in Storage Configuration after enabling SharePoint in Settings → Integrations." | "SharePoint-Speicher: Arbeitsbereich als JSON- oder CSV-Datei in einer SharePoint-Sites-Bibliothek speichern — Datei-URL in der Speicherkonfiguration einfügen, nachdem SharePoint in Einstellungen → Integrationen aktiviert wurde." |

## Testing

### Unit tests

**`parseSharePointFileUrl`** (in `sharepoint-backend.test.ts`):
- happy path returns correct `{hostname, sitePath, itemPath}`.
- decodes `%20` to space in sitePath and itemPath.
- strips query string.
- strips fragment.
- rejects `http://` URLs.
- rejects URLs without `/sites/` segment.
- rejects `*-my.sharepoint.com` (OneDrive).
- rejects malformed URLs (not a URL).
- rejects trailing-slash (pointing at folder, not file).

**`SharePointBackend`** (in `sharepoint-backend.test.ts`):
- mocks global `fetch` + `acquireToken`.
- load success → 200 with JSON body → returns parsed Workspace.
- load 404 → returns default empty Workspace.
- load 401 → throws `StorageNotReadyError` with reauthenticate message.
- load 403 → throws `StorageNotReadyError` with permission-denied message.
- load 500 → throws with friendly message.
- save success → 201 → no throw.
- save constructs correct PUT URL + body + Content-Type for sp-json.
- save constructs correct PUT URL + body + Content-Type for sp-csv.
- `acquireToken` returns null → load/save throws `StorageNotReadyError("Sign in to Microsoft first")`.
- describe returns "<filename> on <sitePath>".
- isReady returns false when acquireToken returns null.
- isReady returns true when token available.

**`createBackend`** (extend existing `storage.test.ts`):
- sp-json case requires `deps.acquireToken`; throws if absent.
- sp-csv case requires `deps.acquireToken`; throws if absent.

### Integration

- `storage-config.test.tsx`: sp-* options gated on M365 master + SharePoint sub-toggle.
- `settings-menu.test.tsx`: SharePoint sub-toggle is interactive (no longer disabled).

### Gates

- `npx tsc --noEmit` 0; `npm run lint` 0 errors; full suite green (existing 949 + ~25 new); `npm run test:coverage` ≥ 70%.

## Release

Minor → **0.22.0 "Jemisin"** (codename retained — same Jemisin batch). New highlight key `versionHighlightSharepointStorage`.

- `src/app/version.ts`: `APP_VERSION = "0.22.0"`; `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`; new top-of-file comment; append `"versionHighlightSharepointStorage"` as the LAST entry of `APP_HIGHLIGHT_KEYS`.
- `src/app/i18n.ts` + `i18n.de.ts`: all new keys + the highlight key.
- `CHANGELOG.md` `[0.22.0] — 2026-05-28 "Jemisin"` entry.
- No new dependencies (Graph is accessed via the built-in `fetch` API + M1's `@azure/msal-browser` for tokens).
- No DESIGN-TOKENS change.

## Plan shape (preview — 8 tasks)

1. `parseSharePointFileUrl` pure helper + 9 unit tests (TDD).
2. `SharePointBackend` class + tests (mocked fetch + acquireToken).
3. Update `storage.ts`: drop clientId/tenantId from sp-* StorageConfig; `createBackend(config, deps?)` dispatch for sp-* with required deps; update `useStorageBackend` to pass `acquireToken`.
4. Settings → Integrations: enable the SharePoint sub-toggle (remove disabled + tooltip).
5. `storage-config.tsx`: add sp-* options gated on M365 + sub-toggle; URL input + parse-on-blur; sign-in prompt; status messages.
6. i18n EN + DE for all new keys.
7. Integration tests (storage-config gating, settings-menu sub-toggle interactive).
8. Release 0.22.0 (version.ts, CHANGELOG).

## What this closes

After 0.22.0 ships, M2 is done. The 5-piece request status:
- M1 M365 auth foundation → 0.21.0 ✅
- M2 SharePoint storage backend → 0.22.0 (this) ✅
- M3 Outlook contacts → next on the M-cluster path
- M4 Outlook calendar → after M3 (or in parallel)
- T1 Turso storage backend → independent, can run any time

The deferred S4 PDF export (from the prior UI batch) is still on hold.
