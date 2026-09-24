<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# CI — GitHub Actions, job by job

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

## Required checks

The ruleset on `main` requires exactly these, and `scripts/ci-workflow.test.mjs` fails if this list
and the job ids in `.github/workflows/ci.yml` differ.

<!-- required-checks:begin -->
- `static` — every `static` step of `scripts/gate-local.mjs` (`--keep-going`), the commit-message leak scan, then actionlint
- `unit` — `npm run test:coverage`; the coverage floors are vitest's
- `unit-shuffled` — `npm run test:shuffle`, after `unit`
- `build` — `npm run build`; publishes `.next/` for prod-smoke
- `e2e` — `npm run e2e`, including the axe gate
- `prod-smoke` — `npm run e2e:smoke:prod` over the built `.next/`
- `semgrep` — ERROR-severity gate; full report as SARIF
- `audit` — `npm audit --omit=dev --audit-level=high`
<!-- required-checks:end -->

## Jobs

Two workflows: `.github/workflows/ci.yml` (the required checks) and
`.github/workflows/scheduled.yml` (weekly, see below). The design and its reasoning are in
`docs/superpowers/specs/2026-09-23-github-actions-ci-design.md`. Read the YAML before relying on
anything here — every job name, `needs:`, timeout and command below was checked against it when
written, and nothing re-checks the prose.

`ci.yml` runs on `pull_request` targeting `main` (GitHub checks out the PR's merge ref against current
`main`), on every push to `main`, and on `workflow_dispatch`. ★★ Concurrency: a pull request's runs
share one group per ref and a newer push cancels the stale run; a push to `main` is grouped by its own
commit (`github.sha`) and is never cancelled, because GitHub keeps one PENDING run per group and a
shared `main` group would silently replace the middle of three quick merges. Workflow-level
`permissions: contents: read`; only `semgrep` adds `security-events: write`. Every `uses:` is pinned to
a 40-hex commit SHA (a `docker://` image by digest) with the version in a trailing comment, every
`actions/checkout` sets `persist-credentials: false`, every job carries `timeout-minutes` and runs on
`ubuntu-latest`, and every job but `semgrep` installs Node `"24"` with `actions/setup-node` (the
workflow test pins it to the `engines` floor). `.github/dependabot.yml` keeps
the action SHAs current weekly; ★ it does NOT cover container digests (semgrep, actionlint), which are
re-resolved by hand.

- **`static`** (15 min). `npm ci`, then writes the `LEAK_LIST` secret to
  `$RUNNER_TEMP/leak-list.txt` and exports `LEAK_LIST_FILE` through `$GITHUB_ENV`. An empty or missing
  secret writes an empty list, and `leaks:check` exits 2 on it — red, never a silent pass. Dependabot
  PRs read `LEAK_LIST` from Dependabot's own secret store. Then
  `node scripts/gate-local.mjs --group static --keep-going`: every `static` step of the shared gate
  list, each one run even after an earlier one fails, with a pass/fail table appended to the step
  summary and exit 1 if any step failed. ★★ Under CI (env `CI` set) an unset `LEAK_LIST_FILE` FAILS
  the leak step with code 2; only a local run skips it. A failing row carries its reason when the
  gate list supplied one, so that case reads `FAIL (exit 2; LEAK_LIST_FILE unset under CI)` while
  `leaks:check`'s own exit 2 reads `FAIL (exit 2)`. Count the steps rather than trusting a number:
  `grep -c 's("static"' scripts/gate-local.mjs`. Then, with `if: !cancelled()`, the **commit-message
  leak scan**, `node scripts/check-commit-message-leaks.mjs "$RANGE"` (`npm run leaks:messages:check`):
  `leaks:check` reads tracked FILES only, and seven commits reached `main` with a session trailer that
  nothing saw (§200). It reads every commit message in the range, plus the message of each annotated
  tag on a commit in it, against the same list, and also fails on any assistant trailer line
  (`TRAILER_RE` in `scripts/identifier-leak-lib.mjs`, shared with `verify-rewrite.mjs`). It prints only
  short SHAs, classes and counts. Exit 0 = clean (an empty range included, so a no-op push passes),
  1 = a list hit or a trailer, 2 = could not scan (list unset, missing or empty; no range or one git
  cannot resolve; a failing git call). On a pull request the range is `<merge-base>..head.sha`, where
  the merge-base is `git merge-base "$PR_HEAD" "refs/remotes/origin/$GITHUB_BASE_REF"`, not the
  payload's `base.sha`: that can be stale, and a branch that merged a newer `main` would then drag
  `main`'s commits in, including the seven §200 trailer commits (a false red). The step exits 2 when
  the merge-base fails. The `fetch-depth: 0` checkout fetches every branch into `refs/remotes/origin/`
  (the all-history refspec in actions/checkout's ref-helper), so no extra fetch is needed, and none
  could run: `persist-credentials: false` leaves git no token. On a push the range is `before..sha`;
  a push whose `before` is all zeros, and a `workflow_dispatch` run, scan `sha^!` (the head commit
  alone). The event values reach the script through `env:`, never inline in
  `run:`. That is why the checkout here, and only here, sets `fetch-depth: 0`. ★ It is NOT in
  `gate-local.mjs`'s `GATE_STEPS`, so `gate:local` does not reproduce it: it needs a commit range a
  local run does not have. Reproduce it with the RUNBOOK's "A required check is red" line.
  Last, **actionlint** from its container image, pinned
  by digest, with `if: !cancelled()` so it still runs when the gate step is red. actionlint has no
  local install; CI is where it is enforced.
- **`unit`** (45 min). `npm run test:coverage -- --maxWorkers=2 --reporter=default --reporter=junit
  --outputFile=junit.xml`, piped through `tee unit.log` in a `shell: bash` step — GitHub's default
  shell has no `pipefail`, and `bash` gives `-eo pipefail`, so a red vitest turns the step red.
  `scripts/ci-workflow.test.mjs` fails on any piped `run:` step without `shell: bash`. The coverage
  floors in `vitest.config.ts` are enforced by vitest itself. An always-run summary step appends the
  "All files" coverage line and up to 50 failing-test lines to the step summary; the artifact
  `unit-results` (`junit.xml`, `coverage/`) is kept 7 days and uploaded even on failure. No
  third-party test-reporter action. ★ Both vitest jobs pass `--maxWorkers=2`, one per vCPU of the
  hosted runner. The first run passed none and took 27 min for `unit` and 30 for `unit-shuffled`: the
  reported test, setup, import and environment time summed to about the wall time, i.e. one worker.
  `gate:local` derives its own count from the local CPUs, so the two still do not share a worker
  layout.
- **`unit-shuffled`** (45 min, `needs: unit`). `npm run test:shuffle -- --maxWorkers=2
  --reporter=default` — the same pinned seed as the local command. ★★ The extra reporter is there
  so a red run can be read (§612). The script's own `--reporter=dot` writes every dot on ONE line
  that ends only when the run does — about 430 KB with its colour codes over ~19,600 tests — and
  `gh run view --log` silently drops that line and everything after it in the step, summary and
  failure included, so a red run looked empty. The full text was there all along in the raw log
  (`gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs --allow-escape-sequences`). A CLI
  `--reporter` is ADDED to the script's, not swapped for it, so both run: the default reporter's
  per-file lines break the dot line up and name a failing file as it finishes, and the failure
  block is printed twice. The alternative, moving `--reporter=dot` out of `test:shuffle`, was
  rejected because it would change the local command, which exists to reproduce this job. It waits for `unit` for the reason the GitLab job did: two full vitest runs must never
  contend for one runner's CPU. On Actions they would sit on different runners, but the dependency
  still stops a red `unit` from spending another full run nobody can read.
- **`build`** (15 min). `npm run build`, then uploads `.next/` minus `.next/cache` as the artifact
  `next-build` (1 day). ★★ `include-hidden-files: true` is load-bearing: `.next` is a hidden directory,
  `upload-artifact` excludes those by default, and without it `prod-smoke` would fail with "No .next/
  directory found" for the wrong reason. The workflow test pins the key.
- **`e2e`** (45 min, `needs: build`). Runs in the container `mcr.microsoft.com/playwright:v1.61.1-jammy`
  — keep the tag equal to `@playwright/test` in `package-lock.json`; the workflow test checks it.
  `npx playwright install chromium`, then `npm run e2e`, including the axe gate. It does NOT consume
  `build`'s artifact: `playwright.config.ts` starts its own `npm run dev` server, so it meets the
  permissive DEV CSP. `playwright-report/` is uploaded on failure only (7 days).
- **`prod-smoke`** (15 min, `needs: build`). Same container. Downloads `next-build` into `.next`
  instead of rebuilding, then `npm run e2e:smoke:prod`. ★★ The ONLY required check that sees the
  nonce-only prod CSP (`src/proxy.ts`); the legacy section below carries the per-suite reasoning.
- **`semgrep`** (15 min). Runs in the `semgrep/semgrep` container, pinned by digest, not `:latest`.
  No `npm ci`. Scan 1 writes the full report (`p/typescript`, `p/react`, `p/owasp-top-ten`,
  `.semgrep/injection.yml`) as `semgrep.sarif` and does not fail on findings; scan 2 runs the same
  configs with `--severity ERROR --error`, which is the gate. `.semgrep/injection.yml` is a local
  rule file (§613) closing a gap the three registry configs leave open: none of them flags
  request-controlled `eval`/`new Function`/`exec` in this codebase's non-Express-shaped handlers.
  The SARIF is uploaded as `semgrep-sarif` (7 days, always). A last step,
  `github/codeql-action/upload-sarif` (v4.38.1), runs only
  `if: always() && !github.event.repository.private`: code scanning refuses SARIF from a private
  repository without Advanced Security, so the step switches itself on at the visibility flip.
- **`audit`** (10 min). `npm audit --omit=dev --audit-level=high`. It reads `package-lock.json` only,
  so it runs no `npm ci` and uses no npm cache.

★ The risk the design names is the 2-vCPU private runner: if `unit` runs past ~25 min, split it with
vitest `--shard` across two jobs. That needs merged coverage reports for the floors, which is why it
was not done up front.

## Weekly

`scheduled.yml` runs on cron `0 3 * * 1` (Monday 03:00 UTC) and on `workflow_dispatch`. Nothing waits
on it and none of its jobs is a required check: a red run is the signal.

- **`audit-full`** (10 min). `npm audit --audit-level=low`, dev dependencies included.
- **`unit-shuffled-random`** (45 min). Echoes the seed (`github.run_id`) with its reproduce command
  (`npx vitest run --sequence.shuffle --sequence.seed=<id>`) BEFORE the run, then
  `npm run test:run -- --sequence.shuffle --sequence.seed=<id> --reporter=default`, so a red result can be
  replayed. 2026-09-23: was `--reporter=dot`, whose one very-long dot line `gh run view --log`
  silently drops along with everything after it in the step, summary and failure included (§612/§614)
  — fixed to `--reporter=default`, a straight swap here (unlike `ci.yml`'s `unit-shuffled`, `test:run`
  has no reporter baked in to sit alongside).
- **`dast-zap`** (30 min). Hosted runners have Docker, so no Docker-in-Docker service: builds
  `Dockerfile.dast`, starts the app on a user-defined network, polls it for up to 60 × 3 s, runs the
  ZAP baseline with `-I` (ZAP's findings do not fail the job; an infrastructure failure still does),
  and uploads `zap-out/` — `zap-report.html` and `zap-report.json` — as `zap-report` (7 days, always).
  `curlimages/curl` and `ghcr.io/zaproxy/zaproxy:stable` are pinned by `@sha256:` digest (§611);
  Dependabot does not track a `docker run` image argument, so re-resolve both quarterly by hand.
  ★★ Never validated on any CI
  before this workflow; its first manual dispatch is a rollout step, not an assumption.

## Operating it

- **Merging:** push → `gh pr create` → wait for the eight checks → `gh pr merge --merge
  --match-head-commit <sha>`. Never `--auto`. `npm run gate:local` stays useful as the pre-push check,
  and is no longer the merge gate.
- **A red check:** read the job's step summary first. `static` lists every failing step, and for the
  register gates exit 1 means drift and exit 2 means the gate could not scan, as before.
- **Minutes exhausted:** checks cannot complete, so merging is blocked. Fallback: run
  `npm run gate:local` (with `LEAK_LIST_FILE` set), merge with the admin bypass, and note the bypass
  and the gate line (`gate:local PASS at <sha>`) in the PR. The next month's first push to `main`
  re-runs everything.

## Legacy — the GitLab pipeline (no longer runs)

Kept for its per-gate reasoning, most of which still applies because the gates themselves did not
change. GitLab reads only `ci/gitlab-sync.yml`; `.gitlab-ci.yml` remains in the tree because
`release-publish-lib.test.mjs` reads it, until migration sub-project 5.

★ Moved VERBATIM out of `AGENTS.md`'s "Hard constraints" section on 2026-09-13 — only link targets changed, plus one line citation converted to a symbol and a grep. Positional words inside the moved text ("this file", "above", "below", "in Commands") still
describe where it sat in `AGENTS.md`, not this file; `AGENTS.md` keeps a short pointer bullet.

### The "CI is GitLab" hard constraint

- **CI is GitLab** (not GitHub). Pipeline: install → quality (lint · typecheck · **semgrep** SAST
  BLOCKING [two-scan: a full-severity `--gitlab-sast` report for the widget + a separate `--severity ERROR
  --error` gate] · **dependency-audit** blocking · **file-size-ratchet** BLOCKING · **duplication-gate**
  BLOCKING [jscpd `--threshold` per package.json `dup:check` — ★★ it compares the TOTAL
  duplicated-LINE percentage across all formats, NOT per-format and NOT tokens; the `dup:check` line
  in Commands carries the bisect] · **agents-symbol-check** BLOCKING
  [`npm run docs:symbols:check` — fails when THIS FILE names a code symbol that does not exist] ·
  **version-sync-check** BLOCKING [`npm run version:check` — `src/app/version.ts` is the source of
  truth for the version and codename; every file the Releasing bullet below points at restates one or
  both, and nothing compared them before this job. Propagate with `npm run version:sync` rather than
  hand-editing them. ★★ TWO FAILURE
  MODES, TWO EXIT CODES: **1 is DRIFT** (a satellite disagrees with `version.ts` — fix with
  `version:sync`), **2 is the gate unable to do its job** (a missing file, a moved regex shape, an
  empty codemap glob — a gate that scans nothing passes everything). Both were 1 until 0.260.x, so a
  red pipeline could not be read without opening the log, and the two demand opposite responses.
  ★ Its ONE structural blind spot is a format the reader and writer agree on and are both wrong
  about: the README badge is a URL inside a markdown link, so a codename with a SPACE has to be
  encoded — un-encoded, `--update` wrote a badge whose link truncates mid-codename and the gate then
  reported IN SYNC over it. Fixed by `encode`/`decode` hooks on that one pattern; a new satellite
  whose file format cannot hold a raw value needs the same, and no amount of reader/writer symmetry
  substitutes] ·
  **doc-claims-check** BLOCKING [`npm run docs:claims:check` — a RATCHET over `path:LINE` citations in
  every tracked PROSE doc — all of `docs/**` bar `docs/superpowers/`, plus the seven root/lib docs in
  `ROOT_DOCS` (the byte-pinned `golden-workspace.md` fixture is deliberately excluded). ★★ It said
  "every tracked doc" while `CHANGELOG.md`, `CLAUDE.md` and the two `lib/*.md` guides were NOT
  scanned; a cold review caught it and the scope was widened to match the claim rather than the claim
  narrowed. Proves only that a cited line COULD exist, never that it
  is right — the Commands entry carries the measurement] ·
  **followups-status-check** BLOCKING [`npm run followups:status:check` — every OPEN entry in
  `docs/open-followups.md` must carry a `**Status:**` line with an ISO date that either cites a
  command or says `never machine-verified`. ★★ TWO EXIT CODES, opposite responses, the same split
  `version-sync-check` documents: **1 is DRIFT** (write the Status line), **2 is the gate unable to
  scan at all** — an unreadable register, or zero entries parsed. The vacuity guard is the
  load-bearing half, because a scan that reads nothing passes everything. ★★★ DO NOT satisfy a red
  run by inventing a verification — `never machine-verified` is a CONFORMING answer and is the
  honest one for an entry nobody has probed. ★ The check is command-SHAPED, not merely backticked:
  a backticked filename is not a verification, and accepting one was measured to admit 10 entries
  that named none] ·
  **followups-index-check** BLOCKING [`npm run followups:index:check` — every `## <n>.` heading in
  `docs/open-followups.md` must carry a row in the index table between `<!-- INDEX:BEGIN -->` and
  `<!-- INDEX:END -->`, and every row must point at a heading that exists. Nothing compared the two
  sets before it, and they disagreed on the day it landed. ★★ SAME TWO-EXIT-CODE SPLIT as its two
  siblings above: **1 is DRIFT** (write the missing rows, delete the orphaned ones, or renumber a
  duplicate), **2 is the gate unable to scan** — markers missing, markers DUPLICATED, or either set
  empty. ★★★ It also reports a §number used TWICE on either axis, which the set difference it is
  built on is structurally BLIND to: paste one index row and both differences come back empty while
  the two counts disagree. ★ DO NOT satisfy a red run by renumbering an entry — a follow-up number
  is a permanent handle other docs cite] ·
  **followups-workitems-check** BLOCKING [`npm run followups:workitems:check` — every OPEN entry in
  `docs/open-followups.md` carries exactly one line STARTING `**Work item:**` whose remainder is `#NN`
  or exactly `none — decision record`, no closed entry carries one, and no issue is claimed by two open
  entries (`scripts/check-followup-workitems.mjs` over `scripts/followup-workitem-lib.mjs`). ★★ SAME
  TWO-EXIT-CODE SPLIT: **1 is DRIFT**, **2 is the gate unable to scan** (unreadable register, or under
  the 50-open-entry floor). ★★ It reads the REGISTER ONLY, so an issue closed in GitLab while its entry
  stays open passes it. ★ DO NOT satisfy a red run with `none — decision record` on an entry that has
  real work — create the issue] ·
  **followups-gitlab-sync** WARN-ONLY [`npm run followups:gitlab:check` — compares every open entry's
  Work item line with the OPEN GitLab issues both ways (`scripts/check-followup-gitlab.mjs` over
  `compareWithGitLab` in `scripts/followup-workitem-lib.mjs`): an issue closed in GitLab, one titled for
  another entry, one with no open entry, a `§NNN:` issue without `source::register` or the reverse.
  ★★ Skips with exit 0 until a masked, protected `REGISTER_SYNC_TOKEN` (a project access token
  with the read-API scope) exists. ★★ A protected variable only reaches pipelines on protected refs, so
  `main` must be protected and the schedule must target `main`; otherwise the job just prints "skipped".
  **1 is DRIFT**, **2 is could-not-compare** (network, token, redirect, or under a 50-REGISTER-issue
  floor — open issues with a `§NNN:` title or the label, NOT all open issues — which catches a fetch that
  returns no or few register issues, e.g. a token that cannot see confidential issues). ★★ Default-branch pushes and schedules
  ONLY: on an MR, whoever merges second rebases, so a branch can hold issues whose entries are not on
  main yet. `allow_failure: true` sits at job level AND on each rule — the YAML comment says why] ·
  **tag-version-check** BLOCKING [tag pipelines only, `needs: []` — `npm run tag:check` asserts the tag
  is `v` + `APP_VERSION` (`scripts/check-tag-version.mjs` over `scripts/tag-version-lib.mjs`). ★★ SAME
  TWO-EXIT-CODE SPLIT: **1 is DRIFT** (the installer would misreport its own version), **2 is the gate
  unable to scan** (an empty tag — a rules bug — or `version.ts`'s shape moved). `desktop-package-tag`
  lists it in its own `needs:`, so the wine build waits for it rather than racing it (that a FAILED
  guard then SKIPS the build is expected `needs:` behaviour, but no GitLab doc checked here states it
  and no tag pipeline has shown it; `publish-release` is held back either way, by stage order)] · **unit** [coverage floors: global lines 92/funcs 91/branch
  80/stmts 89 + per-engine globs in `vitest.config.ts`] · **unit-tests-shuffled** BLOCKING [runs the full
  unit suite at `--sequence.shuffle --sequence.seed=1`; `needs: [install, {job: unit-tests, artifacts:
  false}]` so it cannot run concurrently with **unit-tests** — two full vitest runs on one runner is the
  machine-saturation condition behind the load-sensitive flakes; guards against intra-file test-order
  dependence, open-followups §75]) → build → e2e [**e2e** (MR and default-branch pipelines only — its
  two `rules:` match nothing on a tag) · **prod-smoke** BLOCKING (the same two rules, so not on a tag
  either) [`npm run e2e:smoke:prod` — `next start` + the smoke driver, consuming build's `.next/` artifact.
  ★★ THE ONLY GATE THAT SEES THE PROD CSP, and the reason is per-suite. Dev grants `'unsafe-inline'` on
  `style-src-elem` while prod is nonce-only (`src/proxy.ts`), so anything meeting the DEV policy is blind
  to this class. The unit suite never starts a server at all. **e2e** does, but `playwright.config.ts`
  `webServer.command` is `npm run dev` — so it meets the permissive policy too. And `e2e:smoke` starts no
  server, so it only ever gets pointed at one somebody already had running, which in practice is dev.
  ★ Note **e2e** does NOT invoke `e2e:smoke` — they are separate entry points that happen to share the
  same blind spot, so fixing one would not have covered the other. That is how §54 stayed invisible for
  months. ★ **dast-zap** DOES serve a prod build (`Dockerfile.dast` ends `CMD ["npm","run","start"]`), so
  it is the one other suite that meets this policy — but it does not gate MR or default-branch pipelines,
  where its rule is `when: manual` WITH `allow_failure: true` — tag pipelines match that rule too, and
  without the key a blocking manual job holds every later stage, so `publish-release` would never run.
  ★★ It is NOT unconditionally non-blocking,
  and an earlier revision of this bullet said it "cannot fail a pipeline", which is false in the very mode
  the line names: `allow_failure: true` is indented under the `- when: manual` rule ONLY, there is no
  job-level one, and a `rules:` entry that omits it defaults to FALSE — so on a `schedule`
  pipeline the first rule matches and dast-zap runs BLOCKING. Its ZAP findings still cannot fail it
  (`zap-baseline.py … -I … || true`), but the unguarded `docker build` / `docker network create dastnet`
  / `docker run` steps can, and `network create` fails outright on a re-run where the network survives.
  Reproduce with `sed -n '/^dast-zap:/,/^  image:/p' .gitlab-ci.yml`] · **desktop-package** (manual,
  non-tag, `allow_failure: true`, artifact 1 week) · **desktop-package-tag** (tag pipelines, **BLOCKING**,
  artifact `expire_in: never`) · **dast-zap** weekly/manual] → release [**publish-release** BLOCKING, tag
  pipelines only — `npm run release:publish` (`scripts/publish-release.mjs` over
  `scripts/release-publish-lib.mjs`) creates the GitLab Release with a PER-TAG artifact link. ★★ NO
  `needs:`, on purpose — stage order is what holds it behind every earlier gate; the YAML comment says
  why. ★★★ That URL embeds the producing job's name (`ARTIFACT_JOB`) and the installer's path, so
  renaming `desktop-package-tag` or changing electron-builder's `artifactName` alone would 404 the next
  Release's download while the build stays green. `release-publish-lib.test.mjs` reads `.gitlab-ci.yml`
  and `desktop/electron-builder.yml` as text and fails on either drift, and on the job's artifact
  `paths:` no longer covering the installer].
  All quality gates are ratchets. ★★ The
  `quality-gate-bypass` escape hatch is NOT uniform — reproduce with
  `grep -n quality-gate-bypass .gitlab-ci.yml`, which returns five lines in three jobs: **semgrep** and
  **file-size-ratchet** carry a full commented `rules:` block; **duplication-gate** only NAMES the label
  in prose, with no rules block; and EVERY other quality-stage job mentions it nowhere (`lint`,
  `typecheck`, `dependency-audit`, `dependency-audit-full`, `agents-symbol-check`, `version-sync-check`,
  `doc-claims-check`, `followups-status-check`, `followups-index-check`, `followups-workitems-check`, `followups-gitlab-sync`, `tag-version-check`, `unit-tests`,
  `unit-tests-shuffled`, `unit-tests-shuffled-random` — enumerate with
  `grep -nE "^[a-z][a-zA-Z0-9_-]*:" .gitlab-ci.yml`). ★★★ FOUR successive revisions of this
  sentence were wrong — each named the wrong jobs or under-enumerated, sending an operator hunting for a
  bypass block on whichever gate is actually red. One of them ATTACHED the reproduce command above
  without running it, and the command refutes the sentence it was attached to. **Attach the command and
  run it.** ★★★ THAT WORDING IS NOT ENOUGH, measured 2026-08-08: a review round corrected at least
  EIGHT false claims in these docs and introduced SIX MORE errors across two correction passes — every
  one of them prose, and in every case the author HAD run a command, just not against the sentence they
  ended up writing. So: **a correction is a NEW claim and inherits none of the verification of the
  thing it corrects — run a command against the REPLACEMENT text, not only against the error you
  found.** Two replacement recipes in that round were themselves wrong (one returned five files where
  the sentence said two; its successor returned one, because a consumer imported `../x` while the
  pattern matched only `./x`). ★ The two counts are NOT a matching pair — they are tallied by different
  criteria (corrections made vs. items a reviewer flagged), and one of the six was a broken sentence
  rather than an untrue statement. Read them as magnitudes, not as a symmetry.
  ★★★ COROLLARY — an edit that INSERTS lines invalidates every `file:line` citation below it, including
  ones written moments earlier in the same commit, so a correction round must re-check the citations it
  did not touch: `ALLOW_DATA_ATTR: false` moved 114→130 when a comment block landed, then 130→131 when
  a one-line edit followed. Cite the SYMBOL and a grep instead. ★★ Three stars because
  [`docs/open-followups.md`](../open-followups.md) already records this class repeatedly — one entry
  there calls itself "the third recorded instance", so those two hops are the fourth and fifth. The
  detail lives there, not here. ★ "Ratchets" is loose too: only **file-size-ratchet** (`docs/baselines/file-sizes.json`,
  read by name as its `BASELINE` constant — `grep -n "const BASELINE" scripts/check-file-sizes.mjs`) and **unit-tests**' coverage floors (`vitest.config.ts`)
  hold a baseline; every other quality gate — **duplication-gate** INCLUDED — is plain pass/fail
  against a hardcoded number. ★★ duplication-gate was listed here as baselined and is not: nothing
  reads `docs/baselines/jscpd-2026-07.json` (`grep -rn "baselines/jscpd" package.json .gitlab-ci.yml
  scripts/` returns no loader), and its threshold is the literal `1.75` in `package.json dup:check`.
  A weekly `schedule` pipeline also runs
  `dependency-audit-full` + **unit-tests-shuffled-random** (same suite, seed `$CI_PIPELINE_ID` echoed with
  its reproduce command, warn-only `allow_failure: true`) + **followups-gitlab-sync** (warn-only, also on
  default-branch pushes) + a **dast-zap** ZAP baseline (dind-based, manual
  otherwise). (Phases 1-4 of the
  tech-debt roadmap are complete — gates flipped to blocking in Phase 4, MR !174.)
  New CI gate → also update this line.
