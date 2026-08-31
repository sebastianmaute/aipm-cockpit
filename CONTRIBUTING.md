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
| `npm run stop` | Stop the dev server bound to the app port (default 3000; set PORT to override). Port-scoped — does not touch unrelated node processes |
| `npm run lint` | Run ESLint (`eslint-config-next` preset) |
| `npm run test` | Vitest unit/component tests in watch mode |
| `npm run test:run` | Vitest, single run (CI-friendly) |
| `npm run test:coverage` | Vitest + v8 coverage report (BLOCKING floors: lines 92 / statements 89 / functions 91 / branches 80, plus per-engine globs in vitest.config.ts) |
| `npm run test:shuffle` | Vitest at the SAME pinned seed as CI unit-tests-shuffled (BLOCKING) — reproduces an order-dependence failure locally |
| `npm run e2e` | Playwright functional E2E (smoke + app nav + a11y), headless — the CI suite |
| `npm run e2e:ui` | Playwright interactive UI mode |
| `npm run e2e:smoke` | Standalone smoke driver (scripts/e2e-smoke.mjs): seeds a project, walks every view, fails on any console/page error. Needs a running server |
| `npm run e2e:smoke:prod` | Smoke against a real, already-built production server (scripts/e2e-smoke-prod.mjs): starts `next start`, runs the smoke, stops it. Does NOT build — run `npm run build` first. The ONLY local reproduction of the prod CSP; `e2e:smoke` alone only ever meets the permissive dev policy |
| `npm run e2e:visual` | Playwright visual-regression snapshots (opt-in; baselines are per-platform — generate CI's in the Linux container) |
| `npm run e2e:visual:update` | Regenerate visual snapshot baselines for the current platform |
| `npm run e2e:crossengine` | Run e2e-crossengine/ in BOTH real Chromium and real Firefox (playwright.crossengine.config.ts, port 3300, workers=1). Covers behaviour the unit suite is structurally blind to, in two unrelated specs: popover focus (jsdom's element-removal focus semantics are Firefox's, so a Chromium-only defect stays green in vitest) and the dangling/blocked image marker's ::before glyph (jsdom computes no generated content at all, and the two engines resolve it differently). Runs in NO CI job. Needs Firefox installed (`npx playwright install firefox`) |
| `npm run e2e:install` | One-time: download Chromium browser binary |
| `npm run docs:scripts` | Regenerate AUTO-GENERATED scripts tables in repo docs from `package.json` |
| `npm run docs:scripts:check` | Verify AUTO-GENERATED scripts tables are in sync; exit non-zero on drift (CI mode) |
| `npm run dup:check` | Duplication gate for `src/` via jscpd — BLOCKING in CI (total duplicated-line % vs --threshold) |
| `npm run size:check` | Fail if a src file exceeds 800 lines or grows past its baselined size (ratchet) |
| `npm run docs:symbols:check` | Fail if AGENTS.md or any docs/AGENTS/*.md names a code symbol that does not exist (nothing else gates them) |
| `npm run docs:claims:check` | Fail if a doc gains a new `path:LINE` citation or cites a line that cannot exist (ratchet; prefer a symbol, a line number rots on any insertion above it) |
| `npm run followups:check` | Report which claims in docs/open-followups.md a machine can still check — REPORTING ONLY, never blocking, and it rules claims OUT rather than IN (a CLEAN entry may still be stale) |
| `npm run followups:status:check` | Fail if an OPEN docs/open-followups.md entry has no conforming `**Status:**` line (BLOCKING; exit 1 = drift, exit 2 = the gate could not scan at all) |
| `npm run rownames:check` | Enumerate where a per-row control's accessible name is composed and which surfaces a unit test asserts are distinct (WCAG 2.4.6) — REPORTING ONLY, never blocking, and a COVERED line is not evidence the test is non-vacuous |
| `npm run ooxml:manifest` | Regenerate the ordered OOXML part-manifest baseline (docs/baselines/ooxml-parts.json) — deliberate act only, never run to make a red pipeline pass |
| `npm run version:check` | Fail if a version restatement (package.json, lockfile, README badge, codemap headers) has drifted from src/app/version.ts |
| `npm run version:sync` | Propagate src/app/version.ts's version and codename to every restatement |
<!-- END AUTO-GENERATED -->

There is no separate `tsc` script — `next build` runs the TypeScript check
implicitly. To type-check without building: `npx tsc --noEmit`.

## Project layout

```
src/app/
├── api/                  — 12 same-origin proxy routes: jira/* (8), timelog,
│                            confluence/page, stt, ecb. The first 11 take a
│                            user-supplied host and are SSRF-guarded via
│                            api/_shared/proxy-ssrf.ts — reuse it, don't hand-roll.
│                            ecb is the exception: one hard-coded URL, no user input
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
├── documents-panel.tsx   — Documents tab (list / preview / toolbar leaves)
├── insights-panel.tsx    — Insights tab over the pure insights/ engines
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

`AGENTS.md` holds what applies to any task — commands, hard constraints,
architecture pointers. The per-subsystem deep reference lives in
[`docs/AGENTS/`](docs/AGENTS/) (dashboard · ui-shell · theming · insights ·
ai-assistant · integrations · platform · features): **open the file for the
subsystem you are editing.** Those files are not auto-loaded, so nothing will
put their landmines in front of you — you have to go and read them.

### TypeScript

- `strict: true`. No `any` in application code — use `unknown` and narrow.
- `TranslationKey` is derived from `keyof typeof enUS`. Adding an entry to
  `i18n.ts` automatically requires a matching German translation in
  `i18n.de.ts` (compile-time enforced).
- Path alias: `@/foo` → `./src/foo` (see `tsconfig.json`).

### Lazy loading
Heavy dependencies are dynamically `import()`'d to keep the cold heap small.
Established pattern, applied to every heavy dep in the table below:

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
`mini-css-extract-plugin` or `style-loader` — Next handles CSS internally, and
reaching for either of those in response to a CSS-HMR problem has already been
tried here and was a dead end.

Colours, shadows, and gradients are restricted to the sanctioned AIPM brand
tokens in `globals.css` — no off-palette colours, and no raw `shadow`/gradient
utilities (use the `--shadow-*` / `--gradient-*` role tokens where one is
genuinely needed). The `shell-palette-guard` / `palette-chrome-sweep` tests
enforce this and scan the **whole source, including comments**, so a stray raw
`shadow` (even `--shadow-card` written in a code comment) fails CI.
`ui-light-grey` is **not** a chrome token — `bg-` / `border-` /
`divide-ui-light-grey` is banned; use `ui-medium-grey` instead.

### State
The orchestrator component (`task-manager.tsx`, ~3.0k LoC) owns most state.
Modal bodies live in `task-form-modal.tsx` and `bulk-edit-modal.tsx`. No
external store (zustand / jotai / redux) is in the dep tree by design. New
state should slot into existing context providers / `useState` hooks unless
there's a strong reason to add a layer. Cross-cutting orchestration pulled out
of `task-manager` goes into a **deps-object hook** — see
[CODEMAPS/frontend.md](CODEMAPS/frontend.md).

### Storage
One logical document — `Workspace` — is saved **whole** through a facade
(`storage.ts`) to whichever backend is configured: JSON file, CSV, Markdown,
Turso (single-tenant or multi-tenant), or IndexedDB. There are no record-level
writes; `browser-backend.ts` is the IndexedDB adapter behind the same facade.
Settings + UI prefs live in `localStorage` under the `aipm-cockpit:*`
namespace.

The Workspace logical `SCHEMA_VERSION` (11, `workspace.ts`) is distinct from
the IndexedDB store version `IDB_VERSION` (6, `idb.ts`) and from the Turso DDL
`SCHEMA_VERSION` string ("12", `turso-schema.ts` / `turso-tenant-schema.ts`) —
three independent numbers, do not assume one tracks another. The dual-use
CSV/Markdown serializers must stay byte-identical on the storage round-trip
(the no-config path), so guard any export-only changes behind `ExportConfig`.

★ There is no longer a legacy-`localStorage` migration to preserve: the
one-time `lop-app` → `aipm-cockpit` rename migration was completed and
**removed** in 0.190.41. Earlier revisions of this file told you to keep that
path intact; there is no such path.

### Rich text
Seven fields hold rich HTML rather than plain text: `Task.description`, RAID
`description` + `mitigation`, Change `description` + `impactDescription` +
`resolutionNotes`, and `Milestone.description`. Plus the note log
(`Task.noteLog` / `RaidItem.noteLog` / `ChangeItem.noteLog` — three registers
since 0.245.0), which is separate and owns itself.

★★★ The note-log rules are **not uniform across the three registers**: the same
write-through defect is closed by a different mechanism in each, so copying one
register's fix to another is how two of them broke.
[`docs/AGENTS/rich-text.md`](docs/AGENTS/rich-text.md) owns that detail — read it
before touching any of them.

Five rules, each of which has already cost a bug:

1. **`rich-text-plain.ts` must never *call* DOMPurify.** It runs inside the
   entity sanitizers, which execute under bare Node in
   `scripts/generate-sample-workspace.ts`; DOMPurify binds `window` at module
   eval, so with no DOM the call throws and `jsonToWorkspace`'s catch-all turns
   it into an **empty** workspace that then "successfully" writes near-empty
   sample files. Importing from it is fine — a source-scanning test in
   `rich-text-plain.test.ts` enforces the no-call rule. Anything that genuinely
   needs a DOM lives in `rich-text-projection.ts` or `ai-rich-text.ts`.
2. **Migration is read-time, not write-time.** Decoders hand-build entities and
   do not normalise, so storage holds both plain-text and HTML shapes at once.
   Every *reader* upgrades: `descriptionHtml` at a DOM boundary,
   `descriptionText` for search / AI / previews. Grep the seven field names
   before adding a reader.
3. **A rich export column is a `RichCell`, not a string.** A column named in
   the matching `*_RICH_COLUMNS` set is emitted by `richCell` as
   `RichCell = { html, text }` (`ExportCell = string | number | RichCell`, guard
   `isRichCell`, flattener `cellText`). The DOCX and HTML/PDF renderers read
   `.html` and render real headings, lists and alignment; XLSX and both PPTX
   paths read `.text`, which comes from `descriptionTextWithBreaks` and keeps a
   paragraph boundary as `"\n"` — so those renderers must map that newline to
   their own primitive (one `<a:p>` per line) or they ship fused text.
   `descriptionText` is the OTHER projection: it collapses a paragraph boundary
   to a space, which is right for search / AI / previews and wrong for anything
   a human reads. A new export column joins `*_RICH_COLUMNS`. ★ CSV and Markdown
   are outside this entirely — `exportWorkspace` routes them to
   `workspaceToCsv` / `workspaceToMarkdown`, which never call
   `buildExportSections`, so they emit the stored HTML verbatim and a project
   round-trips without loss.
4. **Every write boundary must be upgrade-aware, and a model's write must also
   be allow-listed.** Use `sanitizeRichText` (never `plainToHtml`, which escapes
   `& < >` and would store literal tags). For anything the AI supplies, route it
   through `sanitizeAiRichText` / `withAiRichFields` — the DOM-free sanitizers
   cannot run an allow-list, so a model's `<script>` would otherwise reach all
   six backends.
5. **A second `useEditor` must pass `injectNonce: readCspNonce()`.**
   `@tiptap/core` injects the ProseMirror base stylesheet at runtime with
   `document.createElement("style")`, and the prod CSP is
   `style-src-elem 'self' 'nonce-…'` — so an un-nonced mount is refused and that
   editor renders with no base CSS (`white-space` falls back to `normal`,
   `position` to `static`). ★★ It is worse than one broken editor:
   `createStyleTag` DEDUPES on `style[data-tiptap-style]` and returns the
   existing tag, so whichever editor mounts FIRST wins for the whole page — one
   un-nonced mount poisons every later one. `rich-text-editor.tsx` is the app's
   only `useEditor` today; keep it that way if you can. ★ Dev cannot show you
   this (its CSP is the permissive branch) and neither can the unit suite (jsdom
   does not implement nonce hiding, so `getAttribute("nonce")` passes every test
   and returns `""` in a browser). `npm run e2e:smoke:prod` is the only check
   that sees it. See `docs/open-followups.md` §54.

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
Mutations that create / update / delete a task, RAID entry, change, document,
shift or absence should append an entry via `activity-log.ts` so the Activity
tab stays accurate. Keep entries short and translatable (use existing i18n keys
where possible), and stamp the actor — an entry records whether it was the user,
the assistant or an integration.

★★ It is **`Workspace.activityLog` — project data, not a per-device store.** It
moved out of localStorage in 0.239.0 and is persisted as a meta-blob on all six
write paths, which means a new field on an entry is a six-path change, not a
one-line one. It is also **storage-only**: it has no export key, deliberately,
because an entry's `changes` carries old and new values.
[`docs/AGENTS/activity-log.md`](docs/AGENTS/activity-log.md) owns the rest —
`logMode`, the two load funnels, and the three incompatible completion-trend
delta shapes.

### Dependencies

**Framework-coupled packages are pinned exactly, with no range:** `next`,
`react`, `react-dom`, `eslint-config-next`. Every other dependency carries a
caret so upstream fixes flow without a slice each. ★ Read that cost honestly: a caret admits
MINOR releases, not just patches — this section exists because `^16.2.11` ADMITS `16.3.2`. ★ It never resolved to it — no 16.3 tarball has
ever entered the lock (`git log --all -S'next/-/next-16.3' -- package-lock.json` is empty). The
risk was the specifier, not an install that happened.

`npm ci` — which is what all four CI install sites use — already installs
strictly from `package-lock.json`, so an exact pin is *not* what makes an
install reproducible. It protects the **specifier**, which is what a lockfile
merge conflict resolves against: a conflict resolved the wrong way is
committed, and CI then installs it faithfully and reports green.

For `next` specifically, a silent minor bump moves the tree off the version
the `AGENTS.md` opening warning is calibrated against — and every gate stays
green while it happens.

Adding a framework-coupled dependency? Pin it exactly and add it to this list.
Verify the current split with:

```bash
node -e "const p=require('./package.json');const all={...p.dependencies,...p.devDependencies};console.log(Object.entries(all).filter(function(x){return /^[0-9]/.test(x[1])}).map(function(x){return x[0]+'@'+x[1]}).join(', '))"
```

### Versioning
On a noteworthy change, update `src/app/version.ts`:
- `APP_VERSION` (semver)
- `APP_BUILD_DATE` (ISO `YYYY-MM-DD`)
- The leading comment summarising the milestone
- `APP_HIGHLIGHT_KEYS` if a new highlight should appear in the Version popover

Then propagate the version everywhere else it is written down — run
`npm run version:sync`, which rewrites every place in the table below from
`version.ts`. **`npm run version:check` compares all of them to `APP_VERSION`,
and the `version-sync-check` job is BLOCKING**, so drift now fails the pipeline
instead of accumulating silently. Hand-edit only if the gate reports a shape it
cannot anchor on — and fix the pattern in that case, never the file:

| place | what to change |
|---|---|
| `package.json` | `version` |
| `package-lock.json` | `version` **twice** — the root one and the `packages[""]` one |
| `README.md` | the shields badge — version **and** codename |
| `docs/CODEMAPS/*.md` (5 files) | the `<!-- Generated: … \| App <version> "<codename>" … -->` header, including the regen date and any file counts that moved |

This is not hypothetical, and the previous version of this paragraph was itself
wrong about it. On 2026-07-27 the badge and the codemap headers had drifted (badge
9 releases back at v0.194.0, codemaps ~50 back at the 0.145 era) and this file
recorded that `version.ts`, `package.json` and `CHANGELOG.md` "were all correctly
in sync" — presenting those three as the reliable ones. By 2026-07-30
`package.json` had been stuck at 0.203.0 for six releases and `package-lock.json`
at 0.199.0 for eleven. Only `version.ts` and `CHANGELOG.md` have actually held.
Do not treat any unchecked file as self-maintaining because it happened to be
correct once.

Two more that no gate checks: `docs/DESIGN-TOKENS.md` (it survived the
`--AIPM-*` → `--ui-*` rename with a stale prefix in its opening line) and the
generated `sample-workspace-{big,huge}.json` — regenerate those with
`npx vite-node scripts/generate-sample-workspace.ts` whenever a sanitizer changes
what a field serializes to, not only when the master changes.

## Testing

Five layers, all gating in CI:

| layer | runner | entry |
|---|---|---|
| unit + component | Vitest (jsdom) | `src/**/*.test.{ts,tsx}`, co-located |
| property | Vitest + fast-check | 22 `*.property.test.ts` files |
| e2e + a11y | Playwright | `e2e/{app,smoke,a11y,visual,print}.spec.ts` |
| prod-CSP smoke | `scripts/e2e-smoke-prod.mjs` | `npm run e2e:smoke:prod` — no spec file |
| gates | scripts | file-size ratchet · jscpd duplication · palette guards · Semgrep |

★★ The **prod-CSP smoke** is a layer rather than another Playwright spec because it is the only
one that runs against a real `next start`. The other four all meet the DEV policy, and dev grants
`'unsafe-inline'` on `style-src-elem` while prod is nonce-only (`src/proxy.ts`) — so a prod-only
defect that rendered EVERY rich-text editor unstyled was structurally invisible to all of them for
months (`docs/open-followups.md` §54). CI job: `prod-smoke`, BLOCKING.

### Unit + component tests — Vitest

- Config: `vitest.config.ts` (jsdom env, `@` path alias, v8 coverage).
- **Coverage floors are BLOCKING and are not 80%**: global lines 92 / functions 91 /
  branches 80 / statements 89, plus stricter per-engine globs (e.g. `next-actions/**`
  lines 97, `sanitize*.ts` branches 94). `npm run test:run` does **not** enforce them —
  only `npm run test:coverage` does, so a new coverage-gated file can be green locally
  and fail the CI unit job.
- Setup: `vitest.setup.ts` registers `@testing-library/jest-dom` matchers
  and RTL cleanup.
- Location: co-located with source as `src/**/*.test.{ts,tsx}`.
- Sample tests: `src/app/sanitize.test.ts`, `src/app/due-dates.test.ts`,
  `src/app/segmented-control.test.tsx`, `src/app/task-form-modal.test.tsx`,
  `src/app/bulk-edit-modal.test.tsx`.

```bash
npm run test           # watch
npm run test:run       # single run
npm run test:coverage  # with v8 coverage; fails below the floors below
```

The global coverage floors are **lines 92 · functions 91 · statements 89 ·
branches 80**, plus tighter per-engine globs in `vitest.config.ts` (e.g.
`next-actions/**` at lines 97 / branches 90, `sanitize*.ts` at 95 / 94). They
are scoped to the business-logic / data layer — React components (`*.tsx`), route
glue, the DE dictionary, and external-format serializers are excluded and
covered by component / E2E tests instead (see the `exclude` list in
`vitest.config.ts`). Storage tests run against an in-memory IndexedDB
(`fake-indexeddb`); some pure modules add property-based tests via `fast-check`.

**Test-only helpers live in `src/test/`** (e.g. `msw-server.ts`,
`toolbar-order.ts`), imported as `../test/<name>`. That path is coverage-excluded
in `vitest.config.ts` and nothing in the app graph imports from it, so helpers
never reach the bundle. Do **not** put a shared test helper under `src/app/` — it
becomes coverage-gated production code.

**Prove a new test can fail.** A test written after the fix passes immediately,
which proves nothing on its own. Either watch it fail first, or revert the fix
and confirm the test dies. Recurring traps in this codebase that make a green
test meaningless:

- `t(lang, key)` returns `undefined` for a key that doesn't exist, so an
  assertion against a mistyped key can pass trivially — and jest-dom's
  `toHaveAttribute(name, undefined)` silently degrades to an existence check.
- `getByRole(..., { name: undefined })` drops the name filter entirely.
- A `<select>` whose value matches no option falls back to its first option, so
  it reads the same whichever source it is bound to.
- `Array.findIndex` returns `-1`, which compares as "before everything" — anchor
  the first index with an explicit `>= 0` before chaining `toBeLessThan`.
- Asserting a substring of a class name can pass for a variant that breaks the
  behaviour (`…:appearance-none` vs `…:block`); assert the whole token.
- A fixture that never reaches the code path under test (e.g. a person with no
  work, when the bug only appears once they own some) passes for the wrong
  reason.

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
2. `npm run e2e:smoke:prod` — build FIRST; it does not build. ★★ Required if you
   touched the CSP, `layout.tsx`, `src/proxy.ts`, or added a dependency that
   injects a `<style>` or `<script>` at runtime. It is the only check that meets
   the PROD policy; every other suite meets the permissive dev one.
3. Manual smoke check for anything you couldn't cover with a test:
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
  Run `npm run lint` before opening a PR. ★ CI DOES enforce it — the `lint` job
  carries no `allow_failure`, so it blocks. (This line previously said CI did not;
  corrected 2026-08-09 against `.gitlab-ci.yml`.) ★★ And `npm run lint` is
  `eslint --max-warnings=0`, so a WARNING fails the job exactly as an error
  does — all 25 severity-1 rules included, among them
  `react-hooks/exhaustive-deps` and six `jsx-a11y` rules.
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
