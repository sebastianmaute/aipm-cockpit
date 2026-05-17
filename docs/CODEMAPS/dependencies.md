<!-- Generated: 2026-05-15 | Files scanned: package.json, package-lock.json | Token estimate: ~500 -->

# Dependencies

Deliberately small surface. The runtime dep tree fits on one screen.

## Direct runtime deps (`package.json` — dependencies)

| Package | Version | Used by |
|---|---|---|
| `next` | 16.2.6 | App framework, dev runtime, route handlers |
| `react` | 19.2.4 | UI |
| `react-dom` | 19.2.4 | UI |
| `date-holidays` | ^3.28.0 | Computed working-day filtering. **Lazy-imported** via `src/app/holidays.ts` only when ≥1 country is selected (Phase G) |

## Direct dev deps (`package.json` — devDependencies)

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5 | Type-checking only — `next build` runs it implicitly |
| `@types/node`, `@types/react`, `@types/react-dom` | latest | Type defs |
| `tailwindcss` | ^4 | Utility CSS |
| `@tailwindcss/postcss` | ^4 | Tailwind via PostCSS plugin (Tailwind v4 uses this layer) |
| `eslint` | ^9 | Linter |
| `eslint-config-next` | 16.2.6 | Next.js eslint preset |

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

Moment + moment-timezone are ~100 KB+ gzipped. Phase G made `date-holidays`
lazy, so the cost is only paid when the user explicitly selects a country.
Default state → never loaded.

## External services

| Service | Caller | How |
|---|---|---|
| `api.anthropic.com` | Browser (direct) | User-supplied API key in `localStorage`; called from `chat-panel.tsx` |
| `api.atlassian.com` | Server (`/api/jira/*` proxy) | Credentials forwarded per-request in POST body; never stored server-side |

No analytics, no observability backend, no error tracker, no CDN, no payment
processor. Self-contained.

## Verified absent

These were considered or asked about but **are not in the dep tree**:

| Package | Why not |
|---|---|
| `moment` / `dayjs` / `date-fns` / `luxon` (direct) | We don't do date math; the codebase uses ISO `YYYY-MM-DD` strings + native `Date`. Moment is transitive via `date-holidays`, not direct. |
| `style-loader` / `mini-css-extract-plugin` | Next handles CSS internally. Not present, not needed. See the `lop-app-css-hmr-investigation` memory for the question that surfaced this. |
| `@tanstack/react-virtual` / virtualization libs | Task table not virtualized (high-risk refactor; see memory-optimization notes). |
| State stores (zustand / jotai / redux-toolkit) | Single god-component owns state; `tasksRef` mirroring discussed as future cleanup. |
