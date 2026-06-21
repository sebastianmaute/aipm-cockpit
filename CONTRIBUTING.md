# Contributing

Working notes for anyone editing this repo. Architecture reference lives in
[CODEMAPS/](CODEMAPS/); this file covers process, conventions, and the moving
parts a contributor needs day-to-day.

## Prerequisites

- **Node.js ≥ 20.9.0** (Next.js 16 requires it; the CI image is `node:20`).
- **npm** (lockfile is `package-lock.json` — yarn / pnpm are not used here).
- A Chromium-based browser (Chrome / Edge / Opera) for local testing. Several
  features (File System Access API for local file storage, `SpeechRecognition`
  for voice) only work in Chromium. Firefox / Safari run the app but fall back
  to IndexedDB-only.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No environment variables
are required to start the app — the Anthropic API key and Jira credentials
are entered in the in-app Settings panel and stored in the browser.

## Scripts

<!-- AUTO-GENERATED from package.json scripts -->
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server with hot reload on http://localhost:3000 |
| `npm run build` | Production build — runs TypeScript type-check, then emits `.next/` |
| `npm run start` | Serve the production build (run `npm run build` first) |
| `npm run lint` | Run ESLint (`eslint-config-next` preset) |
| `npm run test` | Vitest unit/component tests in watch mode |
| `npm run test:run` | Vitest, single run (CI-friendly) |
| `npm run test:coverage` | Vitest + v8 coverage report (thresholds: lines 90 / statements 87 / functions 89 / branches 78) |
| `npm run e2e` | Playwright functional E2E (smoke + app nav + a11y), headless — the CI suite |
| `npm run e2e:ui` | Playwright interactive UI mode |
| `npm run e2e:smoke` | Standalone smoke driver (scripts/e2e-smoke.mjs): seeds a project, walks every view, fails on any console/page error. Needs a running server |
| `npm run e2e:visual` | Playwright visual-regression snapshots (opt-in; baselines are per-platform — generate CI's in the Linux container) |
| `npm run e2e:visual:update` | Regenerate visual snapshot baselines for the current platform |
| `npm run e2e:install` | One-time: download Chromium browser binary |
| `npm run docs:scripts` | Regenerate AUTO-GENERATED scripts tables in repo docs from `package.json` |
| `npm run docs:scripts:check` | Verify AUTO-GENERATED scripts tables are in sync; exit non-zero on drift (CI mode) |
<!-- END AUTO-GENERATED -->

There is no separate `tsc` script — `next build` runs the TypeScript check
implicitly. To type-check without building: `npx tsc --noEmit`.

## Project layout

```
src/app/
├── api/jira/             — thin CORS proxy routes (route.ts per endpoint)
├── task-manager.tsx      — orchestrator; owns most client state
├── task-form-modal.tsx   — task create/edit form modal (extracted slice 4)
├── bulk-edit-modal.tsx   — bulk-edit dialog (extracted slice 4)
├── task-form-context.tsx — TaskFormProvider: form + modal + bulk-edit state
├── chat-panel.tsx        — AI Assistant (Claude) tab
├── gantt.tsx             — Gantt chart tab
├── raid-panel.tsx        — RAID register tab
├── change-panel.tsx      — change-control Log tab
├── stakeholders-panel.tsx — stakeholder register + RACI + influence/interest
├── resources-panel.tsx   — Resources tab + calendar
├── activity-log-panel.tsx — Activity log tab
├── reports.tsx           — Reports tab
├── projects-panel.tsx    — Portfolio: project list / create / archive / delete
├── projects-registry.ts  — file-mode project registry (localStorage)
├── portfolio-mode.ts     — global File ↔ Turso portfolio-mode switch
├── turso-backend.ts      — Turso backend (single-tenant, or one-DB-many-projects via projectId)
├── feature-modules.ts    — Simple/Modular/Advanced module gating
├── i18n.ts               — en-US/en-GB dictionary (baked in)
├── i18n.de.ts            — de dictionary (lazy-loaded)
├── version.ts            — version string + highlight key list
└── ...
docs/CODEMAPS/            — per-layer architecture notes (regenerated, not hand-edited)
```

See [CODEMAPS/architecture.md](CODEMAPS/architecture.md) for the data-flow
diagram and service boundaries.

## Conventions

### Read `AGENTS.md` first
The root `AGENTS.md` warns that this Next.js install is **not** the version
the model has seen most of in training. Before adding code that touches Next
APIs (routing, headers, server actions, etc.), check
`node_modules/next/dist/docs/` for the version-specific guide.

### TypeScript

- `strict: true`. No `any` in application code — use `unknown` and narrow.
- `TranslationKey` is derived from `keyof typeof enUS`. Adding an entry to
  `i18n.ts` automatically requires a matching German translation in
  `i18n.de.ts` (compile-time enforced).
- Path alias: `@/foo` → `./src/foo` (see `tsconfig.json`).

### Lazy loading
Heavy dependencies are dynamically `import()`'d to keep the cold heap small.
Established pattern (used 3× — see `lop-app-memory-optimization` memory):

| Module | Triggered by |
|---|---|
| `i18n.de.ts` | Switching language to German |
| `holidays.ts` (date-holidays + moment-tz) | Selecting ≥1 country in Settings |
| `export-ooxml.ts` (DOCX / XLSX / PPTX writers) | Choosing one of those export formats |
| `gantt.tsx`, `reports.tsx`, etc. | Tabs only mount when active |

When adding a new heavy dep, follow the same gate-then-import pattern rather
than top-level importing.

### CSS
Tailwind v4 with `@tailwindcss/postcss`. Do **not** introduce
`mini-css-extract-plugin` or `style-loader` — Next handles CSS internally and
the `lop-app-css-hmr-investigation` memory documents a previous false trail.

### State
The orchestrator component (`task-manager.tsx`, ~3.5k LoC after slice-4 modal
extraction) owns most state. Modal bodies live in `task-form-modal.tsx` and
`bulk-edit-modal.tsx`. No external store (zustand / jotai / redux) is in the
dep tree by design. New state should slot into existing reducers / `useState`
hooks unless there's a strong reason to add a layer.

### Storage
Tasks and RAID live in `IndexedDB` with record-level writes (see
`storage.ts`). Settings + UI prefs live in `localStorage`. Legacy
`localStorage` task data migrates on first load — keep that migration path
intact if you touch `storage.ts`. The Workspace logical `SCHEMA_VERSION` (9)
is distinct from the IndexedDB store version `IDB_VERSION` (6); the dual-use
CSV/Markdown serializers must stay byte-identical on the storage round-trip
(the no-config path), so guard any export-only changes behind `ExportConfig`.

### Multi-project / portfolio
Each project is a full, independent `Workspace` plus a `ProjectMeta` header on
`Workspace.project`. A global **portfolio-mode** (`portfolio-mode.ts`,
`"file" | "turso"`) selects the active world: **file mode** uses a
localStorage registry (`projects-registry.ts`) + per-project file handles in a
dedicated IndexedDB store (`project-file-handles.ts`); **Turso mode** uses one
shared multi-tenant database (`turso-tenant-schema.ts` / `turso-backend.ts` in
tenant mode / `turso-portfolio.ts`) where every entity table carries a `project_id` and a
`projects` table is the authoritative list. Changing portfolio-mode saves and
reloads the page. See `docs/CODEMAPS/data.md` for the schema detail.

### i18n
Every user-facing string goes through `t(lang, "key")`. When you add a key:
1. Add it to `i18n.ts` (enUS dictionary).
2. Add the German translation to `i18n.de.ts`. TypeScript will fail the build
   if you forget — `de: Record<TranslationKey, string>`.

### Activity log
Mutations that create / update / delete tasks, RAID entries, shifts, or
absences should append an entry via `activity-log.ts` so the Activity tab
stays accurate. Keep entries short and translatable (use existing i18n keys
where possible).

### Versioning
On a noteworthy change, update `src/app/version.ts`:
- `APP_VERSION` (semver)
- `APP_BUILD_DATE` (ISO `YYYY-MM-DD`)
- The leading comment summarising the milestone
- `APP_HIGHLIGHT_KEYS` if a new highlight should appear in the Version popover

The Version popover, README banner, and CODEMAPS regen-date are the three
places that drift from each other most often — keep them aligned.

## Testing

Two layers are scaffolded (as of v0.7.1):

### Unit + component tests — Vitest

- Config: `vitest.config.ts` (jsdom env, `@` path alias, v8 coverage at 80%).
- Setup: `vitest.setup.ts` registers `@testing-library/jest-dom` matchers
  and RTL cleanup.
- Location: co-located with source as `src/**/*.test.{ts,tsx}`.
- Sample tests: `src/app/sanitize.test.ts`, `src/app/due-dates.test.ts`,
  `src/app/segmented-control.test.tsx`, `src/app/task-form-modal.test.tsx`,
  `src/app/bulk-edit-modal.test.tsx`.

```bash
npm run test           # watch
npm run test:run       # single run
npm run test:coverage  # with v8 coverage; fails below 70%
```

The coverage gate is **70%** (lines / functions / branches / statements) and is
scoped to the business-logic / data layer — React components (`*.tsx`), route
glue, the DE dictionary, and external-format serializers are excluded and
covered by component / E2E tests instead (see the `exclude` list in
`vitest.config.ts`). Storage tests run against an in-memory IndexedDB
(`fake-indexeddb`); some pure modules add property-based tests via `fast-check`.

### End-to-end — Playwright

- Config: `playwright.config.ts` (Chromium-only by default; Firefox / WebKit
  commented in). Auto-starts `npm run dev` on port 3000 (reuses an existing
  dev server locally; spawns fresh in CI).
- Location: `e2e/**/*.spec.ts` — kept out of `src/` so Vitest doesn't see it.
- Sample test: `e2e/smoke.spec.ts` (root page loads, title matches, `<main>`
  visible).

```bash
npm run e2e:install   # one-time: ~170 MB Chromium download
npm run e2e           # headless
npm run e2e:ui        # UI mode (useful while writing tests)
```

Artifacts (`/test-results`, `/playwright-report`, `/playwright/.cache`,
`/blob-report`) are gitignored.

### Pre-merge verification

In addition to running the suites:

1. `npm run build` — catches type errors and SSR/build issues.
2. Manual smoke check for anything you couldn't cover with a test:
   - Add / edit / delete a task; verify it persists across reload.
   - Open each tab (Chat, Reports, Gantt, RAID, Resources, Activity).
   - Switch language to German.
   - Export to one binary format (DOCX or XLSX) to confirm the lazy-loaded
     OOXML writer still works.
   - If you touched Jira: hit Sync against a real Atlassian project.

Critical flows still missing E2E coverage (write tests when you touch them):
Jira sync, storage backend switching, voice commands, OOXML export.

## Code style

- ESLint via `eslint-config-next` (typescript + core-web-vitals presets).
  Run `npm run lint` before opening a PR; CI does not currently enforce it.
- Prefer immutable updates (`...spread`) over mutation.
- Functions should stay short — `task-manager.tsx` is already too long; do
  not add to it without a reason. Prefer splitting new logic into a helper
  module or panel component.
- No `console.log` in committed code (logging utility TBD).

## Pull request checklist

Before opening a PR:

- [ ] `npm run build` passes locally.
- [ ] `npm run lint` is clean (or warnings are explained).
- [ ] New user-facing strings have both EN and DE translations.
- [ ] If you added a tab / popover / panel, the Help menu (`help-menu.tsx`)
      and Version highlights (`version.ts`) reference it where appropriate.
- [ ] If you changed the storage shape, the migration in `storage.ts` still
      reads legacy `localStorage` payloads correctly.
- [ ] `version.ts` is bumped if the change is user-visible.
- [ ] CODEMAPS (`docs/CODEMAPS/*.md`) is regenerated if you added / removed
      a top-level module or route — `npm run` does not regenerate these; use
      `/update-codemaps` or update by hand.
