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
| [ci](docs/AGENTS/ci.md) | the GitHub Actions jobs and required checks · the weekly workflow · a red check, minutes exhausted · the legacy GitLab pipeline's per-gate detail and exit-code splits |
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

Conventions used throughout: **★** = a non-obvious rule, **★★** = something that has already
caused a bug, **★★★** = something that has caused the same bug more than once. Open follow-ups
live in [`docs/open-followups.md`](docs/open-followups.md), not here.

★★★ **Almost nothing gates these files, and the one gate that exists checks the weakest property.**
`agents-symbol-check` (`npm run docs:symbols:check`) fails when a backticked name in THIS file or in
any `docs/AGENTS/*.md` exists nowhere in `src`/`scripts`/`e2e`. That is all it does: it proves a NAME
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

```bash
npm run dev                 # next dev (public next, pinned EXACTLY; version in package.json — a caret here would let a
                            # lockfile merge resolved the wrong way move the framework silently. Framework-coupled
                            # packages are exact-pinned; the rule and its reasoning live in CONTRIBUTING.md
                            # under "Dependencies". Read node_modules/next/dist/docs for version behavior.)
npm run build               # next build (prebuild checks script-docs are in sync)
npm run lint                # eslint --max-warnings=0 — ★★★ EVERY warning is now FATAL, and that is 25
                            # rules, not one: `@typescript-eslint/no-unused-vars` is still severity 1 and
                            # `noUnusedLocals` still does not exist in tsconfig.json, but the flag makes
                            # both moot. `_`-prefixed params are NOT exempt (no argsIgnorePattern), so an
                            # unused param from an extract now FAILS rather than warning. Verify severity:
                            #   npx eslint --print-config src/app/icons.ts   (read .rules)
                            # react-hooks/exhaustive-deps (severity 1 — FATAL since --max-warnings=0) rejects an `obj.member` dep (e.g.
                            # [snapshots.rebaselineNow]) — hoist it to a local const and depend on that.
                            # A react-hooks PURITY rule bans `Date.now()`/`Math.random()`/`new Date()`
                            # in a component RENDER body too (not just useMemo) — capture via a lazy
                            # `useState(() => Date.now())`, or read it inside an effect/callback.
                            # `react-hooks/set-state-in-effect` is BANNED (fatal) — to sync state to a
                            # changed prop, use the render-time reconcile pattern (`if (prop !== handled)
                            # { setState(...) }` guarded by a nonce/last-seen state), NOT a useEffect.)
                            # ★ `npx eslint --max-warnings=0 src/app` now matches CI's STRICTNESS but not
                            # its SCOPE — CI lints the whole repo, this lints one directory.
npx tsc --noEmit            # typecheck (enforces i18n EN/DE key parity). `next build` does NOT
                            # typecheck *.test.tsx and vitest never typechecks — a test-only type
                            # error (e.g. an invalid getByRole `{exact:...}`; a string `name` is
                            # ALREADY an exact match) passes build + tests but FAILS tsc (CI). Run
                            # `npx tsc --noEmit` after editing ANY test.
                            # ★★ THAT RULE IS TESTING-LIBRARY ONLY (`*.test.tsx`), AND PLAYWRIGHT IS
                            # THE EXACT OPPOSITE — reading it as universal cost three debug cycles on
                            # 2026-08-26. RTL's string `name` is a whole-string match and has no
                            # `exact` option; Playwright's `getByRole` takes one and it DEFAULTS TO
                            # FALSE, so a bare `name` is a case-INSENSITIVE SUBSTRING. Verify, don't
                            # trust this line: `grep -n "exact?: boolean" -B 8
                            # node_modules/playwright-core/types/types.d.ts` prints "Whether to find
                            # an exact match: case-sensitive and whole-string. Default to false."
                            # ★★ In `e2e/` that bites TWO ways and the second is silent. LOUD: a bare
                            # title matches every per-row control named `"<verb> – <title>"` (six
                            # elements in `documents-list.tsx`) → a strict-mode violation that names
                            # itself. SILENT: a bare `"Rename"` on a modal's commit button ALSO
                            # matches the row trigger behind the open modal, so the click lands on
                            # whichever the engine resolves first. Pass `exact: true` in e2e specs.
                            # fast-check gotchas that pass
                            # vitest but FAIL tsc/the test: `fc.date()` can emit an Invalid Date →
                            # `.toISOString()` throws — pass `{noInvalidDate:true}` or map an integer
                            # ms range to `new Date(ms)`; the regex `/s` (dotAll) flag fails tsc
                            # (target < es2018) — use `[\s\S]` instead.
                            # ★★ TIPTAP COMMANDS ARE TYPED BY MODULE AUGMENTATION, and this is the same
                            # vitest-green/tsc-red shape from the other direction. Each extension
                            # declares its own commands with `declare module '@tiptap/core'` INSIDE its
                            # package (verify: `grep -n "declare module" node_modules/@tiptap/
                            # extension-highlight/dist/index.d.ts`), so `toggleHighlight` /
                            # `toggleSuperscript` / `toggleSubscript` do not exist on Tiptap's chained-
                            # commands type (deliberately un-backticked — it is an UPSTREAM type, and
                            # backticking it would make docs:symbols:check flag this file, which is the
                            # gate working) until some file in the TS PROGRAM imports that module. A toolbar calling
                            # them while only the EDITOR imports the extensions works at RUNTIME either
                            # way — the command is registered on the live editor — so vitest is green
                            # and only tsc objects. Run tsc after touching either file.
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
                            # ★ `--minWorkers` DOES NOT EXIST in vitest 4.1.11 either — it exits with a CACError
                            # before running anything, which reads like a broken suite. `--maxWorkers=N` DOES
                            # exist and is the fix when a saturated machine kills the fork pool (measured: 8x
                            # "Failed to start forks worker" reported as `Test Files no tests` at EXIT=1 —
                            # ground rule 2's false-green shape, but red).
                            # ★ `--reporter=basic` DOES NOT EXIST in vitest 4.1.11 — it fails to load a
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
npm run test:shuffle        # the SAME command CI's `unit-shuffled` job runs, pinned seed (BLOCKING).
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
                            # ★ The visual project pins its own frozen clock (`VISUAL_FROZEN_NOW` in
                            # `e2e/visual.spec.ts`, passed through `gotoApp`'s `time` param) so a
                            # `FROZEN_NOW` bump in `e2e/seed.ts` no longer forces a re-baseline (§573).
npm run e2e:smoke:prod      # smoke against a REAL production server (build FIRST — it does not build).
                            # ★★★ THE ONLY LOCAL REPRODUCTION OF THE PROD CSP. `e2e:smoke` starts no
                            # server, so it is only ever pointed at a dev server — and dev grants
                            # 'unsafe-inline' on style-src-elem while prod is nonce-only (src/proxy.ts).
                            # A prod-only defect that rendered EVERY rich-text editor unstyled shipped
                            # unnoticed behind exactly that gap (open-followups §54). Run it before
                            # shipping anything touching CSP, layout.tsx, or a dependency that injects a
                            # <style>. ★ Owns port 3200 and REFUSES to run if something else holds it —
                            # it would otherwise mistake a foreign server for its own and kill it.
npm run dup:check           # jscpd duplication GATE (--threshold in package.json dup:check; BLOCKING in CI)
                            # ★★ IT COMPARES ONE NUMBER: the TOTAL duplicated-LINE percentage across all
                            # formats — NOT per-format, and NOT tokens. 1.19% (1612/135895 lines) against a
                            # 1.75 threshold on 2026-08-08. The console table prints six cells and flags
                            # none; the eye-catching per-format token figure (tsx 1.70%) is never read.
                            # Bisect by exit code — it is the only witness. Run dup:check's own command
                            # with the threshold overridden: 1.60 and 1.52 both exit 0 (ruling out
                            # per-format tokens and total tokens), 1.19 exits 0, 1.18 exits 1 with
                            # "found too many duplicates (1.2%)". See open-followups.md §116.
                            # ★ docs/baselines/jscpd-2026-07.json is a RETAINED July-2026 report, NOT a
                            # gate input — dup:check passes only --threshold and there is no .jscpd.json.
npm run size:check          # file-size ratchet — fails on a NEW file over the LIMIT, or a baselined file that grew
                            # ★★★ THE LIMIT IS 1600, DOUBLED FROM 800 ON 2026-09-03, and every entry in
                            # `docs/baselines/file-sizes.json` was doubled in the same change — the ratchet was
                            # biting on routine work. Read the number from `scripts/check-file-sizes.mjs` (`LIMIT`)
                            # rather than any prose, this line included. ★★★ `--update` DISCARDS THE DOUBLING, AND
                            # IT DELETES RATHER THAN HALVES: it writes only files ABOVE the LIMIT, so at 1600 it
                            # emits `task-manager.tsx` ALONE and the other three entries VANISH. Running it (which
                            # the gate's own failure message still recommends) restores a no-headroom ratchet and
                            # makes "re-double by hand" impossible for the dropped rows without git archaeology.
                            # ★ CONSEQUENCE: three of the four baseline entries are ALREADY INERT, because a file is
                            # only compared against its entry when it is over the LIMIT — chat-panel,
                            # tasks-section and workspace-section are governed by the LIMIT alone until they pass
                            # 1600. Only `task-manager.tsx` is still consulted, and at a 6040 entry, far above the
                            # file's real length (node one-liner below), it constrains nothing in practice either — read the four as recorded
                            # intent, not as live limits.
                            # ★★ IT COUNTS `wc -l` + 1. The script measures `readFileSync().split("\n").length`,
                            # which for a newline-terminated file is one MORE than `wc -l`. So a file at `wc -l`
                            # 1599 is already AT the limit with ZERO headroom. The same +1 applies to a baselined
                            # file, which is how an `--update`-derived baseline lands one above `wc -l`.
                            # Budgeting a change from `wc -l` overstates your room by exactly one
                            # line and the gate fails on the commit — it cost a build on `use-storage-backend.ts`.
                            # Read the real number with:
                            #   node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
npm run docs:claims:check   # doc-claims RATCHET (BLOCKING in CI) — fails when a doc gains a NEW
                            # `path:LINE` citation, or cites a line that cannot exist. This is the
                            # enforcement the ★★★ "cite the SYMBOL, not a line range" rule never had.
                            # ★★ IT CANNOT TELL YOU A CITATION IS CORRECT, and nothing can — the doc
                            # never records what was supposed to be at that line. It proves only that
                            # the line COULD exist and that the count is not growing. A cite silently
                            # shifted by an insertion still passes: measured on the very row that
                            # motivated the gate, where `jira/_helpers.ts:181` sat 64 lines off the
                            # actual `console.error` and passed the range check while
                            # `timelog/_helpers.ts:185` (one line past EOF) was caught. Two wrong
                            # cites, one detectable. Do NOT read green as "the citations are right".
                            # ★★ It reads CONTINUATION cites too — "`use-resource-planner.ts:710` and
                            # `:723`, returned at `:1023`/`:1025`" is FOUR citations, and the first cut saw
                            # ONE of them while the three bare ones (all broken) were invisible.
                            # Widening found 55 more citations and raised out-of-range 5 → 8.
                            # ★★★ A bare `:NNN` is resolved ONLY from a file mentioned EARLIER ON THE
                            # SAME LINE, and the anchor is the nearest preceding file MENTION, not the
                            # nearest preceding `path:LINE` — a full-cite anchor skipped a colon-less
                            # `task-manager.tsx` and hung four of its line numbers on a 152-citable-line file,
                            # reporting violations that did not exist. The ~113 bare cites whose path
                            # sits on a PREVIOUS line stay out of scope (100 of 156): the form is ambiguous
                            # (AGENTS.md's own `:3000` is a PORT), and a gate that invents a citation
                            # is worse than one with a known blind spot.
                            # ★ Grandfathered breakage in docs/baselines/doc-line-cites.json is down
                            # to 1 unresolvable + 2 out-of-range (from 11 + 8), and ALL survivors sit
                            # in docs/security/findings-2026-07.md — a DATED AUDIT SNAPSHOT, bannered
                            # as such and deliberately NOT renumbered, because rewriting a signed
                            # record to match today's tree destroys the only thing it is good for.
                            # A third bucket, `thirdParty`, holds cites into dompurify/
                            # prosemirror/vitest/eslint internals: unresolvable BY DESIGN, not repo
                            # debt, classified so the debt number stays worth reading. ★★ ITS SIZE IS
                            # DELIBERATELY NOT QUOTED HERE — this line said 10 and the gate printed 9
                            # (disproved 2026-08-17 by a reviewer passing through). Read it off the
                            # gate's own summary line, which prints every bucket:
                            # `npm run docs:claims:check`. ★★ Not
                            # harmless though — they rot on any upgrade, and the vitest one carries a
                            # CONTENT HASH in its filename, so it WILL break and nothing will say so.
                            # Re-baseline ONLY after REMOVING citations or converting them to
                            # symbols: `node scripts/check-doc-claims.mjs --update`. Re-baselining to
                            # admit a new one defeats the only thing it checks.
                            # ★★★ WHAT THE CLEAN-UP MEASURED, and it is the argument for the whole
                            # rule: ONE row of docs/handrolled-ui-inventory.md carried SEVEN line
                            # numbers and FIVE were wrong — two off by 3 and 6, two off by 8, and one
                            # naming a file the code had left — while the CLAIM they supported was
                            # still true at every site. The gate caught ONE, the only one past EOF.
                            # Two more rows ended up naming a file the code had LEFT (`export-pptx.ts`
                            # for an element now emitted by `pptxTextBox`; `chat-panel.tsx` for a caret
                            # now in `chat-tool-block.tsx`). ★★ BOTH were EXACT when written and were
                            # broken by a later EXTRACTION commit — verify with `git log -S` on the
                            # moved string, which names the refactor in each case. An earlier revision
                            # here called them wrong-file-outright authoring errors and contrasted them
                            # with the line-number drift; they are the SAME drift, one directory up, and
                            # no gate can see either. A wrong line number is a SYMPTOM — go
                            # re-verify the claim, never renumber it.
                            # ★ Citations inside ``` fences are ignored on purpose — a stack trace or
                            # sample command is an example, not a claim about this repo.
                            # ★★ The PARSING lives in `scripts/doc-claims-lib.mjs` and HAS A UNIT
                            # TEST (`doc-claims-lib.test.mjs`) — every defect this gate has shipped
                            # was a regex defect, and both were found by running it against the real
                            # docs, never by reading it. ★★★ A COLD REVIEW THEN FOUND FIVE MORE, TWO
                            # OF WHICH COULD FAIL A GOOD BRANCH: `@` was missing from the citation
                            # char classes, so a scoped package (`@tiptap/...`) parsed with the `@`
                            # stripped and was counted as REPO DEBT rather than third-party; and
                            # `stripFencedBlocks` was a parity toggle that missed BLOCKQUOTED and
                            # TILDE fences, inverted on an inline ``` span, and let NESTED fences
                            # leak — a `> ```bash` block exists in README.md today. Also: bare
                            # RANGES (`:113-116`) were invisible, a URL with a line anchor parsed as
                            # a citation, and the range check counted one line too many so a cite to
                            # exactly one past EOF passed. All five fixed; the four REGEX ones are
                            # mutation-proved (4/4), the `stripFencedBlocks` rewrite by its own cases
                            # rather than by a mutant — which is why that 4 sits under a 5. Details in
                            # open-followups §131. ★ Fixing them made the gate STRICTER and it found
                            # more at once (a second broken cite in the snapshot). ★★ The "537 → 541
                            # cites" that used to sit here was a MOMENT'S total, not a property of
                            # the fix, and it had drifted to 532 by 2026-08-17 — every citation
                            # added or removed anywhere moves it. Quote the DIRECTION, never the
                            # totals; `npm run docs:claims:check` prints today's.
                            # `vitest.config.ts` `include` now covers
                            # `scripts/**/*.{test,spec}.mjs` so the CI gates themselves are testable;
                            # coverage `include` deliberately stays `src/**`, so a script test raises
                            # no floor. ★★★ THE TWO TRUNCATION GUARDS ARE NOT INTERCHANGEABLE, and
                            # this line said they were: PATH_RE's `(?!...)` lookahead is LOAD-BEARING
                            # ALONE (drop it and `foo.tsxx` yields a phantom anchor to `foo.tsx`),
                            # while the longest-first extension order really is redundant (dropping
                            # it changes NO output). ★ Both are pinned by a differential test in
                            # `doc-claims-lib.test.mjs` that builds each mutant from the exported
                            # `SOURCE_EXT` — run it, don't trust a number here; this line used to
                            # quote a review's corpus size, which nothing could reproduce.
                            # The lookahead mutant survived the first
                            # suite only because nothing fed it an extension-SUFFIXED name — a test
                            # gap recorded as proof of redundancy, i.e. licence to delete a live
                            # guard. ★★ A surviving mutant is a QUESTION: "equivalent mutant" and
                            # "missing test" look identical from the harness, and separating them
                            # needs an input the suite does not have. Go find one.
npm run stop                # kill ONLY the dev server bound to the app port (default 3000; PORT-overridable)
                            # via scripts/stop-dev.mjs — port-scoped (netstat/taskkill on win, lsof/kill on
                            # posix); NEVER a blanket `taskkill /IM node.exe`. New script → also add a
                            # scriptsDescriptions entry or docs:scripts:check fails.
                            # ★★★ WHICH docs it regenerates is DISCOVERED, NEVER NAMED, so no grep over the
                            # script can enumerate them: `findDocs` walks top-level `*.md` plus
                            # `docs/**/*.md`, and `syncFile` returns "no-marker" for any file lacking the
                            # pair `<!-- AUTO-GENERATED from package.json scripts -->` … `<!-- END
                            # AUTO-GENERATED -->`. CONSEQUENCE: `grep README scripts/sync-script-docs.mjs`
                            # returns nothing whether README participates or not — it CANNOT answer the
                            # question, and on 2026-09-10 an empty result was read as proof that it does
                            # not, in a plan that then prescribed that grep as the verification. An empty
                            # grep confirms whatever you already believed. Enumerate the participants
                            # instead, which is one command:
                            #   git grep -lE "<!-- END AUTO-GENERATED --[>]" -- "*.md"
                            # (grep the END marker: the start marker alone also sits in this file and two
                            # superpowers plans, which do not participate; `[>]` stops a self-match.)
                            # ★★ It returns CONTRIBUTING.md ALONE today, so this is a TWO-file change
                            # (package.json + CONTRIBUTING.md) — read that off the grep, never off this
                            # line. ★ README carried the pair from the initial commit until `7723c3d2`
                            # curated its table down to six hand-picked commands; a standing note calling
                            # it a three-file change was true when written and was falsified by that
                            # commit. Re-adding the markers to README would silently put it back under the
                            # generator and replace the curated list with the full one.
npm run followups:check     # REPORT, not a gate — it runs in NO CI job and exits 0 even with missing
                            # symbols (measured: exit 0 while printing SYMBOL_MISSING=10). Classifies every
                            # `docs/open-followups.md` entry by whether the names/paths/line numbers it
                            # cites still EXIST: CLEAN · SYMBOL_MISSING · PATH_MISSING · *_THIRD_PARTY ·
                            # NO_MACHINE_CLAIM. ★★ CLEAN does NOT mean the entry is still valid — the
                            # script's own header says so: it can describe a behaviour fixed two releases
                            # ago. It rules claims OUT, never IN, and a verdict routes work to a probe
                            # rather than closing anything. `--run-repro` also executes the allowlisted
                            # reproduce commands; `--json <out>` writes a snapshot.
npm run followups:index:check # heading ⟺ index-row GATE over docs/open-followups.md (BLOCKING in CI)
                            # ★★ Exit 1 = DRIFT (a heading with no row, a row with no heading, or a
                            # §number used twice); exit 2 = the gate COULD NOT SCAN (markers missing or
                            # duplicated, either set empty, or under the 50-per-axis floor its two sibling
                            # followup gates already use). A scan that reads nothing passes everything, so
                            # 2 is the load-bearing code and demands the opposite response to 1.
                            # ★★★ THE MARKER MATCH IS WHOLE-LINE AND THAT IS LOAD-BEARING. Both marker
                            # strings occur FOUR times in the register — twice inside a fenced code sample
                            # showing a reader how to slice the table, twice as the real markers hundreds
                            # of lines below. `src.indexOf(INDEX_BEGIN)` slices the SAMPLE, which holds 0
                            # rows, and the gate then calls every heading missing. Still reproducible
                            # today; pinned by a regression test in `followup-index-lib.test.mjs`.
                            # ★★ It compares SETS, so it is blind to a duplicate on its own — a pasted row
                            # leaves both differences empty while the counts disagree. That is why the
                            # duplicate axes are reported separately; do not "simplify" them away.
                            # ★ Parsing is pure (`followup-index-lib.mjs`, unit-tested, NO shebang — a `#!`
                            # on an imported .mjs makes vitest throw naming the WRONG file); the CLI
                            # `check-followup-index.mjs` owns the I/O and the exit codes.
npm run src:symbols:check   # REPORT, not a gate — backticked names cited in `src/` COMMENTS that resolve
                            # nowhere in the CODE. ★★★ IT COVERS THE HALF `docs:symbols:check` CANNOT SEE:
                            # that gate reads AGENTS.md + `docs/AGENTS/*.md` and NOTHING else, so an
                            # invented identifier inside a source docstring is ungated forever. Live
                            # instance: a reproduce command naming a function that never existed, which
                            # STILL RETURNED THE RIGHT ANSWER because a substring matched the real call —
                            # so it read as verified, and it arrived in a round that was CORRECTING a
                            # different claim in the same docstring. ★★ Its universe EXCLUDES comment text,
                            # which the GATE considered and deliberately REJECTED for itself (literal/key
                            # names would produce false findings, and a gate that cries wolf gets switched
                            # off). That trade is right for a report a human triages once and wrong for a
                            # blocking gate — do NOT "align" the two. ★★ A first cut built the universe from
                            # raw text like the gate does and reported 0 findings over 516 names; the same
                            # corpus reports 13 once comments are excluded, because an invented name
                            # resolves against its own docstring. ★ Every finding is a QUESTION — an
                            # upstream API, a spec field, a deliberately hypothetical name and an invented
                            # one all look identical; correct it or say near it that it is absent (the
                            # gate's `ABSENCE_MARKERS` suppress it). `--since <ref>` scopes it to one branch.
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
  `e2e/seed.ts` reads `sample-workspace-small.json` at MODULE TOP-LEVEL, so stale path ENOENTs the
  whole e2e job (fails only in CI; `npx playwright test --list` triggers the read without browsers).
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
  After a `globals.css` `@theme` edit, run axe on a FRESH isolated dev server (`PORT=3100 npm run dev`), never a reused one.
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
  two demand opposite responses. The GitLab project is a READ-ONLY copy synced daily by
  `ci/gitlab-sync.yml`; `.gitlab-ci.yml` stays in the tree only because a test reads it (until
  releases move, migration sub-project 5). No releases or tags until then. New CI gate → also update
  `docs/AGENTS/ci.md`.
- **Releasing:** bump `src/app/version.ts` (APP_VERSION + APP_BUILD_DATE + milestone), add
  `CHANGELOG.md` entry. ★ Do NOT add a `versionHighlight*` key: `APP_HIGHLIGHT_KEYS` is now a fixed
  elevator pitch of what is unique to the app, not a per-release history, and `CHANGELOG.md` owns
  history. ★★ EVERY OTHER COPY OF THE VERSION IS GATED BY `npm run version:check`, and the list is
  `SATELLITES` in `scripts/version-sync-lib.mjs` — not this line, which said "FIVE MORE PLACES" and
  missed `desktop/package.json` + `desktop/package-lock.json`. Read it with
  `grep -n 'file: "' scripts/version-sync-lib.mjs` (one line per file or glob; each lockfile carries
  TWO occurrences); CONTRIBUTING.md's Versioning table says what changes in each.
  Verified 2026-07-30: `package.json` had been stuck at 0.203.0 for six releases, `package-lock.json`
  at 0.199.0 for eleven, and the README badge + codemap headers at 0.203.0 — while `version.ts` and
  `CHANGELOG.md` were correct.
  Propagate them with `npm run version:sync` rather than editing each by hand — the
  `version:check` step of CI's `static` job is BLOCKING, so drift now fails CI instead of accumulating.
- **New persisted `Workspace` field → SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/
  IndexedDB). Miss one and data silently drops on that backend. `calendarEvents`
  ("Resource calendar meetings" below) is a worked example — one `ENTITY_SPECS` row buys three of the six.
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
  ★★★ **BUT "COMMIT IS NEVER REACHED, SO NOTHING IS SAVED" IS FALSE, AND THE TRUTH IS WORSE.**
  That is what this bullet said. A libSQL `/v2/pipeline` batch does NOT abort at a failing
  statement — it returns an error for that ONE statement and keeps executing, so COMMIT runs,
  returns ok, and commits everything that succeeded. `runTursoPipeline` then scans the results,
  sees the error, and calls `rollbackBestEffort` AGAINST AN ALREADY-COMMITTED TRANSACTION — which
  changes nothing — before throwing. So the user is shown a failed save **while the workspace was
  in fact written, minus the rejected row**, and a reader who believes the old claim will not go
  looking for partially-written data. ★★ Measured against a live database, not reasoned from the
  SQLite docs, and pinned by `documents-images-interactive.spec.ts`'s "the pre-idKind DDL rejects
  the insert — and the batch still COMMITS around it", whose comment names the assertion to
  rewrite if the engine ever starts aborting batches. ★ That spec SKIPS without a live database
  (it parses `.env.local` itself — playwright does not), so CI is green on it and silent about
  this: the claim is only ever re-checked by someone running it against a real Turso project.
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
- **task-manager decomposition map (Phase 3):** the orchestrator's cross-cutting clusters were
  extracted into **deps-object hook factories** (see "Extraction conventions") called
  unconditionally before the single return, plus two render helpers. The wiring lives in:
  `use-calendar-integrations.ts` (ALL Outlook push/pull/background-auto-sync for milestones +
  committee + task/raid/change/absence), `use-action-center-handlers.ts` (assign / mark-done /
  clear-blocker / reschedule / draft / escalate / rebaseline / create-task CTAs), `use-ai-orchestration.ts`
  (Analyze-with-AI + weight-suggestion context + scheduled-job runner),
  `use-insight-recommendations.ts` (entity resolution + the insight-recommendation confirm/replay
  path), `shell-chrome.tsx`
  (`buildShellChrome` — a plain builder, NOT a hook — assembles BOTH header mounts), and
  `calendar-summary-modals.tsx` (the four two-way pull-summary modals). ★★ These four hook files are
  RENDER-SCOPE UI GLUE and are EXCLUDED from the coverage gate (`vitest.config.ts` `coverage.exclude`,
  same class as `.tsx`) — extracting a `use*` factory from task-manager into a NEW `.ts` file makes its
  handlers coverage-GATED, so either exclude the new file or expect a function-coverage drop. ★ A THIRD option, and the better one when the hook holds real logic rather than glue: TEST it. `use-view-digest.ts` (0.216.0) is a deps-object hook that assembles the AI view digest from live pane state; it is coverage-GATED and stays above the floors on its own tests, so it is deliberately NOT in `coverage.exclude`. Exclude glue, not logic. ★★ The fourth entry above is the borderline case and is filed as one: `use-insight-recommendations.ts` was excluded on coverage-NEUTRALITY grounds (the code was unmeasured inside `task-manager.tsx` before extraction), but the block's comment says its members are "not unit-testable in isolation", which does not fit an allow-set filter that is a documented security boundary. `docs/open-followups.md` §275 carries it. The
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
     semantics inline (resource save handler, `grep -n editVanished src/app/use-resource-directory.ts`) *plus* the concurrent-delete guard that RAID, changes, stakeholders and milestones also carry beside their
     `resolveEntitySave` call (`grep -rn "editVanished" src/app --include=*.ts --include=*.tsx | grep -v test`) — editing a
     row a concurrent writer already deleted would make the map-replace a silent no-op, so each calls
     `reportSilentFailure` instead of dropping the edit; TASKS are immune by construction, deciding on
     `editingId !== null` (`grep -n "editingId !== null" src/app/use-task-submit.ts`) and never on id-existence.
     ★ TEST TRAP: the race only reproduces when the id is taken BETWEEN open and save. A test that saves
     against an untouched list passes whichever way the handler decides — seed the collision explicitly.
  4. **Shared SSRF core, per-route normalize.** A new external-API proxy REUSES `api/_shared/proxy-ssrf.ts`
     for the IP-classification + host-allowlist checks and hand-rolls only its route-specific
     normalize/auth/URL. Do NOT parameterize the divergent guard chains into one `createProxyHelpers`
     factory (parameterizing divergent security guards is where a config slip silently weakens a guard).
  5. **Panel split (gantt pattern).** A panel crossing ~700 lines splits into orchestrator + `*-rows` +
     `*-toolbar` (+ a `*-columns` leaf for shared metadata) WELL BEFORE it reaches the size ratchet — rows
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
  stays FLAT — grouping is SURFACE-ONLY; learning/notifications/AI keep the flat list. ★ It runs ONCE, in
  `task-manager.tsx` (`nextActionGroups`), which `ActionsPanel` renders and the Dashboard takes its hero and Top-actions
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
  `prominent?` prop (hero = filled+larger via `action-cta-styles.ts` `popoverTriggerClass`; rows pass nothing → unchanged
  ghost). Source icon/pill GONE — source label is a bold prefix in the why-line; numeric score is `expertMode`-only.
  ★★ `--rag-amber-text` (=ui-purple / a brown) is AA ONLY on LIGHT Petrol — as SMALL text on `bg-surface` it FAILS AA on
  dark+mockup (3.5/4.4:1). Tier colour MUST ride the DOT/STRIPE (non-text, AA-exempt), never tinted small text (bit the
  tier count + hero eyebrow; both now muted). ★ the `actions` (Next actions) view is now in axe `A11Y_VIEWS` (hash-nav in
  `e2e/a11y.spec.ts` — Dashboard sub-child, sidebar entry may be collapsed at scan time).
- **Icons come from `src/app/icons.ts`**, never from `lucide-react` directly (the sole exception is
  `rich-text-toolbar.tsx`, whose set came from Tiptap's reference toolbar) and never from
  `@heroicons/react`, which was REMOVED app-wide in 0.255.0 — a `no-restricted-imports` rule makes a
  reintroduction fatal, and its `patterns` half is the load-bearing one because every old call site
  imported the `/24/outline` SUBPATH. ★★ The barrel re-exports lucide under the OLD heroicons names
  on purpose, so a name there is NOT a claim about what lucide calls that glyph.
  ★★★ A NAME MATCH IS NOT A GLYPH MATCH: lucide's `Bolt` is a hardware nut and its `ChartBar` is
  horizontal, so both were remapped — check `/icon-gallery` in dev, and note `icons.test.ts` pins
  every row by `displayName`, which is alias-invariant. ★★ **Five of the barrel's icons render no `<path>`**
  (`Bars2Icon` a `<line>`, both ellipsis icons `<circle>`, `Squares2X2Icon`/`StopIcon` `<rect>`), and
  lucide prepends its own `lucide lucide-<name>` classes — so an icon test must assert on
  `svg.children.length`, never `querySelector("path")`, and never on an exact `class` string. Three
  pre-existing tests broke on exactly that. ★ Line weight is pinned to heroicons' 1.5 by a
  `globals.css` rule on `.lucide`; that file is unlayered, so overriding it needs `stroke-[2]!`.
  ★★ **A stale `.next` makes `/icon-gallery` 404 in dev, and it is the only route that can show
  this.** The page is the repo's sole `if (process.env.NODE_ENV === "production") notFound();`
  guard (`grep -rn NODE_ENV src --include=*.ts --include=*.tsx` — read the hits; ★★ do NOT count
  them, and do NOT read "sole" as "the only `=== "production"` test". `use-arrangement.ts` has one
  too, as an early return guarding a dev-only `console.warn`; what is unique here is the pairing with
  `notFound()`, which is what makes the ROUTE disappear. An earlier revision said "the other two hits
  are `!==`", which was already loose — one of them is a `vi.stubEnv` in a test, not a comparison —
  and went stale the moment a fourth site landed), so
  a dev server serving anything stale for that route 404s while every sibling route is fine. It
  reaches the gallery/visual e2e specs as `toHaveCount` "Received: 0", which reads like a broken
  selector. Remedy is the one this file already gives for a corrupted dev cache: stop the server,
  `Remove-Item -Recurse -Force .next`, restart.
  ★★★ **DO NOT BLAME `npm run build` FOR IT — an earlier revision of this bullet did, at length,
  and the cause was never established.** It asserted that a build leaves production chunks in
  `.next` which `next dev` then serves, with the guard constant-folded true. That mechanism is
  refuted by Next 16's own docs (`node_modules/next/dist/docs/.../version-16.md` "Concurrent `dev`
  and `build`": dev outputs to `.next/dev`, build to the root, precisely so the two do not
  conflict), and the reproduction does not reproduce — stop → build → start → curl now gives
  200/200/200 three times over, as does building while dev runs. The 404 was real and clearing
  `.next` did fix it; the build correlation was spurious. ★★ It also prescribed
  `ls .next/BUILD_ID` as a router, which is worse than useless: `BUILD_ID` survives ANY past build
  (CI, `e2e:smoke:prod`), so on a machine that has ever built it is permanently present.
  ★★ **THE SAME SYMPTOM HAS A SECOND CAUSE with the opposite remedy.** Chained `npx playwright
  test` invocations race their own webServer: `playwright.config.ts` sets `reuseExistingServer:
  !process.env.CI`, so locally a run ATTACHES to a server the previous invocation is still
  releasing and gets the same `Received: 0`. Fix that one by not chaining — `--repeat-each=N`
  inside ONE invocation (5/5 green). A post-mortem `curl` cannot tell the two apart, since the
  server is gone by then either way.
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
  workspace-section "renders ONLY the active tabpanel", which is true of 27 of its 29 tabpanels and
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
  (To Do/In Progress/On Hold/In Review/Cancelled/Done) is the SOURCE OF TRUTH for "done", but
  `completedDate` is AUTO-MANAGED to keep the invariant **`status==="Done" ⟺ completedDate set`** — so
  the ~30 existing completedDate-based derivations were left untouched. ★★ A caller must also say WHICH
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
  mechanism in each (`use-task-submit.ts` omits the field from its payload, `use-resource-planner.ts`
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
  calendar). ★★ HONEST STATE: `ResourcesPanel`'s memo does NOT currently bail, so the optimization this bullet defends is aspirational,
  not in effect. `workspace-section` passes it ~47 props and several are a FRESH IDENTITY every render —
  every `guardEdit(handler)` (`guardEdit` is `makeEditGuard(...)` called unmemoized during render in
  `task-manager.tsx`) plus the `absenceCalendar` bag. Verified twice in review. Do NOT cite this memo as the
  reason anything is fast, and note that "memoize `guardEdit`" is NOT the fix — it is one unstable family of
  several. Either stabilise every handler prop (measure first) or delete the memo and this bullet; tracked in
  the R5 follow-ups doc. The guidance below still stands regardless, because it is what would make a bail
  possible at all. THREAD PROPS instead — workspace-section already holds
  `disciplines`/`grades`/`setResources` and passes them to sibling panels. (The un-memoized panels it renders —
  tasks, milestones, dashboard, insights, knowledge, timelog — lose nothing by consuming context.)
- **Gantt module map:** `GanttPanel` (`gantt.tsx`) is orchestrator only (data derivation +
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
  in the 0.213.0 branch; `grep -n "ALL_GANTT_STATUSES.length" src/app/gantt.tsx` shows the correct form). ★ `resetFilters` restores all three
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
  arithmetic. Split out to keep the orchestrator under the size ratchet, which was 800 at the time.
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
  ★★ A ROLE CELL IS TWO LINES AND A PERSON SUB-ROW IS ONE, so they can only line up HORIZONTALLY, and
  that alignment is arithmetic: `HOURS_LINE_UNITS` (exported from `budget-panel-totals.tsx`) is the `w-14`
  label + `gap-1` + `w-16` value box **counted in Tailwind SPACING UNITS** (14+1+16=31), i.e. where the
  box's RIGHT edge lands from the cell's content-box left. `budget-panel-people-rows.tsx`'s `HoursFigure`
  right-aligns a block of exactly that width (`HOURS_LINE_REM`), so the person figures share the role's
  value-box column. They used to carry `text-right` on the `<td>`, which anchored them to the far edge of
  a much wider PERIOD column and stranded every figure right of the boxes above it.
  ★★ `text-right` must therefore be ABSENT from the cell and PRESENT on the block — leaving it on both
  renders identically for any figure that happens to fill the block and drifts for any that does not, a
  fixture-dependent failure that survives a test suite.
  ★★★ UNITS, NOT PIXELS, and matching the box's `px-1` with a `pr-1`. Both were review findings against a
  first cut that used a px constant and no padding, and each broke the alignment on its own: a px block
  only tracks rem-based `w-14`/`w-16` at a 16px root font size, and a block that is merely the same WIDTH
  puts its digits one unit right of every role figure, because the value box's own `px-1` stops its digits
  short. That was a visible ~4px stagger down the column — **the boxes lined up and the numbers did not**,
  and the numbers are the only thing a reader compares. (`DOT_COL_PX`/`TOTAL_COL_PX` beside it are
  genuinely px and predate this; the sticky-column arithmetic they drive already assumes a 16px root.)
  ★ The bordered `HoursCell` inputs still stop 1px short of the read-only `TotalsTd` spans, since `border`
  is px — pre-existing, between the role rows' own two spellings, and not closable from the person row.
  ★ The Total column already lined up, and NOT by luck: `TOTAL_COL_PX` was itself derived as this width
  plus the cell's `px-3` (124+24=148) — the docstring on `TOTAL_COL_PX` itself says so, immediately above
  the declaration. Both now measure from the one constant, so the two derivations cannot drift apart.
  ★★ An earlier revision here called that alignment a COINCIDENCE while that docstring sat a few lines up
  in the same file, and its replacement then said the docstring was "130 lines above" — a distance nothing
  ever measured (it is ~16). Two errors about one docstring, in consecutive revisions, neither touching the
  arithmetic they surrounded. Cite the SYMBOL and read it; a line distance is unverifiable at a glance,
  rots on the next insertion, and buys the reader nothing a `grep` would not.
  ★ jsdom has no layout, so no test can compare the two edges — what is pinned is that both derive from
  ONE constant, plus tests tying it to the classes in BOTH role cells. ★★ Read that scope literally:
  `budget-panel-totals.tsx` spells the same three widths FOUR times, twice in `TotalsTd` (read-only spans)
  and twice in `HoursCell` (the editable inputs the PERIOD columns align against). A first cut covered
  `TotalsTd` only and claimed "change `w-14` and it goes red", which was false for the more important
  half — changing `HoursCell`'s `w-14` broke every person period figure with the suite green.
- **Tables — `SortResizeTh<K>` + `TableFilter` (`report-table.tsx`) → [`docs/AGENTS/ui-shell.md`](docs/AGENTS/ui-shell.md)
  "tables" section.** Every sortable header in the app flows through `SortResizeTh`, which owns
  `aria-sort` and the `aria-hidden` sort glyph — never hand-roll a sort header. ★★ `stickyLeft` turns
  `width` from a minimum into a clamp, and `position` must stay in the class, never inline. `TableFilter`
  owns the field's only clear ✕. Open that section before touching a table header, filter or pinned column.
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
  and integration blocks (the Outlook `CalendarSyncControls`) go BEFORE it, never between two members.
  ★★ IN THE ELECTRON DESKTOP SHELL EVERY ARITY BELOW LOSES ITS **Print** MEMBER — `PrintButton` renders
  `null` there (`isDesktopShellUserAgent`, `src/app/desktop-shell.ts`), so a group one shorter than this
  rule states is not drift. Unit assertions are unaffected (jsdom's UA is not Electron's); the why is
  beside that helper.
  ★★ THE DASHBOARD'S GROUP IS A 2×2 GRID (Print | reset-layout over reset-size | badge; DOM order unchanged, so it still reads row by row) AND ITS MIDDLE MEMBER IS **reset-LAYOUT**, not reset-columns —
  `ResetLayoutButton`, restoring the tile arrangement to `DEFAULT_LAYOUT`. That pane has no columns to reset, and
  arrangement is the reset-columns ANALOGUE (it restores CONTENT arrangement, where reset-pane-size restores the
  BOX), so it sorts into the same slot: Print · reset-layout · reset-size. Do NOT "correct" it to the spelling
  above. It is pinned by `expectButtonOrder` with `contiguous: true` in `dashboard-panel.test.tsx`, and that
  assertion is mutation-proved — reordering the two resets turns it red. ★ It is also the one member carrying its
  own `!arrangement.readOnly` guard, because the stack around it is gated only on `print:hidden`; a popout is
  read-only by design and would otherwise gain a working reset.
  ★★ SINCE SPEC C THE DASHBOARD'S STACK ENDS WITH A FOURTH CONTROL AFTER THE GROUP — `DashboardHiddenBadge`, the
  hidden-tiles count that toggles the tray under row 1: Print · reset-layout · reset-size · badge. It is the one
  deliberate exception to "ends with the trailing group": it is the arrangement's disclosure and drop target, not a
  utility, and it renders only while a tile is hidden or a drag is in flight, so the three resets stay contiguous with
  or without it. Pinned by the same `contiguous: true` assertion, once without the badge and once with it.
  ★★★ **A PANE WITH BOTH IS FOUR MEMBERS: Print · reset-columns · reset-layout · reset-size.** Reports is the
  first pane to carry all four; the two above are the three-member SPECIAL CASES of it. ★ NO VERSION IS
  QUOTED, and adding one back is a regression twice over: this said "(0.290.x)" while `version.ts` read
  0.289.0 and the branch introducing the fourth member bumped nothing, so the number was ASPIRATIONAL —
  and the preamble to this whole section already says version/MR provenance lives in git + CHANGELOG,
  not here. The order is not arbitrary — it
  contains BOTH of them as SUBSEQUENCES, so neither existing convention breaks, and it keeps the two CONTENT
  resets together ahead of the BOX reset. ★★ `contiguous: true` catches a control inserted BETWEEN members but
  cannot adjudicate the ORDER itself, which is why it is written here rather than inferred from a green test —
  and it cannot see a member wrongly PRESENT in a popout either, so the `readOnly` guard needs its own test.
  ★ `ReportCard` emits the group for its seven consumers; `onResetCols` and `onResetLayout` are both OPTIONAL and
  rendered only when passed, so a pane with no engine for one gets nothing. Drift has
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
  log, the completion trend, or either load funnel: it is STORAGE-ONLY on every path (no export key —
  an entry's `changes` carries old/new values that must never reach a client-facing document),
  `applyWorkspace`'s `logMode` defaults to REPLACE, `isWorkspaceEmpty` deliberately EXCLUDES it
  (inverting the `documents` rule, and counting it would turn a data-loss guard into a data-loss
  vector), and the trend now derives from THREE incompatible delta shapes that must not be merged.
- **AI Assistant chat-thread sidebar is Turso-ONLY.** `chat-panel.tsx` mounts `ChatThreadSidebar`
  (`chat-thread-sidebar.tsx`, over `chat-thread-list.tsx`) only inside `{tursoMode && (...)}`, and
  `tursoMode` is fed from `workspace-section.tsx`'s `chatTursoMode = (settings.storageConfig.kind ===
  "turso" || mode === "turso") && chatTursoConfig !== null`. ★★ The OR is load-bearing, and this bullet
  used to say `mode === "turso"` alone: `mode` here is the multi-project Turso-PICKER flag
  (`workspace-section-types.ts` `mode: "file" | "turso"`), not `settings.storageConfig.kind` (the
  single-DB Turso STORAGE backend) — gating on `mode` alone silently gave a user on single-project Turso
  storage no chat persistence. Mirrors `task-manager.tsx`'s `trendsActive`, which ORs the identical two
  signals for Snapshots/Trends, and reads `settings.storageConfig` unguarded for the same reason — the
  field is non-optional on `Settings`, so a `?.` here would only mask a broken fixture.
  ★★★ "FILE MODE" DOES NOT MEAN "UNCHANGED", and this bullet asserted it did — it read "FILE mode is
  byte-identical to before this branch: no sidebar, no multi-thread persistence." That sentence was true
  of the ORIGINAL gate (`mode === "turso"` alone) and was carried over verbatim when the OR was added
  two lines above it, which is the whole failure: `mode === "file"` with single-DB Turso STORAGE and a
  usable config satisfies the first disjunct, so the sidebar mounts and threads persist. The panel is
  byte-identical to before this branch only when NEITHER signal is Turso, or when `chatTursoConfig` is
  null. Pinned by the `mode=file, storageConfig.kind==='turso'` test in `workspace-section.test.tsx`,
  which is the mirror of the one pinning the `mode` disjunct.
  ★★★ AND THE FORMULA ABOVE WAS WRONG UNTIL NOW FOR A SECOND REASON WORTH RECORDING: it was quoted with
  a `?.` that the source does not have. The commit that CORRECTED this paragraph was followed by the
  VERY NEXT commit on the branch removing the `?.` from `workspace-section.tsx` — so the correction was
  re-staled one commit after it landed, by its own review round, before anything merged. (Reproduce:
  `git log --oneline --reverse <base>..HEAD` puts the docs commit immediately before the test commit,
  and `git log -S'storageConfig?.kind === "turso" || mode' -- src/app/workspace-section.tsx` names the
  second one as the remover.)
  `docs:symbols:check` cannot see this (it proves only that a mixed-case NAME exists, and
  `storageConfig` exists either way). A correction is a NEW claim: re-check it against the tree at the
  END of the round, not at the moment you wrote it.
  ★★ "AI Assistant" IS in axe `A11Y_VIEWS`, but `e2e/seed.ts` seeds FILE mode, so the gate never renders
  this sidebar — same blind spot class as the other Turso-gated views and the Resources → Calendar
  sub-tab (see `docs/AGENTS/accessibility.md`). Compounding it, axe has no rule that flags two controls sharing an accessible name
  (measured in `docs/AGENTS/accessibility.md`) — so even a scanned run could not catch a row-label collision here.
  `chat-thread-list.test.tsx` / `chat-thread-sidebar.test.tsx` are therefore the ONLY coverage this
  surface will ever have; do not read a green axe run as covering it, and eye-verify against a real
  Turso project before shipping any change to this surface.
  ★ The `chat_threads` table is deliberately OUT of `TABLE_NAMES` (else a workspace save's per-table
  DELETE sweep wipes it); its upsert is a single atomic `INSERT OR REPLACE`, never a delete-then-insert
  pair, because `runTursoPipeline` only opens a transaction when the first statement is literal `BEGIN`.
  `stripAttachmentsForPersistence` strips attachment bytes before a thread is written. `deleteThreadStatements`
  requires `projectId` (not just an id) so a delete can never reach across projects.
- **Attachment ingest — ONE entry point, and a mail is a TREE.** `attachment-ingest.ts`
  (`ingestFile` / `ingestBytes`) is the only read/classify/extract path. `chat-panel.tsx`,
  `step0-import-panel.tsx` and anything added later CALL it and must never reimplement it — three
  private copies existed before it. ★★★ A mail expands into an `IngestNode` TREE, so a consumer sends
  `flattenIngestBlocks(node)` and NEVER `node.block` alone: the walk is otherwise computed and thrown
  away while the rendered mail still NAMES the attachments whose content was dropped, which misleads
  the model rather than merely under-informing it. ★ File pickers take
  `ATTACHMENT_ACCEPT`, derived from `chat-attachments.ts`'s own classifier tables — never a
  hand-written `accept` string. ★ TWO size caps, so `checkAttachmentSize` needs the KIND:
  `MAX_ATTACHMENT_BYTES` (20 MB) for a flat file, `MAX_MAIL_BYTES` (64 MB) for mail. ★★ The six MAIL
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
are not. That is the whole point of the split — this file had grown to 324 KB
(~81k tokens) of which ~73% was subsystem reference that most tasks never touch.
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
is GLOBBED (`readdirSync`), so a new subsystem file is scanned the moment it lands. It still
proves only that a backticked NAME is real, never that a CLAIM about it is true.

| File | Owns |
|---|---|
| [dashboard.md](docs/AGENTS/dashboard.md) | the landing cockpit — the arrangeable tile grid · delta strip · KPI trends · sparkline · coaching · density · digest |
| [accessibility.md](docs/AGENTS/accessibility.md) | the a11y hard constraint — accessible names · row-unique per-row names (`buildRowTokens`) · WCAG 2.5.3 label-in-name · `ToggleButton` state + the pressed marker · what the axe gate scans and is silent on |
| [ci.md](docs/AGENTS/ci.md) | CI on GitHub Actions — the eight required checks job by job · `scheduled.yml` · operating it · and, as legacy, the GitLab pipeline: every quality gate and its exit codes · desktop packaging · the release stage · where `quality-gate-bypass` existed |
| [ui-shell.md](docs/AGENTS/ui-shell.md) | Help system · navigation & landing · focus/keyboard · surfaces & controls · tables (`SortResizeTh` · `TableFilter`) · ★ **dismissal (the Escape/Tab protocol — read before touching any modal, popover or panel)** |
| [theming.md](docs/AGENTS/theming.md) | colour schemes · the `--ui-*` token families · AA derivation · the dark-mode hover trap · branding · print · design-system primitives |
| [insights.md](docs/AGENTS/insights.md) | detect → reconcile → recommend → outcome → digest |
| [ai-assistant.md](docs/AGENTS/ai-assistant.md) | wire layer · tools · write-concurrency tokens on the six `update_*` tools · inline edit · dedup · scheduled jobs · allocation & RACI planning |
| [integrations.md](docs/AGENTS/integrations.md) | steering committee · Outlook calendar write-back and two-way pull · Timelog |
| [platform.md](docs/AGENTS/platform.md) | diagnostics ring · guard transparency · dictation · the AI master switch · the load hold (`loadPending`, the render hold, the background-writer gates) |
| [features.md](docs/AGENTS/features.md) | guided tour + demo · timezones · saved views · PWA · resource calendar meetings |
| [rich-text.md](docs/AGENTS/rich-text.md) | ALL rich HTML — the three note-log registers (each closing the SAME defect by a DIFFERENT mechanism) · the seven rich entity fields · the DOM-free vs browser-only module split · `sanitizeRichText` / `sanitizeAiRichText` / `AI_RICH_FIELDS` write boundaries · the per-sink `isHtmlStart` rule · `RichCell` export fidelity · the `role="toolbar"` keyboard contract |
| [activity-log.md](docs/AGENTS/activity-log.md) | `Workspace.activityLog` — meta-blob persistence · storage-only on every path · `logMode` REPLACE-by-default · entry ids and actors · forward-compat sanitising · the THREE incompatible completion-trend delta shapes |
| [documents.md](docs/AGENTS/documents.md) | documents — the DATA half: `DocVersion` before-images · retention + tombstones + the `"restored"` marker · `applyDocMutation` (the single mutation path) · `documentVersions` across all six write paths and both load funnels · AND the UI half: renderers, pane split, the hand block editor |
| [task-status.md](docs/AGENTS/task-status.md) | the task completion model — the `status` ⟺ `completedDate` invariant · the FIVE paths that write the pair and the mechanism each holds it by · why `migrateTask` does NOT repair a split pair · the `isTaskClosed` / `isTaskDelivered` split |
