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

Eight workflows: `.github/workflows/ci.yml` (the required checks), `.github/workflows/release.yml`
(tag-triggered, see below), `.github/workflows/scheduled.yml` (weekly, see below),
`.github/workflows/future-clock.yml` (weekly, one job, described with the weekly jobs below), the two
security workflows `security.yml` and `scorecard.yml` (see "Security workflows" below), and the two live
workflows, `live-turso.yml` and `ai-live.yml` (each in its own section below), neither of them required.
Count them with `ls .github/workflows`. `ci/gitlab-sync.yml`
is NOT one of them — it is a GitLab-side CI config, run by GitLab's own CI configuration path, that
pushes GitHub's history into the read-only mirror and then, in a second job (`mirror-releases`, §640),
creates a GitLab release for every GitHub release that has none yet, with asset links to the GitHub
downloads (`scripts/gitlab-release-mirror.mjs`, create-only, with its own `GITLAB_RELEASE_TOKEN`, a project
access token). `release.yml` itself knows nothing of GitLab. The design and its reasoning are in
`docs/superpowers/specs/2026-09-23-github-actions-ci-design.md` for `ci.yml`/`scheduled.yml` and
`docs/superpowers/specs/2026-09-24-releases-and-updates-design.md` for `release.yml`. Read the YAML
before relying on anything here — every job name, `needs:`, timeout and command below was checked
against it when written, and nothing re-checks the prose.

`ci.yml` runs on `pull_request` targeting `main` (GitHub checks out the PR's merge ref against current
`main`), on every push to `main`, and on `workflow_dispatch`. ★★ Concurrency: a pull request's runs
share one group per ref and a newer push cancels the stale run; a push to `main` is grouped by its own
commit (`github.sha`) and is never cancelled, because GitHub keeps one PENDING run per group and a
shared `main` group would silently replace the middle of three quick merges. Workflow-level
`permissions: contents: read`; only `semgrep` adds `security-events: write`. Every `uses:` is pinned to
a 40-hex commit SHA (a `docker://` image by digest) with the version in a trailing comment, every
`actions/checkout` sets `persist-credentials: false`, every job carries `timeout-minutes` and runs on
`ubuntu-latest`, and every job but `semgrep` installs Node `"24"` with `actions/setup-node` (the
workflow test pins it to the `engines` floor). `.github/dependabot.yml` runs weekly for
`github-actions`, root `npm` and `desktop/` `npm`: minor/patch updates land as one grouped PR per
npm directory, majors and every exactly-pinned framework package (CONTRIBUTING's "Dependencies"
rule) arrive one PR each. Every entry carries a `cooldown` (7 days; 14 for an npm major, because Dependabot rejects the
whole file when the `github-actions` entry carries `semver-major-days`) that holds
version updates back until a release has been public that long; security updates are not delayed.
★ It does NOT cover container digests (semgrep, actionlint), which are
re-resolved by hand.

- **`static`** (15 min). `npm ci`, then `npm --prefix desktop ci --ignore-scripts` (electron's and
  electron-updater's TYPES only — the desktop shell is never built or run here; that install is what
  lets `desktop:typecheck` run instead of skipping), then writes the `LEAK_LIST` secret to
  `$RUNNER_TEMP/leak-list.txt` and exports `LEAK_LIST_FILE` through `$GITHUB_ENV`. An empty or missing
  secret writes an empty list, and `leaks:check` exits 2 on it — red, never a silent pass. Dependabot
  PRs read `LEAK_LIST` from Dependabot's own secret store. Then
  `node scripts/gate-local.mjs --group static --keep-going`: every `static` step of the shared gate
  list — including `changelog:check` (§527: app code changed without a `CHANGELOG.md` line fails, unless
  the PR carries the `no-changelog` label; the label is read LIVE through the API with the job's token,
  which is why this job alone adds `pull-requests: read` and passes `GH_TOKEN` to the step, where
  `gate-local.mjs`'s `stepEnv` strips it from every step except `changelog:check` (`passEnv`) — a re-run
  reuses the original event payload, so a payload read would never see a label added after the first
  run) and `desktop:typecheck` (`scripts/check-desktop-types.mjs` runs TWO `tsc -p` passes,
  `desktop/tsconfig.json` then `desktop/tsconfig.test.json`, exiting with the worse of the two —
  covering `desktop/src/main.ts` and its siblings, which the root `tsc --noEmit` excludes, PLUS
  the desktop tests that import `electron`/`electron-updater` (`updater.test.ts`,
  `updater-module-shape.test.ts`, `server-child.test.ts`), excluded from the root program for the same
  reason but ALSO excluded from
  `desktop/tsconfig.json` (it drops every `src/**/*.test.ts`), so the second pass is what still
  typechecks them; without the desktop install above either pass would exit 2 rather than silently
  pass) — each one run even after an
  earlier one fails, with a pass/fail table appended to the step
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
- **`unit`** (45 min). `npm ci` then `npm --prefix desktop ci --ignore-scripts` (types only, no
  electron binary) — `vitest.config.ts`'s `include` covers `desktop/**/*.test.ts`, and
  `updater.test.ts`, `updater-module-shape.test.ts` and `server-child.test.ts` import `electron`/`electron-updater`;
  mocking those specifiers doesn't help since Vite resolves the import before a mock applies.
  `npm run test:coverage -- --maxWorkers=2 --reporter=default --reporter=junit
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
- **`unit-shuffled`** (45 min, `needs: unit`). Installs desktop deps the same way `unit` does, for
  the same reason. `npm run test:shuffle -- --maxWorkers=2
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
- **`e2e`** (45 min, `needs: build`). Runs in the container `mcr.microsoft.com/playwright:v1.64.1-jammy`
  — keep the tag equal to `@playwright/test` in `package-lock.json`; the workflow test checks it.
  `npx playwright install chromium`, then `npm run e2e`, including the axe gate. It does NOT consume
  `build`'s artifact: `playwright.config.ts` starts its own `npm run dev` server, so it meets the
  permissive DEV CSP. `playwright-report/` is uploaded on failure only (7 days).
  ★★★ The live-Turso specs read only `TURSO_THROWAWAY_DATABASE_URL` / `TURSO_THROWAWAY_AUTH_TOKEN`
  (`e2e/live-turso-env.ts`), never the app's `NEXT_PUBLIC_TURSO_*`, because they write to and drop
  tables in that database and a plain `npm run e2e` runs them. A spec that drives the UI also needs
  the app's `NEXT_PUBLIC_TURSO_DATABASE_URL` to equal the throwaway URL, as Next itself resolves it
  (`appUsesDatabase`), and aborts any app request to another Turso host (`guardAppDatabase`); those
  specs turn tracing off, because a trace records the app's `Authorization` header. This job never
  gets the pair, so here they always skip; they run against the database in `live-turso.yml` (below).
  ★★ The specs that DROP tables are not in this job at all: `playwright.config.ts`'s
  `live-turso-destructive` project holds them (`LIVE_TURSO_DESTRUCTIVE`), runs its files one at a
  time, and `chromium` ignores them, because every live spec shares one throwaway database and this
  job runs files in parallel. They run only through `npm run e2e:live-destructive`, which sets
  `E2E_LIVE_DESTRUCTIVE=1` (they skip without it, so a bare `npx playwright test` running every
  project at once leaves them out) and `PLAYWRIGHT_NO_WEBSERVER=1` itself.
  ★★ CI with Turso secrets runs with trace and video off; failures debug from screenshots and logs.
  `playwright.config.ts` turns both off whenever the app would carry `NEXT_PUBLIC_TURSO_AUTH_TOKEN`
  (`appHasTursoToken`), because a trace records the `Authorization` header and a failing job uploads
  `playwright-report/`.

- **`prod-smoke`** (15 min, `needs: build`). Same container. Downloads `next-build` into `.next`
  instead of rebuilding, then `npm run e2e:smoke:prod`. ★★ The ONLY required check that sees the
  nonce-only prod CSP (`src/proxy.ts`): dev grants `'unsafe-inline'` on `style-src-elem` while prod is
  nonce-only, so anything meeting the dev policy is blind to this class. `e2e` (above) starts its own
  `npm run dev` server, so it meets the permissive policy too. The weekly, non-required `dast-zap`
  (below) is the one other suite that serves a real prod build (`Dockerfile.dast` runs `npm run
  start`), but it does not gate a pull request or a push to `main`.
- **`semgrep`** (15 min). Runs in the `semgrep/semgrep` container, pinned by digest, not `:latest`.
  No `npm ci`. Scan 1 writes the full report (`p/typescript`, `p/react`, `p/owasp-top-ten`,
  `.semgrep/injection.yml`) as `semgrep.sarif` and does not fail on findings; scan 2 runs the same
  configs with `--severity ERROR --error`, which is the gate. `.semgrep/injection.yml` is a local
  rule file (§613) closing a gap the three registry configs leave open: none of them flags
  request-controlled `eval`/`new Function`/`exec` in this codebase's non-Express-shaped handlers.
  The SARIF is uploaded as `semgrep-sarif` (7 days, always). A last step,
  `github/codeql-action/upload-sarif` (v4.39.0), runs only
  `if: always() && !github.event.repository.private`, plus a same-repository check: code scanning
  refuses SARIF from a private repository without Advanced Security, so the step switched itself on at
  the visibility flip, and a fork's pull request gets a token that cannot write security events, so
  the step skips there rather than failing a required check. ★ Not yet seen on a real fork PR (none
  has been opened); a Dependabot PR uploads fine (#610).
- **`audit`** (10 min). `npm audit --omit=dev --audit-level=high`. It reads `package-lock.json` only,
  so it runs no `npm ci` and uses no npm cache.

★ The risk the design named (written while the repository was private, for the 2-vCPU private runner): if `unit` runs past ~25 min, split it with
vitest `--shard` across two jobs. That needs merged coverage reports for the floors, which is why it
was not done up front.

## `live-turso.yml` — the live-Turso specs (§215)

NOT a required check, and deliberately so: it needs repository secrets a fork's pull request and
Dependabot never get, and a required check that cannot run there would block them. It runs on every
pull request and every push to `main`, beside `ci.yml`, and on `workflow_dispatch`, as two jobs:

- **`check`** reads the two secrets through `env:` and answers one question, are both set. With
  either missing it writes a notice, and `live-turso` is skipped.
- **`live-turso`** (`needs: check`, only when both are set) runs two suites, each through its npm
  script. Which specs each runs has one home, `playwright.config.ts`: `LIVE_TURSO_DESTRUCTIVE`
  and `LIVE_TURSO_APP`.
  - `npm run e2e:live-destructive`: the specs that drop tables, one file at a time, no app server.
  - Then `npm run e2e:live-app`, even when the first failed (not when setup failed): the specs
    that drive the app, one worker, on a dev server started with the two secrets also mapped into
    `NEXT_PUBLIC_TURSO_*`, so the app's database is the throwaway one.
- ★★★ **A green run must have run every test.** Every live spec SKIPS when a setting it needs is
  missing (`e2e/live-turso-env.ts`), and a Playwright run in which everything skipped exits 0. So
  each step writes a JSON report (`E2E_JSON_REPORT`) and then runs `scripts/check-live-run.mjs`,
  which fails the step if any test skipped or none ran. Reproduce the failing case locally, with
  no database touched (the destructive specs skip without `E2E_LIVE_DESTRUCTIVE`):
  `PLAYWRIGHT_NO_WEBSERVER=1 PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_HTML_OUTPUT_DIR=<dir>/html E2E_JSON_REPORT=<dir>/run.json npx playwright test --project=live-turso-destructive`
  (the two `PLAYWRIGHT_HTML_*` keep it off your own `playwright-report/`)
  exits 0 with 4 skipped, and `E2E_JSON_REPORT=<dir>/run.json node scripts/check-live-run.mjs`
  then exits 1. On 2026-10-10 both suites, run through their npm scripts against the throwaway
  database, passed the check: 4 and 11 tests ran, none skipped.
- ★★ **Each Playwright run stops itself before its step is killed.** Each test step has its own
  `timeout-minutes` (12 and 20, under the job's 50), so a hung step fails rather than the job being
  cancelled. Inside it, `E2E_GLOBAL_TIMEOUT_MS` (10 and 18 minutes) becomes Playwright's
  `globalTimeout` through `globalTimeoutFrom` (`e2e/global-timeout.ts`, which says which values set
  a limit): Playwright then interrupts the run and still writes its HTML report, which it writes
  only when a run ends. Reproduce: `E2E_GLOBAL_TIMEOUT_MS=1` on the command above exits 1 with
  "Timed out waiting 0.001s" and an `index.html` written (that limit fires during setup, before
  any test). ★ `--retries=1 --max-failures=3` (in `e2e:live-app`) do NOT bound the time:
  Playwright counts a failure only after its retries, and queues every retry after all first
  attempts. Each step's reports go under `playwright-report/`, uploaded as `live-turso-report` on
  failure or cancellation, for 7 days. A JOB that hits its own timeout ends cancelled, and its
  upload is best-effort for the same reason.
- **Secrets.** `TURSO_THROWAWAY_DATABASE_URL` and `TURSO_THROWAWAY_AUTH_TOKEN`, for a Turso
  database kept for this workflow alone: the specs drop its tables. ★★★ The token must be scoped
  to that ONE database (`turso db tokens create <db>`), never a group or organisation token: what a
  leak can reach is exactly what the token reaches. The secrets enter through the `env:` of the
  three steps that need them only, never a `run:` line and never a job-level `env:` (that would
  hand the token to `npm ci`, which runs every dependency's install scripts), and
  `playwright.config.ts` turns trace and video off whenever either pair carries a token, so a
  report holds no `Authorization` header. This repository is public, so its logs and artifacts
  are too. GitHub masks the exact secret values in logs. The database HOST is not masked and can
  appear in an uploaded report (a failure screenshot or page snapshot of the app's storage
  settings or an error toast): it is not a credential, since the token is scoped to that one
  database.
- ★★ **Accepted risk.** Anyone who can push a branch to this repository can change the specs,
  `playwright.config.ts` or `package.json` that this workflow runs, and so read the secrets. That is
  inherent to running secrets on `pull_request`, and acceptable while only the owner has write
  access; with collaborators, gate `live-turso` on an environment with required reviewers.
  `pull_request_target`, which would hand the secrets to a fork's code, is never used.
- ★★ **One run at a time, and runs can be dropped.** `live-turso` has a JOB-level concurrency
  group, the fixed name `live-turso-throwaway-database`, with `cancel-in-progress: false`: every
  run shares one database, so a running job is never cancelled. GitHub keeps ONE pending run per
  group, so a second run waits and a third REPLACES the waiting second, which ends "cancelled" and
  is not re-queued: re-run it by hand (Re-run jobs, or `workflow_dispatch`). The group sits on the
  job, after `check`, so a run that skips (a fork's pull request) is EXPECTED never to take the slot
  or replace a real run's pending one. ★★ Expected, not yet observed: it rests on GitHub evaluating
  the job's `if:` before the job joins its group. To observe it once the secrets exist: while a
  real run is pending, open a pull request from a fork (it has no secrets, so it skips) and check
  that the pending run still starts; record the result here. Prefer the fork over a
  `workflow_dispatch` with the secrets briefly unset: a pending run reads the secrets when its job
  STARTS, so if they are still unset then, that run skips too and the observation proves nothing.
- **Pinned by** the `live-turso.yml` block of `scripts/ci-workflow.test.mjs` (each test's name says
  what it pins) and `scripts/live-run-lib.test.mjs`. ★ Those checks read text, not parsed YAML: a
  deliberately obscured expression (a YAML anchor, `format()` to build a secret name) is out of
  their reach. They fail closed on a trailing comment after `env:` or a secret line, and on any
  comment line quoting a `${{ }}` that names `secrets` or `env`: keep comments on their own line.

## `ai-live.yml` — the AI relay and key check, live (AI organisation key)

NOT a required check, and started by hand only: it runs on `workflow_dispatch` and nothing else,
because every run spends tokens (a handful of Messages calls with `max_tokens: 1`, on the newest
Haiku model the live model list names). It proves the relay (`src/app/api/ai/_relay.ts`) and its
organisation key check (`_key-check.ts`) against the real Anthropic API and a real Cloudflare AI
Gateway. Two jobs, the same shape as `live-turso.yml`:

- **`check`** reads the five secrets through `env:` and answers one question, are all five set.
  With any missing it writes a warning, and `ai-live` is skipped. ★★ Such a run shows green and
  proved NOTHING: read the warning, never the colour, before citing a run as evidence.
- **`ai-live`** (`needs: check`, only when all five are set) runs `npm ci` with no secret in its
  environment, then one step: `npx vitest run src/app/api/ai/_relay.live.test.ts`. That file calls
  `relay` in-process with the production `httpsSend` wrapped by a recorder, so the "no Messages
  call reached Anthropic" proofs read the relay's own upstream record. The six proofs, one test
  each: (1) direct, correct ids, a Messages call succeeds after a passing pre-flight; (2) a random
  organisation id and (3) a random workspace id are refused with `ai-key-wrong-organization` /
  `ai-key-wrong-workspace` and only the pre-flight went upstream; (4) through the gateway, correct
  ids, both answer headers came back and the call succeeds; (5) through the gateway, a random
  organisation id is refused before any Messages call; (6) records, without asserting, whether the
  organisation header comes back on a 401 for an invalid key. Proofs 4 and 6 write what they saw to
  the job summary. Proof 4 also checks that the Messages call itself went through the gateway with
  its token. If the gateway drops either header, proofs 4 and 5 fail with a message that names the
  rule it breaks: a gateway must pass Anthropic's organisation and workspace headers back, and one
  that does not cannot be combined with the restriction ([RUNBOOK](../RUNBOOK.md), "Restricting AI
  to the organisation's Anthropic keys", step 5). No assertion message carries an upstream body:
  every parse of one is wrapped, and a failure reports a boolean or a status.
- ★★★ **A green run must have run every proof.** The file's proofs SKIP unless all five secrets are
  set AND `AI_LIVE_REQUIRED` is `1` (that is what keeps the unit job, which runs every `src/**`
  test file, and a local shell that exports the `AI_LIVE_*` values from making paid calls), and a
  vitest run in which everything skipped exits 0. So the test step sets `AI_LIVE_REQUIRED=1`, which
  also turns on the file's one test that fails when any secret is missing: a renamed or mistyped
  secret fails the run instead of passing it green.
- **Secrets.** `AI_LIVE_ANTHROPIC_KEY` (a key with a low spend limit from a throwaway organisation
  and workspace), `AI_LIVE_ORGANIZATION_ID` and `AI_LIVE_WORKSPACE_ID` (that key's ids, UUID-shaped
  as the restriction setting requires), `AI_LIVE_GATEWAY_URL` and `AI_LIVE_GATEWAY_TOKEN` (a
  throwaway Cloudflare AI Gateway, on an account with no stored provider keys, per the RUNBOOK).
  They enter through the `env:` of the two steps that need them only, never a `run:` line and never
  a job- or workflow-level `env:`, and no other workflow names them, so `ci.yml`'s unit job never
  has them. The test's recorder keeps only booleans, statuses and call kinds, never a key, id, URL
  or body, so neither an assertion message nor the summary can print one; GitHub masks the exact
  secret values in the log as well. msw is closed for that file, since its unhandled-request
  warning would print each call's URL and body.
- ★★ **Accepted risk**, as for `live-turso.yml`: anyone who can push a branch can change the test
  file, the vitest config or `package.json` and dispatch the workflow on that branch, and so read
  the secrets. Acceptable while only the owner has write access; with collaborators, gate
  `ai-live` on an environment with required reviewers.
- **One run at a time.** A JOB-level concurrency group with the fixed name
  `ai-live-throwaway-organisation` and `cancel-in-progress: false`; the same queueing caveat as
  `live-turso.yml` applies (a third run replaces a waiting second).
- **Not yet run.** Nothing here has been observed against the real services; the first dispatch
  with the secrets set is the first proof. Record what proofs 4 and 6 found (the job summary) in
  this section when it has run.
- **Pinned by** the `ai-live.yml` block of `scripts/ci-workflow.test.mjs` (text, not parsed YAML,
  with the same limits as the `live-turso.yml` block's).

## Weekly

`scheduled.yml` runs on cron `0 3 * * 1` (Monday 03:00 UTC) and on `workflow_dispatch`. Nothing waits
on it and none of its jobs is a required check: a red run is the signal.

- **`audit-full`** (10 min). `npm audit --audit-level=low`, dev dependencies included.
- **`unit-shuffled-random`** (45 min). Installs desktop deps like `ci.yml`'s `unit`/`unit-shuffled`
  do — `test:run` covers `desktop/**/*.test.ts` too. Echoes the seed (`github.run_id`) with its reproduce command
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
  `Dockerfile.dast`'s base, `node:24-bookworm-slim`, is pinned by its index digest too (OpenSSF
  Scorecard Pinned-Dependencies), and `dependabot.yml` has no `docker` entry, so it joins that
  quarterly hand re-resolve: the tag no longer floats onto Node 24 patch releases by itself.
  ★★ Never validated on any CI
  before this workflow; its first manual dispatch is a rollout step, not an assumption.
- **`register-sync`** (10 min, `continue-on-error: true`). The workflow step runs `node
  scripts/check-followup-github.mjs` directly (the `followups:github:check` npm script wraps the
  same file, for a local reproduce): compares `docs/open-followups.md`'s Work item lines with the
  open GitHub issues, in both directions, the same comparison `followups-gitlab-sync` ran on GitLab.
  It exits 0 with a skip line unless the repository variable `REGISTER_TRACKER` is set to `github`,
  which the flip set (checklist step 7). Exit 1 means drift (fix the Work item line or the issue) and
  exit 2 means it could not compare (a missing/malformed `GITHUB_TOKEN`, a fetch failure, or fewer
  register issues seen than the shared `MIN_OPEN_ENTRIES` in `scripts/followup-claims-lib.mjs`). It replaced `followups-gitlab-sync`, which was deleted at the flip
  together with its script and test
  (`docs/superpowers/specs/2026-09-23-issues-migration-design.md`).

`future-clock.yml` (§149) runs one job, `unit-future-clock`, on cron `0 4 * * 1` (Monday 04:00 UTC) and on
`workflow_dispatch`. It is its own workflow so a manual run costs only that suite's minutes; it is not a
required check.

- **`unit-future-clock`** (45 min). Same installs as `unit-shuffled-random`, then
  `npm run test:run -- --reporter=default --reporter=github-actions` (the second reporter annotates each
  failing test on the run, which is where the findings are recorded) with `VITEST_CLOCK_OFFSET_DAYS=400`: `vitest.setup.ts` passes
  that to `registerClockOffset` (`src/test/clock-offset.ts`), which moves only `Date` 400 days ahead in
  every test. A test that goes red here passes today only because a hardcoded date is still in the
  future. Reproduce one with `VITEST_CLOCK_OFFSET_DAYS=400 npx vitest run <file>`. A file that installs
  its own fake timers still inherits the shift (`vi.useFakeTimers()` starts from the shifted
  `Date.now()`); only a file that calls `vi.setSystemTime` itself, or restores real timers before it
  asserts, sets its own clock and is not covered.

## Security workflows

Two workflows beside the CodeQL default setup (configured in the repository settings, not a file),
Semgrep and `npm audit`. Neither is a required check, so a finding never blocks a merge; read it on the
PR or in Code Scanning. `scripts/ci-workflow.test.mjs` holds both to the shared workflow rules (pinned
`uses:`, read-only top-level permissions, timeouts, credential-free checkouts) and pins that neither job
is in the required list.

- **`security.yml`**, on pull requests, pushes to `main` and `workflow_dispatch`:
  - **`dependency-review`** (pull requests only, 10 min). `actions/dependency-review-action` fails the PR
    when it ADDS a dependency with a known vulnerability of moderate severity or higher, or under a GPL or
    AGPL license. `npm audit` reports on the whole tree; this stops the addition at the PR.
  - **`zizmor`** (10 min). Audits the workflow files themselves: template injection, credential
    persistence, unsafe triggers, excessive permissions. actionlint checks structure, not this. The zizmor
    version is pinned in the step. ★ The job does NOT fail on findings: the action uploads SARIF, zizmor
    exits 0 in SARIF mode, and the findings arrive as Code Scanning alerts. Read them there. On a
    fork's pull request, which cannot upload, `advanced-security` is false and the job fails on a
    finding instead.
- **`scorecard.yml`**, weekly (cron `30 5 * * 1`), on pushes to `main` and `workflow_dispatch`: OpenSSF
  Scorecard scores supply-chain practices and publishes the result to Code Scanning and to scorecard.dev.
  ★ scorecard-action refuses to publish from a workflow whose job does more than checkout, scorecard
  and upload-sarif (it also allows upload-artifact and harden-runner, which this one does not use; no
  `env`, `defaults`, containers or extra write permissions). The workflow stays green when it refuses,
  so add nothing to it; the test pins the exact step list.
- **`release.yml`'s three `setup-node` steps set `package-manager-cache: false`.** setup-node v7 caches
  by default, and zizmor rates a cache restored into a tag-triggered release build as cache poisoning
  (High). A release build restores nothing.

## Operating it

- **Merging:** push → `gh pr create` → wait for the eight checks → `gh pr merge --merge
  --match-head-commit <sha>`. Never `--auto`. `npm run gate:local` stays useful as the pre-push check,
  and is no longer the merge gate.
- **A red check:** read the job's step summary first. `static` lists every failing step, and for the
  register gates exit 1 means drift and exit 2 means the gate could not scan, as before.
- **Actions unavailable:** the repository is public, so standard-runner minutes no longer run out
  (`gh repo view --json visibility`). If Actions is down, or the repository goes private again (GitHub
  Pro's included minutes, $0 budget), checks cannot complete and merging is blocked. Fallback: run
  `npm run gate:local` (with `LEAK_LIST_FILE` set), merge with the admin bypass, and note the bypass
  and the gate line (`gate:local PASS at <sha>`) in the PR. The next push to `main` once Actions runs
  again re-runs everything. `docs/RUNBOOK.md` "Actions minutes exhausted" has the details.

## `release.yml` — releases

Trigger: `push` of tags matching `v*`. Design: `docs/superpowers/specs/2026-09-24-releases-and-updates-design.md`. Workflow-level `permissions: contents: read`; `concurrency: group: release, cancel-in-progress: false` (a second tag never races or cancels a RUNNING first — but the group is one FIXED name shared by every tag, not per-ref, and GitHub keeps only one PENDING run per group, so push one release tag at a time: pushing a third tag while one run is in progress and a second is queued silently cancels the queued one, and a cancelled run just needs a re-run). Since flip step 10a added the `release` environment's required reviewer (2026-09-25), a run PAUSED waiting for approval also occupies that one queue slot, so it likewise holds every later tag until it is approved or cancelled. Every job has `timeout-minutes`, every `uses:` is SHA-pinned, every `actions/checkout` sets `persist-credentials: false`. ★ Only `publish` can write, and it installs no packages (no `npm ci`/`npm install`) — the installer is unsigned, so this gate is what stands in front of every installed copy's auto-update.

★ **Repository-level Actions policy** (settings, not YAML): `allowed_actions=all` with `sha_pinning_required=true` — GitHub still refuses an unpinned `uses:` repo-wide, which is what the SHA-pinning above rides on. The plan was `allowed_actions=selected` (GitHub-owned actions only, plus an explicit third-party allowlist entry for the digest-pinned `docker://` actionlint step) — that setting made `ci.yml` fail at startup (measured 2026-09-24, runs 36051255568 and 36051362469) even with a `patterns_allowed[]=rhysd/actionlint@*` entry added, so it was reverted to `all`. Beside the `release` environment's required reviewer (added at flip step 10a, see `publish` below; `gh api repos/{owner}/{repo}/environments/release --jq '.protection_rules[].type'` lists it, measured 2026-10-26), `publish` is also guarded by: the tag ruleset ("release tags" — only the owner/admin role can create, move or delete a `refs/tags/v*`), `guard`'s check that the tag equals `APP_VERSION` and names a commit on `main`, and immutable releases (both active, measured 2026-09-24).

- **`guard`** (ubuntu, 5 min). `node scripts/check-tag-version.mjs "$TAG"` (`npm run tag:check`) asserts the tag is `v` + `APP_VERSION` (a `-rc.<n>` suffix must match the same suffix in `version.ts`). `git merge-base --is-ancestor "$GITHUB_SHA" origin/main` refuses a tag on an unmerged commit. Outputs `version` (the tag with its leading `v` stripped) for the later jobs.
- **`build`** (windows-latest, `needs: guard`, 45 min). `npm ci`, `NEXT_STANDALONE=1 npm run build`, `npm run desktop:copy-static`, `npm --prefix desktop ci`, `npm --prefix desktop run build`, `npm run desktop:package`. Three guards before upload: the **sharp guard** — ported from the retired GitLab packaging job (the `.desktop-package` base job in the deleted `.gitlab-ci.yml`, shared by the blocking `desktop-package-tag`), with its positive control (`next/package.json` must exist, so a moved or missing tree fails loudly rather than passing a walk over nothing) — fails if `sharp`/`@img/sharp-*` is found nested at ANY depth under the packaged tree's `node_modules`, not just at the top level `desktop/electron-builder.yml`'s own filter can see; the **electron-updater guard** — `asar list` on the packaged `app.asar` must show `node_modules/electron-updater/out/main.js` and `node_modules/builder-util-runtime` (the bracket class in the grep matches both `/` and `\`, since `asar list` reports the runner's native separator); and the **fuse guard** (§561) — `electron-fuses read` on `win-unpacked/AI PM Cockpit.exe` must print the Electron fuses RunAsNode, EnableNodeCliInspectArguments and EnableNodeOptionsEnvironmentVariable Disabled and OnlyLoadAppFromAsar Enabled (upstream fuse names, so unquoted here), the four `electronFuses` in `desktop/electron-builder.yml` (the test checks the two lists agree); fuses exist only in a packaged binary, so this is the only gate that can read them. Uploads one artifact holding exactly `aipm-cockpit-<version>-setup.exe`, its `.blockmap` and `latest.yml` (7-day retention; `if-no-files-found: error`). All three guards are pinned by `scripts/ci-workflow.test.mjs`'s `describe("release.yml", ...)`, not by a script-level test.
- **`publish`** (ubuntu, `needs: [guard, build]`, `environment: release`, 15 min). The only job with write permission: `contents: write`, `id-token: write`, `attestations: write` — nothing built earlier needed it. The `release` environment requires the owner's approval (Actions → the run → "Review deployments"): its required-reviewer rule was added at flip step 10a (`docs/superpowers/specs/2026-09-23-flip-checklist.md`) on 2026-09-25, once the repository was public — GitHub had rejected it on the private repository's plan (HTTP 422, measured 2026-09-24). Self-review is allowed on that rule, because the owner is the only reviewer. The environment's `v*`-tag deployment-branch policy applies as well. Steps: download the artifact; `npm run release:verify` (`scripts/verify-release-assets.mjs`, dependency-free); `actions/attest-build-provenance` **only when `!github.event.repository.private`** (while private the step is skipped with a logged line — attestations need GitHub Enterprise on a private repository); `npm run release:publish` (`scripts/publish-github-release.mjs` over `scripts/release-publish-lib.mjs`) — drafts the release (`gh release create --draft --verify-tag`, `--prerelease` for a suffixed tag), checks the still-draft release against the expected files, then `gh release edit --draft=false`. Immutable releases lock the files and the tag at that publish, which is why the draft is checked one more time right before it.
- **Exit codes.** `release:verify` — 0 the three files are exactly right; 1 named problems (wrong or missing asset, `latest.yml`'s version/sha512/size/path mismatched against the installer's bytes); 2 could not check. `release:publish` — 0 published, or an identical release already exists; 1 a human must act (a published release for the tag differs — immutable releases cannot be fixed in place, publish a new version instead — or anything failed at or after the `--draft=false` edit, so the release may already be live and needs inspecting by hand); 2 could not run, or the still-unpublished draft this run just created did not match what was expected — safe to delete and retry, nothing has gone live yet.
- **`release-publish-lib.mjs`** — pure decisions only, unit-tested by `release-publish-lib.test.mjs`: `installerName`/`releaseTitle`/`releaseNotes` (the CHANGELOG section for the version, plus a fixed unsigned-installer notice; throws if the section is missing) / `expectedAssets` / `checkLatestYml`. It does NOT cross-check `release.yml` or `desktop/electron-builder.yml` against itself — that structural half lives in `scripts/ci-workflow.test.mjs`'s `describe("release.yml", ...)` (the upload paths equal `expectedAssets` under `INSTALLER_DIR`) and `describe("electron-builder.yml agrees with the release library", ...)` (electron-builder's `artifactName`/`directories.output` match `installerName`/`INSTALLER_DIR`).

The whole `.gitlab-ci.yml` was removed at sub-project 5; the GitLab project only mirrors GitHub through `ci/gitlab-sync.yml`.

## Gate gotchas — the full notes behind AGENTS.md's Commands block

Moved verbatim from AGENTS.md on 2026-10-14. AGENTS.md keeps one line per command with its main trap; every
measurement, failure story and reproduce command behind those lines is here. Read the entry before relying
on, or editing, the gate it describes.

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
                            # ★★ A PASS IS EXIT 0 WITH ZERO ERRORS IN TOTAL — never "0 errors in src/".
                            # One syntax error anywhere, e.g. in a corrupt generated `.next` types file
                            # that the gitignored `next-env.d.ts` imports, suppresses the real type
                            # errors while tsc still exits 2, so a src/-filtered count reads green. The
                            # checked-file count goes UP in that case, so it cannot detect it either.
                            # Fix: stop the dev server, delete `.next` (that alone regenerates nothing),
                            # then regenerate with `npx next typegen`, `npm run dev` or `npm run build`.
npm run test:run            # vitest (unit/integration). testTimeout/hookTimeout = 20s
                            # (raised from the 5s default in vitest.config) — the CPU-heavy
                            # fast-check property suites (`*.property.test.ts`, ~100 runs each) +
                            # fake-indexeddb setup can starve a worker past 5s under full-suite
                            # parallel load on a slow machine → a RARE, non-deterministic timeout
                            # that never repros in isolation or in CI. Don't "fix" such a flake by
                            # editing the property logic before ruling out a load timeout (run the
                            # property thousands of times in isolation first; logic bugs repro there).
                            # ★ `--minWorkers` DOES NOT EXIST in vitest 4.1.11 or 5.0.2 either — it exits with a CACError
                            # before running anything, which reads like a broken suite. `--maxWorkers=N` DOES
                            # exist and is the fix when a saturated machine kills the fork pool (measured: 8x
                            # "Failed to start forks worker" reported as `Test Files no tests` at EXIT=1 —
                            # ground rule 2's false-green shape, but red).
                            # ★ `--reporter=basic` DOES NOT EXIST in vitest 4.1.11 or 5.0.2 — it fails to load a
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
                            # which fiber carries the PLACEMENT flag (since React 19.3.0, a NEW fiber only). Three
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
                            # formats — NOT per-format, and NOT tokens. 1.11% (2297/207417 lines) against a
                            # 1.75 threshold on 2026-09-26, jscpd 5.3.2 (it was 1.19% on 2026-08-08). The
                            # console table prints six cells and flags none; the eye-catching per-format
                            # token figure is never read. Bisect by exit code — it is the only witness. Run
                            # dup:check's own command with the threshold overridden: on 2026-09-26 1.11
                            # exits 0 and 1.10 exits 1; on 2026-08-08, 1.60 and 1.52 both exited 0, ruling
                            # out per-format tokens and total tokens. See open-followups.md §116.
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
                            # 1600. Only `task-manager.tsx` is still consulted, and since 2026-10-04 its entry is its
                            # measured length with NO headroom (§491), so any growth fails the gate — read the
                            # other three as recorded intent, not as live limits.
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
                            # from 11 unresolvable + 8 out-of-range, and every survivor sits in one of
                            # two DATED SNAPSHOTS: docs/security/findings-2026-07.md (an audit) and
                            # docs/handrolled-ui-inventory.md (archived 2026-09-13; its two survivors
                            # point past the end of `tasks-section.tsx` after the §492 split). Both are
                            # bannered as such and deliberately NOT renumbered, because rewriting a
                            # dated record to match today's tree destroys the only thing it is good
                            # for. Read today's counts off the gate's own summary line, not off here.
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
                            # ★★ Exit 1 = DRIFT (a heading with no row, a row with no heading, a
                            # §number used twice, or a table that is not exactly what a rebuild writes);
                            # exit 2 = the gate COULD NOT SCAN (markers missing or duplicated, either set
                            # empty, a row the rebuild cannot parse, or under its 50-per-axis floor). A scan that reads nothing passes everything, so
                            # 2 is the load-bearing code and demands the opposite response to 1.
                            # ★★ That 50 counts EVERY heading, closed ones included, so it never falls
                            # on a closure. The gates that count OPEN entries (claims · status ·
                            # workitems · github) import ONE floor instead, `MIN_OPEN_ENTRIES` in
                            # `followup-claims-lib.mjs` — 50 until 2026-10-08, when 50 linked entries
                            # meant the next closure would turn CI red. Read it there, not here:
                            #   grep -n "MIN_OPEN_ENTRIES =" scripts/followup-claims-lib.mjs
                            # ★★★ THE MARKER MATCH IS WHOLE-LINE AND THAT IS LOAD-BEARING. The marker
                            # strings have also appeared inside fenced code samples above the real
                            # table, and `src.indexOf(INDEX_BEGIN)` then slices the SAMPLE, which holds
                            # 0 rows, and the gate calls every heading missing. Count today's copies:
                            #   grep -c "<!-- INDEX:BEGIN -->" docs/open-followups.md
                            # Pinned by a regression test in `followup-index-lib.test.mjs` either way.
                            # ★★ The table is GENERATED by `node scripts/rebuild-followup-index.mjs`; this
                            # gate (in `static`) and a test in `unit` both fail when the committed table
                            # differs from a rebuild. `--check` on the script runs the same drift check.
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
