# Outlook Contacts Import — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.23.0-outlook-contacts`
**Context:** Sub-project **M3** — third piece of the 5-sub-project Microsoft 365 + Turso request. Builds on M1 (MSAL + Graph foundation, 0.21.0) and reuses the Graph error-handling patterns established by M2 (SharePoint storage, 0.22.0). Ships as **0.23.0 "Jemisin"** (milestone codename retained) with a new highlight key. M4 (Outlook calendar) and T1 (Turso) remain independent.

## Goal

Let a signed-in Microsoft 365 user import their Outlook personal contacts (Graph `/me/contacts`, `Contacts.Read` scope) into lop-app. Imported contacts land in **both** people surfaces:

- The rich **Resource Directory** (`Resource` records: name, email, title, department, phone, company, location, birthday) — best field-fit with Graph contact objects.
- The lightweight **Contacts address book** that feeds assignee autocomplete (`{name, email}` pairs).

Import is a **preview-and-pick** flow: fetch, show a deduped checkbox list, confirm. Contacts that already exist (matched by email) are pre-checked and, on import, **update** the existing record's mutable fields (the "offer to update" rule) — the user can uncheck any they want left alone.

## Non-goals

- No write-back to Outlook (read-only `Contacts.Read` scope).
- No org-directory (`/users`) or People-API (`/me/people`) import — personal contacts (`/me/contacts`) only.
- No background/auto-sync — import is an explicit, user-triggered action.
- No contact-group / category filtering — all contacts are fetched; the user picks per-row.
- No M4 (calendar) work — the Outlook **calendar** sub-toggle stays gated "Available in 0.24.0+".

## Architecture

Four units plus wiring. The pure core (`outlook-contacts.ts`) holds all the mapping/merge logic and is exhaustively unit-tested; the hook isolates Graph I/O; the modal is presentational; `task-manager` coordinates.

### 1. `src/app/outlook-contacts.ts` (new, pure)

The testable core — no React, no `window`, token injected by callers.

```ts
import type { Resource } from "./types";
import { nextId } from "./resource-foundation";

/** Raw Graph /me/contacts item (subset we $select). */
export interface GraphContact {
  id?: string;
  displayName?: string | null;
  givenName?: string | null;
  surname?: string | null;
  emailAddresses?: { address?: string | null }[] | null;
  jobTitle?: string | null;
  department?: string | null;
  companyName?: string | null;
  businessPhones?: (string | null)[] | null;
  mobilePhone?: string | null;
  officeLocation?: string | null;
  birthday?: string | null; // ISO; year 0001 == "no year"
}

/** Normalized, app-facing shape. */
export interface OutlookContact {
  /** Graph contact id — stable React key for the preview list. */
  sourceId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;        // normalized lower-case; may be "" (name-only contact)
  title?: string;
  department?: string;
  company?: string;
  phone?: string;
  location?: string;
  birthday?: string;    // "YYYY-MM-DD" or "MM-DD"
}
```

- `mapGraphContact(raw: GraphContact, index: number): OutlookContact | null`
  - Name: `givenName`/`surname` when present; otherwise split `displayName` on first whitespace (`displayName` → firstName=token[0], lastName=rest). When all three are blank, fall back to the email local-part as `displayName`.
  - `email`: `emailAddresses?.[0]?.address`, trimmed + lower-cased (`sanitizeEmail` from `sanitize.ts`); `""` when absent.
  - `phone`: `businessPhones?.[0] ?? mobilePhone`.
  - `title`←`jobTitle`, `department`, `company`←`companyName`, `location`←`officeLocation` (each trimmed; omitted when blank).
  - `birthday`: `parseGraphBirthday(raw.birthday)`.
  - `sourceId`: `raw.id ?? \`graph-${index}\`` (index fallback keeps keys unique if Graph omits id).
  - Returns `null` when there is neither a usable name nor an email (nothing worth importing).

- `parseGraphBirthday(iso?: string | null): string | undefined`
  - Graph birthday is `"1974-07-04T00:00:00Z"`, or year `0001` when the user stored only month/day.
  - Parse the leading `YYYY-MM-DD`. When `YYYY === "0001"` → return `"MM-DD"`. Otherwise return `"YYYY-MM-DD"`. Invalid/missing → `undefined`. (Matches `Resource.birthday` forms accepted by `birthdays.ts`.)

- `mergeImportedResources(existing: readonly Resource[], selected: readonly OutlookContact[]): Resource[]`
  - Build `byEmail = Map<normalizedEmail, Resource>` from `existing` (skip resources with no email).
  - For each selected contact:
    - **Match (email non-empty and present in map):** produce an updated copy that overwrites `firstName`, `lastName`, `title`, `department`, `businessPhone` (←`phone`), `company`, `location`, `birthday` from the contact, **preserving** `id`, `roleId`, `utilizationMode`, `utilization`, `absenceOverride`, `active`, `notes`. (Fields the contact leaves blank overwrite to `undefined` — "offer to update" means the latest Outlook value wins, including clearing.)
    - **No match:** append a new `Resource` with `id: nextId(<running list>)`, `roleId: null`, `utilizationMode: "percent"` (the app default), `utilization: {}`, plus the mapped fields.
  - Returns a brand-new array (immutable). New ids are assigned against the growing list so a multi-add batch gets distinct ids.

- `contactsFromImported(selected: readonly OutlookContact[]): { name: string; email: string }[]`
  - Maps each contact with a non-empty `displayName` to `{ name: displayName, email }`. Caller feeds these through `upsertContact` to seed the assignee address book.

### 2. `src/app/use-outlook-contacts.ts` (new hook)

```ts
export interface UseOutlookContactsResult {
  fetchContacts: () => Promise<OutlookContact[]>;
}
export function useOutlookContacts(
  acquireToken: (scopes: readonly string[]) => Promise<string | null>,
): UseOutlookContactsResult;
```

- `fetchContacts()`:
  - `const token = await acquireToken(["Contacts.Read"])` → `null` throws `Error` with key `outlookSignInRequired`.
  - Paged GET starting at
    `https://graph.microsoft.com/v1.0/me/contacts?$top=100&$select=id,displayName,givenName,surname,emailAddresses,jobTitle,department,companyName,businessPhones,mobilePhone,officeLocation,birthday`
    with `Authorization: Bearer <token>`. Follow `@odata.nextLink` until absent, accumulating `value[]`.
  - Map each item via `mapGraphContact`, dropping `null`s. Return the full list (no partial returns — any page failure throws before merge).
  - Errors mirror M2's `SharePointBackend`: 401 → `outlookSignInExpired`, 403 → `outlookPermissionDenied`, other non-ok → generic `outlookFetchFailed` (with status). Network rejection propagates as `outlookFetchFailed`.
- `fetchContacts` is wrapped in `useCallback([acquireToken])`; `acquireToken` is already a stable `useCallback` reference from M1's `use-ms-auth.ts`.

### 3. `src/app/outlook-import-modal.tsx` (new, presentational)

```ts
interface OutlookImportModalProps {
  lang: Lang;
  open: boolean;
  loading: boolean;
  error: string | null;          // pre-translated message
  contacts: OutlookContact[];
  existingEmails: ReadonlySet<string>; // normalized emails already in directory
  onConfirm: (selected: OutlookContact[]) => void;
  onClose: () => void;
}
```

- Renders a modal (same primitive/overlay as existing modals, e.g. `bulk-edit-modal.tsx`).
- Each contact is a checkbox row: name + email + (when `existingEmails.has(contact.email)`) an `already in directory · will update` badge.
- **Pre-check rule:** every importable contact is checked by default — both new and existing-match (per "offer to update"). The badge tells the user which will update; they can uncheck any row.
- Header has a select-all / deselect-all checkbox and a live `n selected` count.
- States: `loading` → spinner/"Loading contacts…"; `error` → error text + Close; empty (`!loading && contacts.length === 0`) → "No Outlook contacts found."; otherwise the list + **Import (n)** / **Cancel**.
- `onConfirm` is called with the checked subset; the modal does not mutate app state itself.

### 4. Wiring

- **`task-manager.tsx`** (coordinator):
  - `const m365Enabled = settings.integrations?.m365?.enabled ?? false;`
  - `const outlookContactsEnabled = m365Enabled && (settings.integrations?.m365?.outlookContacts ?? false);`
  - `const auth = useMsAuth(m365Enabled);` `const { fetchContacts } = useOutlookContacts(auth.acquireToken);`
  - Local state: `importOpen`, `importLoading`, `importError`, `importContacts`.
  - `handleOpenOutlookImport()` → opens modal, sets loading, calls `fetchContacts()`; on success stores contacts, on throw stores a translated `importError` (map the thrown message-key through `t(lang, key)`).
  - `handleConfirmImport(selected)` →
    `setResources((prev) => mergeImportedResources(prev, selected));`
    seed address book: `setContacts((prev) => contactsFromImported(selected).reduce((acc, c) => upsertContact(acc, c.name, c.email), prev));`
    close modal; toast `t(lang, "outlookImportedN", String(selected.length))`.
  - Renders `<OutlookImportModal … existingEmails={set of normalized resource emails} />`.
  - Gating: `handleOpenOutlookImport` is only reachable from the Directory button, which only renders when `outlookContactsEnabled && auth.account`.
  - `setContacts` is already available in `task-manager` via `useContacts`; `setResources` via `useResourcePlanner`.
- **`resource-directory.tsx`**: new optional prop `onImportOutlook?: () => void`. When provided, render an **"Import from Outlook"** button in the toolbar beside "Open address book" (same button styling).
- **`resources-panel.tsx`**: thread `onImportOutlook` through to `<ResourceDirectory>` (Directory tab only).
- **`settings-menu.tsx`**: change the sub-toggle tuple `["integrationsOutlookContacts", "outlookContacts", true]` → `["integrationsOutlookContacts", "outlookContacts", false]` so it becomes interactive (calls `updateM365({ outlookContacts: e.target.checked })`), exactly as M2 did for SharePoint. Leave Outlook calendar `comingSoon: true`.

### What ships when toggles are OFF

- `outlookContactsEnabled` is false → the Directory shows no "Import from Outlook" button; `useMsAuth(false)` returns a no-op; MSAL bundle never loads. Zero new cold-start cost. Same testable "default OFF" contract as M1/M2.

### Edge cases

- **Token null (not signed in):** `fetchContacts` throws `outlookSignInRequired`; modal shows the message. (Button is normally hidden unless signed in, but the guard is defensive.)
- **Incremental consent:** first `Contacts.Read` use triggers MSAL's consent popup via `acquireTokenSilent` → falls back to interactive when needed (MSAL handles this; the hook just awaits the token).
- **Name-only contact (no email):** still importable; merge always treats it as new (no email key to match); seeded into the address book only if it has a display name.
- **Duplicate emails within one Outlook batch:** later occurrence wins for the resource (map overwrite); `upsertContact` dedupes the address book by normalized name.
- **Contact with multiple emails:** first `emailAddresses[0]` is used (matches the address-book single-email model).
- **Large address books:** `$top=100` paging walks all pages; the preview list renders them all (no pagination in the modal for MVP — acceptable for personal contact volumes).
- **Birthday year `0001`:** stored as `"MM-DD"` so it joins the birthday-reminder system without a bogus year.

## Data flow

```
Settings: enable M365 + Outlook contacts → Sign in with Microsoft
  ↓
Resources › Directory → "Import from Outlook"
  ↓
acquireToken(["Contacts.Read"])  ── incremental-consent popup on first use
  ↓
GET /me/contacts?$select=…&$top=100  → follow @odata.nextLink → value[]
  ↓
mapGraphContact(...)  → OutlookContact[]
  ↓
Preview modal (deduped checkboxes; existing matches badged "will update")
  ↓ confirm(selected)
setResources(mergeImportedResources(prev, selected))   // rich directory
setContacts(upsert loop over contactsFromImported)       // assignee autocomplete
  ↓
toast "Imported N contacts"
```

## i18n keys (EN + DE)

| Key | EN | DE |
|---|---|---|
| `integrationsOutlookContacts` | (exists) | (exists) |
| `outlookImportButton` | "Import from Outlook" | "Aus Outlook importieren" |
| `outlookImportTitle` | "Import Outlook contacts" | "Outlook-Kontakte importieren" |
| `outlookImportLoading` | "Loading contacts…" | "Kontakte werden geladen…" |
| `outlookImportEmpty` | "No Outlook contacts found." | "Keine Outlook-Kontakte gefunden." |
| `outlookImportExisting` | "already in directory · will update" | "bereits im Verzeichnis · wird aktualisiert" |
| `outlookImportSelectAll` | "Select all" | "Alle auswählen" |
| `outlookImportSelectedN` | "{0} selected" | "{0} ausgewählt" |
| `outlookImportConfirm` | "Import ({0})" | "Importieren ({0})" |
| `outlookImportedN` | "Imported {0} contacts" | "{0} Kontakte importiert" |
| `outlookSignInRequired` | "Sign in to Microsoft first." | "Zuerst bei Microsoft anmelden." |
| `outlookSignInExpired` | "Sign-in expired. Sign in again." | "Anmeldung abgelaufen. Bitte erneut anmelden." |
| `outlookPermissionDenied` | "Permission denied. Grant contacts access." | "Zugriff verweigert. Kontaktzugriff gewähren." |
| `outlookFetchFailed` | "Could not load Outlook contacts." | "Outlook-Kontakte konnten nicht geladen werden." |
| `versionHighlightOutlookContacts` | "Import your Outlook contacts: sign in with Microsoft, then pull contacts into your resource directory and assignee suggestions from the Resources tab." | "Outlook-Kontakte importieren: mit Microsoft anmelden und Kontakte aus dem Reiter „Ressourcen“ ins Ressourcenverzeichnis und in die Zuständigen-Vorschläge übernehmen." |

(`{0}` uses the existing positional-arg substitution already used by `t(lang, key, arg)`, e.g. `sortBy`.)

## Testing

### Unit — `outlook-contacts.test.ts` (new)
- `mapGraphContact`: full record; givenName/surname only; displayName-only split; email-only (name falls back to local-part); all-blank → `null`; phone prefers `businessPhones[0]` then `mobilePhone`.
- `parseGraphBirthday`: real year → `"YYYY-MM-DD"`; year `0001` → `"MM-DD"`; missing/invalid → `undefined`.
- `mergeImportedResources`: new contact gets `nextId`; email match updates mutable fields while preserving `id`/`roleId`/`utilization`; multi-add batch gets distinct ids; blank field on update clears the value.
- `contactsFromImported`: maps displayName+email; skips blank-name contacts.

### Unit — `use-outlook-contacts.test.tsx` (new)
- Multi-page `@odata.nextLink` walk accumulates across pages.
- Null token → throws `outlookSignInRequired`; 401 → `outlookSignInExpired`; 403 → `outlookPermissionDenied`; 500 → `outlookFetchFailed`.
- `Authorization: Bearer` header present; correct `$select`/`$top` URL.

### Unit — `outlook-import-modal.test.tsx` (new)
- New contacts pre-checked; existing-match rows show the "will update" badge and are also pre-checked.
- Select-all toggles every row; count updates.
- Confirm calls `onConfirm` with exactly the checked subset.
- Loading, error, and empty states render.

### Unit — `settings-menu.test.tsx` (extend)
- Outlook contacts toggle is now interactive (not disabled) and persists `integrations.m365.outlookContacts`.
- Outlook calendar toggle remains disabled with the coming-soon tooltip.

### Gates
- `npx tsc --noEmit` 0; `npm run lint` 0; full suite green (existing 981 + new); coverage ≥ current (~77%).

## Release

Minor → **0.23.0 "Jemisin"**. New highlight key `versionHighlightOutlookContacts`.

- `src/app/version.ts`: `APP_VERSION = "0.23.0"`; keep `APP_BUILD_DATE = "2026-05-28"` and `// Jemisin milestone`; add 0.23.0 block comment; append `"versionHighlightOutlookContacts"` as the LAST `APP_HIGHLIGHT_KEYS` entry.
- `src/app/i18n.ts` + `i18n.de.ts`: all new keys above + the highlight key.
- `CHANGELOG.md`: `[0.23.0] — 2026-05-28 "Jemisin"` entry — Added (Outlook contacts import; preview-and-pick; updates existing by email; both surfaces) + Changed (Outlook contacts sub-toggle now interactive).
- No DESIGN-TOKENS change. No new dependencies (reuses `@azure/msal-browser` from M1).

## Plan shape (preview — `writing-plans` skill expands)

1. `outlook-contacts.ts` pure core (`GraphContact`/`OutlookContact` types, `mapGraphContact`, `parseGraphBirthday`, `mergeImportedResources`, `contactsFromImported`) + tests.
2. `use-outlook-contacts.ts` hook (paged fetch + typed errors) + tests.
3. `outlook-import-modal.tsx` + tests.
4. Wire into `task-manager.tsx` (auth + hook + state + handlers + modal) and `resource-directory.tsx` / `resources-panel.tsx` (button + prop threading).
5. Flip the Outlook contacts sub-toggle interactive in `settings-menu.tsx` + tests.
6. i18n EN + DE (all new keys).
7. Release 0.23.0 (version.ts, CHANGELOG).

## What this closes

After 0.23.0 ships, M3 is done. M4 (Outlook calendar) and T1 (Turso) remain; both are independent and can land in any order on top of M1.
