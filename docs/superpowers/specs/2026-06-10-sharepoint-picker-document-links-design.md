# SharePoint Picker + Document Links — Design

**Status:** Approved (brainstorming) — ready for implementation planning
**Date:** 2026-06-10
**Author:** brainstorming session

> **Context:** This is **sub-project 1 of 4** in a larger "Microsoft 365 communication & collaboration" initiative. The other three sub-projects — Teams messaging + channel/chat picker, Microsoft Planner read/write sync, and Teams calling (Azure Communication Services) — are deliberately **out of scope** here and will each get their own spec → plan → build cycle. Teams calling via `@azure/communication-react` was explicitly **deferred** because it requires a paid ACS resource and a server-side token-minting endpoint, which breaks the app's "no backend account required" posture.

---

## Goal

Add a reusable **SharePoint browse/picker** to lop-app and use it in two places: (1) choosing the SharePoint storage-backend file location, and (2) attaching **document links** (files *or* folders) to every major workspace entity.

## Summary

Today, SharePoint is reachable only by **pasting a file URL** into the storage-backend config (`parseSharePointFileUrl` → `{hostname, sitePath, itemPath}`). There is no way to browse, and no way to reference SharePoint documents from anywhere else in the app.

This sub-project delivers:

1. A **custom Graph-browse picker** (our own AIPM-styled modal) with **tenant-wide site search**, library selection, folder navigation, and file/folder selection.
2. A shared **`DocumentLink`** data model and a reusable **`<DocumentLinksField>`** editor embedded in all six major entities (Project, Task, RAID, Change, Stakeholder, Milestone).
3. The picker reused by the **storage-backend config** as a "Browse…" alternative to URL paste.

It is **browser-only** (delegated Microsoft Graph, no backend), reuses the existing MSAL auth (`use-ms-auth.ts`) and Graph-client conventions, and requires **no CSP change** (Graph + login hosts are already allowlisted in `src/proxy.ts`).

## Non-goals

- Teams messaging/notifications, Teams calling, Microsoft Planner sync (separate sub-projects).
- OneDrive (personal/`-my.sharepoint.com`) browsing — SharePoint **sites** only, consistent with the existing backend's exclusion of OneDrive hosts.
- Uploading/creating/editing SharePoint files from the picker. The picker **references** existing documents; it does not author them. (Storage save continues to write the single workspace file via the existing backend.)
- A dedicated "Documents" navigation tab. Links surface inside each entity's existing editor + a project-level list. A standalone Documents view can be a later enhancement.

---

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Picker mechanism | **Custom Graph-browse** modal (not the Microsoft File Picker SDK v8, not paste-only) |
| Purpose | **Both** storage-config location **and** general document linking |
| Entities with links | **All six**: Project, Task, RAID, Change, Stakeholder, Milestone (v1, not phased) |
| Site discovery | **Tenant-wide search** (`/sites?search=`) + paste-a-URL fallback |
| Delegated scopes | **`Files.ReadWrite.All`** (drive items + storage backend) **+ `Sites.Read.All`** (site search & site-resource reads) |
| Selectable items | **Files *and* folders** (the "path and file" ask) |

### Scope rationale

`Files.ReadWrite.All` covers drive/`driveItem` access — listing folder children and reading/writing files, including SharePoint sites addressed by path (this is how `sharepoint-backend.ts` already works). Tenant-wide site **search** (`GET /sites?search=`) and reading the `site` resource require `Sites.Read.All`, so we add it as a second scope. The existing storage backend's `Files.ReadWrite` scope is **standardized up to `Files.ReadWrite.All`** so the whole app shares one file scope; users consent to exactly two Graph permissions total, both with **incremental consent** (acquired interactively on first browse/save, silently thereafter).

---

## Architecture

Follows the established **pure-core + hook + component** split used by `outlook-calendar.ts` / `use-outlook-calendar.ts`.

### New modules

| File | Responsibility | Tested by |
|---|---|---|
| `src/app/document-link.ts` | `DocumentLink` type + `sanitizeDocumentLinks(raw): DocumentLink[]` (always returns an array). Pure. | unit + `fast-check` |
| `src/app/sharepoint-graph.ts` | Graph response types (`GraphSite`, `GraphDrive`, `GraphDriveItem`), URL builders (search/drives/children), and mappers `GraphDriveItem → DocumentLink` / `GraphSite → SiteRef`. **No fetch, no React.** | unit + `fast-check` |
| `src/app/use-sharepoint-browser.ts` | Hook: token via `useMsAuth().acquireToken`, `fetch` for the Graph calls, navigation state (current site/drive/folder, breadcrumb stack, paging via `@odata.nextLink`), inline error state. | hook test w/ mocked `fetch` |
| `src/app/sharepoint-picker-modal.tsx` | Reusable modal UI: search box → site list → library list → folder navigation (breadcrumb) → select file/folder. AIPM-styled. Two modes: `"location"` (storage: file only) and `"link"` (file or folder). Returns the selection to its caller. | RTL component test |
| `src/app/document-links-field.tsx` | Reusable `<DocumentLinksField>`: renders current links (file/folder icon, name, open-in-new-tab, remove) + an "Add from SharePoint" button that opens the picker in `"link"` mode. Controlled (`value` / `onChange`). | RTL component test |

### Modified modules

| File | Change |
|---|---|
| `src/app/types.ts` | Add optional `documentLinks?: DocumentLink[]` to `Task`, `RaidItem`, `ChangeItem`, `Stakeholder`, `Milestone`, `ProjectMeta`. Import `DocumentLink` from `document-link.ts`. |
| `src/app/storage.ts` | Add `documentLinks` to each entity's column list; add a JSON-in-cell encoder in the per-column serializer switch and a `sanitizeDocumentLinks` decode in the parse path; add CSV import header aliases. Bump `SCHEMA_VERSION`. |
| `src/app/turso-tenant-schema.ts` + `turso-schema.ts` | Column-driven, so the new `documentLinks` TEXT column flows automatically from the storage column lists; bump both `SCHEMA_VERSION` constants. |
| `src/app/sharepoint-backend.ts` | Standardize the requested scope `Files.ReadWrite` → `Files.ReadWrite.All`; add a "Browse…" entry path that reuses the picker in `"location"` mode to fill `{hostname, sitePath, itemPath}`. |
| `src/app/storage-config.tsx` | Add a **"Browse…"** button (sp-json/sp-csv) that opens the picker in `"location"` mode; keep the URL paste field as a fallback. |
| Entity editors: `task-form-fields.tsx`, `raid-*edit*`, `change-edit-modal.tsx`, stakeholder form, milestone form, `project-form-fields.tsx` | Embed `<DocumentLinksField>` wired to each entity's `documentLinks`. |
| `i18n.ts` + `i18n.de.ts` | New EN + DE keys (picker labels, errors, field label, empty states). |
| `activity-log.ts` callers | Append a short entry on document-link add/remove. |
| `version.ts` | Bump `APP_VERSION`, `APP_BUILD_DATE`, milestone comment, highlight key. |
| `docs/CODEMAPS/*.md` | Regenerate (new modules, new field, scope/schema changes). |

---

## Data model

```ts
// document-link.ts
export type DocumentLink = {
  id: string;            // stable id: the Graph driveItem id, or a generated id for paste/manual entries
  name: string;          // display name (file or folder)
  url: string;           // webUrl — opened in a new tab (target="_blank" rel="noopener noreferrer")
  kind: "file" | "folder";
  driveId?: string;      // Graph addressing for future re-browse / re-resolution
  itemId?: string;
  mimeType?: string;     // file icon / type hint (files only)
  addedAt?: string;      // ISO timestamp
};

export function sanitizeDocumentLinks(raw: unknown): DocumentLink[];
```

`sanitizeDocumentLinks` mirrors the defensive contract of `stakeholderIds`: tolerate `undefined`/`null`/malformed input, always return an array, drop entries missing a usable `url` or `name`, clamp `kind` to the union, and trim strings.

### Persistence

- **JSON & Turso:** additive. Turso schema is **column-driven** (every column is `TEXT`, derived from the storage column lists), so adding `documentLinks` to those lists creates the column automatically. The cell stores `JSON.stringify(links)`. Bump `SCHEMA_VERSION` in `storage.ts`, `turso-schema.ts`, and `turso-tenant-schema.ts`.
- **CSV & Markdown (dual-use serializers):** one new column per entity holding **`JSON.stringify(links)` inside the cell**, passed through the existing CSV/MD escaping (the serializers already use `JSON.stringify` for complex cells, e.g. `storage.ts:1056`). JSON-in-cell is **lossless** (preserves every field) and reuses the sanitizer on decode. List fields like `stakeholderIds` use `join("|")`, but that is insufficient for multi-field objects, so `documentLinks` uses JSON encoding instead.

> ⚠️ **Highest-risk area — the dual-use round-trip.** `workspaceToCsv`/`workspaceToMarkdown` are used **both** for export *and* for the no-config storage round-trip, which must stay **lossless and stable**. Empty `documentLinks` must serialize to an empty cell (not `"[]"`-vs-`""` drift) so existing workspaces round-trip byte-stably. The implementation plan must include explicit round-trip tests (empty, single, many, special characters in names) for **all four** serializers before any UI work.

---

## Picker flow (delegated Graph)

1. **Search sites:** `GET /sites?search={q}` (scope `Sites.Read.All`) → list `{id, displayName, webUrl}`.
   - *Fallback:* paste a site/library URL → resolve via a generalized `parseSharePointFileUrl` (`GET /sites/{host}:{sitePath}`).
2. **List libraries:** `GET /sites/{siteId}/drives` → document libraries.
3. **List root:** `GET /drives/{driveId}/root/children`.
4. **Navigate folders:** `GET /drives/{driveId}/items/{itemId}/children`; breadcrumb stack tracks the path; `@odata.nextLink` drives paging.
5. **Select:** a file (`location` mode requires a file) or a file/folder (`link` mode). Map the chosen `GraphDriveItem` → `DocumentLink` (or, in `location` mode, → `{hostname, sitePath, itemPath}`).

All drive/`driveItem` calls use `Files.ReadWrite.All`. Tokens come from `useMsAuth().acquireToken(scopes, { interactive })` — interactive on the first user-initiated browse (incremental consent), silent thereafter.

---

## Error handling

Reuse the conventions in `sharepoint-backend.ts`:

| Condition | Handling |
|---|---|
| Not signed in | Picker shows a "Sign in to Microsoft" prompt (same as storage config). |
| 401 | Inline: "Sign-in expired. Re-authenticate from Settings." |
| 403 | Inline: "Permission denied — you lack access to this site/file." |
| 404 (paste fallback) | Inline: "Site or file not found." |
| 429 / 5xx | Inline: "SharePoint is busy — try again later." |
| Empty search / empty folder | Friendly empty-state copy, not an error. |
| User cancels | Silent (no error), matching the local file picker behavior. |

No errors are swallowed; every failed `fetch` maps to a user-facing message and the picker stays open for retry.

---

## Testing strategy

- **Pure cores** (`document-link.ts`, `sharepoint-graph.ts`): unit tests for mappers, URL builders, and `sanitizeDocumentLinks`, plus `fast-check` property tests (sanitizer never throws, always returns an array; round-trippable mappers).
- **Hook** (`use-sharepoint-browser.ts`): mocked `fetch` covering search → drives → children → paging → each error status.
- **Components**: RTL tests for the picker modal (search, navigate, select file vs folder, cancel) and `<DocumentLinksField>` (add/remove, open link, empty state).
- **Persistence**: round-trip tests for `documentLinks` across **JSON, CSV, Markdown, and Turso**, including the empty-cell stability case (the highest-risk item above).
- Coverage stays **≥ 70%** (the business-logic/data layer gate). New `*.tsx` are covered by component tests; pure modules count toward the gate.

---

## Rollout / settings

- The picker and document-linking are gated by the existing **M365 enabled** + **SharePoint** integration toggles (`integrations-section.tsx`); when off, `<DocumentLinksField>` shows a hint to enable the integration (or is hidden), consistent with the storage backend's gating.
- No new env vars. Scopes are requested on demand via incremental consent.

## Open implementation details (resolved in the plan, not blocking design)

- Exact column **position** of `documentLinks` within each entity's CSV/MD column list and the precise import-header aliases.
- Whether the project-level Documents list renders in the project form only, or also as a compact panel — default: project form, to honor YAGNI.
- Picker paging page size and debounce interval for the search box (named constants).
