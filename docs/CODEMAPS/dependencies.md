<!-- Generated: 2026-07-30 · counts re-verified 2026-08-19 at 6046dcd2 | App 1.15.1 "Cornwell" | Files scanned: package.json, vitest.config.ts, playwright.config.ts, src/proxy.ts | Token estimate: ~750 -->

# Dependencies

Deliberately small. **Fifteen runtime dependencies**, seven of which are Tiptap packages on one
version line — so the count of independent vendors is nine. Timezones use native `Intl`,
drag-and-drop is native HTML5, OOXML export is hand-rolled over an in-tree zip writer, and every AI
call is a raw `fetch`.

★ Read the number rather than quoting this one: `node -e "console.log(Object.keys(require('./package.json').dependencies).length)"`.
It said **nine** for six releases after five Tiptap extensions and `lucide-react` had landed.

## Runtime

| Package | Version | Used for |
|---|---|---|
| `next` | 16.3.6 (exact — see CONTRIBUTING.md "Dependencies") | framework (a public npm package, NOT a fork — the lock resolves it from registry.npmjs.org; read `node_modules/next/dist/docs` — APIs differ from training data) |
| `react` / `react-dom` | 19.3.0 | UI. React 19 delegates events on `document`, which is why `stopPropagation` cannot contain a key from a document-level listener |
| `@azure/msal-browser` | ^5.23.0 | M365 sign-in; owns its own token cache (app stores no M365 secret) |
| `@tiptap/react` + `@tiptap/starter-kit` | ^3.31.3 | rich-text editor (lazy `ssr:false` — needs `Range.getClientRects` stubs in jsdom) |
| `@tiptap/extension-``list` `text-align` `highlight` `superscript` `subscript` | ^3.31.3 | the toolbar beyond starter-kit: task lists, alignment, highlight, super/subscript. ★★ Each declares its own commands via `declare module '@tiptap/core'` INSIDE its package, so `toggleHighlight`/`toggleSuperscript`/`toggleSubscript` do not exist on the chained-commands type until some file in the TS program imports that module — a toolbar calling them while only the EDITOR imports the extensions is green in vitest and red in tsc |
| `lucide-react` | ^1.48.0 | the app's ONLY icon set since 0.255.0. **2 importers**: `src/app/icons.ts` (the barrel every other file goes through) and `rich-text-toolbar.tsx` (grandfathered — its set came from Tiptap's reference toolbar). ★ A third file, `icons.test.ts`, matches a bare `lucide-react` grep on a COMMENT and is not an importer — quote importers, not string hits. `@heroicons/react` was REMOVED app-wide in the same release and an ESLint `no-restricted-imports` rule (both a `paths` and a `patterns` entry, the latter load-bearing because every old call site used the `/24/outline` SUBPATH) makes its return a fatal lint error. Re-measure rather than quoting: `grep -rln "@heroicons/react" src/app | wc -l` returns **0**. See `docs/tech-debt-register.md` TD-8 (resolved) and `docs/superpowers/specs/2026-08-21-heroicons-to-lucide-migration-design.md`. |
| `dompurify` | ^3.4.16 | HTML sanitize for the note log, the seven rich description fields, and anything the AI writes into them. ★★ must not run at module-eval (no DOM under SSR → 500) **and must never be reached from `rich-text-plain.ts` or an entity sanitizer** — those are DOM-free by contract, and scripts import them with no DOM installed (`scripts/ai-eval.ts`, `scripts/update-ooxml-manifest.ts`), where the call throws; the sample generator is NOT one of them, it installs JSDOM first (see [data.md](data.md) and `docs/open-followups.md` §151) |
| `date-holidays` | ^3.37.0 | public-holiday calendar |
| `zod` | ^4.6.5 | runtime schemas for the Jira responses the client reads (`jira-schemas.ts`, open-followups §7 B4). Strict on each item's identity, lenient on an issue's fields: a wrong-typed field becomes `undefined` and a malformed list item is dropped and logged. ★ In zod 4 a bare `z.unknown()` object key is REQUIRED; write `.optional()` when the key may be absent. It was already in the tree as a dev-only transitive of `eslint-plugin-react-hooks`. ★★ It stays OUT of the startup chunk: `jira-schemas.ts` is its only VALUE importer (`jira-api.ts` imports only its types), `jira-api.ts` is the only importer of `jira-schemas.ts`, and every caller reaches `jira-api.ts` through `loadJiraApi()` (`use-jira-sync.ts`), per CONTRIBUTING's "Lazy loading" rule. A value import of `./jira-api` or `./jira-schemas` from anything on the startup chain puts it back. Re-check: `grep -rn 'from "zod"' src/app --include=*.ts \| grep -v test` and `grep -rln jira-schemas src/app \| grep -v test`. ★ `loadJiraApi` memoises through `lazyRetryOnReject` (`lazy-retry.ts`), so a failed chunk download is retried on the next call instead of staying cached |

## Dev / test

`typescript` · `eslint` + `eslint-config-next` · `tailwindcss` + `@tailwindcss/postcss` ·
`vitest` + `@vitest/coverage-v8` + `jsdom` · `@testing-library/{react,jest-dom,user-event}` ·
`fake-indexeddb` · `fast-check` (property tests) · `msw` · `@playwright/test` +
`@axe-core/playwright` · `jscpd` (duplication gate) · `@vitejs/plugin-react` · `@types/*`

★ `tailwindcss` shows as an unused devDep to `knip` — it is a false positive. Tailwind v4 auto-scans
files rather than being imported. That auto-scan covers **`.md` and comments too**, so never put a
`*` wildcard inside a Tailwind arbitrary-value bracket in any tracked file — it compiles to invalid
CSS and `globals.css` fails, 500-ing the app.

## External services (runtime, none required)

Every integration is opt-in; the app is fully functional with all of them off.

| Service | Reached | Secret |
|---|---|---|
| Anthropic | browser-direct, `api.anthropic.com` | `anthropicApiKey` |
| Turso (libSQL) | browser-direct, `*.turso.io` | `tursoAuthToken` |
| Microsoft Graph / MSAL | browser-direct | none stored (MSAL owns its cache) |
| Jira + Confluence | `/api/jira/*`, `/api/confluence/page` | `jiraApiToken` |
| TimeLog | `/api/timelog` | `timelogApiToken` |
| STT (BYO OpenAI-compatible) | `/api/stt` | `sttApiKey` |
| ECB FX rates | `/api/ecb` | none |

The five secrets are AES-256-GCM sealed at rest under a non-extractable device key. Browser-direct
hosts must appear in `src/proxy.ts` `connect-src`/`frame-src`; proxied ones need no CSP entry
(same-origin).

## Adding a dependency

Check the registry first, prefer a battle-tested library over hand-rolling — but note the standing
bias here is the reverse of most repos: zip writing, OOXML, DnD, recurrence expansion, lane packing
and the virtual-list-shaped work were all built in-tree deliberately. A new runtime dep is a decision
to raise, not a default. `zod` is the worked example: it was an open ask under
`open-followups.md` §7 B4 until the owner approved it on 2026-10-03, and it is scoped to the Jira
responses that entry named. Using it anywhere else is a new decision, not a precedent.
