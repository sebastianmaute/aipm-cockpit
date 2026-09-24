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

Three workflows: `.github/workflows/ci.yml` (the required checks), `.github/workflows/release.yml`
(tag-triggered, see below) and `.github/workflows/scheduled.yml` (weekly, see below). `ci/gitlab-sync.yml`
is NOT one of them — it is a GitLab-side CI config, run by GitLab's own CI configuration path, that
only pushes GitHub's history into the read-only mirror. The design and its reasoning are in
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
rule) arrive one PR each. ★ It does NOT cover container digests (semgrep, actionlint), which are
re-resolved by hand.

- **`static`** (15 min). `npm ci`, then `npm --prefix desktop ci --ignore-scripts` (electron's and
  electron-updater's TYPES only — the desktop shell is never built or run here; that install is what
  lets `desktop:typecheck` run instead of skipping), then writes the `LEAK_LIST` secret to
  `$RUNNER_TEMP/leak-list.txt` and exports `LEAK_LIST_FILE` through `$GITHUB_ENV`. An empty or missing
  secret writes an empty list, and `leaks:check` exits 2 on it — red, never a silent pass. Dependabot
  PRs read `LEAK_LIST` from Dependabot's own secret store. Then
  `node scripts/gate-local.mjs --group static --keep-going`: every `static` step of the shared gate
  list — including `desktop:typecheck` (`tsc -p desktop/tsconfig.json --noEmit`, covering
  `desktop/src/main.ts` and its siblings, which the root `tsc --noEmit` excludes; without the
  desktop install above it would exit 2 rather than silently pass) — each one run even after an
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
- **`register-sync`** (10 min, `continue-on-error: true`). The workflow step runs `node
  scripts/check-followup-github.mjs` directly (the `followups:github:check` npm script wraps the
  same file, for a local reproduce): compares `docs/open-followups.md`'s Work item lines with the
  open GitHub issues, in both directions, the same comparison `followups-gitlab-sync` ran on GitLab.
  It exits 0 with a skip line unless the repository variable `REGISTER_TRACKER` is set to `github`,
  which the flip set (checklist step 7). Exit 1 means drift (fix the Work item line or the issue) and
  exit 2 means it could not compare (a missing/malformed `GITHUB_TOKEN`, a fetch failure, or fewer
  than 50 register issues seen). It replaced `followups-gitlab-sync`, which was deleted at the flip
  together with its script and test
  (`docs/superpowers/specs/2026-09-23-issues-migration-design.md`).

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

## `release.yml` — releases

Trigger: `push` of tags matching `v*`. Design: `docs/superpowers/specs/2026-09-24-releases-and-updates-design.md`. Workflow-level `permissions: contents: read`; `concurrency: group: release, cancel-in-progress: false` (a second tag never races or cancels a RUNNING first — but the group is one FIXED name shared by every tag, not per-ref, and GitHub keeps only one PENDING run per group, so push one release tag at a time: pushing a third tag while one run is in progress and a second is queued silently cancels the queued one, and a cancelled run just needs a re-run). Once flip step 10a adds the `release` environment's required reviewer, a run PAUSED waiting for approval also occupies that one queue slot, so it likewise holds every later tag until it is approved or cancelled. Every job has `timeout-minutes`, every `uses:` is SHA-pinned, every `actions/checkout` sets `persist-credentials: false`. ★ Only `publish` can write, and it installs no packages (no `npm ci`/`npm install`) — the installer is unsigned, so this gate is what stands in front of every installed copy's auto-update.

★ **Repository-level Actions policy** (settings, not YAML): `allowed_actions=all` with `sha_pinning_required=true` — GitHub still refuses an unpinned `uses:` repo-wide, which is what the SHA-pinning above rides on. The plan was `allowed_actions=selected` (GitHub-owned actions only, plus an explicit third-party allowlist entry for the digest-pinned `docker://` actionlint step) — that setting made `ci.yml` fail at startup (measured 2026-09-24, runs 36051255568 and 36051362469) even with a `patterns_allowed[]=rhysd/actionlint@*` entry added, so it was reverted to `all`. **Until flip step 10a adds the `release` environment's required reviewer** (GitHub rejects that rule on this private repository's plan, HTTP 422, measured 2026-09-24), what actually stands in front of `publish` today is: the tag ruleset ("release tags" — only the owner/admin role can create, move or delete a `refs/tags/v*`), `guard`'s check that the tag equals `APP_VERSION` and names a commit on `main`, and immutable releases (both active, measured 2026-09-24) — not an approval pause.

- **`guard`** (ubuntu, 5 min). `node scripts/check-tag-version.mjs "$TAG"` (`npm run tag:check`) asserts the tag is `v` + `APP_VERSION` (a `-rc.<n>` suffix must match the same suffix in `version.ts`). `git merge-base --is-ancestor "$GITHUB_SHA" origin/main` refuses a tag on an unmerged commit. Outputs `version` (the tag with its leading `v` stripped) for the later jobs.
- **`build`** (windows-latest, `needs: guard`, 45 min). `npm ci`, `NEXT_STANDALONE=1 npm run build`, `npm run desktop:copy-static`, `npm --prefix desktop ci`, `npm --prefix desktop run build`, `npm run desktop:package`. Two guards before upload: the **sharp guard** — ported from the retired GitLab packaging job (the `.desktop-package` base job in the deleted `.gitlab-ci.yml`, shared by the blocking `desktop-package-tag`), with its positive control (`next/package.json` must exist, so a moved or missing tree fails loudly rather than passing a walk over nothing) — fails if `sharp`/`@img/sharp-*` is found nested at ANY depth under the packaged tree's `node_modules`, not just at the top level `desktop/electron-builder.yml`'s own filter can see; and the **electron-updater guard** — `asar list` on the packaged `app.asar` must show `node_modules/electron-updater/out/main.js` and `node_modules/builder-util-runtime` (the bracket class in the grep matches both `/` and `\`, since `asar list` reports the runner's native separator). Uploads one artifact holding exactly `aipm-cockpit-<version>-setup.exe`, its `.blockmap` and `latest.yml` (7-day retention; `if-no-files-found: error`). Both guards are pinned by `scripts/ci-workflow.test.mjs`'s `describe("release.yml", ...)`, not by a script-level test.
- **`publish`** (ubuntu, `needs: [guard, build]`, `environment: release`, 15 min). The only job with write permission: `contents: write`, `id-token: write`, `attestations: write` — nothing built earlier needed it. The `release` environment is wired to require the owner's approval (Actions → the run → "Review deployments") once a required-reviewer rule is configured on it, but GitHub rejects that rule on this private repository's plan (HTTP 422, measured 2026-09-24) — so today `publish` starts as soon as `build` finishes, with no pause. The rule is added at flip step 10a (`docs/superpowers/specs/2026-09-23-flip-checklist.md`); the environment's `v*`-tag deployment-branch policy is already active regardless. Steps: download the artifact; `npm run release:verify` (`scripts/verify-release-assets.mjs`, dependency-free); `actions/attest-build-provenance` **only when `!github.event.repository.private`** (while private the step is skipped with a logged line — attestations need GitHub Enterprise on a private repository); `npm run release:publish` (`scripts/publish-github-release.mjs` over `scripts/release-publish-lib.mjs`) — drafts the release (`gh release create --draft --verify-tag`, `--prerelease` for a suffixed tag), checks the still-draft release against the expected files, then `gh release edit --draft=false`. Immutable releases lock the files and the tag at that publish, which is why the draft is checked one more time right before it.
- **Exit codes.** `release:verify` — 0 the three files are exactly right; 1 named problems (wrong or missing asset, `latest.yml`'s version/sha512/size/path mismatched against the installer's bytes); 2 could not check. `release:publish` — 0 published, or an identical release already exists; 1 a human must act (a published release for the tag differs — immutable releases cannot be fixed in place, publish a new version instead — or anything failed at or after the `--draft=false` edit, so the release may already be live and needs inspecting by hand); 2 could not run, or the still-unpublished draft this run just created did not match what was expected — safe to delete and retry, nothing has gone live yet.
- **`release-publish-lib.mjs`** — pure decisions only, unit-tested by `release-publish-lib.test.mjs`: `installerName`/`releaseTitle`/`releaseNotes` (the CHANGELOG section for the version, plus a fixed unsigned-installer notice; throws if the section is missing) / `expectedAssets` / `checkLatestYml`. It does NOT cross-check `release.yml` or `desktop/electron-builder.yml` against itself — that structural half lives in `scripts/ci-workflow.test.mjs`'s `describe("release.yml", ...)` (the upload paths equal `expectedAssets` under `INSTALLER_DIR`) and `describe("electron-builder.yml agrees with the release library", ...)` (electron-builder's `artifactName`/`directories.output` match `installerName`/`INSTALLER_DIR`).

The whole `.gitlab-ci.yml` was removed at sub-project 5; the GitLab project only mirrors GitHub through `ci/gitlab-sync.yml`.
