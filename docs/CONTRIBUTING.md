# Contributing

Working notes for anyone editing this repo. Architecture reference lives in
[CODEMAPS/](CODEMAPS/); this file covers process, conventions, and the moving
parts a contributor needs day-to-day.

## Prerequisites

- **Node.js 20+** (Next.js 16 requires it).
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
| `npm run dev` | Start Next.js dev server with hot reload on `http://localhost:3000` |
| `npm run build` | Production build — runs TypeScript type-check, then emits `.next/` |
| `npm run start` | Serve the production build (run `npm run build` first) |
| `npm run lint` | Run ESLint (`eslint-config-next` preset) |
<!-- END AUTO-GENERATED -->

There is no separate `tsc` script — `next build` runs the TypeScript check
implicitly. To type-check without building: `npx tsc --noEmit`.

## Project layout

```
src/app/
├── api/jira/             — thin CORS proxy routes (route.ts per endpoint)
├── task-manager.tsx      — god-component; owns most client state
├── chat-panel.tsx        — Claude chat tab
├── gantt.tsx             — Gantt chart tab
├── raid-panel.tsx        — RAID register tab
├── resources-panel.tsx   — Resources tab + calendar
├── activity-log-panel.tsx — Activity log tab
├── reports.tsx           — Reports tab
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
A single god-component (`task-manager.tsx`, ~4k LoC) owns most state. No
external store (zustand / jotai / redux) is in the dep tree by design. New
state should slot into existing reducers / `useState` hooks unless there's a
strong reason to add a layer.

### Storage
Tasks and RAID live in `IndexedDB` with record-level writes (see
`storage.ts`). Settings + UI prefs live in `localStorage`. Legacy
`localStorage` task data migrates on first load — keep that migration path
intact if you touch `storage.ts`.

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

There is **currently no test suite** in this repo (no Jest, Vitest, or
Playwright config). Verification before merging means:

1. `npm run build` — catches type errors and SSR/build issues.
2. Manual smoke test in a browser:
   - Add / edit / delete a task; verify it persists across reload.
   - Open each tab (Chat, Reports, Gantt, RAID, Resources, Activity).
   - Switch language to German.
   - Export to one binary format (DOCX or XLSX) to confirm the lazy-loaded
     OOXML writer still works.
   - If you touched Jira: hit Sync against a real Atlassian project.

Adding a test framework is on the wish-list — start with Playwright for the
critical Jira-sync and storage flows.

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
