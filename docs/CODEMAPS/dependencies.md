<!-- Generated: 2026-07-30 · counts re-verified 2026-08-10 at the merge with main 528dd5fe | App 0.232.0 "Merril" | Files scanned: package.json, vitest.config.ts, playwright.config.ts, src/proxy.ts | Token estimate: ~750 -->

# Dependencies

Deliberately small. **Nine runtime dependencies**, and the count barely moves across releases —
timezones use native `Intl`, drag-and-drop is native HTML5, OOXML export is hand-rolled over an
in-tree zip writer, and every AI call is a raw `fetch`.

## Runtime

| Package | Version | Used for |
|---|---|---|
| `next` | ^16.2.11 | framework (public fork; read `node_modules/next/dist/docs` — APIs differ from training data) |
| `react` / `react-dom` | 19.2.4 | UI. React 19 delegates events on `document`, which is why `stopPropagation` cannot contain a key from a document-level listener |
| `@azure/msal-browser` | ^5.16.0 | M365 sign-in; owns its own token cache (app stores no M365 secret) |
| `@heroicons/react` | ^2.2.0 | icon set |
| `@tiptap/react` + `@tiptap/starter-kit` | ^3.27.1 | rich-text editor (lazy `ssr:false` — needs `Range.getClientRects` stubs in jsdom) |
| `dompurify` | ^3.4.10 | HTML sanitize for the note log, the seven rich description fields, and anything the AI writes into them. ★★ must not run at module-eval (no DOM under SSR → 500) **and must never be reached from `rich-text-plain.ts` or an entity sanitizer** — those run under bare Node in the sample generator, where the call throws and `jsonToWorkspace` swallows it into an empty workspace (see [data.md](data.md)) |
| `date-holidays` | ^3.28.0 | public-holiday calendar |

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
to raise, not a default. `zod` in particular is an open ask, not an approval
(`open-followups.md` §7 B4).
