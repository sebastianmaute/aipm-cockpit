<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Contents

Read [Commands](#commands) and [Hard constraints](#hard-constraints)
before your first edit — the rest is reference, reachable from here.

**In this file** (always loaded):

| | |
|---|---|
| [The doc set](#the-doc-set--what-lives-where) | which doc owns what — read before restating a fact in a second file |
| [Commands](#commands) | every script + the CI gotcha that bites for each |
| [Hard constraints](#hard-constraints) | i18n · byte-stable serializers · palette · a11y gate · six write paths · secrets · CSP |
| [Architecture pointers](#architecture-pointers) | orientation, module maps, extraction conventions, panel splits, toolbar order |
| [Subsystem reference](#subsystem-reference--deeper-detail-loaded-on-demand) | every file in `docs/AGENTS/`, and why they are not loaded |

**In `docs/AGENTS/`** (NOT loaded — open the one you need):

| | |
|---|---|
| [dashboard](docs/AGENTS/dashboard.md) | delta strip · KPI trends · arrangeable tile grid · coaching · density · digest |
| [accessibility](docs/AGENTS/accessibility.md) | the axe gate · accessible + row-unique names · label-in-name · toggle state · what axe cannot see |
| [ci](docs/AGENTS/ci.md) | the GitHub Actions jobs and required checks · `release.yml` (tag-triggered releases) · the weekly workflow · a red check, minutes exhausted |
| [ui-shell](docs/AGENTS/ui-shell.md) | Help · nav · focus/keyboard · surfaces · tables (`SortResizeTh` · `TableFilter`) · ★ **dismissal owns the Escape/Tab protocol — read it before touching any modal, popover or panel** |
| [theming](docs/AGENTS/theming.md) | colour schemes · `--ui-*` tokens · AA derivation · branding · print · DS primitives |
| [insights](docs/AGENTS/insights.md) | detect · reconcile · recommend · outcome · digest |
| [ai-assistant](docs/AGENTS/ai-assistant.md) | wire layer · tools · write-concurrency tokens · inline edit · dedup · scheduled jobs |
| [integrations](docs/AGENTS/integrations.md) | steering committee · calendar write-back + two-way pull · Timelog |
| [platform](docs/AGENTS/platform.md) | diagnostics · guard transparency · dictation · AI master switch · the load hold (§548) |
| [features](docs/AGENTS/features.md) | guided tour + demo · timezones · saved views · PWA · resource calendar meetings |
| [documents](docs/AGENTS/documents.md) | version before-images · retention + tombstones · the single mutation path · `documentVersions` across the six write paths · surfaces + the block editor |
| [rich-text](docs/AGENTS/rich-text.md) | note logs · the seven rich fields · DOM-free vs browser-only · sanitizers + model-write boundaries · export fidelity · the toolbar |
| [activity-log](docs/AGENTS/activity-log.md) | meta-blob persistence · `logMode` · actors · forward-compat sanitising · the three completion-trend delta shapes |
| [task-status](docs/AGENTS/task-status.md) | the `status` ⟺ `completedDate` pair · the five writers · load does NOT repair a split pair · `isTaskClosed` vs `isTaskDelivered` |
| [task-manager](docs/AGENTS/task-manager.md) | the orchestrator's decomposition map — every extracted `use*` hook and `build*` builder, coverage-gated or excluded, and why |
| [budget](docs/AGENTS/budget.md) | the EUR boundary (`fx.ts`) · plan currency on load · budget follows plan · earned value · the Budget panel's cell layer |
| [undo](docs/AGENTS/undo.md) | what is undoable · creates · label registrations · rows vs patches · the redo arm |
| [desktop](docs/AGENTS/desktop.md) | Electron runtime · port · sign-in popup · print · PDF · updater |
| [storage](docs/AGENTS/storage.md) | the backends · load and save paths · decode diagnostics ("Saving paused") · unload journal · recovery + reset |

Conventions used throughout: **★** = a non-obvious rule, **★★** = something that has already
caused a bug, **★★★** = something that has caused the same bug more than once. Open follow-ups
live in [`docs/open-followups.md`](docs/open-followups.md), not here.

★★★ **Almost nothing gates these files, and the one gate that exists checks the weakest property.**
`agents-symbol-check` (`npm run docs:symbols:check`) fails when a backticked name in THIS file or in
any `docs/AGENTS/*.md` exists nowhere in `src`/`scripts`/`e2e`/`desktop/src`/`desktop/scripts`. That is all it does: it proves a NAME
is real, never that a CLAIM about it is true. "`sanitizeX` guards this path" passes the gate whether
or not that path calls it. ★★★ NARROWER STILL — **it only checks MIXED-CASE names, so every
backticked `SCREAMING_CASE` constant in AGENTS.md and every file in `docs/AGENTS/` is completely ungated.** The scan requires
both a lowercase and an upper/underscore character (`check-agents-symbols.mjs`, the "mixed case only"
guard), so `HELP_ENTRIES`, `TABLE_NAMES`, `CONFIG_KEYS`, `A11Y_VIEWS` and every peer are skipped
outright — a deleted one goes on being documented as current forever. Verified 2026-08-05 by probe,
not by reading: injecting two backticked names that never existed — one SCREAMING_CASE, one camelCase
— into a doc failed the gate on the camelCase one ALONE. (Deliberately un-backticked here: quoting a
fake identifier in backticks makes the gate flag THIS file, which is the gate working.) It cost real work — a `HELP_SECTIONS` export deleted from the
code stayed described as live here and in `docs/AGENTS/ui-shell.md`, and a whole slice was scoped
around the behaviour that prose implied. Do not read a green run as covering a constant.
★★ It cannot see a COUNT either — "the 20 lazy panels" passed every run
while the number was 23, and two of five counts sampled on 2026-08-04 were wrong. A count is the
easiest claim to check and the easiest to leave rotting: put the reproduce command beside it.

★★ It exists because a false NAME does not stay in the doc. `migrateTaskStatus` — a function that
never existed — was read by three contributors in one release; each grepped `src/`, found nothing to
contradict it, and wrote the claim into code comments and a commit message as justification for
editing test fixtures. The gate catches that class at the source.

★★ Deliberately-absent names are fine and are most of what it had to learn to ignore: prohibitions
("was removed. Do NOT reintroduce it"), rejected designs ("evaluated and deliberately NOT built"),
retired modules. Say so NEAR the mention using one of the script's `ABSENCE_MARKERS`; genuinely
non-repo names (browser APIs, upstream API fields) go in its allowlist WITH a reason. Never widen
either to make a pipeline pass — a defeated gate reports success.

★★ Everything else here is still ungated. Every claim was true when written and some have outlived
their code — six false clusters were found and fixed on 2026-07-30 alone, one of them restated four
times (a bundled-themes directory that does not exist), and 0.213.0 found eight more. Before relying
on a specific claim (a path, a count, a call site, "X is guarded"), **grep it.** Correct what you
disprove, in the same commit.

## The doc set — what lives where

| File | Owns |
|---|---|
| **AGENTS.md** (this file) | ALWAYS LOADED. Landmines and hard constraints that apply to any task, plus the architecture pointers and module maps. |
| [`docs/AGENTS/`](docs/AGENTS/) | NOT loaded. The per-subsystem deep reference this file used to carry inline — same conventions, same gate. Open the one you are working in. |
| [`docs/CODEMAPS/`](docs/CODEMAPS/) (5 files) | layered overview — architecture · frontend · backend · data · dependencies. Read these FIRST for shape; AGENTS.md + `docs/AGENTS/` for detail. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | process + conventions: setup, scripts, testing layers, release checklist. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | operations: build, deploy, rollback, secrets, and a symptom-indexed "common issues" list. |
| [`docs/open-followups.md`](docs/open-followups.md) | every known-open defect and deferred decision, numbered. |

★ A fact belongs in ONE of these. When it must appear twice, the second copy links rather than
restates — four restatements of the same claim is how `public/themes/*.json` survived in this file
long after the directory it named stopped existing.

## Commands

★★★ One line per command and its main trap. The full notes — every measurement and failure story behind these
lines — are in [`docs/AGENTS/ci.md`](docs/AGENTS/ci.md) "Gate gotchas". Read that entry before relying on, or
editing, a gate.

```bash
npm run dev                 # next dev on :3000; `next` is exact-pinned (CONTRIBUTING.md "Dependencies")
npm run build               # next build (prebuild checks script-docs are in sync)
npm run lint                # eslint --max-warnings=0 — ★★★ EVERY warning is FATAL, unused `_` params included.
                            # `react-hooks/set-state-in-effect` is banned: use the render-time reconcile pattern.
                            # No `Date.now()`/`new Date()`/`Math.random()` in a render body; hoist an `obj.member`
                            # dep to a local const. CI lints the whole repo, not one directory.
npx tsc --noEmit            # typecheck + i18n EN/DE key parity. ★★ vitest never typechecks — run it after editing
                            # ANY test. A pass is exit 0 with ZERO errors in total. Trust tsc, not IDE squiggles.
                            # RTL's string `name` is already exact; Playwright's `getByRole` name is a case-
                            # insensitive SUBSTRING unless `exact: true` — pass it in e2e specs.
npm run test:run            # vitest (20s test timeout). `--maxWorkers=N` exists; `--minWorkers` and
                            # `--reporter=basic` do NOT (use `--reporter=dot`). ★★★ A StrictMode test composed
                            # inside a wrapper is VACUOUS-BUT-GREEN: read `src/app/strictmode.meta.test.tsx` first.
                            # ★★ `onTestFailed` runs AFTER every `afterEach` — mocks and DOM are already reset.
npm run test:shuffle        # the same command as CI's BLOCKING `unit-shuffled` job — run before adding or reordering tests
npm run test:coverage       # vitest + coverage floors (BLOCKING in CI; `test:run` does not enforce them)
npm run e2e                 # playwright, incl. the axe a11y gate
npm run e2e:smoke           # fast subset; e2e:visual / e2e:visual:update / e2e:ui / e2e:install
npm run e2e:smoke:prod      # smoke against a REAL production server (build first) — ★★★ the ONLY local repro of
                            # the prod CSP (dev allows 'unsafe-inline'); owns port 3200
npm run dup:check           # jscpd GATE on the TOTAL duplicated-LINE % (BLOCKING); bisect by exit code
npm run size:check          # file-size ratchet; LIMIT in `scripts/check-file-sizes.mjs`, counted as `wc -l` + 1.
                            # ★★★ never run `--update`: it drops the baseline headroom and deletes rows
npm run docs:claims:check   # doc `path:LINE` citation RATCHET (BLOCKING) — proves a line COULD exist, never that
                            # the cite is right. Cite the SYMBOL, not a line.
npm run stop                # kill ONLY the dev server on the app port — never a blanket `taskkill /IM node.exe`
npm run followups:check     # REPORT only (exits 0 always) — CLEAN rules claims OUT, never IN
npm run followups:index:check # register heading ⟺ index-row GATE (BLOCKING): exit 1 = drift, exit 2 = could not scan
npm run src:symbols:check   # REPORT: backticked names in `src/` comments that resolve nowhere in code
```

★★★ **NEVER READ A GATE'S EXIT CODE THROUGH A PIPE — you get the PIPE's status, not the command's.**
`npm run test:run | tail -8` exits **0 while tests are failing**, because that is `tail`'s status; the
pipe also DISCARDS the failure diagnostic, so the obvious re-run tells you nothing either. Same shape
with grep: `npx eslint --max-warnings=0 src/app | grep -v notice` reports **1** when eslint passed and
grep simply matched nothing — a pass that reads as a failure, and a failure that reads as a pass, from
the same mistake. Both directions were hit in one session, the first causing a failing suite to be
reported as green **after** the trap had already been flagged twice.
★ Do this instead — redirect, check unpiped, then read the file:
```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"        # no pipe at all
```
★★ This matters more here than in most repos: the gates ARE the safety net, and a defeated gate is
worse than no gate — it reports success. A "green" claim is only worth what the exit code behind it is.

## Hard constraints

- **i18n:** `i18n.ts` (EN) + `i18n.de.ts` (DE) key sets must be identical (tsc enforces).
  DE must use real German umlauts — `i18n-encoding` test BANS ASCII subs (fuer/druecken).
  ★★★ **`sed -i` UNDER GIT BASH RE-LINES A WHOLE CRLF FILE TO LF, AND `core.autocrlf=true` HIDES
  IT FROM THE DIFF.** The OPPOSITE failure from the node-anchor one below — not a silent no-op but a
  silent whole-file rewrite. `src/**` carries no `.gitattributes` entry (`git check-attr -a
  src/app/icons.ts` prints nothing), so `autocrlf=true` governs it alone: blobs are LF, the working
  tree is CRLF. A `sed -i` re-lines the working copy to LF, which then CLEANS to the very same blob,
  so the diff body shows only the lines you meant to change. Measured 2026-08-23 in a throwaway repo:
  a 10-line CRLF file, one substitution, `git diff --stat` reporting 1 insertion / 1 deletion while
  the file lost exactly one byte per line — 10 CRLF became 0, and the byte count fell by 10. ★ The
  DELTA is the reproducible part; an earlier revision quoted absolute byte counts (150 → 140) that
  depend entirely on the fixture's line contents, which the sentence never gave, so nobody could
  reproduce them and a re-run at a different fixture size looked like a contradiction. ★★ The SAME
  experiment at `autocrlf=false`
  reports 10 insertions / 10 deletions — that control is what pins the attribution; without it this
  is a correlation.
  ★★ **IT CANNOT REACH THE REPOSITORY, which is the half that decides how much to care.** The clean
  filter normalises either way, so the re-lined file commits to the byte-identical blob a
  CRLF-preserving edit would have produced (measured with `git hash-object --path`). The damage is
  LOCAL: it survives commits with `git status` reporting clean, and is undone the next time git
  checks the file out. A hygiene trap, NOT a way to ship a defect — an earlier revision here implied
  otherwise.
  ★★ **And git DOES warn**, once per file, on `git diff` and `git add` (never on `git status`, in
  either form) — so “invisible” was wrong too. The warning goes to STDERR, so it vanishes the moment
  the command is piped or redirected: the same trap as the exit-code-through-a-pipe rule above.
  ★ Check a file by hand — 0 means CRLF-clean. Run it against a known-LF file too, or you cannot
  tell a working check from a vacuous one:
  ```bash
  node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');console.log((s.match(/(?<!\r)\n/g)||[]).length)" <file>
  ```
  ★★ That line MUST carry the two-character escapes backslash-r and backslash-n. The first version
  of it shipped with REAL CR and LF bytes in the regex — the only stray CR byte in this entire file
  — and a JS regex literal cannot span a newline, so it died with an unterminated-regexp error for
  every reader who pasted it. `file <path>` discriminates on a trailing “, with CRLF line
  terminators” suffix and has no escapes to corrupt — ★★ match on THAT SUFFIX, not on a full
  string: an earlier revision quoted “ASCII text, with CRLF line terminators”, and for this repo's
  sources `file` actually prints `JavaScript source, Unicode text, UTF-8 text[, with CRLF line
  terminators]`, so a reader grepping for “ASCII text” sees no match and concludes nothing. Run it
  against a known-CRLF and a known-LF file together or the check is vacuous. ★★ `git ls-files --eol
  <file>` is the durable check, because it reports the INDEX and the WORKING TREE separately, which is
  the distinction this whole bullet turns on: `i/lf w/crlf` is healthy here, `i/lf w/lf` is re-lined.
  ★ Never name a specific file as a re-lined example — that state is local to one working tree, so the
  claim refutes itself on every other machine.
  Edit tool corrupts umlauts AND curls double-quotes in `i18n.de.ts` (bites umlaut-free
  strings too); patch via node utf8 write, re-verify. File is CRLF — a node
  replace whose anchor uses `\n` silently no-ops; match `\r\n`.
  Interpolated strings use 0-based positional placeholders: `t(lang, key, a, b)` → `{0}`/`{1}`.
  `Lang` is `"en-US" | "en-GB" | "de"` — NO `"en"` (legacy runtime alias only, invalid
  as TS literal; `t(lang, …)` calls + component tests must use `"en-US"`). DE dict lazy —
  test asserting DE output must call `loadI18n("de")` (e.g. in `beforeAll`) before assertion.
- **Byte-stable serializers:** `golden-workspace.test` pins exact CSV/Markdown storage bytes.
  Failure usually means real format change — only regenerate `__fixtures__` when the
  *input* (`sample-workspace-small.json`) legitimately changed, never to mask format diff.
  Renaming/moving sample data or any asset: grep `e2e/` TOO (not just `src scripts README docs`) —
  `e2e/seed-workspace.ts` (imported by `e2e/seed.ts`) reads `sample-workspace-small.json` at MODULE TOP-LEVEL, so a stale path ENOENTs the
  whole e2e job, and — since §99 — the unit job and local vitest too, because `src/app/idb-layout.test.ts` imports that module
  (`npx playwright test --list` also triggers the read without browsers).
- **Palette:** only sanctioned brand tokens (`globals.css`); no off-palette colors,
  gradients, shadows. a11y gate + palette-sweep test enforce contrast/token use.
  Note: palette-sweep scans CSS for `box-shadow` — an off-palette Tailwind class (e.g. `shadow-md`)
  on element PASSES CI but still forbidden; check new components by eye.
  ★ Tailwind v4 auto-scans ALL repo files (incl. `.md`/comments) for class candidates — NEVER put a
  `*` wildcard inside a Tailwind arbitrary-value bracket (a `--foo-*` glob inside `[var(…)]`) in ANY
  tracked file; Tailwind emits it as invalid CSS and `globals.css` fails to compile → app 500s.
  Use a real token name in examples (e.g. `shadow-[var(--shadow-card)]`); write token FAMILIES as bare
  `--foo-*` globs outside any Tailwind bracket.
- **a11y (axe gate) → [`docs/AGENTS/accessibility.md`](docs/AGENTS/accessibility.md).** Every new
  interactive control (button/checkbox/input/drag handle) needs an accessible name + keyboard
  operability; `placeholder` is NOT an accessible name, and an unlabeled form control is axe-critical
  FAIL. Per-row controls in a list need a row-UNIQUE name (`buildRowTokens`/`rowLabel`).
  ★★★ A green axe run is SILENT on duplicate accessible names, on WCAG 2.5.3 label-in-name and on
  colour-only toggle state, in every view at every seed size — only a UNIT test catches those. Use
  `ToggleButton`/`SegmentedControl`, never a hand-rolled `aria-pressed` button. Open that file before
  adding a control, a view or a toggle: what `A11Y_VIEWS` does NOT scan, and running it locally, are there.
  Before pushing an IA/UI/contrast change, run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"`: the unit suite never runs axe, so otherwise it fails only in CI.
  Add `--workers=1` when `-g` matches more than one view: CI runs axe serially, and local contention fails tests as timeouts, not violations.
  After a `globals.css` `@theme` edit, run axe on a FRESH server, never a reused one: since §58 (b) a plain run boots its own, so give it a free port (`PORT=3100 npx playwright test ...`).
- **CI is GitHub Actions → [`docs/AGENTS/ci.md`](docs/AGENTS/ci.md).** `.github/workflows/ci.yml`
  runs on every pull request and every push to `main`; its eight job ids ARE the required checks on
  the `main` ruleset (`static` · `unit` · `unit-shuffled` · `build` · `e2e` · `prod-smoke` · `semgrep`
  · `audit`), and `scripts/ci-workflow.test.mjs` fails when the workflow, the gate list in
  `scripts/gate-local.mjs` and the list in `docs/AGENTS/ci.md` disagree. ★★ `gate-local.mjs` is the
  ONE gate list: a new blocking npm gate goes there with a group, never straight into the YAML.
  `npm run gate:local` is the pre-push check, no longer the merge gate. ★★ While the repository is
  private, Actions minutes come from GitHub Pro's allowance with a $0 budget; when they run out,
  checks cannot complete and merging needs the admin bypass on a `gate:local` PASS — see
  `docs/RUNBOOK.md`. Several gates split exit **1 = DRIFT** from exit **2 = could not scan**, and the
  two demand opposite responses. Releases run from `.github/workflows/release.yml` on a push of a
  `v*` tag (`guard` → `build` → `publish`; `publish` pauses for the owner's approval, a
  required-reviewer rule on the `release` environment since flip step 10a) — see the "Releasing"
  bullet below and
  [`docs/AGENTS/ci.md`](docs/AGENTS/ci.md)'s `release.yml` section. The GitLab pipeline file
  (`.gitlab-ci.yml`) is gone; the GitLab project is a READ-ONLY mirror synced daily by
  `ci/gitlab-sync.yml`. New CI gate → also update `docs/AGENTS/ci.md`.
- **Releasing:** bump `src/app/version.ts` (APP_VERSION + APP_BUILD_DATE + milestone), add
  `CHANGELOG.md` entry (a section for the version — `release:publish` refuses to build notes
  without it), merge to `main`, and tag only from `main`. ★ Do NOT add a `versionHighlight*` key:
  `APP_HIGHLIGHT_KEYS` is now a fixed elevator pitch of what is unique to the app, not a per-release
  history, and `CHANGELOG.md` owns history. ★★ EVERY OTHER COPY OF THE VERSION IS GATED BY
  `npm run version:check`, and the list is
  `SATELLITES` in `scripts/version-sync-lib.mjs` — not this line, which said "FIVE MORE PLACES" and
  missed `desktop/package.json` + `desktop/package-lock.json`. Read it with
  `grep -n 'file: "' scripts/version-sync-lib.mjs` (one line per file or glob; each lockfile carries
  TWO occurrences); CONTRIBUTING.md's Versioning section says what changes in each and why the
  gate exists.
  Propagate them with `npm run version:sync` rather than editing each by hand — the
  `version:check` step of CI's `static` job is BLOCKING, so drift now fails CI instead of accumulating.
- **New persisted `Workspace` field → SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/
  IndexedDB). Miss one and data silently drops on that backend. `calendarEvents`
  ("Resource calendar meetings" below) is a worked example — one `ENTITY_SPECS` row buys BOTH Turso layouts;
  CSV and Markdown still need a hand-written section each. Their writers (`calendarEventsToCsv`,
  `calendarEventsToMarkdown`, the latter with its own `EVENTS_MD_COLUMNS`) encode cells with the row encoder
  `calendarEventFieldToString`, and their decoders use `buildCalendarEventFromObj`, the row decoder the spec
  also uses. (Corrected 2026-09-28: this said one row "buys three of the six".)
  ★★ `activityLog` ("Activity log" below) is the CONTRASTING worked example, and the cheaper shape is the
  reason: a **meta-blob** slice has no `ENTITY_SPECS` row, so it buys nothing and needs all six written by
  hand — and the Turso TENANT path was the one missed, caught in review rather than by any gate.
  ★ `entity-persistence-registry.test.ts` carries meta-blob round-trips at DIFFERENT widths, so read the
  row you need rather than the file's name: `documents` CSV + Markdown, `documentVersions` CSV + Markdown
  + JSON (`sanitizeDocumentVersions` plus a rich-field pass makes JSON a real filter there — the file's
  own comment says so), `activityLog` CSV + Markdown only. For `activityLog` neither Turso layout, nor
  JSON, nor IndexedDB is exercised there, so a green run says nothing about four of the six; its JSON
  path is pinned separately in `workspace.test.ts` ("round-trips activityLog through JSON"). ★★ An
  earlier revision of this line said "only over the two TEXT backends … nor JSON", which was false about
  the very file it was describing — that file imports `jsonToWorkspace` and calls the exception out.
  Count to six yourself, per slice.
- **New COLUMN on existing entity** (e.g. `Milestone.outlookEventId`): add to entity's
  `*_CSV_COLUMNS` (in `csv-codecs-core.ts` — covers CSV **and** Turso single+tenant, DDL/insert
  derive from it; also extend that entity's `*FieldToString`/`build*FromObj` THERE), plus the
  markdown codec (`*_MD_COLUMNS` + table codec in `markdown-codecs-core.ts`) + `sanitize.ts` (see
  "Codec module maps" / "Sanitize module map" for which sub-file); REGENERATE `__fixtures__/golden-*`
  (legit new-column format change) — the sample workspace is JSON-only now (no curated `.md`/`.csv`
  sample to hand-edit); add the column to `sample-workspace-small.json` if it needs sample coverage.
  EXISTING Turso DBs:
  `CREATE TABLE IF NOT EXISTS` can't add column and save INSERTs *named* columns, so old DB
  errors on save — `turso-migrate.ts` self-heals (PRAGMA-diff → `ALTER ADD COLUMN`, run inside
  write lock before save).
- **Turso-gated features** (Snapshots/Trends, version history, Portfolio health) must check
  `tursoConfig !== null`, not just `storageConfig.kind === "turso"` (kind can be set while config
  unset/quarantined). Nav-gating: add the view to `TURSO_ONLY_VIEWS` (`nav-config.ts`) → `filterNavGroups`
  prunes it from the sidebar in file mode (so it can't render a dead tab); the panel STILL runtime-guards.
  ★ such a view is NOT reachable by the file-mode e2e seed → keep it OUT of `A11Y_VIEWS` (unit/eye-verify).
  ★★ A REGION-QUALIFIED Turso host (`<db>-<org>.aws-eu-west-1.turso.io`) is VALID — it is what `turso db show`
  officially prints. `turso-config.ts` once carried an `isLikelyRegionQualifiedTursoUrl` guard driving a
  settings banner that told users to strip the region segment; that advice was wrong and the helper, banner
  and `tursoUrlRegionWarning` strings were all removed. Do NOT reintroduce it.
- **CSP allowlist:** every host BROWSER calls (Turso, Anthropic, MS Graph, MSAL, Jira) must be in
  `src/proxy.ts` `connect-src`/`frame-src` — NOT `next.config`. Missing host fails only at RUNTIME
  (unit tests mock `fetch`; `next build` passes), so silently slips through CI. CSP edits need dev-server restart.
- **New Turso table NOT workspace data** (snapshots, version history, comm_templates)
  must stay OUT of `TABLE_NAMES` (guard test enforces) — else workspace save's
  per-table DELETE wipes it. `SqlArg.value` (turso-schema) is string-only even for ints (`String(v)`).
  ★★★ **A NEW `ENTITY_SPECS` ENTITY WHOSE `id` IS A STRING MUST DECLARE `idKind: "text"`, AND
  FORGETTING IT BREAKS EVERY SAVE.** `colDdl` renders any column named `id` as
  `id INTEGER PRIMARY KEY` — a rowid alias, the one column type SQLite ENFORCES — and
  `insertStmt`/`tenantInsert` bind it as `{type:"integer"}`. Every spec minted a number until
  `DocumentAsset` (a `crypto.randomUUID()`), whose INSERT rides the SAME `BEGIN…COMMIT` as tasks,
  RAID, milestones, plan and meta: a real engine answers `datatype mismatch` and EVERY save then
  reports failure.
  ★★★ **A PIPELINE OF SEPARATE `execute` REQUESTS DOES NOT STOP AT A FAILING STATEMENT.** It
  errors that ONE statement and keeps executing, so COMMIT runs and commits everything that
  succeeded — measured against a live database and pinned by `turso-ddl-probe-live.spec.ts`'s
  "the pre-idKind DDL rejects the insert — and the batch still COMMITS around it". Until §637 the
  save was sent that way, so the user saw a failed save **while the workspace was written, minus
  the rejected row**. Since §637 `runTursoPipeline` sends a BEGIN…COMMIT list as ONE Hrana
  `batch` whose steps each run only if the previous one succeeded, with a ROLLBACK step when
  COMMIT did not: a failed save now writes nothing. The same spec's "§637 — … through
  runTursoPipeline writes nothing" checks that, and passed against a live database on 2026-10-10;
  a live mutant that dropped the step conditions made it fail on the surviving co-resident write
  (register §637). ★ Both SKIP unless the throwaway pair `TURSO_THROWAWAY_*` is set
  (`e2e/live-turso-env.ts`) and run only through `npm run e2e:live-destructive`, so CI is green on
  them and silent about this: the claim is only ever re-checked by someone running them against a
  real Turso project.
  `EntitySpec.idKind`
  defaults to `"integer"`, so an omission is silent at every layer that does not execute SQL — and
  a DDL-string-matching test cannot see it either (`entity-persistence-registry.test.ts` never
  executes a statement). `turso-schema.execute.test.ts` runs the real statements against
  `node:sqlite`, generalised over `ENTITY_SPECS`, so a new entity is pinned without being named.
  Enumerate today's declarers with `grep -n 'idKind: "' src/app/turso-schema.ts` (one line per
  spec that declares it — one today); the worked example
  is in [`docs/AGENTS/documents.md`](docs/AGENTS/documents.md)'s "Asset images (S3c-1)" section.
- **Secrets at rest:** the `SecretId` union is now FIVE device-sealed ids. ★ The id and the SETTINGS
  FIELD it seals are NOT the same string, and three of the five differ — the ids are
  `"anthropicApiKey"` (field `settings.ai.apiKey`), `"tursoAuthToken"` (field `authToken`),
  `"jiraApiToken"` (field `settings.jira.apiToken`), `"timelogApiToken"` and `"sttApiKey"` (5th;
  lives under `settings.dictation`, browser→same-origin `/api/stt` SSRF proxy). Use the ID spellings
  above wherever an id is named — earlier text here listed the field names as if they were the ids.
  All five are
  ENCRYPTED via `secrets.ts` (AES-256-GCM; non-extractable device key in IndexedDB by default,
  optional per-secret PBKDF2 passphrase — Jira is device-only so far, no passphrase UI). ★ Adding a
  SecretId starts at the runtime list `SECRET_IDS` in `secrets.ts`. The `SecretId` union, the
  `isSealedSecret` id check, the `readStore` loop (`secrets-store.ts`) and the mount-load
  unreadable-secret probe (`use-settings.ts`) all DERIVE from it (§567 — a hand-kept copy that
  missed an id silently dropped the ciphertext on read, or on the probe, silently never reported a
  lost one), and
  `SECRET_SETTINGS_PATHS` is a total record, so tsc demands its entry. The edits that remain by hand:
  `migratePlaintextSecrets` (seal + return), `writeSettings` blank, `hydrateSecretsInto` restore +
  the load-effect migrate/hydrate/re-merge block, and a seal-on-edit call in the field's settings
  section (`saveSecretValue(id,…,"device")`). ★ `jira` lives at TOP-LEVEL `settings.jira` (NOT under
  `settings.integrations`); `email`/`siteUrl` stay plaintext (identifying, and `email` is needed for
  the Basic-auth header). `writeSettings` is ONLY writer of `localStorage["aipm-cockpit:settings"]` and
  BLANKS those fields — settings persist EFFECT must call `writeSettings`, NEVER raw `setItem` (raw
  write dumps decrypted in-memory key/token to disk on every settings change — real CRITICAL
  we shipped and caught). M365 stores NO secret (clientId/tenantId are public; MSAL owns its token
  cache) — nothing to encrypt there. Secrets hydrated into memory on load (`hydrateSecretsInto`);
  passphrase-wrapped ones stay empty until unlock. Anything reading a secret uses live in-memory
  value; if IndexedDB/WebCrypto unavailable load path degrades to in-memory plaintext (never
  crash). `aipm-cockpit:secrets` ciphertext stays OUT of exports, Turso, recovery `CONFIG_KEYS`.
- **App config vs project data (reset/clear boundary):** `app-reset.ts` `clearAppConfig()` wipes
  ALL `aipm-cockpit:*` localStorage (snapshot keys BEFORE the remove loop — index-shift) + deletes the
  CONFIG IndexedDB DBs `aipm-cockpit-secrets` (device key) and `aipm-cockpit-project-handles` (FS-access
  pointers). It must NEVER delete the WORKSPACE IndexedDB DB `aipm-cockpit` (project data) — reset is
  detach-only ("no file/DB deletion"). Any new clear/reset path obeys the same split. IDB deletes
  are fire-and-forget (awaiting can hang on `onblocked` across tabs).
- **Storage namespace = `aipm-cockpit`** (renamed from legacy `lop-app`; MR rename-aipm-cockpit).
  The one-time `lop-app`→`aipm-cockpit` migration (`storage-migration.ts` + its boot-IIFE duplicate) was
  REMOVED in 0.190.41 once complete — there is no longer any `lop-app*`/`lop-*` runtime literal, migration
  gate (`ensureStorageMigrated`), or `aipm-cockpit:idb-migrated` flag. The IDB-open entry points
  (`idb.ts`/`secrets.ts`/`project-file-handles.ts`) open the new-name DBs directly. A device that never
  opened the app post-rename would not carry its old-key data forward (accepted — migration is done).

## Architecture pointers

> Bullets describe CURRENT behavior; version/MR provenance lives in git + CHANGELOG, not here.

- **Orientation / key files:** `task-manager.tsx` = root orchestrator (layout, top bar, view
  routing; threads workspace + AI hooks down). `storage.ts` = backend facade;
  `workspace-context.tsx` = live workspace state + setters; `types.ts` = all entity shapes + enum
  consts; `sanitize.ts` = single per-entity validators (a BARREL — see "Sanitize module map");
  `i18n.ts`/`i18n.de.ts` = EN/DE strings; `nav-config.ts` = `AppView` list + nav labels.
- **task-manager decomposition map (Phase 3) → [`docs/AGENTS/task-manager.md`](docs/AGENTS/task-manager.md).** The
  orchestrator's cross-cutting clusters live in deps-object `use*` hooks called unconditionally before the single
  return, plus plain `build*` builders; that file lists every one and why each keeps or drops its memoization.
  ★★ A new `.ts` hook extracted from task-manager is coverage-GATED: test it if it holds logic (`use-view-digest.ts`
  is the model) or add it to `vitest.config.ts` `coverage.exclude` if it is glue. ★★ `use-insight-recommendations.ts`
  filters replayed calls through `ALLOWED_REC_TOOLS`, a security boundary — never exclude it. Open that file before
  extracting from, or wiring into, task-manager.
- **Extraction conventions (Phase 3) — follow these by default for new work:**
  1. **Deps-object hook.** Cross-cutting orchestration extracted from task-manager takes a typed `deps`
     object of live render-scope values, is named `use*` and called UNCONDITIONALLY before the single
     return, and returns NON-memoized handlers (they read live scope each render). Pattern origin:
     `use-storage-file-ops.ts`; Phase-3 instances in `docs/AGENTS/task-manager.md`. A JSX-only builder with NO hook calls is a plain
     `build*` fn (e.g. `buildShellChrome`), not a `use*`. ★ Such `.ts` hook files are coverage-gated —
     add them to `vitest.config.ts` `coverage.exclude` if they are pure UI glue (see [`docs/AGENTS/task-manager.md`](docs/AGENTS/task-manager.md)).
  2. **Calendar bag.** A new calendar-capable entity threads ONE `EntityCalendarProps` on the pane
     contract, never five flat props. `outlookEventId` persists across the six write paths + is guarded by
     `entity-persistence-registry.test.ts`.
  3. **Per-entity CRUD hooks.** Entity save/delete handlers live in a dedicated per-entity hook
     (`useChangeLog` / `useStakeholders` / `useRaidItems` / `useResourcePlanner` — RAID's handlers left
     `useResourcePlanner` for `useRaidItems`, which it composes), NOT inlined in task-manager. Every save
     handler is a FUNCTIONAL setter (`setX(prev => …)`) — the bulk-edit "N saves in one tick" landmine.
     (A generic `makeEntityCrudHandlers` factory was evaluated and deliberately NOT built — the per-entity
     hooks already encapsulate divergent behavior; a uniform factory adds risk without cohesion.)
     ★★★ **ID-MINT RACE — a save handler MUST decide create-vs-update by the modal's INTENT, never by
     id-EXISTENCE.** Entity "Add" modals precompute the new id at modal-OPEN. If a concurrent writer
     commits that id before Save — an AI `create_*` tool, a second tab, a bulk op — then a handler asking
     `find(id) === undefined` misclassifies the create as an UPDATE and **map-replace silently clobbers
     the concurrent row** (real data loss, fixed in 0.170.2 "Doctorow"). Route it through pure
     `entity-id-mint.ts` `resolveEntitySave(existing, itemId, isNew, mintId)`, which takes the intent and
     **re-mints** the id when the open-time one was taken: RAID (`use-raid-items`), changes
     (`use-change-log`), stakeholders (`use-stakeholders`), milestones (`milestones-panel`), calendar
     events (`use-calendar-events`). Modals forward `isNew`; the pane contract types are
     `(item, isNew?) => void` (`workspace-section-types.ts`). ★ `isNew` is OPTIONAL and the fallback is
     `isNew ?? !taken` — bulk edit and other non-modal callers deliberately omit it and keep the old
     id-existence behaviour, which is correct because they never precompute an id.
     ★ **Two entities are outside that helper, both correctly:** RESOURCES hand-rolls the identical
     semantics inline (resource save handler, `grep -n editVanished src/app/use-resource-directory.ts`) *plus* the concurrent-delete guard that RAID, changes, stakeholders and milestones also carry beside their
     `resolveEntitySave` call (`grep -rn "editVanished" src/app --include=*.ts --include=*.tsx | grep -v test`) — editing a
     row a concurrent writer already deleted would make the map-replace a silent no-op, so each calls
     `reportSilentFailure` instead of dropping the edit; TASKS are immune by construction, deciding on
     `editingId !== null` (`grep -n "editingId !== null" src/app/use-task-submit.ts`) and never on id-existence. ★ They
     do report a concurrent DELETE (2026-10-08): saving a task whose stored row is gone shows the same
     `guardEditVanished` toast and writes nothing (`grep -n "task.editVanished" src/app/use-task-submit.ts`);
     until then the update mapped over nothing and the edit vanished in silence.
     ★ TEST TRAP: the race only reproduces when the id is taken BETWEEN open and save. A test that saves
     against an untouched list passes whichever way the handler decides — seed the collision explicitly.
  4. **Shared SSRF core, per-route normalize.** A new external-API proxy REUSES `api/_shared/proxy-ssrf.ts`
     for the IP-classification + host-allowlist checks and hand-rolls only its route-specific
     normalize/auth/URL. Do NOT parameterize the divergent guard chains into one `createProxyHelpers`
     factory (parameterizing divergent security guards is where a config slip silently weakens a guard).
  5. **Panel split (gantt pattern).** A panel crossing ~700 lines splits into orchestrator + `*-rows` +
     `*-toolbar` (+ a `*-columns` leaf for shared metadata) WELL BEFORE it reaches the size ratchet — rows
     and toolbar are PURE presentational (data + handlers as props). Precedent: gantt, reports, raid-panel,
     tasks-section (`tasks-section-toolbar.tsx` + `tasks-section-rows.tsx`, §492).
- `src/app/` is flat, organized by feature. Pure domain logic lives in i18n-free modules/subdirs
  (e.g. `next-actions/`, serializers); React surfaces import them and translate — keep engines i18n-free.
  ★ Before creating `<name>.ts`, check for existing `<name>.tsx` (and vice versa) — a bare `./<name>`
  import resolves `.ts` AHEAD of `.tsx`, so a new pure `foo.ts` silently hijacks an existing `foo.tsx`
  component import and breaks its tests. Name the pure module distinctly (e.g. `action-notifications.ts`
  beside `notifications.tsx`).
- Storage facade (`storage.ts`) over backends: JSON file, CSV, Markdown, Turso (single + multi-tenant),
  IndexedDB. Snapshots/Trends + version history are Turso-ONLY.
- **Sample data is JSON-only, tiered:** `sample-workspace-small.json` is the hand-curated MASTER (the
  ONLY hand-edited sample artifact); `-big.json` (3×) and `-huge.json` (10×) are GENERATED from it via
  pure `scaleWorkspace(ws, factor)` (id-offset `k*100000` + full FK remap, incl. `bucket.taskIds`;
  reference data — resources/roles/disciplines/grades — NOT replicated; replicas get distinct
  stakeholder names + workstream-qualified titles, not "(2)"). Don't hand-edit `-big`/`-huge`; regenerate
  via `scripts/generate-sample-workspace.ts` (`npx vite-node scripts/generate-sample-workspace.ts`), then
  regenerate `__fixtures__/golden-*` via serializers. There is NO `.md`/`.csv`/`.sqlite3` sample artifact
  anymore — those were removed; edit the JSON master directly (it's the app's native format, no
  round-trip codec needed).
- **Action-Center CTAs surface-only:** thread optional handler task-manager → workspace-section →
  ActionsPanel → ActionRow (ActionsPanel renders in workspace-section, not task-manager, and renders
  TWO ActionRow lists — tier + monitor — so a new CTA prop must thread to BOTH); `next-actions/` engine
  stays pure.
- **Action-Center grouping (slice 1):** pure i18n-free `next-actions/group.ts` `groupNextActions(actions)` collapses
  signals on the SAME entity into one `ActionGroup` (key = open-CTA `${cta.view}:${cta.id}`, else the action's own id
  so snooze-only ids never merge; `primary`=max-score, `extra`=rest, group `score`/`tier`=primary's). `computeNextActions`
  stays FLAT — grouping is SURFACE-ONLY; learning/notifications/AI keep the flat list. ★ It runs ONCE, in
  `use-next-actions.ts` (`nextActionGroups`, called from `task-manager.tsx`), which `ActionsPanel` renders and the Dashboard takes its hero and Top-actions
  primaries from (spec C). `actions-panel.tsx` caps Now/Soon
  at `MAX_VISIBLE_PER_TIER=5` with a show-more toggle.
- **Action-row layout (slice 2):** `action-row.tsx` shows tier as a coloured LEFT STRIPE (`TIER_STRIPE` →
  `border-l-[var(--rag-red)]` for now, with `--rag-amber`/`--rag-green` for soon/monitor — REPLACED the dot; RAG tokens
  switch under Mockup). ★ Write each tier's stripe token as its own concrete `var(--rag-NAME)` here; never collapse the
  family into one arbitrary-value bracket with a pipe or wildcard — Tailwind v4 scans AGENTS.md and an invalid char inside
  such a bracket compiles to broken CSS (globals.css 500s, e2e webserver times out). A single `⋮` overflow
  popover (Draft / Create-task / Log-as-RAID / Snooze) reuses `usePopoverDismiss`; contextual popovers (Escalate/Assign/Rebaseline/
  Reschedule) stay INLINE (≤1 per row). Expandable "+N more reasons" renders the group's `extraReasons`. ★ the reasons
  panel is ALWAYS mounted + `hidden`-toggled (id `action-reasons-${action.id}`) so the `aria-controls` target stays in DOM.
- **`task-attention` provider (slice 3):** `next-actions/providers/task-attention.ts` (core, NO moduleId) flags active
  (`!isTaskFinished`) tasks: unassigned (`assignee` blank && `resourceId==null`), stale (`lastUpdateDate` ≥`STALE_DAYS=14`),
  blocked (`blockers` non-empty), dep-blocked (first unfinished `FS` predecessor only; `d.taskId!==task.id` self-dep guard,
  SS/FF/SF ignored). ★ the new `ActionSource` `"task-attention"` forced the exhaustive map `ACTION_SOURCE_LABEL`
  (→`actionSourceAttention`). (`ACTION_SOURCE_ICON` was REMOVED in the next-actions redesign — rows show no source icon.)
- **Inline resolve CTAs (slice 4):** Assign-owner (extends the RAID assign bundle to unassigned tasks, routes by `cta.view`),
  Mark-done (`applyStatusChange`), Clear-blocker, Reschedule (`reschedule-popover.tsx`). Handlers live in `task-manager`
  (functional `setTasks(prev=>…)`, `isPopout`→undefined, guarded on `cta.view==="open-points"`); threaded the 5-layer chain
  task-manager → `workspace-section-types` → workspace-section → `ActionsPanel` → `ActionRow`.
- **Next-actions surface (focus hero + action-first rows):** pure `next-actions/action-cta.ts` = `pickPrimaryCta`/
  `overflowCtas` (SINGLE source for a row's primary verb + ⋮ overflow; the `can*` predicates live here, consumed by
  `action-row.tsx` AND `action-hero-card.tsx`) + `TIER_RAG` (tier→stripe/dot token classes — ★ NO `text` variant, see
  landmine). Shared React controls in `action-cta-controls.tsx` (`ActionPrimaryCta`/`ActionOverflowMenu`/`useActionCaps`/
  `ActionHandlers`/`AssignOwnerBundle`, re-exported by `action-row`) render identical CTAs for the compact row AND the
  hero. Hero = `pickHeroGroup(groups)` (`groups[0]`, only when `tier!=="monitor"` — the Dashboard's row 2 calls the same helper), DE-DUPED from its tier list (`g.key!==heroKey`).
  `action-reasons.tsx` = shared +N-reasons expander. Escalate/Rebaseline/Reschedule popovers + the assign button take a
  `prominent?` prop: every CTA is the shared `Button` — the hero's filled verbs and triggers are `primary` at `md`, a row's
  filled verbs `primary` at `xs` with `PRIMARY_MATCHING_BORDER` (`button.tsx`; `primary` draws no border and would be 2px
  shorter than the chips), every bordered chip `secondary` at `xs` (§102, owner decision 2026-10-09). Source icon/pill GONE — source label is a bold prefix in the why-line; numeric score is `expertMode`-only.
  ★★ `--rag-amber-text` (=ui-purple / a brown) is AA ONLY on LIGHT Petrol — as SMALL text on `bg-surface` it FAILS AA on
  dark+mockup (3.5/4.4:1). Tier colour MUST ride the DOT/STRIPE (non-text, AA-exempt), never tinted small text (bit the
  tier count + hero eyebrow; both now muted). ★ the `actions` (Next actions) view is now in axe `A11Y_VIEWS` (hash-nav in
  `e2e/a11y.spec.ts` — Dashboard sub-child, sidebar entry may be collapsed at scan time).
- **Icons come from `src/app/icons.ts` → [`docs/AGENTS/theming.md`](docs/AGENTS/theming.md) "Icons".** Never import
  `lucide-react` directly (the sole exception is `rich-text-toolbar.tsx`) and never `@heroicons/react` (removed; a
  `no-restricted-imports` rule makes it fatal). ★★★ The barrel re-exports lucide under the OLD heroicons names, and a
  name match is not a glyph match — check `/icon-gallery` in dev. ★★ Some icons render no `<path>`: an icon test
  asserts on `svg.children.length`, never `querySelector("path")` or an exact `class` string.
- **Top bar in TWO independent places**, both built in `task-manager.tsx`: classic `AppHeader`
  (`appHeaderEl`, used by classic main-window `legacyTree`) and modern `ModernShell` `topBarMenus` slot
  (DEFAULT layout). A new top-bar control must wire into BOTH or it's invisible in whichever layout you
  forgot (modern default is the easy miss). Popout `legacyTree` branch renders NO header, so header
  controls correctly never appear in popouts.
- **Remount-swallow (parent request/nonce → conditionally-mounted child):** modern shell renders ONLY
  the active view; workspace-section renders only the active tabpanel FOR MOST PANELS — so such a view
  MOUNTS FRESH each visit. A child consuming a parent "request"/nonce prop must NOT seed its
  last-seen/handled ref from the
  LIVE prop (`useRef(prop)`/`useState(prop)`) — a fresh mount sees prop===seed and silently SWALLOWS a
  pending request. Seed `undefined`/sentinel + guard `!== undefined`; parent must CLEAR (consume) or
  monotonically bump the nonce so re-mounts don't re-fire stale. Bit settings-view learning deep-link AND
  milestones-panel `openCreateNonce` (Gantt "Add milestone").
  ★★ **THE WHOLE MAIN-WINDOW TREE UNMOUNTS WHILE `loadPending` IS TRUE (§548)** — the first load, a
  backend-change reload and every project-swap op render `PanelSkeleton` instead — so EVERY panel, the
  two exceptions below included, mounts fresh after each; the sentinel rule applies to them too. A new
  BACKGROUND writer (timer, listener, interval) does not unmount and must gate on `loadPending` itself:
  [`docs/AGENTS/platform.md`](docs/AGENTS/platform.md) "The load hold". ★★ AND THAT IS ONLY HALF —
  `loadPending` answers "may I START?"; a writer that AWAITS (Graph, the AI) can resolve after the swap
  FINISHED, when it is false again, so it must also capture `getScopeEpoch()` before its first await and
  drop its write through `dropStaleScopeWrite` (`scope-epoch.ts`). Same file, same section.
  ★★★ **TWO PANELS ARE THE EXCEPTION AND THIS BULLET USED TO DENY IT** — it said flatly that
  workspace-section "renders ONLY the active tabpanel", which is true of 28 of its 30 tabpanels and
  FALSE for `panel-chat` and `panel-raid`: those two are mounted UNCONDITIONALLY and merely
  `hidden={activeTab !== …}`, with no `key`, so they NEVER remount on navigation and their state
  survives every tab switch. Reproduce the split rather than trusting these numbers —
  `grep -c 'role="tabpanel"' src/app/workspace-section.tsx` against
  `grep -n -B4 'hidden={activeTab' src/app/workspace-section.tsx`, which also names the two.
  ★★ The direction of the error is what makes it expensive: for those two the danger is the OPPOSITE of
  remount-swallow. A fresh mount cannot be relied on to clear anything, so state that is only valid
  under some condition (a mode flag, a project id) must be reset EXPLICITLY when that condition ends —
  nothing will do it for you. That is exactly how a retained chat thread id survived a Turso→file
  switch and silently killed every subsequent send (fixed on the chat-thread branch; see the AI
  Assistant sidebar bullet). Before writing either guard, check which of the two shapes your panel is.
- **Task editor is ONE floating surface now:** ALL layouts (modern DEFAULT, classic, popout) use the shared
  floating `TaskFormModal` (draggable/resizable/reset; its own `ModalHeader` title+✕). The former modern
  full-page `TaskEditView` (ModernShell `editView` slot / `useEditView`) was RETIRED — modern no longer
  replaces the shell with an edit page; the modal floats over the active view (which stays Open Points). New
  editor controls/heading wire into the modal header/footer. ★ The Delete button lives footer-LEFT +
  pink/destructive (mirrors `change-edit-modal`) via exported `TaskDeleteButton` (`task-editor-actions.tsx`);
  `TaskFormModal` takes a `deleteAction` prop (the old `TaskEditView` `footerLeading` path is gone).
  Dark-mode hover uses `dark:hover:bg-ui-pink/5`.
- **Task status model → [`docs/AGENTS/task-status.md`](docs/AGENTS/task-status.md).** `Task.status`
  is the SOURCE OF TRUTH for "done", but `completedDate` is AUTO-MANAGED to keep the invariant
  **`status==="Done" ⟺ completedDate set`**. ★★ A caller must also say WHICH
  question it is asking: `task-closed.ts` exposes `isTaskClosed` ("will this be worked on again?" =
  Done|Cancelled) and `isTaskDelivered` ("was it delivered?" = `!!completedDate`) — Cancelled is CLOSED
  but never DELIVERED, and reading `!!completedDate` as "closed" is the bug that made cancelled tasks
  keep reporting as open and overdue. ★★★ Open that file before touching any status write: pure
  `applyStatusChange` (`task-status.ts`) is NOT the sole writer of the pair — FIVE paths write it, each
  with a mechanism of its own, so "completing the pattern" by routing one through another is the
  recurring defect here — and the invariant is held by those WRITERS, not at load, which leaves a
  valid-but-inconsistent pair split on every backend.
- **Open Points + Milestones toolbars = ONE flat wrapping row** (`flex flex-wrap items-center gap-2`, no
  `<h2>` heading/count) with the search input `flex-1` so it expands and pushes trailing controls right
  (mirrors the changes-panel toolbar). ★ Tasks "Clear all" opens a
  `TypeToConfirmDialog` (type the `tasksClearAllConfirmValue` phrase) — the shared `handleClearAll` (`use-bulk-operations.ts`)
  no longer self-confirms via `window.confirm`; the button path is dialog-gated. ★★ the VOICE `clearAll`
  command ALSO routes to the `TypeToConfirmDialog` now (no more one-click `window.confirm`): hook
  `requestClearAllConfirm?` → task-manager `setActiveTab("open-points")` + bumps a MONOTONIC non-null
  `clearAllRequestNonce` → tasks-section render-reconcile (handled seed = SENTINEL null so a FRESH mount
  HONORS a pending request) + `onClearAllRequestConsumed` resets the nonce→null. LANDMINE: seeding the
  handled-ref to the LIVE nonce is the remount-SWALLOW trap — a voice-clear fired from a non-Tasks view
  (TasksSection unmounted) is silently DROPPED; sentinel-seed + parent-clear for any "works-from-any-view" req. All saved-views controls (`panel-views-control`/
  `saved-views-control`/`reports-views-control`) use the standard `FOCUS_RING` (ring-2) — a bare
  `focus:ring-ui-green` sets colour only (no width) and is invisible.
- **★★ Orphaned list filters (`task-filters.ts`):** the Open Points assignee/group/label filters hold a free
  string, but their `<select>` options are DERIVED from the live tasks (`uniqueAssignees`/`uniqueGroups`/
  `uniqueLabels`). Editing the last task carrying a filtered-for value (reassign, re-group, re-label) removes
  the option while the filter state keeps pointing at it — the filter goes on hiding EVERY row while the
  control, left with no matching option, falls back to its first one and reads "All", so the table looks
  unfiltered and empty at once. Pure `resolveEffectiveFilters(values, options)` resolves an unmatched value to
  `FILTER_ALL`; `workspace-context` computes it ONCE into `effectiveFilters` and feeds BOTH `filteredSortedTasks`
  AND the pane's three `<select value=…>` — one source, so control and row filter cannot drift. ★ The RAW state
  is deliberately NOT written back: it lives in `FiltersProvider` (a parent — neither an effect nor a
  render-phase setState can reach it from the pane, and `set-state-in-effect` is banned), and leaving it makes
  the fallback SELF-HEALING (undo the reassign → the filter returns). Saved views capture the RAW values, which
  is correct — a preset preserves intent. ★ Consequence: a view saved WHILE a filter is orphaned stores the
  orphan (the control reads "All", the state does not), so if that value later reappears on a task the view
  starts filtering by it. Deliberate — the same self-healing property, seen from the other side. ★★ Each check MIRRORS how the row filter compares that field:
  assignee/group exact, label case-INSENSITIVE — matching more loosely here would keep a filter that hides every
  row, the exact state this prevents. ★★ `GROUP_NONE` (`""`) is EXEMPT: the group `<select>` renders a permanent
  "No group" option, but `uniqueGroups` drops blanks, so resolving it would make that option unselectable (a
  blank ASSIGNEE is not exempt — it only exists while `uniqueAssignees` still carries one). ★ TEST TRAP: with a
  genuinely orphaned value the `<option>` is gone and the select falls back to "All" whichever source it is
  bound to, so a realistic fixture CANNOT tell a correct binding from a reverted one — stub the raw and
  effective values apart, keeping the stale ones as real options (mutation-proved vacuous otherwise).
- **★ ResourcePicker ✕ CLEARS the whole field** (`name` + `email` + FK), it does not merely unlink. Dropping
  only the FK left the same name rendered (`display` falls back to `value.name`), so the sole visible effect was
  the button vanishing and the control read as dead — reported twice. A DANGLING link (resource deleted) clears
  the same way; re-picking from the dropdown is the repair path, because one glyph doing two different things
  depending on its colour is worse than losing the unlink-but-keep-name shortcut. ★ Keep the `onMouseDown`
  `preventDefault` — commit-on-blur consumers (the inline task-row assignee) close on blur, so without it the
  clear lands on an already-closed editor and is swallowed. ★★ The accessible NAME is the shared `clear` key in
  BOTH states, so linked-vs-dangling rides the `title` (the accessible DESCRIPTION, since `aria-label` wins the
  name): `resourcePickerLinked` / `resourcePickerDangling`. Don't collapse that back to a flat "Clear" title or a
  screen-reader user is never told an assignment is broken. ★★ That is a SCREEN-READER disclosure, NOT a WCAG
  1.4.1 fix — `title` is hover-only (no keyboard focus, unreachable on touch), so VISUALLY the two states still
  differ only by the green/pink border+glyph. Closing 1.4.1 needs a non-colour visual cue (a distinct
  glyph/marker for dangling) — CLOSED by a `data-dangling-marker` warning-triangle `<span>` (aria-hidden; AT
  already gets the state from the description) rendered beside the ✕, with the input padded `pr-12` in that
  state. Don't drop it back to colour-only. ★ the ✕ renders whenever there is something to clear — including a
  FREE-TEXT name (`!!display`), not just a linked/dangling one, since the control is labelled "Clear"; its
  colour/title fall back to neutral + `clear` when there is no link state.
- **Rich text — three note-log registers + seven rich HTML fields → [`docs/AGENTS/rich-text.md`](docs/AGENTS/rich-text.md).**
  `Task.description` plus RAID `description`/`mitigation`, Change `description`/`impactDescription`/
  `resolutionNotes` and `Milestone.description` are rich HTML; Tasks, RAID and Changes each carry a dated
  `noteLog` surfaced by ONE shared floating window. ★★★ Open that file before touching any of it — its
  landmines are NOT uniform across the three registers, and the same defect is closed by a DIFFERENT
  mechanism in each (`use-task-submit.ts` omits the field from its payload, `use-raid-items.ts`
  carries it from the STORED row, `change-log.ts`'s `withStoredNoteLog` does it at three decode/JSON/AI
  boundaries) — copying one register's fix to another is how two of them broke.
  It also owns: the DOM-free vs browser-only split across `rich-text-plain.ts` / `rich-text-projection.ts`
  / `rich-text-runs.ts` and why `rich-text-plain.ts` must never call DOMPurify; `sanitizeRichText` (never
  `plainToHtml`) as the only safe write boundary; `sanitizeAiRichText` + `AI_RICH_FIELDS` on every
  model-write path; the per-sink `isHtmlStart` classifier rule; `RichCell` export fidelity and list
  numbering; and the toolbar's `role="toolbar"` keyboard contract.
- **Kanban board:** tasks pane has a Table/Board toggle (per-device `settings.tasksViewMode`). Board
  component is **`task-kanban-board.tsx`** — NOT `task-kanban.tsx` (the pure `task-kanban.ts` engine
  shadows a `.tsx` sibling via `.ts`-before-`.tsx` resolution). Native HTML5 DnD (no lib); the per-card
  status `<select>` (shared `TaskStatusSelect`, also used by the table row) is the keyboard path. ★★ The
  board renders OUTSIDE `RowContextProvider` (which wraps only the table body) — so ANY component a Kanban
  card renders must take what it needs as PROPS, never `useTaskRowContext()` (that THROWS → board crashes
  on RAID-linked cards; bit `RaidBadge`, now in `task-raid-badge.tsx` taking `lang`+`onJumpToRaid` as
  props). Test cards/board with a populated `raidByTask` or the crash path stays untested. ★ Jira-synced
  tasks (`!!task.jiraKey`) are read-only: sync maps `statusCategory`→`status` via `jiraCategoryToStatus`
  INSIDE `issueToTaskFields`' patch and applies `patch.status` DIRECTLY — NOT through `applyStatusChange`
  (which would stamp `today` instead of Jira's resolution date). Board/table selects + drag are disabled
  for synced; `onStatusChange` no-ops on `jiraKey`. Board is NOT in axe `A11Y_VIEWS` (gate scans the table
  view) — board a11y is eye-verified (row-unique select labels + per-column `aria-label`).
  ★★ ROW-CONTEXT IS SPLIT to bound edit re-renders: the volatile `tasksById` (new Map on ANY edit) lives in
  a SEPARATE `RowLookupContext`/`useTaskLookup`, consumed ONLY by `DependencyChipsImpl` — a context consumer
  re-renders on value change REGARDLESS of an ancestor `memo` bailout, so an edit re-renders one dep-chip
  cell, not all 4×N row cells (context-bypasses-memo). Don't fold `tasksById` back into `RowContextValue`.
- **★★ Several panels `workspace-section` renders are `memo()`'d** — `ResourcesPanel`, `ResourceDirectory`, `ChatPanel` and
  `ActivityLogPanel` directly; RAID, Changes and Stakeholders through `RaidPanelMemo`/`ChangePanelMemo`/
  `StakeholdersPanelMemo` (enumerate: `grep -rn "= memo(" src/app --include=*.tsx | grep -v test`). In any
  of them, adding a `useWorkspace()` call silently defeats the optimization. A direct context consumer
  re-renders on ANY context-value change REGARDLESS of the parent's memo bailout (same rule as the
  `RowLookupContext` split above), and `WorkspaceProvider`'s value is one `useMemo` over ~30 slices, so a
  milestone/RAID/budget/insight edit — or a background Outlook-pull / insight-recommendation / scheduled-job
  write — would re-render the whole panel (for Resources: the planning table, workload rollups and absence
  calendar). ★★ `ResourcesPanel` and its `ResourceCalendar` can bail since §1 closed: `workspace-section` routes every
  function prop through `useStableHandlers` (`resourcesHandlers`), whose wrappers keep one identity and call the
  LATEST handler, so no `useCallback` sweep (and no stale closure) was needed; inside, `onMoveOccurrence` is a
  `useMemo` and the omitted-`calendarEvents` default is one shared list. ★★ A NEW function prop on `ResourcesPanel`
  goes into that bag — passed raw it re-breaks the bail silently; the "§1" describe in `workspace-section.test.tsx`
  catches it only if `makeProps` supplies the handler. Not profiled: the bail is shown by prop identity
  (`resources-panel.memo.test.tsx`), not measured. The guidance below still stands, because a context read
  defeats any bail. THREAD PROPS instead — workspace-section already holds
  `disciplines`/`grades`/`setResources` and passes them to sibling panels. (The un-memoized panels it renders —
  tasks, milestones, dashboard, insights, knowledge, timelog — lose nothing by consuming context.)
- **Gantt module map → [`docs/AGENTS/ui-shell.md`](docs/AGENTS/ui-shell.md) "Gantt module map".** `GanttPanel`
  (`gantt.tsx`) is orchestrator only; `gantt-engine.ts` and `gantt-status-buckets.ts` are pure and i18n-free; rows,
  chrome, chart and overlays are presentational. ★★★ Gantt prefs are v2 and `statuses: []` now means SHOW NOTHING —
  an "is a filter active" test compares `prefs.statuses.length < ALL_GANTT_STATUSES.length`, never `> 0`.
  Gantt IS in axe `A11Y_VIEWS`.
- **Reports module map:** `ReportsPanel` (`reports.tsx`) owns data + sort/column-resize state; pure
  i18n-free `reports-stats.ts` (`computeStats` + `Stats`/`GroupOrLabelRow`) and presentational
  `reports-tables.tsx` (`GroupOrLabelTable`, `AssigneeTable`, `Tile`, `Section`, `StackedBar` + shared
  `REPORTS_*_COL_WIDTHS` consts and `AssigneeSort`/`GroupOrLabelSort` types). One-way dep (reports →
  reports-tables → reports-stats); per-type report engines/panels (budget/raid/resource/stakeholder) live
  in their own files. Reports IS in axe `A11Y_VIEWS`.
- **Budget, FX and the Budget panel → [`docs/AGENTS/budget.md`](docs/AGENTS/budget.md).** The budget
  engine treats every figure as EUR (§473); `fixedPriceAmount` is the one stored field it converts, with
  `currencyToEur`. That file owns the FX boundary, earned value and the panel's pinned-column arithmetic.
- **Tables — `SortResizeTh<K>` + `TableFilter` (`report-table.tsx`) → [`docs/AGENTS/ui-shell.md`](docs/AGENTS/ui-shell.md)
  "tables" section.** Every sortable header in the app flows through `SortResizeTh`, which owns
  `aria-sort` and the `aria-hidden` sort glyph — never hand-roll a sort header. ★★ `stickyLeft` turns
  `width` from a minimum into a clamp, and `position` must stay in the class, never inline. `TableFilter`
  owns the field's only clear ✕. Open that section before touching a table header, filter or pinned column.
- **★★ `buildResourceWorkload` (`resource-workload-rows.ts`) MUST receive the COMPLETE resource list.** It
  builds its `managed` id-map and `nameToId` map from the `resources` ARGUMENT ALONE, and `resolve()` falls
  through to `ensureUnlinked` on a miss. So filtering that argument does NOT hide anyone — the withheld
  person's tasks/absences/shifts/RAID miss both lookups and REAPPEAR under "Unlinked", whose "Clear unlinked"
  control (`onClearUnlinked`, built in `workload-triage-handlers.ts`) blanks task assignees + RAID owner and **`filter`s matching
  absences and shifts out of the workspace entirely**. A display filter would therefore become a path to real
  data deletion. `ResourceWorkload` takes a `hideExternal` FLAG and filters the BUILT `managed` rows instead
  (`unlinked` untouched). The full list is also the reassign-picker's target set (`WorkloadOverdueTriage`),
  which a display filter must never narrow. ★ TEST TRAP: a fixture whose external owns NO work cannot reach
  `ensureUnlinked`, so the naive "external disappears" assertion passes for the wrong reason — give them a
  task and assert absence from the WHOLE pane. (Planning/rollup DO correctly consume a pre-filtered
  `visibleResources` — they just `map` it.)
- **★ Toolbar button ORDER convention → [`docs/AGENTS/ui-shell.md`](docs/AGENTS/ui-shell.md) "toolbar button
  order".** Every pane's toolbar ends with the contiguous trailing group **Print · reset-columns · reset-layout ·
  reset-size** (a pane drops the members it lacks; the Electron shell renders no Print); destructive/bulk actions
  and integration blocks go BEFORE it; a pane's primary action leads the row. ★★ Assert it with the shared
  `src/test/toolbar-order.ts` `expectButtonOrder`, `contiguous: true` for the trailing group — never a hand-rolled
  walk. Read the exceptions there (the Dashboard's badge, the popout `readOnly` guard) before touching a toolbar.
- **Documents (AI document authoring) → [`docs/AGENTS/documents.md`](docs/AGENTS/documents.md).** A
  `ProjectDocument` is JSON at rest over a typed `DocBlock` union; bytes are rendered ON DEMAND and
  never stored, and PDF is the HTML renderer printed, not a fourth renderer. ★★ `documents` and
  `documentVersions` are **meta-blob** slices — absent from `TABLE_NAMES` because they have no table of
  their own, NOT because they are non-workspace data — and ride all six write paths. Blocks are
  hand-editable too. That file owns both halves: the data model, and the panes + block editor in its
  "Surfaces and editor" section. Open it before touching anything `document*`.
- **Activity log (`Workspace.activityLog`) → [`docs/AGENTS/activity-log.md`](docs/AGENTS/activity-log.md).**
  Per-project audit trail persisted as a **meta-blob** (one JSON row in `meta`, like `insights` and
  `documents`), NOT via `ENTITY_SPECS` — so it is correctly absent from `TABLE_NAMES` **because it has
  no table of its own, NOT because it is non-workspace data.** ★★★ Open that file before touching the
  log, the completion trend, or either load funnel: it is STORAGE-ONLY on every export and document path (no export key; the one exception is the
  internal audit download in Settings, §510 —
  an entry's `changes` carries old/new values that must never reach a client-facing document),
  `applyWorkspace`'s `logMode` defaults to REPLACE, `isWorkspaceEmpty` deliberately EXCLUDES it
  (inverting the `documents` rule, and counting it would turn a data-loss guard into a data-loss
  vector), and the trend now derives from THREE incompatible delta shapes that must not be merged.
- **AI Assistant chat-thread sidebar is Turso-ONLY → [`docs/AGENTS/ai-assistant.md`](docs/AGENTS/ai-assistant.md)
  "chat-thread sidebar".** `chat-panel.tsx` mounts `ChatThreadSidebar` only when `tursoMode`, which
  `workspace-section.tsx` computes as `(settings.storageConfig.kind === "turso" || mode === "turso") &&
  chatTursoConfig !== null`. ★★★ The OR is load-bearing (`mode` is the multi-project picker flag, not the storage
  backend), so "file mode" does NOT mean no sidebar. ★★ The e2e seed is file mode, so axe never renders it — its
  unit tests are the only coverage. `chat_threads` stays OUT of `TABLE_NAMES`.
- **Attachment ingest — ONE entry point, and a mail is a TREE.** `attachment-ingest.ts`
  (`ingestFile` / `ingestBytes`) is the only read/classify/extract path. `chat-panel.tsx`,
  `step0-import-panel.tsx` and anything added later CALL it and must never reimplement it — three
  private copies existed before it. ★★★ A mail expands into an `IngestNode` TREE, so a consumer sends
  `flattenIngestBlocks(node)` and NEVER `node.block` alone: the walk is otherwise computed and thrown
  away while the rendered mail still NAMES the attachments whose content was dropped, which misleads
  the model rather than merely under-informing it. ★ File pickers take
  `ATTACHMENT_ACCEPT`, derived from `chat-attachments.ts`'s own classifier tables — never a
  hand-written `accept` string. ★ TWO size caps, so `checkAttachmentSize` needs the KIND:
  `MAX_ATTACHMENT_BYTES` (20 MB) for a flat file, `MAX_MAIL_BYTES` (64 MB) for mail. ★ A BATCH of files is
  bounded separately: both callers run `planBatch` (`chat-attachments.ts`) over the flattened blocks, which skips —
  never truncates — a file that would push the batch past `MAX_BATCH_TEXT_CHARS` or `MAX_BATCH_BASE64_CHARS`; the
  first file is always admitted, so the ceiling never becomes a smaller per-file limit. ★★ The six MAIL
  parsers (`cfbf` · `lzfu` · `mime-parse` · `msg-extract` · `eml-extract` · `html-extract`) eat
  untrusted bytes off the network and return PARTIAL results rather than throwing. ★★★ THAT IS THE
  SIX NAMED, NOT "every parser beneath ingest" — `unzip.ts`, on the office path, throws five
  different ways on hostile input and `attachment-ingest.ts` catches it into `read-failed`. Reading
  the rule as universal is how a real throw gets written off as impossible.
  ★★★ **"Recursion lives in the orchestrator alone, never in a parser" is FALSE as stated and was
  in this file for a release.** `mime-parse.ts` recurses internally — `walkNode` re-enters itself at
  three sites for nested multiparts, bounded by `MAX_MIME_DEPTH` — and that is correct. The real
  invariant is narrower: a parser must never re-enter `ingestBytes`, i.e. ATTACHMENT-TREE recursion
  belongs to the orchestrator, because the reverse creates an import cycle. A reviewer applying the
  old wording literally files a Critical against `walkNode`, which is bounded and fine. Each
  parser's own bounds are in its source docstring (`cfbf.ts`'s header is ~65 lines of them); none of
  the six is documented under `docs/AGENTS/`, so do not go looking there.

## Subsystem reference — deeper detail, loaded on demand

★★★ **Only THIS file reaches every session.** `CLAUDE.md` is `@AGENTS.md`, so
everything above is loaded before you type anything; the files in the table below
are not. That is the whole point of the split (sizes in the next paragraph).
**Open the matching file before editing that subsystem's code.** The landmines
did not get weaker by moving, and a landmine nobody loads is a landmine nobody
reads — which is the risk this arrangement trades for the context saving.

★★★ **THE SPLIT IS NOT SELF-SUSTAINING — IT REGREW BY 111% IN FIFTEEN DAYS AND NOTHING
NOTICED.** Measured, not estimated: 328,772 bytes before the 2026-08-04 split → 92,745 after
→ **195,808 by 2026-08-19**, across 84 commits that each added a few hundred plausible bytes.
By then 66% of this always-loaded file was the "Architecture pointers" section, and THREE
bullets alone (rich text, its note-log half, the activity log) held 37% of it — the exact
content class the split had just moved out. Extracting those three to `rich-text.md` and
`activity-log.md` cut a third straight back off — no number is quoted for the result, because
this paragraph is itself part of it and the next commit moves it. Measure, don't cite:
`wc -c AGENTS.md` · `git show <split-sha>:AGENTS.md | wc -c` ·
`awk '/^## /{if(n)printf "%7d  %s\n",b,n; n=$0; b=0; next} {b+=length($0)+1} END{printf "%7d  %s\n",b,n}' AGENTS.md`
★★ NO GATE WATCHES THIS. `size:check` walks `src`, never docs, so this file can double again
without a single red pipeline. **A bullet that grows past ~60 lines of subsystem detail belongs
in `docs/AGENTS/`, and moving it is a NET WIN even when every line of it is true** — which is
why it regrows: nothing here is wrong, it is merely not worth every session's context.

★★ `npm run docs:symbols:check` gates every file in `docs/AGENTS/`, not just this one — `docs/AGENTS/`
is GLOBBED (`readdirSync`), so a new subsystem file is scanned the moment it lands.

| File | Owns |
|---|---|
| [dashboard.md](docs/AGENTS/dashboard.md) | the landing cockpit — the arrangeable tile grid · delta strip · KPI trends · sparkline · coaching · density · digest |
| [accessibility.md](docs/AGENTS/accessibility.md) | the a11y hard constraint — accessible names · row-unique per-row names (`buildRowTokens`) · WCAG 2.5.3 label-in-name · `ToggleButton` state + the pressed marker · what the axe gate scans and is silent on |
| [ci.md](docs/AGENTS/ci.md) | CI on GitHub Actions — the eight required checks job by job · `release.yml` (tag guard → Windows build → publish behind the owner's approval, the sharp and electron-updater guards, exit codes) · `scheduled.yml` · operating it |
| [ui-shell.md](docs/AGENTS/ui-shell.md) | Help system · navigation & landing · focus/keyboard · surfaces & controls · tables (`SortResizeTh` · `TableFilter`) · ★ **dismissal (the Escape/Tab protocol — read before touching any modal, popover or panel)** |
| [theming.md](docs/AGENTS/theming.md) | colour schemes · the `--ui-*` token families · AA derivation · the dark-mode hover trap · branding · print · design-system primitives |
| [insights.md](docs/AGENTS/insights.md) | detect → reconcile → recommend → outcome → digest |
| [ai-assistant.md](docs/AGENTS/ai-assistant.md) | wire layer · tools · write-concurrency tokens on the six `update_*` tools · inline edit · dedup · scheduled jobs · allocation & RACI planning |
| [integrations.md](docs/AGENTS/integrations.md) | steering committee · Outlook calendar write-back and two-way pull · Timelog |
| [platform.md](docs/AGENTS/platform.md) | diagnostics ring · guard transparency · dictation · the AI master switch · the load hold (`loadPending`, the render hold, the background-writer gates) |
| [features.md](docs/AGENTS/features.md) | guided tour + demo · timezones · saved views · PWA · resource calendar meetings |
| [rich-text.md](docs/AGENTS/rich-text.md) | ALL rich HTML — the three note-log registers (each closing the SAME defect by a DIFFERENT mechanism) · the seven rich entity fields · the DOM-free vs browser-only module split · `sanitizeRichText` / `sanitizeAiRichText` / `AI_RICH_FIELDS` write boundaries · the per-sink `isHtmlStart` rule · `RichCell` export fidelity · the `role="toolbar"` keyboard contract |
| [activity-log.md](docs/AGENTS/activity-log.md) | `Workspace.activityLog` — meta-blob persistence · storage-only on every export/document path (one internal audit download, §510) · `logMode` REPLACE-by-default · entry ids and actors · forward-compat sanitising · the THREE incompatible completion-trend delta shapes |
| [documents.md](docs/AGENTS/documents.md) | documents — the DATA half: `DocVersion` before-images · retention + tombstones + the `"restored"` marker · `applyDocMutation` (the single mutation path) · `documentVersions` across all six write paths and both load funnels · AND the UI half: renderers, pane split, the hand block editor |
| [task-status.md](docs/AGENTS/task-status.md) | the task completion model — the `status` ⟺ `completedDate` invariant · the FIVE paths that write the pair and the mechanism each holds it by · why `migrateTask` does NOT repair a split pair · the `isTaskClosed` / `isTaskDelivered` split |
| [task-manager.md](docs/AGENTS/task-manager.md) | the `task-manager.tsx` decomposition — every extracted deps-object hook and builder, which are coverage-GATED and which excluded, and why each keeps or drops its memoization |
| [budget.md](docs/AGENTS/budget.md) | budget and money — `resolveRate` / `currencyToEur` and the one stored non-EUR field · the IndexedDB field-wise plan coercion (`coerceStoredPlan`) · `effectiveBudgetHours` mirroring · bucket earned value and its all-or-nothing rollup · the panel module map and pinned-column arithmetic |
| [undo.md](docs/AGENTS/undo.md) | the undo/redo stack — creates · label registrations · row vs field-patch capture · field groups · the §295 redo arm · popout + load-hold |
| [desktop.md](docs/AGENTS/desktop.md) | the Electron shell at RUNTIME — port + server child · navigation + sign-in popup · print + menu · PDF export · updater |
| [storage.md](docs/AGENTS/storage.md) | the storage layer — `createBackend` and the four backend classes · the two load funnels · decode diagnostics and the save pause · the debounced save and flush-on-hide · the §629 unload journal · who writes each of the six paths · `/recovery`, safe mode and the factory reset |
