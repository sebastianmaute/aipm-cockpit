<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, file structure may all differ from training data. Read relevant guide in `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Contents

Read [Commands](#commands) and [Hard constraints](#hard-constraints-ci-enforced--these-gate-merges)
before your first edit — the rest is reference, reachable from here.

**In this file** (always loaded):

| | |
|---|---|
| [The doc set](#the-doc-set--what-lives-where) | which doc owns what — read before restating a fact in a second file |
| [Commands](#commands) | every script + the CI gotcha that bites for each |
| [Hard constraints](#hard-constraints-ci-enforced--these-gate-merges) | i18n · byte-stable serializers · palette · a11y gate · six write paths · secrets · CSP |
| [Architecture pointers](#architecture-pointers) | orientation, module maps, extraction conventions, panel splits, toolbar order |
| [Subsystem reference](#subsystem-reference--deeper-detail-loaded-on-demand) | the nine files below, and why they are not loaded |

**In `docs/AGENTS/`** (NOT loaded — open the one you need):

| | |
|---|---|
| [dashboard](docs/AGENTS/dashboard.md) | delta strip · KPI trends · masonry · coaching · density · digest |
| [ui-shell](docs/AGENTS/ui-shell.md) | Help · nav · focus/keyboard · surfaces · ★ **dismissal owns the Escape/Tab protocol — read it before touching any modal, popover or panel** |
| [theming](docs/AGENTS/theming.md) | colour schemes · `--ui-*` tokens · AA derivation · branding · print · DS primitives |
| [insights](docs/AGENTS/insights.md) | detect · reconcile · recommend · outcome · digest |
| [ai-assistant](docs/AGENTS/ai-assistant.md) | wire layer · tools · inline edit · dedup · scheduled jobs |
| [integrations](docs/AGENTS/integrations.md) | steering committee · calendar write-back + two-way pull · Timelog |
| [platform](docs/AGENTS/platform.md) | diagnostics · guard transparency · dictation · AI master switch |
| [features](docs/AGENTS/features.md) | guided tour + demo · timezones · saved views · PWA · resource calendar meetings |
| [documents](docs/AGENTS/documents.md) | version before-images · retention + tombstones · the single mutation path · `documentVersions` across the six write paths |

Conventions used throughout: **★** = a non-obvious rule, **★★** = something that has already
caused a bug, **★★★** = something that has caused the same bug more than once. Open follow-ups
live in [`docs/open-followups.md`](docs/open-followups.md), not here.

★★★ **Almost nothing gates these files, and the one gate that exists checks the weakest property.**
`agents-symbol-check` (`npm run docs:symbols:check`) fails when a backticked name in THIS file or in
any `docs/AGENTS/*.md` exists nowhere in `src`/`scripts`/`e2e`. That is all it does: it proves a NAME
is real, never that a CLAIM about it is true. "`sanitizeX` guards this path" passes the gate whether
or not that path calls it. ★★★ NARROWER STILL — **it only checks MIXED-CASE names, so every
backticked `SCREAMING_CASE` constant in all ten files is completely ungated.** The scan requires
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
| [`docs/AGENTS/`](docs/AGENTS/) (9 files) | NOT loaded. The per-subsystem deep reference this file used to carry inline — same conventions, same gate. Open the one you are working in. |
| [`docs/CODEMAPS/`](docs/CODEMAPS/) (5 files) | layered overview — architecture · frontend · backend · data · dependencies. Read these FIRST for shape; AGENTS.md + `docs/AGENTS/` for detail. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | process + conventions: setup, scripts, testing layers, release checklist. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | operations: build, deploy, rollback, secrets, and a symptom-indexed "common issues" list. |
| [`docs/open-followups.md`](docs/open-followups.md) | every known-open defect and deferred decision, numbered. |

★ A fact belongs in ONE of these. When it must appear twice, the second copy links rather than
restates — four restatements of the same claim is how `public/themes/*.json` survived in this file
long after the directory it named stopped existing.

## Commands

```bash
npm run dev                 # next dev (public next ^16.2.11 — read node_modules/next/dist/docs for version behavior)
npm run build               # next build (prebuild checks script-docs are in sync)
npm run lint                # eslint  (CI --max-warnings=0: an unused import/var or `_`-prefixed
                            # param is FATAL — no argsIgnorePattern; re-check after every extract.
                            # react-hooks/exhaustive-deps REJECTS an `obj.member` dep (e.g.
                            # [snapshots.rebaselineNow]) — hoist it to a local const and depend on that.
                            # A react-hooks PURITY rule bans `Date.now()`/`Math.random()`/`new Date()`
                            # in a component RENDER body too (not just useMemo) — capture via a lazy
                            # `useState(() => Date.now())`, or read it inside an effect/callback.
                            # `react-hooks/set-state-in-effect` is BANNED (fatal) — to sync state to a
                            # changed prop, use the render-time reconcile pattern (`if (prop !== handled)
                            # { setState(...) }` guarded by a nonce/last-seen state), NOT a useEffect.)
                            # ★ `npm run lint` itself is bare `eslint` with NO `--max-warnings` flag, so it
                            # EXITS 0 even when warnings are present — it does not reproduce the CI gate.
                            # Check the actual gate locally with `npx eslint --max-warnings=0 src/app`.
npx tsc --noEmit            # typecheck (enforces i18n EN/DE key parity). `next build` does NOT
                            # typecheck *.test.tsx and vitest never typechecks — a test-only type
                            # error (e.g. an invalid getByRole `{exact:...}`; a string `name` is
                            # ALREADY an exact match) passes build + tests but FAILS tsc (CI). Run
                            # `npx tsc --noEmit` after editing ANY test. fast-check gotchas that pass
                            # vitest but FAIL tsc/the test: `fc.date()` can emit an Invalid Date →
                            # `.toISOString()` throws — pass `{noInvalidDate:true}` or map an integer
                            # ms range to `new Date(ms)`; the regex `/s` (dotAll) flag fails tsc
                            # (target < es2018) — use `[\s\S]` instead.
                            # ★ The IDE language-server's inline diagnostics are MID-EDIT snapshots —
                            # after a multi-file edit they routinely show phantom "Cannot find module"/
                            # "implicitly any" that a real `npx tsc --noEmit` (exit 0) contradicts. Trust
                            # tsc, not the squiggles.
npm run test:run            # vitest (unit/integration). testTimeout/hookTimeout = 20s
                            # (raised from the 5s default in vitest.config) — the CPU-heavy
                            # fast-check property suites (`*.property.test.ts`, ~100 runs each) +
                            # fake-indexeddb setup can starve a worker past 5s under full-suite
                            # parallel load on a slow machine → a RARE, non-deterministic timeout
                            # that never repros in isolation or in CI. Don't "fix" such a flake by
                            # editing the property logic before ruling out a load timeout (run the
                            # property thousands of times in isolation first; logic bugs repro there).
                            # ★ `--reporter=basic` DOES NOT EXIST in vitest 4.1.8 — it fails to load a
                            # reporter module and errors at startup, which reads like a broken test run.
                            # Use `--reporter=dot`.
                            # ★★ `onTestFailed` runs AFTER every `afterEach`, and `afterEach` is LIFO — by
                            # the time it fires, vitest.setup.ts's RTL cleanup() and the test file's own
                            # vi.clearAllMocks() have both already run, so the capture reads zeroed mocks
                            # and an empty document.body. Measured, not theorised: a capture written the
                            # obvious way printed `{"fetchCalls":0,"toastCalls":[],…}` on a run where the
                            # fetch HAD fired and the toast HAD rendered — which would have falsely
                            # CONFIRMED the already-suspected hypothesis with fabricated evidence. That is
                            # worse than no capture: one that agrees with your prior is the one you stop
                            # checking. The working pattern is a describe-scoped afterEach holding a
                            # closure the test body assigns, guarded on ctx.task.result?.state === "fail"
                            # — registered LAST, so it runs FIRST, while mocks and DOM are still live.
                            # `timelog-panel.test.tsx` and `use-tasks-dedup.test.tsx` carry that pattern
                            # with a warning comment (open-followups §73).
                            # ★★★ A StrictMode test is VACUOUS-BUT-GREEN in the obvious shape. React's
                            # double-invoke walk descends each branch to the topmost fiber FLAGGED FOR
                            # PLACEMENT and fires there only if StrictMode is at or above it. On a first
                            # mount the only placed fibers are the root's direct children, so nothing may
                            # sit between the root and StrictMode on that branch: `wrapper: StrictMode` and
                            # RTL's `reactStrictMode: true` satisfy that; composing it inside a wrapper
                            # (`({children}) => <StrictMode>{children}</StrictMode>`) does NOT, and the test
                            # then passes with the line it claims to pin DELETED — that shape is the likely
                            # source of §85's "StrictMode single-invokes here" (the 2026-08-04 run's shape
                            # was never recovered) and was measured vacuous for `use-storage-backend`; the
                            # other two `mountedRef` re-sets simply shipped with no StrictMode test at all.
                            # ★★ That is the MOUNT case only, and it is a corollary — the rule turns on
                            # which fiber carries the PLACEMENT flag, which a keyed reorder also sets. Three
                            # successive wordings of it shipped over-general, each measured at one shape and
                            # written as if it held everywhere, so do NOT extend this summary by reasoning:
                            # `src/app/strictmode.meta.test.tsx` states the rule in full and pins every edge
                            # but one, which it flags as stated-not-pinned. Read it before writing a
                            # StrictMode test, and mutation-test the guard.
npm run test:shuffle        # vitest at the SAME pinned seed CI's unit-tests-shuffled uses (BLOCKING).
                            # ★ Run this before pushing anything that adds or reorders tests — it is
                            # the ONLY local reproduction of that gate. `--sequence.shuffle` as a bare
                            # boolean shuffles BOTH file order and test order WITHIN a file, so it
                            # catches intra-file order dependence (open-followups §75), not just
                            # cross-file leakage. A red run here is deterministic and re-runnable;
                            # the weekly random-seed job echoes its own seed for the same purpose.
npm run test:coverage       # vitest + coverage. The floors in vitest.config.ts are BLOCKING in CI
                            # (global lines 92/funcs 91/branch 80/stmts 89 + per-engine globs), and
                            # `test:run` does NOT enforce them — a new coverage-gated `.ts` file (a
                            # pure engine, or an extracted `use*` hook that wasn't added to
                            # coverage.exclude) can be green locally and fail the unit job.
npm run e2e                 # playwright (incl. the 17-view axe a11y gate)
npm run e2e:smoke           # fast subset. e2e:visual / e2e:visual:update drive the visual-regression
                            # specs; e2e:ui opens the Playwright UI; e2e:install fetches browsers.
npm run dup:check           # jscpd duplication GATE (--threshold set in package.json dup:check, per-format; BLOCKING in CI). baseline docs/baselines/jscpd-2026-07.json
npm run size:check          # file-size ratchet — fails on a NEW >800-line file or a baselined file that grew
                            # ★★ IT COUNTS `wc -l` + 1. The script measures `readFileSync().split("\n").length`,
                            # which for a newline-terminated file is one MORE than `wc -l`. So a file at `wc -l`
                            # 799 is already AT the 800 limit with ZERO headroom, and a 2971-line file is at a
                            # 2972 baseline. Budgeting a change from `wc -l` overstates your room by exactly one
                            # line and the gate fails on the commit — it cost a build on `use-storage-backend.ts`.
                            # Read the real number with:
                            #   node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
npm run stop                # kill ONLY the dev server bound to the app port (default 3000; PORT-overridable)
                            # via scripts/stop-dev.mjs — port-scoped (netstat/taskkill on win, lsof/kill on
                            # posix); NEVER a blanket `taskkill /IM node.exe`. New script → also add a
                            # scriptsDescriptions entry or docs:scripts:check fails.
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

## Hard constraints (CI-enforced — these gate merges)

- **i18n:** `i18n.ts` (EN) + `i18n.de.ts` (DE) key sets must be identical (tsc enforces).
  DE must use real German umlauts — `i18n-encoding` test BANS ASCII subs (fuer/druecken).
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
  `e2e/seed.ts` reads `sample-workspace-small.json` at MODULE TOP-LEVEL, so stale path ENOENTs the
  whole e2e job (fails only in CI; `npx playwright test --list` triggers the read without browsers).
- **Palette:** only sanctioned AIPM brand tokens (`globals.css`); no off-palette colors,
  gradients, shadows. a11y gate + palette-sweep test enforce contrast/token use.
  Note: palette-sweep scans CSS for `box-shadow` — an off-palette Tailwind class (e.g. `shadow-md`)
  on element PASSES CI but still forbidden; check new components by eye.
  ★ Tailwind v4 auto-scans ALL repo files (incl. `.md`/comments) for class candidates — NEVER put a
  `*` wildcard inside a Tailwind arbitrary-value bracket (a `--foo-*` glob inside `[var(…)]`) in ANY
  tracked file; Tailwind emits it as invalid CSS and `globals.css` fails to compile → app 500s.
  Use a real token name in examples (e.g. `shadow-[var(--shadow-card)]`); write token FAMILIES as bare
  `--foo-*` globs outside any Tailwind bracket.
- **a11y (axe gate):** every new interactive control (button/checkbox/input/drag handle) needs
  accessible name + keyboard operability — unlabeled form control is axe-critical FAIL.
  `placeholder` is NOT an accessible name — input needs `aria-label`/`<label>` (placeholder-only
  input fails axe gate even though looks labeled).
  In LIST of rows, per-row controls need row-UNIQUE accessible name (e.g.
  `aria-label={`${t(lang,"edit")} – ${row.name}`}`) — N identical "Edit"/"Enabled" labels is
  WCAG 2.4.6 fail, but axe gate can PASS it when live app seeds only ONE row (collision
  never renders at scan time). Qualify label; don't trust green axe run with single seeded row.
  ★★ TOGGLE-BUTTON name/state coherence: a `<button aria-pressed>` whose VISIBLE LABEL flips to the
  OPPOSITE action (e.g. "Comfortable view" while compact is active) announces "Comfortable view,
  pressed" — implying the WRONG mode is on (WCAG 4.1.2). axe PASSES it (a name exists). Fix: PIN the
  label to what the toggle ENABLES ("Compact view") and let `aria-pressed` track THAT state, so
  "Compact view, pressed" ⇒ compact is on. (The dashboard's own density + Trends toggles followed this
  before they were REMOVED — density moved to Settings → Appearance, Trends is now Turso-gated.) The
  pin-the-enabled-label + `aria-pressed` pattern remains the RULE for any new toggle button.
  ★★ THAT PIN CREATES A WCAG 1.4.1 PROBLEM IN THE DARK SCHEMES AND `ToggleButton` NOW CLOSES IT.
  Because the label may not say which state is active, the ON state rode the accent border+tint.
  ★★★ SCOPE IT CORRECTLY — an earlier revision here said "colour as the sole visual channel" flatly
  and that is FALSE for the three LIGHT schemes: Understanding 1.4.1 counts a lightness difference
  of ≥3:1 as the required additional distinction, and pressed-vs-unpressed border measures
  harbor-light 8.97:1 · meridian-light 7.71:1 · umber-light 9.30:1 (computed from `builtin-schemes.ts`).
  Those were already conformant. The DARK maps are 1.22 / 1.16 / 1.03:1 — that is the real failure,
  and it is not merely a colour-perception one (see §56). The primitive renders a trailing
  `data-pressed-marker` check glyph (`aria-hidden`, since `aria-pressed` already tells AT). ★ It is present in BOTH states and merely
  `invisible` when off, so the button keeps ONE width — conditional rendering would make the button
  ~20px narrower when off, moving a toolbar's neighbouring controls under the pointer on every click
  (reasoned, not measured — jsdom has no layout, so nothing here can test it). ★ `invisible` vs
  `opacity-0` is NOT load-bearing: heroicons DEFAULTS `aria-hidden` on every icon (its own attributes
  come first and `props` spread after, so a caller can override it — a default, not a hard-code), so the glyph is
  out of the a11y tree in both states either way. An earlier revision of this bullet claimed the
  a11y tree was the reason — it is inert, and a test written to pin it could not fail.
  ★★ `disabled` was declared on this primitive from the start but styled NOTHING until 0.212.0 — no
  call site ever passed it, so an inoperable toggle was pixel-identical to a live one. It now carries
  `disabled:cursor-not-allowed disabled:opacity-60`. ★★ THE JUSTIFICATION IS THE MEASURED FLOOR, not
  the exemption: at 60% the disabled label lands at 4.16:1 worst case (umber-light; harbor-light 4.34,
  meridian-light 4.51, all three dark 5.7+), so it stays readable. WCAG 1.4.3's inactive-component
  exemption is the conformance BACKSTOP, not the reason — quoting it alone would license `opacity-30`
  on some other disabled control, which is formally conformant and unreadable. Do not read this as
  licence for the enabled-state alpha traps recorded elsewhere in this file. ★ The disabled BORDER
  drops to ~1.15:1 and effectively vanishes; the control reads as a control via its text, which is
  why the floor above is the number that matters. ★ Keep it a real `disabled` attribute — an
  `aria-disabled` lookalike still fires `onClick`, which for the Settings auto-sync row would arm
  background sync from a row the user had switched off (pinned by a test).
  ★★ axe 4.12.1's ONLY `wcag141` rule is `link-in-text-block` (links vs surrounding text) — nothing
  in axe evaluates whether a CONTROL's state is colour-only, so the gate is silent on this for every
  toggle in the app and the primitive's unit test is the only coverage. (An earlier revision said
  "axe has NO rule for colour-as-sole-cue"; a contributor grepping the tag list finds one and stops
  trusting the bullet.) A hand-rolled `aria-pressed` button gets neither the cue nor the test — use
  `ToggleButton`.
  Moving/folding a control INTO an axe-scanned view re-scans it: gate scans `Settings`→General, so
  folding Storage/Appearance into General surfaced pre-existing unlabeled `<select>` (a visible
  `<span>` label is NOT an `aria-label`/`<label>`) as axe-critical.
  `A11Y_VIEWS` list (`e2e/a11y.spec.ts`) is **17** named views — Dashboard · Open Points · Gantt ·
  Resources · Budget · RAID · Settings · Stakeholders · Changes · Milestones · Reports · Activity ·
  Time bookings · AI Assistant · Next actions · Insights · Documents — so a passing run reports 5 scheme
  COMBOS × 17 + 5 Kanban-board variants = **90** axe scans, plus ONE non-scan guard test (asserts the
  served app's `data-app-version` matches this checkout, open-followups §58) — **91** tests total in the
  spec file. ★ Don't derive these three numbers, MEASURE them, in the same commit that changes the list:
  `npx playwright test e2e/a11y.spec.ts --list` prints the total (no browsers needed, and it also proves
  `e2e/seed.ts`'s module-level sample read still resolves), and `grep -c "a11y:"` over that output splits
  scans from the guard.
  ★★ A VIEW IN THE LIST IS NOT THE SAME AS A VIEW BEING COVERED — the scan only sees what the e2e seed
  put in IndexedDB, and `e2e/seed.ts` seeds from two HARDCODED lists. A slice absent from them renders
  its EMPTY STATE at scan time, so the run is green over a panel with no rows, no per-row controls and
  nothing to collide. Seeding `documents` for the first time immediately turned up a real serious
  violation the empty state had been hiding. Most of BrowserBackend's optional kv slices are still
  unseeded — Insights is in this list and affected today (`docs/open-followups.md`).
  It does NOT include Projects, Knowledge, or the
  Resources → **Calendar** sub-tab (Resources defaults to the directory), so controls only on those
  surfaces aren't scanned; anything in the always-present top bar IS (scanned via every view).
  ★★ Calendar being unscanned has already cost real bugs: 0.202.0 shipped an AA contrast failure
  there (`text-ui-pink` on `bg-surface-muted`, under the 4.5:1 AA threshold) that a fully green axe run said nothing
  about (the count at the time was lower than today's, which is why this sentence no longer quotes one). Check contrast BY HAND for anything styled on that surface.
  Verify IA/UI/contrast changes with
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"` (~16s, webServer auto-starts)
  BEFORE pushing — unit suite (`test:run` = vitest) never runs playwright, so axe regressions slip
  local gate and fail ONLY in CI.
  ★★★ ADD `--workers=1` WHENEVER YOU MATCH MORE THAN ONE VIEW. `playwright.config.ts` sets
  `workers: process.env.CI ? 1 : undefined`, so **CI runs axe SERIALLY and local runs it at CPU-count**
  — a local-only contention mode the gate itself can never exhibit. Over-subscribed, tests die on
  `Test timeout of 60000ms exceeded` inside `page.evaluate`, which prints as a FAILURE with a
  screenshot and zero violation text. Measured 2026-08-08: a 3-view × 5-scheme selection went
  **10 failed / 5 passed** in parallel and **15 passed** at `--workers=1`, same commit, same warm
  server, no code change between runs. ★★ Read the failure BODY, never the summary line: a real
  violation names a rule id and an impact; this names neither, and the only `axe-core` string in the
  log is the spec's own `.withTags(...)` source echoed into the error context. Recording a green
  branch as red is the expensive direction here.
  ★ The 60s per-test timeout also covers the FIRST navigation's one-time Turbopack compile (the
  config says so at its `timeout`), so a COLD server can blow it under load even at one worker. Warm
  the route first (`curl -o /dev/null http://localhost:3000/` until it returns in well under a second)
  and let `reuseExistingServer` attach to that.
  ★★ After ANY `globals.css` `@theme` edit or large class/token rename, run axe on a FRESH ISOLATED
  server (`PORT=3100 npm run dev`, stop with `PORT=3100 npm run stop`) — NEVER the reused long-running
  dev server. Playwright's `reuseExistingServer:!CI` will attach to a stale `:3000` whose Tailwind
  hasn't regenerated the new `bg-ui-*` utilities → phantom transparent-fill axe FAILS that a prod build
  + a fresh port both pass (cost ~5 debug cycles once). Also re-run after killing a `PORT=3100` axe
  server if `.next/dev/types/*` got corrupted (phantom tsc errors in GENERATED files → `Remove-Item
  -Recurse -Force .next`, not source).
- **CI is GitLab** (not GitHub),  (GitLab). Pipeline: install → quality (lint · typecheck · **semgrep** SAST
  BLOCKING [two-scan: a full-severity `--gitlab-sast` report for the widget + a separate `--severity ERROR
  --error` gate] · **dependency-audit** blocking · **file-size-ratchet** BLOCKING · **duplication-gate**
  BLOCKING [jscpd `--threshold` per package.json `dup:check`, per-format] · **agents-symbol-check** BLOCKING
  [`npm run docs:symbols:check` — fails when THIS FILE names a code symbol that does not exist] · **unit** [coverage floors: global lines 92/funcs 91/branch
  80/stmts 89 + per-engine globs in `vitest.config.ts`] · **unit-tests-shuffled** BLOCKING [runs the full
  unit suite at `--sequence.shuffle --sequence.seed=1`; `needs: [install, {job: unit-tests, artifacts:
  false}]` so it cannot run concurrently with **unit-tests** — two full vitest runs on one runner is the
  machine-saturation condition behind the load-sensitive flakes; guards against intra-file test-order
  dependence, open-followups §75]) → build → e2e. All quality gates are ratchets. ★★ The
  `quality-gate-bypass` escape hatch is NOT uniform — reproduce with
  `grep -n quality-gate-bypass .gitlab-ci.yml`, which returns five lines in three jobs: **semgrep** and
  **file-size-ratchet** carry a full commented `rules:` block; **duplication-gate** only NAMES the label
  in prose, with no rules block; and EVERY other quality-stage job mentions it nowhere (`lint`,
  `typecheck`, `dependency-audit`, `dependency-audit-full`, `agents-symbol-check`, `unit-tests`,
  `unit-tests-shuffled`, `unit-tests-shuffled-random` — enumerate with
  `grep -nE "^[a-z][a-zA-Z0-9_-]*:" .gitlab-ci.yml`). ★★★ FOUR successive revisions of this
  sentence were wrong — each named the wrong jobs or under-enumerated, sending an operator hunting for a
  bypass block on whichever gate is actually red. One of them ATTACHED the reproduce command above
  without running it, and the command refutes the sentence it was attached to. **Attach the command and
  run it.** ★ "Ratchets" is loose too: only **file-size-ratchet**, **duplication-gate** and
  **unit-tests**' coverage floors hold a baseline; every other quality gate is plain pass/fail.
  A weekly `schedule` pipeline also runs
  `dependency-audit-full` + **unit-tests-shuffled-random** (same suite, seed `$CI_PIPELINE_ID` echoed with
  its reproduce command, warn-only `allow_failure: true`) + a **dast-zap** ZAP baseline (dind-based, manual
  otherwise). (Phases 1-4 of the
  tech-debt roadmap are complete — gates flipped to blocking in Phase 4, MR !174.)
  New CI gate → also update this line.
- **Releasing:** bump `src/app/version.ts` (APP_VERSION + APP_BUILD_DATE + milestone), add
  `CHANGELOG.md` entry, append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE
  strings). ★★ FIVE MORE PLACES CARRY THE VERSION AND **NO GATE CHECKS ANY OF THEM**:
  `package.json` `version`, `package-lock.json` (TWO occurrences — the root `version` and the
  `packages[""]` one), the README shields badge (version **and** codename), and the
  `<!-- Generated: … | App <version> "<codename>" … -->` header on all five `docs/CODEMAPS/*.md`.
  Verified 2026-07-30: `package.json` had been stuck at 0.203.0 for six releases, `package-lock.json`
  at 0.199.0 for eleven, and the README badge + codemap headers at 0.203.0 — while `version.ts` and
  `CHANGELOG.md` were correct. Bump them in the SAME commit as `version.ts` or the drift restarts.
- **New persisted `Workspace` field → SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/
  IndexedDB). Miss one and data silently drops on that backend. `calendarEvents`
  ("Resource calendar meetings" below) is a worked example — one `ENTITY_SPECS` row buys three of the six.
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
- **Secrets at rest:** the `SecretId` union is now FIVE device-sealed ids. ★ The id and the SETTINGS
  FIELD it seals are NOT the same string, and three of the five differ — the ids are
  `"anthropicApiKey"` (field `settings.ai.apiKey`), `"tursoAuthToken"` (field `authToken`),
  `"jiraApiToken"` (field `settings.jira.apiToken`), `"timelogApiToken"` and `"sttApiKey"` (5th;
  lives under `settings.dictation`, browser→same-origin `/api/stt` SSRF proxy). Use the ID spellings
  above for the hardcoded allowlists below — earlier text here listed the field names as if they were
  the ids. All five are
  ENCRYPTED via `secrets.ts` (AES-256-GCM; non-extractable device key in IndexedDB by default,
  optional per-secret PBKDF2 passphrase — Jira is device-only so far, no passphrase UI). ★ Adding a
  SecretId means SIX edits in lockstep: `SecretId` union, `isSealedSecret` id allowlist + `readStore`
  allowlist loop (both HARDCODE the id list — a missed one silently drops the ciphertext on read),
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
- **task-manager decomposition map (Phase 3):** the orchestrator's cross-cutting clusters were
  extracted into **deps-object hook factories** (see "Extraction conventions") called
  unconditionally before the single return, plus two render helpers. The wiring lives in:
  `use-calendar-integrations.ts` (ALL Outlook push/pull/background-auto-sync for milestones +
  committee + task/raid/change/absence), `use-action-center-handlers.ts` (assign / mark-done /
  clear-blocker / reschedule / draft / escalate / rebaseline / create-task CTAs), `use-ai-orchestration.ts`
  (Analyze-with-AI + weight-suggestion context + scheduled-job runner), `shell-chrome.tsx`
  (`buildShellChrome` — a plain builder, NOT a hook — assembles BOTH header mounts), and
  `calendar-summary-modals.tsx` (the four two-way pull-summary modals). ★★ These three hook files are
  RENDER-SCOPE UI GLUE and are EXCLUDED from the coverage gate (`vitest.config.ts` `coverage.exclude`,
  same class as `.tsx`) — extracting a `use*` factory from task-manager into a NEW `.ts` file makes its
  handlers coverage-GATED, so either exclude the new file or expect a function-coverage drop. ★ A THIRD option, and the better one when the hook holds real logic rather than glue: TEST it. `use-view-digest.ts` (0.216.0) is a deps-object hook that assembles the AI view digest from live pane state; it is coverage-GATED and stays above the floors on its own tests, so it is deliberately NOT in `coverage.exclude`. Exclude glue, not logic. The
  task-manager→WorkspaceSection prop contract is pinned by `task-manager.characterization.test.tsx`.
- **Extraction conventions (Phase 3) — follow these by default for new work:**
  1. **Deps-object hook.** Cross-cutting orchestration extracted from task-manager takes a typed `deps`
     object of live render-scope values, is named `use*` and called UNCONDITIONALLY before the single
     return, and returns NON-memoized handlers (they read live scope each render). Pattern origin:
     `use-storage-file-ops.ts`; Phase-3 instances above. A JSX-only builder with NO hook calls is a plain
     `build*` fn (e.g. `buildShellChrome`), not a `use*`. ★ Such `.ts` hook files are coverage-gated —
     add them to `vitest.config.ts` `coverage.exclude` if they are pure UI glue (see the decomposition note).
  2. **Calendar bag.** A new calendar-capable entity threads ONE `EntityCalendarProps` on the pane
     contract, never five flat props. `outlookEventId` persists across the six write paths + is guarded by
     `entity-persistence-registry.test.ts`.
  3. **Per-entity CRUD hooks.** Entity save/delete handlers live in a dedicated per-entity hook
     (`useChangeLog` / `useStakeholders` / `useResourcePlanner`), NOT inlined in task-manager. Every save
     handler is a FUNCTIONAL setter (`setX(prev => …)`) — the bulk-edit "N saves in one tick" landmine.
     (A generic `makeEntityCrudHandlers` factory was evaluated and deliberately NOT built — the per-entity
     hooks already encapsulate divergent behavior; a uniform factory adds risk without cohesion.)
     ★★★ **ID-MINT RACE — a save handler MUST decide create-vs-update by the modal's INTENT, never by
     id-EXISTENCE.** Entity "Add" modals precompute the new id at modal-OPEN. If a concurrent writer
     commits that id before Save — an AI `create_*` tool, a second tab, a bulk op — then a handler asking
     `find(id) === undefined` misclassifies the create as an UPDATE and **map-replace silently clobbers
     the concurrent row** (real data loss, fixed in 0.170.2 "Doctorow"). Route it through pure
     `entity-id-mint.ts` `resolveEntitySave(existing, itemId, isNew, mintId)`, which takes the intent and
     **re-mints** the id when the open-time one was taken: RAID (`use-resource-planner`), changes
     (`use-change-log`), stakeholders (`use-stakeholders`), milestones (`milestones-panel`), calendar
     events (`use-calendar-events`). Modals forward `isNew`; the pane contract types are
     `(item, isNew?) => void` (`workspace-section-types.ts`). ★ `isNew` is OPTIONAL and the fallback is
     `isNew ?? !taken` — bulk edit and other non-modal callers deliberately omit it and keep the old
     id-existence behaviour, which is correct because they never precompute an id.
     ★ **Two entities are outside that helper, both correctly:** RESOURCES hand-rolls the identical
     semantics inline (`use-resource-planner.ts:485`) *plus* an extra guard the others lack — editing a
     row a concurrent writer already deleted would make the map-replace a silent no-op, so it calls
     `reportSilentFailure` instead of dropping the edit; TASKS are immune by construction, deciding on
     `editingId !== null` (`use-task-submit.ts:126`) and never on id-existence.
     ★ TEST TRAP: the race only reproduces when the id is taken BETWEEN open and save. A test that saves
     against an untouched list passes whichever way the handler decides — seed the collision explicitly.
  4. **Shared SSRF core, per-route normalize.** A new external-API proxy REUSES `api/_shared/proxy-ssrf.ts`
     for the IP-classification + host-allowlist checks and hand-rolls only its route-specific
     normalize/auth/URL. Do NOT parameterize the divergent guard chains into one `createProxyHelpers`
     factory (parameterizing divergent security guards is where a config slip silently weakens a guard).
  5. **Panel split (gantt pattern).** A panel crossing ~700 lines splits into orchestrator + `*-rows` +
     `*-toolbar` (+ a `*-columns` leaf for shared metadata) BEFORE it crosses the 800-line ratchet — rows
     and toolbar are PURE presentational (data + handlers as props). Precedent: gantt, reports, raid-panel.
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
  stays FLAT — grouping is SURFACE-ONLY; learning/notifications/AI keep the flat list. `actions-panel.tsx` caps Now/Soon
  at `MAX_VISIBLE_PER_TIER=5` with a show-more toggle.
- **Action-row layout (slice 2):** `action-row.tsx` shows tier as a coloured LEFT STRIPE (`TIER_STRIPE` →
  `border-l-[var(--rag-red)]` for now, with `--rag-amber`/`--rag-green` for soon/monitor — REPLACED the dot; RAG tokens
  switch under Mockup). ★ Write each tier's stripe token as its own concrete `var(--rag-NAME)` here; never collapse the
  family into one arbitrary-value bracket with a pipe or wildcard — Tailwind v4 scans AGENTS.md and an invalid char inside
  such a bracket compiles to broken CSS (globals.css 500s, e2e webserver times out). A single `⋮` overflow
  popover (Draft / Create-task / Snooze) reuses `usePopoverDismiss`; contextual popovers (Escalate/Assign/Rebaseline/
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
  hero. Hero = `groups[0]`, shown only when `tier!=="monitor"`, DE-DUPED from its tier list (`g.key!==heroKey`).
  `action-reasons.tsx` = shared +N-reasons expander. Escalate/Rebaseline/Reschedule popovers + the assign button take a
  `prominent?` prop (hero = filled+larger via `action-cta-styles.ts` `popoverTriggerClass`; rows pass nothing → unchanged
  ghost). Source icon/pill GONE — source label is a bold prefix in the why-line; numeric score is `expertMode`-only.
  ★★ `--rag-amber-text` (=ui-purple / a brown) is AA ONLY on LIGHT AIPM — as SMALL text on `bg-surface` it FAILS AA on
  dark+mockup (3.5/4.4:1). Tier colour MUST ride the DOT/STRIPE (non-text, AA-exempt), never tinted small text (bit the
  tier count + hero eyebrow; both now muted). ★ the `actions` (Next actions) view is now in axe `A11Y_VIEWS` (hash-nav in
  `e2e/a11y.spec.ts` — Dashboard sub-child, sidebar entry may be collapsed at scan time).
- **Top bar in TWO independent places**, both built in `task-manager.tsx`: classic `AppHeader`
  (`appHeaderEl`, used by classic main-window `legacyTree`) and modern `ModernShell` `topBarMenus` slot
  (DEFAULT layout). A new top-bar control must wire into BOTH or it's invisible in whichever layout you
  forgot (modern default is the easy miss). Popout `legacyTree` branch renders NO header, so header
  controls correctly never appear in popouts.
- **Remount-swallow (parent request/nonce → conditionally-mounted child):** modern shell renders ONLY
  the active view; workspace-section renders ONLY the active tabpanel — so a view MOUNTS FRESH each
  visit. A child consuming a parent "request"/nonce prop must NOT seed its last-seen/handled ref from the
  LIVE prop (`useRef(prop)`/`useState(prop)`) — a fresh mount sees prop===seed and silently SWALLOWS a
  pending request. Seed `undefined`/sentinel + guard `!== undefined`; parent must CLEAR (consume) or
  monotonically bump the nonce so re-mounts don't re-fire stale. Bit settings-view learning deep-link AND
  milestones-panel `openCreateNonce` (Gantt "Add milestone").
- **Task editor is ONE floating surface now:** ALL layouts (modern DEFAULT, classic, popout) use the shared
  floating `TaskFormModal` (draggable/resizable/reset; its own `ModalHeader` title+✕). The former modern
  full-page `TaskEditView` (ModernShell `editView` slot / `useEditView`) was RETIRED — modern no longer
  replaces the shell with an edit page; the modal floats over the active view (which stays Open Points). New
  editor controls/heading wire into the modal header/footer. ★ The Delete button lives footer-LEFT +
  pink/destructive (mirrors `change-edit-modal`) via exported `TaskDeleteButton` (`task-editor-actions.tsx`);
  `TaskFormModal` takes a `deleteAction` prop (the old `TaskEditView` `footerLeading` path is gone).
  Dark-mode hover uses `dark:hover:bg-ui-pink/5`.
- **Task status model:** `Task.status` (To Do/In Progress/On Hold/In Review/Cancelled/Done) is the
  SOURCE OF TRUTH for "done", but `completedDate` is AUTO-MANAGED to keep the invariant
  **`status==="Done" ⟺ completedDate set`** — so the ~30 existing completedDate-based derivations were
  left untouched. Pure i18n-free engine `task-status.ts`: `applyStatusChange(task,next,today)` is the SOLE
  writer of status+completedDate — EVERY status mutation (form save create+update in `use-task-submit`,
  inline status dropdown (`onStatusChange`) in `use-task-row-handlers`, AI/Jira/template seeds) routes through
  it. ★★★ THE LOAD-PATH REPAIR IS `migrateTask`, NOT `migrateTaskStatus` (no such function exists), AND
  IT IS WEAKER THAN THIS BULLET USED TO CLAIM. It runs on all six load paths but only backfills an
  ABSENT/INVALID status (`completedDate` set → Done, else To Do) — `if (statusOk && createdOk) return
  task;` short-circuits FIRST, so a *valid but inconsistent* `status:"To Do"` + `completedDate` pair is
  NOT repaired. The invariant is held by the WRITERS (`applyStatusChange`; Jira's `issueToTaskFields`
  drives both fields off one `isDone` flag), not at load, so an imported or hand-edited blob can carry
  the bad pair. The old wording caused three separate defects in one session — every reader concluded
  load normalises the pair and wrote that into code comments and commit messages.
  `isTaskFinished`=Done|Cancelled; Cancelled is terminal-but-NOT-completed (excluded from
  overdue/next-actions/health-red). ★★ SINCE 0.213.0 THE CALLER MUST SAY WHICH QUESTION IT IS ASKING —
  pure `task-closed.ts` exposes `isTaskClosed(task)` (= `isTaskFinished`, Done|Cancelled → "will this be
  worked on again?": overdue, schedule RAG, forecast, workload, row styling, chasing, the Gantt status
  filter, milestone at-risk) and `isTaskDelivered(task)` (= `!!completedDate` → "was it delivered?": the
  completion-% NUMERATOR, earned value, on-time/late, and anywhere a real date is shown). Cancelled is
  CLOSED but never DELIVERED. Reading `!!completedDate` as "closed" is the bug that made cancelled tasks
  keep reporting as open and overdue — 11 modules import the split (dashboard · gantt · gantt-rows ·
  gantt-status-buckets · milestones · reports-stats · resource-workload-rows · resources-panel · snapshot ·
  task-row · visible-task-rows). ★ Completion-% counts Done only in the NUMERATOR, but since 0.213.0
  cancelled work is dropped from the DENOMINATOR (`dashboard.ts` `computeDashboardProgress`), so a
  project with cancelled scope can reach 100%. Reports carry a third `cancelled` bucket — a cancelled
  task is neither open nor completed there, and never overdue. UI labels via
  `task-status-ui.ts` (AIPM palette tokens only). ★ The table status column key is **`taskStatus`** — the
  pre-existing `"status"` col key is the RAG/health DOT (header "Health"/DE "Ampel"). ★ The tasks view
  ("Open Points") IS in axe `A11Y_VIEWS`, so the inline status `<select>` needs a row-UNIQUE label
  (`Status – <task>`).
- **Open Points + Milestones toolbars = ONE flat wrapping row** (`flex flex-wrap items-center gap-2`, no
  `<h2>` heading/count) with the search input `flex-1` so it expands and pushes trailing controls right
  (mirrors the changes-panel toolbar). ★ Tasks "Clear all" opens a
  `TypeToConfirmDialog` (type `"yes, clear all tasks"`) — the shared `handleClearAll` (`use-bulk-operations.ts`)
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
- **Rich-text note log (Tasks + RAID, v0.196.0 "Emrys"):** dated note LOG on `Task.noteLog?` +
  `RaidItem.noteLog?` (`NoteLogEntry[]` = `{id;authorResourceId?;authorName?;timestamp;editedAt?;html;text}`),
  surfaced by ONE shared draggable NON-modal floating CRUD window `notes-window.tsx` (+ `🗒 N` badge
  `notes-badge-button.tsx` on Open Points + RAID rows, "Notes (N)" button in the editors). Author =
  per-device `settings.selfResourceId` (honor-system, NO dropdown/auth); `canEditNote` gates edit/delete
  (`authorResourceId == null || === self`; edit CLAIMS an authorless note). Pure model in `note-log.ts`
  (`addNote`/`editNote`/`deleteNote` immutable; `sanitizeNoteLog`; `encodeNoteLog`/`decodeNoteLog`
  JSON-in-cell for CSV/MD/Turso — mirrors `document-link.ts`). Composer = shared `RichTextEditor variant="lean"`
  (`commitOnEnter`; note-editor.tsx folded in). Drag via shared `use-draggable-window.ts` (help-menu shares it).
  ★★ **`RichTextEditorHandle.appendText`** (`rich-text-editor.tsx`): Tiptap binds its `content` ONCE at mount,
  so a changed `value` prop cannot reach an already-mounted editor — dictation therefore appends imperatively
  via an `editorRef` (`useImperativeHandle`), not by pushing a new `value`. The handle's `appendText` calls
  `editor.chain().focus().insertContent({type:"text",text}).run()` — `insertContent` MUST take a TEXT NODE
  object, never a bare string: a bare string is parsed as HTML, so dictated text containing `<`/`&` would be
  interpreted as markup instead of inserted literally. Both the note log's composer and its entry editor wire
  `useDictationMic`'s `onAppendFinal` straight to `editorRef.current?.appendText(txt)`.
  ★★ `Task.notes` was RENAMED to `Task.description` (rich HTML) — NO back-compat decoder / NO runtime
  migration; Turso `COLUMN_RENAMES` `{from:"notes",to:"description"}` self-heals; historical notes folded into
  `noteLog` ONLY in the sample generator (Description starts empty); CSV task column renamed + goldens regen.
  RaidItem's `description?` is PRE-EXISTING (unrelated); other entities' `notes?` fields are untouched.
  ★★★ STORED-XSS defense-in-depth — noteLog `html` is `dangerouslySetInnerHTML`, guarded at THREE layers:
  (1) SINK re-sanitize `sanitizeNoteHtml(html)` in `RichTextView` (idempotent; mirrors comm-send-preview/
  meeting-report); (2) `sanitizeNoteFields(entity)` (note-log.ts) at the WHOLE-OBJECT load boundaries that
  cast verbatim — `jsonToWorkspace` (file/sharepoint/local-file JSON) + IDB load (`browser-backend.ts`);
  CSV/MD/Turso route `noteLog` through `decodeNoteLog` — ★★ that covers `noteLog` ONLY, and reads as
  if it covered `description` too. It does not: NOTHING sanitizes the six rich DESCRIPTION fields on
  those three backends (see the rich-text bullet below; `docs/open-followups.md` §28). A NEW
  whole-object load path MUST call the `sanitize*RichFields` matching its entity, not just this one.
  ★★ The form must never write `noteLog` back: the log is WRITE-THROUGH and owns itself, so a draft
  that snapshots it at modal-open and spreads it over the live row on save silently destroys any note
  added while the editor was open (real data loss, fixed 0.209.0 — `use-task-submit.ts` deliberately
  omits `noteLog` from its payload). ★ 0.211.1 went further and removed the field from the DRAFT too:
  `emptyForm` carries no `noteLog`, so `TaskFormDraft` (a `ReturnType<typeof emptyForm>`) has no such
  key and there is nothing for a future writer to put back into `payload`. The unsaved-task fallback
  button shows NO count at all — a hardcoded `0` would be true only by WIRING (task-manager gates
  `taskNotePanel` on `editingId !== null`), not by construction. Re-adding the field is a typecheck
  error before it is a data-loss bug — keep it that way.
  ★★★ RAID HAD THE SAME DEFECT AND IT IS FIXED DIFFERENTLY — do not copy the task approach there.
  `raid-panel.tsx` seeds `useState<RaidItem | null>` with a full-row SNAPSHOT at edit-open, the notes
  window is owned ABOVE the panel (`task-manager.tsx` `openRaidNotes`) and commits write-through to the
  workspace `raid` array the snapshot never sees, and the save is a full row REPLACE — so open RAID
  editor → Notes → add a note → Save destroyed it (fixed 0.211.1, `docs/open-followups.md` §48).
  ★★ The task fix (OMIT the field from the payload) would be WORSE here: because the RAID save
  REPLACES the row, a payload without `noteLog` erases the log outright. `use-resource-planner.ts`
  instead builds `withStamp` with `noteLog` taken from the STORED row (`previous`), never the payload.
  ★★ It must land on `withStamp` and not only inside `setRaid` — `RAID_UNDO_GROUPS` is `[]`, so
  `changedFieldGroups` emits ONE capture PER changed key and a stale `noteLog` becomes undoable/
  redoable state. `NEVER_CAPTURE` is only `{id, localModifiedAt}`, so nothing else suppresses it.
  ★ The modal's `draft.noteLog?.length ?? 0` count still reads the stale snapshot, so it can
  under-report while the notes window is open. Cosmetic (the log itself is safe now) — left open.
  ★★★ **`sanitizeRaidItem` DROPS `noteLog` and CANNOT be taught to keep it.** It builds from an
  explicit field list, and `sanitizeNoteLog` → `sanitizeNoteHtml` → DOMPurify is DOM-BOUND while the
  entity sanitizers must stay DOM-free (they run under bare node in the sample generator — same
  constraint as §36(a)). So ANY caller that sanitizes an EXISTING RAID row silently erases its log.
  `use-chat-dispatcher.ts` `updateRaid` did exactly that until 0.211.1 and every AI edit to a RAID item
  wiped its notes unrecoverably (no undo on AI writes) — it now re-applies the stored log after
  sanitizing (`docs/open-followups.md` §49). The other THREE callers are CREATES and safe. ★ A NEW
  `sanitizeRaidItem` call site must ask whether it holds a stored row; nothing gates this. ★★ Sweep on
  the BARE name — `ai-project-proposal.ts:287` passes the sanitizer by REFERENCE into `buildList`, so
  `grep 'sanitizeRaidItem('` misses it (that trap produced a wrong count here first time round, and it
  applies to any sanitizer used as a `.map`/`buildList` callback).
  ★★ STILL OPEN (§50): whole-row `capture()` undo restores a stale row, so undoing a BULK edit reverts
  the note log. Shared engine (`undo-stack.ts:89`), so tasks are likely affected too — unverified.
  ★★ SSR landmine: `plainToHtml` must NOT run DOMPurify at module-eval (no DOM under Next SSR → 500) — it
  escapes `&<>` + wraps `<p>`/`<br>`, a provable no-op vs the sanitizer. ★ Enter-commit IME guard:
  `!event.isComposing && keyCode !== 229`. `use-notes-window.ts` = deps-object glue hook (coverage-excluded).
- **Rich-text register descriptions (0.209.0 "Lafferty"):** SIX more fields joined `Task.description`
  as rich HTML — RAID `description` + `mitigation`, Change `description` + `impactDescription` +
  `resolutionNotes`, Milestone `description`. Same lean `RichTextEditor`, same `sanitizeNoteHtml`
  allow-list. Two pure modules, split by ONE axis — whether the code may touch a DOM:
  • `rich-text-plain.ts` — **DOM-FREE**. `descriptionHtml` (upgrade), `htmlPlainProjection`,
  `htmlTextLength`, `capHtmlText`, `sanitizeRichText` (the entity sanitizers' entry point).
  • `rich-text-projection.ts` — **browser-only**. `descriptionText` (= projection ∘ `htmlToText` ∘
  upgrade) for every NON-DOM consumer, `descriptionTextWithBreaks` (the EXPORT projection), and
  `appendDictationToHtml`.
  ★★ **TWO projections, and exports use the SECOND one.** `descriptionText` COLLAPSES a block
  boundary to a space — right for search, AI digests and the inline-AI preview, wrong for an export
  a human reads, where a three-paragraph description arrived as one run-on line.
  `descriptionTextWithBreaks` keeps the boundary as `"\n"`, and `export-sections.ts`'s `richCell`
  routes EVERY rich column through it (`TASK_RICH_COLUMNS` · `RAID_` · `MILESTONE_` · `CHANGE_`);
  each renderer then maps that newline to its own primitive — `<br>` (HTML/PDF, escape FIRST),
  `<w:br/>` (DOCX, several `<w:t>` in one `<w:r>`), one `<a:p>` per line (PPTX), and XLSX already
  preserved it via `xml:space="preserve"` + `wrapText`. A new export column joins a `*_RICH_COLUMNS`
  set; a new RENDERER must map the newline or it silently ships fused text.
  ★★★ The break mode is OPT-IN at THREE points and all three are required:
  `separateBlockBoundaries(html, "\n")`, `htmlToText(html, {preserveBreaks:true})` and
  `htmlPlainProjection(html, {preserveBreaks:true})`. The middle one is the easy miss —
  `htmlToText`'s default collapse is `\s+` → `" "`, which flattens the very newline
  `separateBlockBoundaries` just inserted, silently producing the collapsed form. Every default path
  is BYTE-IDENTICAL and pinned by hardcoded byte-stability suites, because `htmlPlainProjection`
  feeds `capHtmlText` → `sanitizeRichText` → all six backends. `separateBlockBoundaries`' `sep` is
  typed `" " | "\n"`, not `string`: it lands in a `String.replace` REPLACEMENT position where `` $` ``
  and `$&` are special.
  ★★★ `rich-text-plain.ts` MUST NEVER CALL DOMPurify. It runs inside the entity sanitizers, which
  execute under bare node in `scripts/generate-sample-workspace.ts` and the fixture flow; DOMPurify
  binds `window` at module-eval, so with no DOM `sanitize` is undefined, the call throws, and
  `jsonToWorkspace`'s catch-all swallows it into an EMPTY workspace that then "successfully" writes
  near-empty sample files. A comment-stripping source scan in its test enforces it — comments may
  name the library, code may not. IMPORTING `plainToHtml` is fine (only a CALL needs the DOM).
  ★★★ **EVERY WRITE BOUNDARY FOR A RICH FIELD MUST BE UPGRADE-AWARE — `sanitizeRichText`, never
  `plainToHtml`.** `plainToHtml` ESCAPES `& < >`, so an HTML value passed through it is stored as
  `<p>&lt;p&gt;&lt;strong&gt;…` — literal tags visible in the field, in every export and in the search
  index, permanently. RAID/change/milestone were always safe **from that CORRUPTION** — they route through
  their entity sanitizer → `sanitizeRichText` → `descriptionHtml`, which passes HTML through and upgrades
  plain text. ★★★ They were NEVER allow-listed, and reading this sentence as "those three need nothing" is
  plausibly WHY the model-write gap below took three review rounds to find. Two different properties:
  upgrade-vs-escape (corruption) and allow-list (what a model may store). Never let a claim about one read
  as a claim about the other.
  `Task.description` had FOUR plain-text-in boundaries, all fixed in 0.210.0 — `use-chat-dispatcher.ts`
  create + `update_task`, `ai-project-proposal.ts` (the model's `propose_project`, fed from an uploaded
  PDF / SharePoint file / Confluence page — the most attacker-influenceable input in the app), and
  `templates.ts` `sanitizeSeedTask`. ★ `grep -rn "plainToHtml(" src/app` is the sweep; the remaining hits
  (`action-task-seed.ts`, `jira-api.ts` via `adfToText`, `templates-builtin.ts`) are provably plain by
  construction. ★★ `sanitizeSeedTask` ALSO read the pre-0.196.0 `raw.notes` only, which was silent DATA
  LOSS: `templateFromWorkspace` captures real `Task` objects, so every captured description imported as
  `""`. It now reads `raw.description || raw.notes` — `||` not `??`, because a template carrying
  `description: ""` beside a legacy `notes` must fall back, and `??` only catches null/undefined. ★ `ai-project-proposal` keeps `raw.notes` on
  purpose — `PROPOSAL_TOOL`'s task schema advertises that key, so it is what the model is asked for.
  0.210.0 made the inline-AI route reachable by renaming the descriptor's dead
  `notes` to `description` (a task-description diff became possible) while the confirm path applies the
  model's VERBATIM `diff.raw` — which is HTML, because `scopeBlock` hands the model the stored HTML to
  read. ★ Precisely: the plain CHAT route was already reachable at base (the model reads a stored
  description through a read tool and echoes HTML back), so 0.210.0 added a second route and made a hit
  far likelier — it did not create reachability from nothing. THREE of the four boundaries go through
  **`sanitizeAiRichText`** (`ai-rich-text.ts`); chat and persisted insight-recommendation replay share two.
  ★★★ The FOURTH — `templates.ts` `sanitizeSeedTask` — deliberately does NOT, and CANNOT: that file is in
  `scripts/generate-sample-workspace.ts`'s import graph, so a DOMPurify call there throws under bare node
  and `jsonToWorkspace`'s catch-all writes near-empty sample files. Template import gets the upgrade but no
  allow-list — the same DOM-free CAUSE as the codec load paths (§28), recorded as its own item in
  `docs/open-followups.md` **§36(a)**, since §28 is scoped to the codecs and does not cover this boundary.
  Do not "complete the sweep" by importing the helper there; the guard bans it precisely so you cannot.
  ★★★ AND SO DO THE OTHER THREE ENTITIES, via `withAiRichFields(input, AI_RICH_FIELDS.<entity>)` at the
  six raid/change/milestone create+update sites. Their entity sanitizers (`sanitize-records.ts`) are
  DOM-FREE and therefore CANNOT run an allow-list — verified: `sanitizeRaidItem` stored
  `<script>alert(1)</script>` verbatim — so the model's value is cleaned BEFORE it reaches them. Fixing
  only `Task.description` (as 0.210.0 first did) left six model-writable rich fields unguarded while this
  very bullet claimed "EVERY write boundary". ★★ Apply it to the model's INPUT/PATCH, never to the merged
  entity: an update spreads the STORED value, and re-sanitizing that rewrites bytes the call never asked
  to touch. ★★ A field the model did not supply must be SKIPPED, not blanked — otherwise renaming a RAID
  item erases its stored description and mitigation. ★ A new rich field on an AI-writable entity goes in
  `AI_RICH_FIELDS` (a test pins each list, so adding one forces the decision).
  ★★★ That helper is TWO layers and both are load-bearing: `sanitizeRichText` (upgrade-aware, DOM-free,
  caps + drops-empty) THEN `sanitizeTemplateHtml` (the actual DOMPurify allow-list). Layer 1 alone CANNOT
  sanitize — it is DOM-free by contract and `descriptionHtml` passes HTML-shaped input through verbatim,
  so a model's `<script>` reached all six backends. ★★★ It is `sanitizeTemplateHtml`, **NOT**
  `sanitizeNoteHtml`, and the difference is DATA LOSS: `sanitizeNoteHtml` sets `KEEP_CONTENT:false`, which
  deletes the TEXT inside a non-allow-listed tag — right for the editor (its schema emits only the lean
  set) and WRONG for a model, which legitimately emits `<h3>`/`<div>`/`<table>`. A test pins that
  distinction; swapping the sanitizer fails it. ★ The helper lives in its OWN module because it calls
  DOMPurify — putting it in `rich-text-plain.ts` would break the DOM-free guarantee that module's guard
  exists to protect.
  ★★ A model may send EITHER shape — never assume plain text just because the tool schema says "text".
  ★★ TEST AT THE WRITE, NOT THE TOOL CALL: the inline-AI tests spy on `runTool` and assert what reaches
  it, which is one hop short of this defect, and `descriptor-drift.test.ts` covers only the four
  sanitizer-backed entities — it says so — leaving the one entity without a `sanitizeRichText` boundary
  as the uncovered one. Three primed review rounds missed this; a COLD read found it.
  ★★ **MIGRATION IS READ-TIME, NOT WRITE-TIME.** Storage is not normalised by the decoders — they
  hand-build entities and never call the entity sanitizer (`buildRaidItemFromObj`,
  `buildMilestoneFromObj`). EVERY reader upgrades instead: `descriptionHtml` at a DOM boundary,
  `descriptionText` for search / AI digests / the inline-AI preview (exports use
  `descriptionTextWithBreaks` — see above). A project therefore
  holds BOTH shapes at once, and that is fine — but a new consumer that reads one of the six fields
  raw ships escaped markup or fused text. Grep the six names before adding a reader.
  ★★ The projection is REGEX, and both of its obvious spellings are wrong: `<[^>]*>` deletes a tag
  with nothing in its place (so `<p>a</p><p>b</p>` fused to `"ab"`, and every upgraded multi-line
  legacy value read as one word), and it is not the HTML tokenizer (a `<` NOT followed by an ASCII
  letter or `/` is literal text — `<p>cost < 5k</p>` projected to `"cost"`, and a value projecting to
  empty is DROPPED by `sanitizeRichText`'s empty rule). Block tags are replaced by a SPACE first;
  `&amp;` decodes LAST so `&amp;lt;` cannot double-decode. All three cost a data-integrity bug.
  ★★ `HTML_START` (`narrative-html.ts`, SHARED with the dashboard narrative) must see the tag
  actually CLOSE and be an OPENING tag. Accepting `"<li 3 items"` as HTML stored a value the counter
  measured at 11 while every reader rendered nothing.
  ★ Counters/caps measure VISIBLE TEXT (`htmlTextLength`), never `html.length`; `capHtmlText` backs a
  truncation off one code unit rather than splitting a surrogate pair (a lone surrogate is `U+FFFD`
  on CSV/MD but survives on JSON/IDB — a backend-dependent corruption). `clipText` in
  `sanitize-core.ts` carried that bug across ~49 plain-text call sites until 0.222.x, and now backs
  the cut off the same way — open-followups §22 is CLOSED. ★ It clamps a NEGATIVE `max` to `""` too,
  which is a distinct case from `0`: `slice(0, -1)` counts from the END and returns nearly the whole
  string, over cap and able to end on a lone surrogate itself.
  ★ Whole-object load boundaries (JSON + IDB) route the rich fields through `sanitizeNoteFields` /
  `sanitizeRaidRichFields` / `sanitizeChangeRichFields` / `sanitizeMilestoneRichFields` — escape
  BEFORE sanitize, or `KEEP_CONTENT:false` deletes tag-shaped plain text along with its content.
  ★ They are four ONE-ARGUMENT functions on purpose: every call site is `.map(fn)`, which passes the
  INDEX as the second argument, so a `(entity, fields)` signature would be fed `0, 1, 2…`, normalise
  nothing, and leave every `.map`-based test green.
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
- **★★ `ResourcesPanel` is the ONLY `memo()`'d panel `workspace-section` renders** — so it is the one place
  where adding a `useWorkspace()` call silently defeats a real optimization. A direct context consumer
  re-renders on ANY context-value change REGARDLESS of the parent's memo bailout (same rule as the
  `RowLookupContext` split above), and `WorkspaceProvider`'s value is one `useMemo` over ~30 slices, so a
  milestone/RAID/budget/insight edit — or a background Outlook-pull / insight-recommendation / scheduled-job
  write — would re-render the whole planning table, workload rollups and absence calendar.
  ★★ HONEST STATE: the memo does NOT currently bail, so the optimization this bullet defends is aspirational,
  not in effect. `workspace-section` passes it ~47 props and several are a FRESH IDENTITY every render —
  every `guardEdit(handler)` (`guardEdit` is `makeEditGuard(...)` called unmemoized during render in
  `task-manager.tsx`) plus the `absenceCalendar` bag. Verified twice in review. Do NOT cite this memo as the
  reason anything is fast, and note that "memoize `guardEdit`" is NOT the fix — it is one unstable family of
  several. Either stabilise every handler prop (measure first) or delete the memo and this bullet; tracked in
  the R5 follow-ups doc. The guidance below still stands regardless, because it is what would make a bail
  possible at all. THREAD PROPS instead — workspace-section already holds
  `disciplines`/`grades`/`setResources` and passes them to sibling panels. (Every other panel it renders —
  tasks, milestones, dashboard, insights, knowledge, timelog — is un-memoized, so consuming context there
  costs nothing.)
- **Gantt module map:** `GanttPanel` (`gantt.tsx`, 715 lines) is orchestrator only (data derivation +
  layout); heavy
  parts extracted. Pure i18n-free ENGINES `gantt-engine.ts` (date math, prefs load/save, critical-path,
  derive-bar) and `gantt-status-buckets.ts` (`taskStatusBuckets`/`milestoneStatusBucket` — which
  status-filter buckets an entity belongs to; `today` passed in, no clock). React pieces: hooks
  `use-gantt-bar-drag.ts` (bar move/resize — window pointer-listener drag
  lifecycle + `previewDates`/`startBarDrag`, mirrors drag into state for the preview bar) and
  `use-gantt-prefs.ts` (sort/filter prefs state + localStorage hydrate/persist + setters); presentational
  `gantt-chrome.tsx` (`GanttToolbar`, `GanttHeader` axis, `GanttDependencyLayer` SVG arrows + milestone
  connectors), `gantt-rows.tsx` (`GanttTaskRow`, `GanttMilestoneRow`), `gantt-chart.tsx` (`GanttChart` —
  the scrollable chart surface: sticky header, overlays, today marker, dependency layer, the interleaved
  row list, the trailing add-task affordance and the range footer; extracted from `gantt.tsx`),
  `gantt-overlays.tsx` (`GanttNonWorkingLayer` holiday shading + `GanttGridLayer` dotted day rules, both
  `aria-hidden` + `pointer-events-none` so they can never intercept a bar drag; both derive their origin
  from the SHARED `dayLeftPx(i, nameColWidth)` — a layer computing its own origin/column width puts a grid
  line off its date label) and `gantt-view-menu.tsx` (`GanttViewMenu`, the toolbar's View popover holding
  all EIGHT display toggles — dependencies · holidays · absences · grid · critical path · baseline ·
  show-milestones · inline milestone placement; every one is a `ToggleButton`, never a hand-rolled
  `aria-pressed` button, so each gets the non-colour pressed marker). Rows/chrome/chart/overlays are PURE —
  `GanttPanel` threads data + drag state/handlers (incl. the same `interactingWithBarRef` the row's
  `onDragStart` reads synchronously) down as props. ★ Gantt IS in axe `A11Y_VIEWS`. ★ One brittle
  markup-ORDER source test reads `gantt-chrome.tsx` (toolbar markup moved there), not `gantt.tsx`.
  ★★★ **GANTT PREFS ARE v2 AND `statuses: []` NOW MEANS "SHOW NOTHING".** `GANTT_PREFS_VERSION = 2`
  (`gantt-engine.ts`); `DEFAULT_PREFS.statuses` is `[...ALL_GANTT_STATUSES]`, i.e. every bucket TICKED.
  The pre-v2 blob used empty-means-all, so `loadPrefs` migrates it — `!isV2 && statuses.length === 0`
  re-fills all three buckets — and `savePrefs` stamps `v`. Writing `statuses: []` intending "show
  everything" now yields an EMPTY chart. ★★ Consequently **any "is a filter active" test must compare
  `prefs.statuses.length < ALL_GANTT_STATUSES.length`, NEVER `> 0`** — a `> 0` test calls an untouched
  project filtered and hides its "add your first task" affordance (that exact mistake shipped a regression
  in the 0.213.0 branch; `gantt.tsx:588` holds the correct form). ★ `resetFilters` restores all three
  statuses, NOT `[]`; priorities and assignees keep empty-means-all and still clear to `[]`. ★
  `ALL_GANTT_STATUSES` is `Object.freeze`d and `loadPrefs` returns `DEFAULT_PREFS` BY REFERENCE on its
  SSR/no-blob/catch paths — spread it (`[...ALL_GANTT_STATUSES]`) wherever a mutable array is wanted.
  ★ The name-column resize handle (in `GanttHeader`, `gantt-chrome.tsx`) renders the SAME 3-dot ⋮ grip
  glyph as the Open Points table but tuned for the LIGHT `bg-surface-muted` header (`text-muted-foreground/60`
  + `hover:bg-ui-dark-blue/10` + `hover:text-ui-dark-blue`) — NOT the shared `ColumnResizeHandle` (which
  uses dark-header `table-head-*` tokens). It's `role="button"` + aria-label, mouse-only (`onMouseDown`); the
  SVG child is `aria-hidden` so the accessible name stays the aria-label.
- **Reports module map:** `ReportsPanel` (`reports.tsx`) owns data + sort/column-resize state; pure
  i18n-free `reports-stats.ts` (`computeStats` + `Stats`/`GroupOrLabelRow`) and presentational
  `reports-tables.tsx` (`GroupOrLabelTable`, `AssigneeTable`, `Tile`, `Section`, `StackedBar` + shared
  `REPORTS_*_COL_WIDTHS` consts and `AssigneeSort`/`GroupOrLabelSort` types). One-way dep (reports →
  reports-tables → reports-stats); per-type report engines/panels (budget/raid/resource/stakeholder) live
  in their own files. Reports IS in axe `A11Y_VIEWS`.
- **Budget panel module map (gantt pattern):** `budget-panel.tsx` is the orchestrator (state, derivation,
  the bucket cards, the CCI tiles); the bucket table's CELL layer is the presentational leaf
  `budget-panel-totals.tsx` — `HoursCell`/`HoursTd` (the editable period cells), `TotalsTd` (the fixed
  Total column's cells and every cell of a bucket total row), `BucketRowLeadCells` (the three PINNED
  leading cells: RAG dot · label · Total), `BucketTotalRow`, `RowDot`, and the pure `bucketColumnTotals`
  arithmetic. Split out to keep the orchestrator under the 800-line ratchet.
  ★★ The three leading columns are PINNED by arithmetic — role at `DOT_COL_PX`, Total at `DOT_COL_PX +
  the LIVE role width` (the role column is user-resizable, so a hardcoded offset drifts the moment it is
  dragged). That arithmetic is only true while every column to a pinned one's LEFT renders exactly as
  wide as it declares, and TWO independent mechanisms break that: `table-layout: auto` lets CONTENT push
  a column past its declared width (so the dot header's label is `sr-only` and the role cells are
  clamped), and a `w-full` table spreads LEFTOVER width across every column including the pinned ones
  (so the table is `w-max`). ★ The `w-max` cost is real and deliberate: a short plan no longer stretches
  to fill the pane. ★ jsdom has no layout, so NOTHING in the unit suite can see any of this — the tests
  pin the class/offset plumbing only, and the geometry itself was measured in Chromium.
  ★★ The total row's separating rule rides `cellClass` onto the CELLS, never the `<tr>` — see
  `docs/open-followups.md` §68 for why a `<tr>` border in these tables has never painted.
  ★ `bucketColumnTotals` takes the caller's OWN `cellBudget` as `budgetOf`, so the column sums and the
  row sums come from one accessor and cannot disagree (it honours budget-follows-plan mirroring). It is
  fed the FILTERED rows, so the totals follow the role filter — §70.
- **Shared sortable/resizable header cell (`SortResizeTh<K>` in `report-table.tsx`):** the
  `<th className="relative px-3 py-2[ text-right] font-medium"> + SortHeaderButton + ColumnResizeHandle`
  trio every report panel repeated per column (top cross-file jscpd clones, TD-6) is now ONE generic
  component beside `SortHeaderButton`. `K` is fixed by the `sortKey` prop (the table's typed sort union),
  so `sortCol` must be a valid key and `onSort={click}` typechecks with no cast. ★ `resizeCol` (defaults to
  `sortCol`) + `width` are SEPARATE from `sortCol` — they diverge on the name/label column (sort key `name`,
  width/resize key `label`). `align="right"` picks the `text-right` variant; `hint` forwards to the
  `InfoTooltip`. Byte-equivalent DOM (Reports is axe-scanned). ★ Consumers are now raid-report (28) /
  resources-report (16) / tasks-section (11) / change-report (6) / resources-panel-rows (6) /
  reports-tables (4) / calendar-series-list (2) / milestones (2) / budget-panel (1) /
  budget-report-panel (1) — TEN non-test files, 77 invocations (2026-08-04, reproduce with
  `grep -ro "<SortResizeTh" src/app --include="*.tsx" | grep -v "\.test\.tsx:" | wc -l`; the unfiltered
  grep returns 83 because `report-table.test.tsx` holds 6 more, and an earlier revision here both said
  "raid-report (34)" and omitted `resources-report` entirely) — `reports-tables`
  and `budget-report` were once "left as-is" over local sort-var naming and have since adopted it, so
  every sortable header in the app now flows through here (which is why the `aria-sort` below lifts them
  all at once). NON-sortable text-only header cells (no `SortHeaderButton`) keep their raw `<th>` +
  `ColumnResizeHandle`.
  ★ `onResize` is OPTIONAL — omit it for a table that sorts but stores no column widths (the calendar series
  list) and NO handle renders. Never pass a no-op instead: that draws a grip which looks draggable and does
  nothing, the exact false affordance this component exists to avoid.
  ★★ **`stickyLeft` DOES TWO THINGS, and the second one is the surprise.** It pins the column
  (`position: sticky` at that px offset) AND it silently changes what `width` MEANS: at the other 76
  invocations `width` is a MINIMUM (`table-layout: auto` lets content grow the column past it), but
  passing `stickyLeft` adds `max-width` + `overflow-hidden` + `whitespace-nowrap` so the declared width
  becomes the RENDERED one. That coupling is deliberate — anything pinned to the RIGHT is placed by
  arithmetic over this column's DECLARED width, so a wider render puts the neighbour on top of this
  column's own content — but a caller reaching for "pin this" gets a clamp it did not ask for. ★ `0` is a
  REAL offset (the leading fixed column), so both the class branch and the style branch check
  `stickyLeft === undefined`, never truthiness; `report-table.test.tsx` pins the offset-0 case in BOTH
  branches precisely because a `!stickyLeft` "simplification" ships green otherwise.
  ★★★ `position` MUST stay in the CLASS, never the inline style. An inline declaration outranks every
  author rule in every media, so an inline `position: sticky` leaves the `print:static` beside it
  permanently inert — and the print stylesheet strips the scroll container these cells are positioned
  against, so a pinned cell with no scroller offsets against the PAGE. Measured in Chromium under
  emulated print media: inline sticky + class static computes `sticky`; class sticky + class static
  computes `static`. Only `left`/`width` are inline (per-instance values).
  ★★ The pinned header clips with `overflow-hidden whitespace-nowrap` while the matching BODY cell in
  `budget-panel-totals.tsx` uses `truncate` (the same two properties PLUS `text-overflow: ellipsis`), so
  a narrowed role column cuts the header label mid-glyph while the row labels beneath it get "…".
  **Do NOT "fix" that by swapping in `truncate` — measured in Chromium, the two render IDENTICALLY.**
  The header's content is an inline-flex `SortHeaderButton`, an atomic inline, and `text-overflow` does
  not apply to one; the body cell ellipsizes only because its content is raw text. The asymmetry is
  inherent to the header holding a button, not to the class choice, and jsdom cannot see either.
  ★★ The `<th>` carries **`aria-sort`** (`ascending`/`descending`/`none`), derived from the SAME `active` value
  the arrow is, so the announced and drawn states cannot drift; `active` gates on BOTH `sortKey === sortCol`
  AND `sortDir !== "off"` ("off" is a real member of the asc→desc→off cycle, so naming the column is not
  enough). The `↑`/`↓` is `aria-hidden` — it stays VISIBLE and in `textContent` (existing glyph assertions in
  `report-table.test.tsx` + `calendar-series-list.test.tsx` read textContent, so they are unaffected) but out
  of the accessible NAME, since aria-sort already says it. axe has NO rule for a missing aria-sort, so the
  gate is silent on regressions here — the unit tests are the only coverage.
  ★ The raw-`<th>` tables are NOT in step and knowing which way matters: `change-panel.tsx` +
  `raid-panel-rows.tsx` + `stakeholders-panel.tsx` set aria-sort AND keep a ▲/▼ inside the button's
  name (the double announcement this removed from the shared component), and `activity-log-panel.tsx`
  has the glyph with NO aria-sort at all. Folding them in is a follow-up, not a claim about today.
  ★ `SortHeaderButton` is used ONLY by `SortResizeTh`, so hiding the glyph cannot strand a raw `<th>`
  that lacks aria-sort.
  ★★ KNOWN LOSS: VoiceOver/Safari does not announce `aria-sort`, so a VO user goes from hearing
  "Title ↑" to "Title". Standard-correct (the glyph was never a state) but a real regression for that
  one AT — do not re-litigate it as a pure win.
- **★ `TableFilter` (`report-table.tsx`) has exactly ONE clear ✕, overlaid INSIDE the field.** The input is
  `type="search"`, so Chrome/Safari draw their own ✕ inside it; a sibling clear button therefore read as TWO
  clears on those browsers while Firefox — which draws none — showed only ours. The fix suppresses the native
  one (`[&::-webkit-search-cancel-button]:appearance-none`) and absolutely-positions our button over the field
  (`pr-8` reserves the room). ★ Do NOT "simplify" this back to a sibling button, and do NOT drop our button in
  favour of the native one — the native ✕ does not exist in Firefox and is not keyboard-reachable. Shared by
  7 panels (budget · budget-report · change-report · raid-report · reports-tables · resources-panel ·
  resources-report), several axe-scanned.
- **★★ `buildResourceWorkload` (`resource-workload-rows.ts`) MUST receive the COMPLETE resource list.** It
  builds its `managed` id-map and `nameToId` map from the `resources` ARGUMENT ALONE, and `resolve()` falls
  through to `ensureUnlinked` on a miss. So filtering that argument does NOT hide anyone — the withheld
  person's tasks/absences/shifts/RAID miss both lookups and REAPPEAR under "Unlinked", whose "Clear unlinked"
  control (`task-manager.tsx` `onClearUnlinked`) blanks task assignees + RAID owner and **`filter`s matching
  absences and shifts out of the workspace entirely**. A display filter would therefore become a path to real
  data deletion. `ResourceWorkload` takes a `hideExternal` FLAG and filters the BUILT `managed` rows instead
  (`unlinked` untouched). The full list is also the reassign-picker's target set (`WorkloadOverdueTriage`),
  which a display filter must never narrow. ★ TEST TRAP: a fixture whose external owns NO work cannot reach
  `ensureUnlinked`, so the naive "external disappears" assertion passes for the wrong reason — give them a
  task and assert absence from the WHOLE pane. (Planning/rollup DO correctly consume a pre-filtered
  `visibleResources` — they just `map` it.)
- **★ Toolbar button ORDER convention (this is the RULE, not a claim every pane already follows it — read the
  pane's own toolbar before assuming compliance):** every pane's toolbar ends with the contiguous trailing group
  **Print · reset-columns · reset-pane-size**, in that order. Destructive/bulk actions (Activity's "Clear log")
  and integration blocks (the Outlook `CalendarSyncControls`) go BEFORE it, never between two members. Drift has
  been caught and fixed more than once: Outlook once sat between the two resets in Resources; Clear once sat
  after them in Activity; Open Points had the worst case — Print/reset-size/reset-columns sat BEFORE the
  destructive Clear-all AND the two resets were in the wrong relative order (reset-size before reset-columns),
  fixed in 0.211.0. ★ the reset-columns button uses `ResetColWidthsIcon` (columns glyph) and reset-size uses
  `ResetSizeIcon`; Gantt's name-column reset once wore the reset-SIZE glyph, making the two adjacent resets
  indistinguishable. That one was fixed in an EARLIER release — 0.211.0 did not touch Gantt at all, and this
  sentence sitting under a "fixed in 0.211.0" clause made it read as though it had.
  ★★ A pane's PRIMARY action leads the control row, ahead of its filters — `PlanningToolbar`'s `aiPlanButton`
  is the reference, and RACI's "Suggest RACI" joined it in 0.212.0 (it had been sitting in the trailing group
  beside Print/Reset, reading as a trailing utility). The trailing group is unaffected either way: a leading
  control only has to come BEFORE it, which is why `expectButtonOrder` takes `contiguous` per call.
  ★★ ASSERT THIS WITH THE SHARED `src/test/toolbar-order.ts`, never a local `compareDocumentPosition` walk.
  `buttonIndex` THROWS when a key matches zero or several buttons; a hand-rolled `findIndex` silently takes
  the first, so an ordering assertion can pass against the wrong control. And plain ordering is NOT enough
  for the trailing group — only `contiguous: true` catches a control drifting BETWEEN two members, which is
  the exact drift this bullet lists four instances of. ★ The helper reads BUTTONS only, so a combobox filter
  still needs one hand-rolled position check.
  ★ 0.212.0 also moved Planning's "Hide externals" INTO the trailing `ml-auto` group so it sits beside the
  Outlook block, matching what `renderWorkloadHeader` already did — Planning had been the outlier. ★ That is
  a GROUPING change, not an ordering one: the toggle was already the element immediately preceding the group,
  so a DOM-ORDER assertion passes against the unfixed code. Assert `closest("div.ml-auto")` contains the
  Outlook control instead.
  ★ Gantt's **View** menu (`GanttViewMenu`, 0.213.0) sits AFTER the reset-filters button and BEFORE the
  trailing Print · reset-columns · reset-size group (`gantt-chrome.tsx`) — it collects display toggles, so
  it is neither a primary action nor a member of the trailing group.
- **Documents (AI document authoring):** a `ProjectDocument` is `{id, title, blocks, createdAt, updatedAt}`
  over a typed `DocBlock` union — **JSON at rest; bytes are rendered ON DEMAND and never stored**, so no blob
  lives anywhere in the workspace. Three renderers: `doc-render-html.ts` (canonical), `doc-render-docx.ts`,
  `doc-render-pptx.ts`. ★ **PDF is not a fourth renderer** — it is the HTML renderer's `standalone` mode
  driven through the browser print dialog, so there is no PDF writer and no PDF dependency; keep it that way.
  Surfaces are `documents-panel.tsx` (orchestrator) over `documents-list.tsx` / `document-preview.tsx` /
  `documents-toolbar.tsx`.
  ★★ It persists via the **meta-blob** pattern (one JSON row in `meta`, exactly like `insights`), NOT via
  `ENTITY_SPECS`. So it is deliberately absent from `TABLE_NAMES` **because it has no table of its own — NOT
  because it is non-workspace data. It IS workspace data**, and reading the absence the other way is how a
  future slice talks itself into adding it to the per-table DELETE set. The dirty check is reference
  equality (`prev.documents !== next.documents`), so an in-place mutation silently skips the save.
  ★★ `document-model.ts` is DOM-FREE BY CONTRACT (a comment-stripped source scan in its test enforces it, so
  comments may name DOMPurify and code may not) — but the CSV/MD/JSON/Turso LOAD paths are the OPPOSITE and
  REQUIRE a DOM. Do not generalise either direction: `docs/open-followups.md` §97 holds the measurement and
  the blast radius, and §92 the `settings-types` ⇄ `workspace` ⇄ `document-model` import cycle.
  ★ `dataSection` blocks resolve through `doc-data-section.ts` `resolveDataSection`, which calls the REAL
  `buildExportSections` — so a document's embedded data cannot drift from what the workspace exporter emits.
  ★★ `documentVersions` is a SECOND meta-blob slice beside `documents`, on the same six write paths and
  subject to everything above. The version model (before-images, retention, tombstones, the single
  `applyDocMutation` path) lives in **[`docs/AGENTS/documents.md`](docs/AGENTS/documents.md)** — open it
  before touching version history, deleted documents, or any "add a field to the six write paths" task,
  which it records a landmine for.

## Subsystem reference — deeper detail, loaded on demand

★★★ **Only THIS file reaches every session.** `CLAUDE.md` is `@AGENTS.md`, so
everything above is loaded before you type anything; the nine files below are
not. That is the whole point of the split — this file had grown to 324 KB
(~81k tokens) of which ~73% was subsystem reference that most tasks never touch.
**Open the matching file before editing that subsystem's code.** The landmines
did not get weaker by moving, and a landmine nobody loads is a landmine nobody
reads — which is the risk this arrangement trades for the context saving.

★★ `npm run docs:symbols:check` gates all ten files, not just this one — `docs/AGENTS/`
is GLOBBED (`readdirSync`), so a new subsystem file is scanned the moment it lands. It still
proves only that a backticked NAME is real, never that a CLAIM about it is true.

| File | Owns |
|---|---|
| [dashboard.md](docs/AGENTS/dashboard.md) | the landing cockpit — masonry layout · delta strip · KPI trends · sparkline · coaching · density · digest |
| [ui-shell.md](docs/AGENTS/ui-shell.md) | Help system · navigation & landing · focus/keyboard · surfaces & controls · ★ **dismissal (the Escape/Tab protocol — read before touching any modal, popover or panel)** |
| [theming.md](docs/AGENTS/theming.md) | colour schemes · the `--ui-*` token families · AA derivation · the dark-mode hover trap · branding · print · design-system primitives |
| [insights.md](docs/AGENTS/insights.md) | detect → reconcile → recommend → outcome → digest |
| [ai-assistant.md](docs/AGENTS/ai-assistant.md) | wire layer · tools · inline edit · dedup · scheduled jobs · allocation & RACI planning |
| [integrations.md](docs/AGENTS/integrations.md) | steering committee · Outlook calendar write-back and two-way pull · Timelog |
| [platform.md](docs/AGENTS/platform.md) | diagnostics ring · guard transparency · dictation · the AI master switch |
| [features.md](docs/AGENTS/features.md) | guided tour + demo · timezones · saved views · PWA · resource calendar meetings |
| [documents.md](docs/AGENTS/documents.md) | the DATA half of documents — `DocVersion` before-images · retention + tombstones + the `"restored"` marker · `applyDocMutation` (the single mutation path) · `documentVersions` across all six write paths and both load funnels |
