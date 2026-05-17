<!-- Generated: 2026-05-17 | Files scanned: package.json, package-lock.json | Token estimate: ~500 -->

# Dependencies

Deliberately small surface. The runtime dep tree fits on one screen.

## Direct runtime deps (`package.json` — dependencies)

| Package | Version | Used by |
|---|---|---|
| `next` | 16.2.6 | App framework, dev runtime, route handlers, middleware (`src/proxy.ts`) |
| `react` | 19.2.4 | UI |
| `react-dom` | 19.2.4 | UI |
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

Unchanged since 2026-05-15 — no new runtime or dev deps.

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
| SharePoint Online | **Not yet wired** | `sp-json` / `sp-csv` `StorageConfig` variants resolve to a stub `SharePointBackend` that throws `StorageNotImplementedError("sharepoint-coming-soon")`. UI flags them as "Coming soon" |

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

## Verified absent

These were considered or asked about but **are not in the dep tree**:

| Package | Why not |
|---|---|
| `moment` / `dayjs` / `date-fns` / `luxon` (direct) | We don't do date math; the codebase uses ISO `YYYY-MM-DD` strings + native `Date`. Moment is transitive via `date-holidays`, not direct. |
| `style-loader` / `mini-css-extract-plugin` | Next handles CSS internally. Not present, not needed. See the `lop-app-css-hmr-investigation` memory for the question that surfaced this. |
| `@tanstack/react-virtual` / virtualization libs | Task table not virtualized (high-risk refactor; see memory-optimization notes). |
| State stores (zustand / jotai / redux-toolkit) | Single god-component owns state; `tasksRef` mirroring discussed as future cleanup. |
| `@azure/msal-browser` / `@microsoft/microsoft-graph-client` | SharePoint integration not implemented yet — backend stubs only. Will be required when `sp-json`/`sp-csv` are wired up. |
| `jszip` / `pako` | OOXML export uses the in-tree `zip.ts` STORE-method writer; no DEFLATE. |
