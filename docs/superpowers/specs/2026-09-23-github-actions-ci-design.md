# CI on GitHub Actions — design (roadmap sub-project 3)

**Date:** 2026-09-23
**Status:** design approved in conversation 2026-09-23; awaiting written-spec review.
**Roadmap:** `2026-09-20-github-migration-roadmap.md` (sub-project 3 of five)
**Depends on:** sub-project 2 (`2026-09-22-github-cutover-design.md`), done: GitHub is canonical,
GitLab is a read-only copy synced daily by `ci/gitlab-sync.yml`, and `npm run gate:local` is the
merge gate because no CI runs anywhere.

## Goal

Every blocking gate the GitLab pipeline ran becomes a GitHub Actions check that runs on every pull
request and every push to `main`, and a pull request **cannot be merged** while one is red. This
closes the gap sub-project 2 opened: e2e with the axe gate, semgrep, the dependency audit and
prod-smoke run again. The repository stays **private**; the visibility flip remains the roadmap's
last step. Register §200 closes in this sub-project.

## Decisions taken 2026-09-23 (by the repository owner)

| Decision | Choice |
|---|---|
| Plan while private | **GitHub Pro.** Required status checks on a private repository need it (measured: the branch-protection API answers 403 "Upgrade to GitHub Pro or make this repository public" on the Free plan) |
| Minutes while private | Stay inside Pro's included 3,000 minutes. Actions **budget set to $0**, so exhaustion stops jobs rather than billing |
| Pipeline shape | The **full** pipeline on every PR push — no fast/slow split. Such a split would exist only for the private stretch and would be dead weight after the flip |
| SAST reporting | Semgrep keeps its blocking ERROR gate; the full report is a SARIF artifact; the code-scanning upload step is present but runs only once the repository is public |
| Leak gate on fork PRs | **Deferred to the flip.** A private repository cannot receive fork PRs, so any rule written now is untestable. Recorded as a new register entry (see "Register") |
| Job layout | **Grouped jobs over one shared gate list** (approach B below) |
| §200 | Closed in this sub-project, with a requirement handed to sub-project 4 |

## Measured facts that bound the design

Re-measure rather than trust; every number here drifts.

| Fact | Value | Reproduce |
|---|---|---|
| Runner time of one full GitLab MR pipeline | ~45 min (pipeline 7327: e2e 953 s, unit-tests 730 s, unit-tests-shuffled 590 s, lint 104 s, build 68 s, semgrep 65 s, ten small gates ~5 s each) | `glab api "projects/:id/pipelines/<id>/jobs"` |
| Merges to `main` per month | 158 (Jun) · 179 (Jul) · 87 (Aug) · 81 (Sep to the 23rd) | `git log --merges --first-parent main --since=… --until=… --oneline \| wc -l` |
| Pipelines 3,000 minutes buys | ~60–65 full pipelines a month — counting **every** PR push and every push to `main`, not merges | 3000 / 45, before per-job rounding |
| Hosted runner, private repo | 2 vCPU Linux (public: 4 vCPU); billing rounds each job **up** to a whole minute | GitHub billing docs |
| After the flip | Standard hosted runners are free and unmetered; rulesets and SARIF upload are free | GitHub billing docs |

★★ The minute budget is the design's main constraint and it is **temporary**: it lasts exactly as
long as the repository is private. Nothing in the workflows depends on it, so the flip changes a
setting, not a file.

★ The owner does not expect to exceed the included minutes before the flip. If a month does run
out, required checks cannot complete; the fallback is under "Operating it".

## Approaches considered

- **A. Faithful 1:1 port** (~20 jobs, same names and `needs:` graph). Rejected: Actions has no
  equivalent of the `install` job's `node_modules/` artifact, so every job repeats `npm ci`, and the
  per-job minute rounding turns ten ~5-second gates into ~10 billable minutes per run — roughly 20 %
  more minutes for no extra signal.
- **B. Grouped jobs over one shared gate list.** Chosen. Fewest minutes, keeps the "never two vitest
  runs at once" rule, and makes the CI gates and `gate:local` one list instead of two hand-kept
  copies.
- **C. CI runs `npm run gate:local` plus e2e/semgrep jobs.** Rejected: sequential (~30 min before e2e
  starts), stops at the first failure so later reds stay hidden, and collapses most of the pipeline
  into one required check.

## Workflows

Two files:

- `.github/workflows/ci.yml` — pull requests, pushes to `main`, manual re-run.
- `.github/workflows/scheduled.yml` — the weekly non-blocking jobs, plus manual dispatch.

### Triggers and concurrency (`ci.yml`)

- `pull_request` targeting `main`. GitHub checks out the PR's **merge ref** against current `main`,
  which is what GitLab's merge-request pipeline tested.
- `push` to `main`: the full pipeline again after the merge. It costs minutes, but it is the only run
  over the merge commit exactly as it landed.
- `workflow_dispatch`.
- `concurrency: group: ci-${{ github.ref }}`, with `cancel-in-progress` true **only** for
  `pull_request` events. A newer push to a PR cancels its stale run; a run on `main` is never
  cancelled.

### Runtime conventions (both files)

- `runs-on: ubuntu-latest`.
- `actions/setup-node` with `node-version-file: package.json` (follows `engines`), npm cache on.
  Each job that needs `node_modules` runs `npm ci`.
- `e2e` and `prod-smoke` run in the container `mcr.microsoft.com/playwright:v1.61.1-jammy`, the tag
  the GitLab jobs pin. Keep it in lockstep with `@playwright/test`, as before.
- Every third-party action is **pinned to a full commit SHA** with the version in a trailing comment.
  Tags are movable, and a moved tag is code execution with the job's token. Dependabot
  (`.github/dependabot.yml`, ecosystem `github-actions`, weekly) keeps the pins current.
- Workflow-level `permissions: contents: read`. Only the `semgrep` job adds
  `security-events: write`.
- `actions/checkout` with `persist-credentials: false`.
- Every job carries a `timeout-minutes`, so a hung run cannot drain the budget.

### Jobs (`ci.yml`)

| Job (= required check) | Runs | `needs` | Timeout | Artifacts |
|---|---|---|---|---|
| `static` | `node scripts/gate-local.mjs --group static --keep-going`, then actionlint | — | 15 | — |
| `unit` | `npm run test:coverage -- --reporter=default --reporter=junit --outputFile=junit.xml` | — | 45 | `junit.xml`, `coverage/` — 7 days, always |
| `unit-shuffled` | `npm run test:shuffle` | `unit` | 45 | — |
| `build` | `npm run build` | — | 15 | `.next/` — 1 day |
| `e2e` | `npm run e2e` | `build` | 45 | `playwright-report/` — 7 days, on failure |
| `prod-smoke` | `npm run e2e:smoke:prod` over the downloaded `.next/` | `build` | 15 | — |
| `semgrep` | the two scans below | — | 15 | `semgrep.sarif` — 7 days, always |
| `audit` | `npm audit --omit=dev --audit-level=high` | — | 10 | — |

Notes, per job:

- **`static`** first writes the `LEAK_LIST` secret to `$RUNNER_TEMP/leak-list.txt` and exports
  `LEAK_LIST_FILE` pointing at it. An empty or missing secret therefore makes `leaks:check` exit 2
  (red), never a silent pass. It then runs **actionlint** from its official container image, pinned
  by digest, over `.github/workflows/`. actionlint has no local install, so CI is where it is enforced.
- **`unit`**: the coverage floors in `vitest.config.ts` are enforced by vitest itself, as before. The
  job appends the "All files" coverage line and the names of any failing tests to
  `$GITHUB_STEP_SUMMARY`. **No third-party test-reporter action**: the JUnit file is an artifact, and
  the summary line replaces GitLab's coverage regex.
- **`unit-shuffled`** needs `unit` for the same reason the GitLab job did: two full vitest runs must
  never contend for one runner's CPU. On Actions they would sit on different runners, but the
  dependency still stops a red `unit` from spending another ~10 minutes on a shuffled run nobody can
  read. It calls the npm script, so CI and `npm run test:shuffle` stay one command.
- **`prod-smoke`** downloads `build`'s `.next/` artifact instead of rebuilding.
- **`semgrep`** runs in the `semgrep/semgrep` container, **pinned by digest, not `:latest`**. Scan 1:
  the full-severity report (`p/typescript`, `p/react`, `p/owasp-top-ten`) written as SARIF, exit 0.
  Scan 2: the same configs with `--severity ERROR --error`, which is the gate. A third step,
  `github/codeql-action/upload-sarif`, runs only `if: ${{ !github.event.repository.private }}`, so it
  switches itself on at the flip.

★ **Risk: the 2-vCPU runner.** `unit` took ~12 min on GitLab and may take twice that here. The first
run measures it. If `unit` exceeds ~25 min, split it with vitest `--shard` across two jobs. That
costs the same minutes but finishes sooner, and the coverage floors then need merged reports, which
is why it is not done up front.

### `scheduled.yml`

Cron `0 3 * * 1` (Monday 03:00 UTC) plus `workflow_dispatch`. Every job is non-blocking by nature:
no PR waits on it, and none is a required check.

- **`audit-full`**: `npm audit --audit-level=low`.
- **`unit-shuffled-random`**: seed = `${{ github.run_id }}`, echoed together with its reproduce
  command (`npx vitest run --sequence.shuffle --sequence.seed=<id>`) before the run, so a red result
  can be replayed.
- **`dast-zap`**: Docker is available on hosted runners, so no Docker-in-Docker service. Build
  `Dockerfile.dast`, start the app on a user-defined network, wait for it, run the ZAP baseline scan
  (`-I`), and upload `zap-report.html` and `zap-report.json` (7 days). ★★ **Never validated anywhere**
  — the GitLab job's own comment says so. Its first manual dispatch is a rollout step, not an
  assumption.

### Not ported, deliberately

| GitLab job | Where it goes |
|---|---|
| `tag-version-check`, `desktop-package`, `desktop-package-tag`, `publish-release` | Sub-project 5. No tags or releases until then |
| `followups-gitlab-sync` | Sub-project 4, which rewrites it against the GitHub Issues API. It runs **nowhere** until then |
| `install` | Replaced by `npm ci` in each job with the setup-node cache |

`.gitlab-ci.yml` stays in the tree: GitLab does not read it (its CI path is `ci/gitlab-sync.yml`),
but `release-publish-lib.test.mjs` does, until sub-project 5.

## The shared gate list

`GATE_STEPS` in `scripts/gate-local.mjs` changes from a list of argv arrays to a list of
`{ argv, group }` entries. Groups: `static`, `unit`, `unit-shuffled`, `build`. The order and the
content of the existing steps do not change.

- **`npm run gate:local`** (no flags) behaves exactly as today: every step, in order, stop at the
  first failure, the same start and final lines. Its existing tests stay green unchanged.
- **`--group <name>`** runs only that group's steps. An unknown group exits 2.
- **`--keep-going`** runs every selected step even after one fails, prints a pass/fail table, appends
  the same table to `$GITHUB_STEP_SUMMARY` when that variable is set, and exits 1 if any step failed.
- CI's `static` job calls `--group static --keep-going`. `unit`, `unit-shuffled` and `build` keep
  their own jobs (they need artifacts, reporters or `needs:`), but their commands come from the same
  entries. `ci-workflow.test.mjs` pins that every group has a job and every `--group` named in the
  workflow exists.

**The leak gate joins the list** as a `static` step. Locally, when `LEAK_LIST_FILE` is unset,
`gate:local` prints `SKIPPED leaks:check (LEAK_LIST_FILE unset)` and the skip appears in the final
table, so it is visible rather than silent. It is not a failure there because the list is private and
contributors will not hold it. In CI the variable is always set, so the skip path cannot occur there.

## Protection

★★★ **`main` on GitHub is unprotected today, although sub-project 2's spec says it is protected.**
Measured 2026-09-23: both the branch-protection API and the rulesets API answer 403 "Upgrade to
GitHub Pro or make this repository public" — a private repository on the Free plan can hold neither.
Only the repository-level merge settings took effect (merge commits on, squash and rebase off). A
force push to GitHub `main` is therefore possible right now; the one alarm is the GitLab sync job,
which fails on a non-fast-forward `main` up to a day later. The Pro upgrade in rollout step 0 is what
makes protection possible at all, so the ruleset below is **new**, not a replacement, and it is
created before anything else in the rollout depends on it (step 0b). The sub-project 2 spec's claim
is corrected in the same change.

A **repository ruleset** on `main` enforces: no force push, no deletion, changes through pull
requests only. (Merge-commit-only stays a repository setting, already in force.) Once every check
has reported, it adds **required status checks**: `static`, `unit`, `unit-shuffled`, `build`, `e2e`,
`prod-smoke`, `semgrep`, `audit`.

- **"Require branches to be up to date before merging" stays off.** At 80–180 merges a month it would
  force a rebase and a full re-run whenever `main` moves. The push-to-`main` run covers the gap it
  leaves.
- The **admin bypass** stays. Its only intended use is the minute-exhaustion fallback below.
- A ruleset can only require a check that has reported at least once, so the ruleset is created
  after the first full run (rollout step 4).

## Operating it

- **Merging:** push → `gh pr create` → wait for green → `gh pr merge --merge`. Never `--auto`.
  `npm run gate:local` stays useful as the pre-push check, and is no longer the merge gate.
- **A red check:** read the job's step summary first. `static` lists every failing step, and for the
  register gates exit 1 means drift and exit 2 means the gate could not scan, as before.
- **Minutes exhausted:** checks cannot complete, so merging is blocked. Fallback: run
  `npm run gate:local` (with `LEAK_LIST_FILE` set), merge with the admin bypass, and note the bypass
  and the gate line (`gate:local PASS at <sha>`) in the PR. The next month's first push to `main`
  re-runs everything.

## Register

- **§200 closes.** What keeps it open today is SP3-sized:
  1. the leak gate running in CI — delivered by the `static` job and proven by the control PR;
  2. the last two mentions of the internal GitLab project number, comments at `.gitlab-ci.yml` lines
     346 and 625 — scrubbed;
  3. a one-time proof that the history GitHub now serves is clean: `git clone --mirror` of `origin`,
     then `node scripts/verify-rewrite.mjs --repo <clone> --expect clean --allow <file>`, with the
     positive control `--expect dirty` against `cutover/original.bundle`, which must report nonzero
     counts;
  4. a closure note in the entry, its `**Work item:**` line removed, its index row updated, and
     GitLab issue **#185** closed in the same change (register ⇄ issue pairing).
  The closure note records the leak gate's known blind spot — it scans file content, never file
  **names** — and the requirement handed to sub-project 4 (next bullet).
- **Handed to sub-project 4, as a requirement of its spec:** GitLab issue titles, bodies and comments
  very likely carry internal hosts, the employer's name and work addresses, and imported issues
  become public at the flip. The SP4 import must run the leak scan over the issue text and clean it
  **before** import. With §200 closed, nothing else tracks this, so the roadmap's SP4 section is
  amended in the same change.
- **New entry: the fork-PR rule for the leak gate**, due at the flip. Fork PRs receive no secrets, so
  `leaks:check` would exit 2 on every outside contribution. The options (skip on forks and rely on
  the push-to-`main` run; keep forks red until a maintainer re-runs from an in-repo branch) are
  recorded there, undecided. ★★ Reserve the entry's number on `origin/main` before using it: the
  per-branch index gate passes on two branches that picked the same number.

## Rollout

Each step names the evidence that closes it. A gate counts as proven only after it has gone red
against a state it must reject.

0. **Owner setup** (settings, not code): upgrade the account to Pro; set the Actions budget to $0;
   `gh secret set LEAK_LIST < ~/.config/aipm-cockpit/leak-list.txt`.
   **0b.** Create the `main` ruleset **without** required checks yet (no force push, no deletion, PR
   only). Proof: `gh api repos/sebastianmaute/aipm-cockpit/rules/branches/main` lists the
   `non_fast_forward`, `deletion` and `pull_request` rules as active on `main`, where today the same
   family of calls answers 403. A live push test is deliberately not used: if the rule were missing,
   the test itself would land a stray commit on `main`.
1. **PR A — the shared gate list.** The `{ argv, group }` refactor, `--group`, `--keep-going`, the
   step summary and the leak step, test-first. Merged on `npm run gate:local`, since no CI exists yet.
2. **PR B — the workflows, Dependabot config and `ci-workflow.test.mjs`.** Its own run is the first
   measurement: per-job durations and the run's billable minutes replace the ~45-minute estimate in
   this spec. The `unit` shard decision is taken here. Merged on its own green run plus
   `gate:local`.
3. **Control PR** — a throwaway branch, closed and never merged, one plant per blocking job:
   - a listed identifier → `static` red, with `leaks:check` exit 1;
   - a lint error in the **same** run → `static` lists **both** failing steps (proves `--keep-going`);
   - a failing unit test → `unit` red;
   - a broken accessible name in a view `A11Y_VIEWS` scans → `e2e` red on an axe violation;
   - a semgrep ERROR-severity pattern → `semgrep` red. Which rule is ERROR is measured first, not
     assumed;
   - a prod-only CSP break (an inline `<style>` without the nonce) → `prod-smoke` red.
   `audit` gets its own small control PR: a known-vulnerable **production** dependency pinned →
   `audit` red. `unit-shuffled` has no cheap plant; its only proof is that it runs the same
   `npm run test:shuffle` the local reproduction runs, and this spec claims no more than that.
4. **Ruleset** — created once every check name has reported. Proof that it bites: `gh pr merge` on
   the still-red control PR must be **refused**. Then close the control PRs.
5. **`scheduled.yml`** — dispatched by hand once. `audit-full` and `unit-shuffled-random` complete;
   `dast-zap` gets its first-ever validation, and its reports are downloaded and read.
6. **§200 closure** — the two scrubs, the history proof, the closure note, GitLab #185 closed.
7. **Minutes check**, one week after step 4: actual usage against the 60–65-pipelines-a-month
   estimate, recorded in this spec.

## Tests and guards

- `scripts/gate-local.test.mjs`, extended: every step has exactly one known group; `--group` selects
  only its steps; an unknown group exits 2; `--keep-going` runs every step and exits 1 when any
  failed; the summary lists every step's result and is written to `$GITHUB_STEP_SUMMARY` only when
  that is set; the leak step reports SKIPPED without `LEAK_LIST_FILE`; the unflagged run is unchanged.
- `scripts/ci-workflow.test.mjs`, new and **textual** (the repository has no YAML parser, and one is
  not added for this): every `uses:` is pinned to a 40-hex SHA; top-level `permissions:` is
  `contents: read`; every `--group` named in `ci.yml` exists in `GATE_STEPS` and every group has a
  job; the required-check list in `docs/AGENTS/ci.md` equals the set of job ids in `ci.yml`.
  Mutation-proved: an unpinned `uses:`, and a job missing from the doc list, each turn it red.
- actionlint in the `static` job (see "Jobs").

## Docs, in the same changes

- `AGENTS.md`: the hard constraint "GitHub is canonical; CI is between homes" becomes "CI is GitHub
  Actions" — the required checks, the minute budget and the $0 limit, the bypass fallback, and
  `gate:local` as a pre-push check. The `leaks:check`, `gate:local` and CI mentions elsewhere follow.
- `docs/AGENTS/ci.md`: rewritten for Actions job by job, including the exit-1/exit-2 split and the
  required-check list the workflow test compares against. A short legacy note says why
  `.gitlab-ci.yml` is still in the tree.
- `CONTRIBUTING.md`: the PR process with CI; the generated scripts table follows `scriptsDescriptions`.
- `docs/RUNBOOK.md`: "CI red" and "Actions minutes exhausted" under common issues.
- `package.json` `scriptsDescriptions`: `gate:local` and `leaks:check` lose "until GitHub Actions
  exists" and "NOT YET IN CI"; the headers of `gate-local.mjs` and `check-identifier-leaks.mjs`
  likewise.
- The roadmap: sub-project 3's status, and the SP4 requirement above.
- `2026-09-22-github-cutover-design.md` and any doc repeating it: "`main` protected" was never in
  force on the Free plan (see "Protection"). Correct it with a dated note rather than rewriting the
  record.

## Out of scope

Issue migration and the sync job (sub-project 4). Tags, desktop packaging, releases and the update
feed (sub-project 5). The visibility flip, and the fork-PR rule that becomes decidable with it. Any
change to what an existing gate checks.
