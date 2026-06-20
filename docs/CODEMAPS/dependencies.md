<!-- Generated: 2026-06-10 | Files scanned: package.json, package-lock.json, vitest.config.ts, playwright.config.ts | Token estimate: ~700 | Updated for 0.59.0 "Gibson": test stack upgraded to Vitest 4; added fake-indexeddb + fast-check dev deps; no new runtime deps. 0.97.0–0.115.0 (AI orchestration SP0–SP5, Task.status/Kanban, steering committee, guided tour, timezones): NO new runtime deps — timezones use native `Intl.DateTimeFormat`, Kanban uses native HTML5 DnD, AI uses raw `fetch` to api.anthropic.com, Confluence reuses the in-tree Jira proxy -->

# Dependencies

Deliberately small surface. The runtime dep tree fits on one screen.

## Direct runtime deps (`package.json` — dependencies)

| Package | Version | Used by |
|---|---|---|
| `next` | 16.2.6 | App framework, dev runtime, route handlers, middleware (`src/proxy.ts`) |
| `react` | 19.2.4 | UI |
| `react-dom` | 19.2.4 | UI |
| `@azure/msal-browser` | ^4.30.0 | **0.21.0+:** Microsoft Entra browser authentication (PKCE flow). **Lazy-imported** via `use-ms-auth.ts` only when M365 toggle is enabled in Settings → Integrations |
| `date-holidays` | ^3.28.0 | Computed working-day filtering. **Lazy-imported** via `src/app/holidays.ts` only when ≥1 country is selected |

## Direct dev deps (`package.json` — devDependencies)

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5 | Type-checking only — `next build` runs it implicitly |
| `@types/node` (^20), `@types/react` (^19), `@types/react-dom` (^19) | latest in range | Type defs |
| `tailwindcss` | ^4 | Utility CSS |
| `@tailwindcss/postcss` | ^4 | Tailwind via PostCSS plugin (Tailwind v4 uses this layer) |
| `eslint` | ^9 | Linter |
| `eslint-config-next` | 16.2.6 | Next.js eslint preset |
| `vitest` | ^4.1.8 | Unit/component test runner (`vitest.config.ts`) |
| `@vitest/coverage-v8` | ^4.1.8 | v8 coverage provider; threshold enforced at 70% lines/functions/branches/statements (scoped logic/data layer) |
| `@vitejs/plugin-react` | ^4.3.4 | JSX/TSX transform inside the Vitest runner |
| `jsdom` | ^25.0.1 | DOM environment for component tests |
| `fake-indexeddb` | ^6.2.5 | In-memory IndexedDB for storage-layer tests (BrowserBackend / file-handle persistence) |
| `fast-check` | ^4.8.0 | Property-based testing |
| `@testing-library/react` | ^16.3.0 | RTL render + queries (React 19 compatible) |
| `@testing-library/jest-dom` | ^6.6.3 | Custom DOM matchers; registered in `vitest.setup.ts` |
| `@testing-library/user-event` | ^14.6.1 | Realistic user interaction simulation |
| `@playwright/test` | ^1.49.0 | E2E runner (`playwright.config.ts`); Chromium-only by default |

**0.59.0 "Gibson":** the test stack moved to Vitest 4 (`vitest` + `@vitest/coverage-v8` → ^4.1.8) and gained `fake-indexeddb` + `fast-check`. Runtime deps unchanged. Test count grows with each release; see CHANGELOG for per-release totals.

**0.97.0–0.115.0:** the AI-orchestration suite (SP0–SP5), Task.status + Kanban board, steering committee, guided tour, and the timezone subsystem all shipped with **zero new runtime or dev dependencies**. Timezone formatting and zone enumeration use the native `Intl.DateTimeFormat` / `Intl.supportedValuesOf` APIs (`timezone.ts` / `tz-display.ts` / `tz-clock.ts`); the Kanban board uses native HTML5 drag-and-drop (no DnD library); AI calls hit `api.anthropic.com` directly via `fetch`; Confluence import reuses the in-tree Jira proxy helpers.

### `overrides` / `allowScripts`

- **`overrides`:** `postcss` pinned to `^8.5.14` (transitive, via Tailwind/Next toolchain).
- **`allowScripts`:** post-install build scripts are gated; only `esbuild@0.27.7`, `sharp@0.34.5`, and `unrs-resolver@1.11.1` are allowed to run.

## Notable transitive deps

`date-holidays` brings:

```
date-holidays@3.28.0
└── date-holidays-parser@3.4.7
    ├── caldate@2.0.5
    │   └── moment-timezone (deduped)
    └── moment-timezone@0.5.48
        └── moment@2.30.1
```

Moment + moment-timezone are ~100 KB+ gzipped. `date-holidays` stays lazy, so
the cost is only paid when the user explicitly selects a country. Default
state → never loaded.

## External services

| Service | Caller | How |
|---|---|---|
| `api.anthropic.com` | Browser (direct) | User-supplied API key in `localStorage`; called from `chat-panel.tsx`. Whitelisted in `connect-src` of the CSP. |
| `api.atlassian.com` | Server (`/api/jira/*` proxy) | Credentials forwarded per-request in POST body; never stored server-side |
| `graph.microsoft.com` | Browser (direct, v0.21.0+) | MSAL token in Bearer header; called from sharepoint-backend, outlook-contacts, outlook-calendar hooks |
| `api.turso.io` | Browser (direct, v0.25.0+) | Turso auth token in Bearer header; called from turso-backend via HTTP `/v2/pipeline` API |

No analytics, no observability backend, no error tracker, no CDN, no payment
processor. Self-contained.

## In-tree hand-rolls (no external dep)

| Module | What it does |
|---|---|
| `src/app/zip.ts` | Minimal STORE-method ZIP writer for OOXML packages (docx/xlsx/pptx). Avoids pulling in JSZip or similar. |
| `src/app/adf.ts` | Plain-text ↔ Atlassian Document Format converter (lossy by design — flattens rich formatting). |
| `src/app/api/jira/_rate-limit.ts` | In-memory token bucket per-IP/per-creds. |
| `src/app/contacts.ts` | localStorage address book; no third-party autocomplete library. |
| `src/app/activity-log.ts` | localStorage-only CRUD audit log. |
| `src/app/use-resizable.ts` | Corner-drag resize hook with localStorage persistence. No react-resizable / react-rnd. |

## Testing stack

```
unit / component  →  vitest + jsdom + @vitejs/plugin-react
                     @testing-library/{react,jest-dom,user-event}
                     property-based: fast-check
                     storage tests: fake-indexeddb (in-memory IDB)
                     coverage: @vitest/coverage-v8 (70% threshold)
                     config: vitest.config.ts, vitest.setup.ts
                     location: src/**/*.test.{ts,tsx}

E2E               →  @playwright/test (Chromium only)
                     config: playwright.config.ts
                     auto-starts `npm run dev`; reuses local server
                     location: e2e/**/*.spec.ts
                     artifacts (gitignored): /test-results,
                       /playwright-report, /playwright/.cache,
                       /blob-report
```

Both runners are independent of Next's build pipeline. Vitest uses its own
SWC-via-Vite transform (not Next's). Playwright treats the dev server as a
black box.

## Verified absent

These were considered or asked about but **are not in the dep tree**:

| Package | Why not |
|---|---|
| `moment` / `dayjs` / `date-fns` / `luxon` (direct) | We don't do date math; the codebase uses ISO `YYYY-MM-DD` strings + native `Date`. Moment is transitive via `date-holidays`, not direct. Timezone handling (0.113.0+) uses the native `Intl.DateTimeFormat` / `Intl.supportedValuesOf("timeZone")` APIs — no Luxon/Temporal/tz library. |
| `style-loader` / `mini-css-extract-plugin` | Next handles CSS internally. Not present, not needed. |
| `@tanstack/react-virtual` / virtualization libs | Task table not virtualized (high-risk refactor). |
| State stores (zustand / jotai / redux-toolkit) | Single god-component owns state; `tasksRef` mirroring discussed as future cleanup. |
| `@microsoft/microsoft-graph-client` | Direct Graph calls made via native `fetch` in `sharepoint-backend.ts` and Outlook hooks; no need for a client library wrapper. |
| `@libsql/client` | Turso integration (0.25.0) uses raw HTTP `/v2/pipeline` API via `fetch`; no need for the SDK. The 0.59.0 multi-tenancy work also stays on raw `/v2/pipeline`, not the SDK. |
| `jszip` / `pako` | OOXML export uses the in-tree `zip.ts` STORE-method writer; no DEFLATE. |
