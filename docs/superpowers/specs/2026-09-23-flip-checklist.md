# Flip checklist

**Date:** 2026-09-23
**Source:** the "Flip checklist" section of
[`2026-09-23-issues-migration-design.md`](2026-09-23-issues-migration-design.md), copied here because
the issue steps must sit in order among the rest of the flip. The roadmap
(`2026-09-20-github-migration-roadmap.md`, "Ordering, and the one-way door") links here for the flip
step; register entry §200 (`docs/open-followups.md`) closes after step 4.

The order matters — do not reorder these steps.

- [ ] **0. Rewrite the history** (§200). Nothing here touches GitHub; everything runs in scratch
  directories outside any working tree.
  - **Freeze first.** From the mirror clone below until step 3's push, nothing merges to `main` and
    no branch that is to be carried is pushed. Anything that lands in that window exists only in the
    old repository; redo this step if it happens.
  - **Carry or leave each branch.** List every remote branch with commits `main` lacks:
    `git for-each-ref --format='%(refname:short)' refs/remotes/origin | while read r; do echo "$r
    $(git rev-list --count origin/main..$r)"; done`. On 2026-09-24 the only one was
    `feat/timelog-booking-review-tl1` (3 ahead). Decide for each one: CARRY it (step 3 pushes its
    rewritten form) or LEAVE it (it survives only in the archive). A branch that exists only in a
    local clone, never pushed, is NOT in the mirror: push it first if it is to be carried, or it is
    lost with its old SHAs. (Transplanting it later means mapping its base through the rewrite's
    `filter-repo/commit-map`.)
  - **Build the two private inputs** from the untracked leak list, both NEVER tracked:
    - the `--replace-text` file for `scripts/rewrite-history/run.sh`. It must include a rule for the
      GitLab project number's PROSE form, not just its URL form (§200, "second part"). Its header
      comment describes the byte-boundary rules;
    - the mailmap mapping every historical identity to the owner's noreply address or the one
      neutral CI identity.
  - **Two mirrors:** `git clone --no-local --mirror` of the GitHub repository, twice, into scratch.
    One is rewritten; the other stays untouched as the original.
  - **Red first:** `LEAK_LIST_FILE=<list plus the prose-form pattern> node scripts/verify-rewrite.mjs
    --repo <original mirror> --expect dirty` must find nonzero hits. A pattern that finds nothing here proves
    nothing later.
  - **Rewrite:** `scripts/rewrite-history/run.sh <rewrite-mirror> <replacements> <mailmap>`.
  - Verify:
    - `git rev-list --all --count` is equal in the two mirrors (the script prunes nothing);
    - `verify-rewrite --expect clean` with the same list against the REWRITTEN mirror reports 0
      blob, 0 message and 0 trailer lines, and an identity set equal to the allowlist. This is the
      local dry run; step 4 repeats it against the pushed repository, and only that run closes §200;
    - the rewritten mirror still carries `refs/pull/*` from GitHub. Step 3 pushes named branches
      only and never those refs.

- [ ] **1. Rename today's repository** (for example `aipm-cockpit-archive`), keeping it **private**, to
  free the name. Whether it is later deleted is an owner decision.
  - While it exists, its `refs/pull/*` stay private.
  - Verify: the name `sebastianmaute/aipm-cockpit` is free (a `gh repo view sebastianmaute/aipm-cockpit`
    against the renamed repo returns the new name, not the old one).

- [ ] **2. Create the fresh private repository** `sebastianmaute/aipm-cockpit`.
  - Before creating it: check that the owner account's default for new repositories leaves
    Dependabot alerts and Dependabot security updates OFF. The setting is on github.com under the
    account's Settings → Code security, as an "Automatically enable for new repositories" option
    beside each feature. Security-update PRs ignore step 3's zero limit (see there), so if this
    default is on, a security-update PR can burn the repository before the import. The UI moves,
    so verify the exact location and wording on the day rather than trusting this line.
  - Verify: `gh repo view sebastianmaute/aipm-cockpit` reports `visibility: PRIVATE` and 0 issues, 0
    pull requests.
  - Verify both Dependabot features are off on the new repository:
    `gh api repos/sebastianmaute/aipm-cockpit/vulnerability-alerts` must fail with HTTP 404 (alerts
    disabled; 204 means enabled), and
    `gh api repos/sebastianmaute/aipm-cockpit/automated-security-fixes` must print
    `"enabled":false`.

- [ ] **3. Push the rewritten history**, which drops the 7 trailer lines and the GitLab project number
  (§200), with ONE hold commit on top.
  - `.github/dependabot.yml` is in that history, and Dependabot version updates start from that file
    alone, with nothing enabled in the settings. One Dependabot PR before step 6 takes an issue
    number and burns the repository. So immediately before the push, add one commit on top of the
    rewritten `main` that sets `open-pull-requests-limit: 0` on EVERY entry under `updates:`.
    - Today the file has one entry, `package-ecosystem: github-actions`. Re-read the file before
      editing, in case an ecosystem has been added since. The edit adds one line per entry at the
      entry's key indentation:
      ```yaml
      updates:
        - package-ecosystem: github-actions
          directory: /
          open-pull-requests-limit: 0
          schedule:
            interval: weekly
      ```
    - Commit it with the owner's identity (which is on the step 4 allowlist) and no trailers, for
      example `chore: hold Dependabot at zero PRs until the issue import is verified`. Record its
      sha: step 7 reverts it.
    - Check that every entry carries the limit in the COMMITTED file. It prints
      `entries N, held N` and exits 0, or exits 1 if any entry lacks the limit. `node` is last in
      the pipe, so the exit code is its own:
      ```bash
      git show HEAD:.github/dependabot.yml | node -e 'const y=require("fs").readFileSync(0,"utf8");const e=y.split(/^\s*- package-ecosystem:/m).slice(1);const bad=e.filter(c=>!/^\s+open-pull-requests-limit: 0\s*$/m.test(c));console.log("entries "+e.length+", held "+(e.length-bad.length));process.exit(e.length>0&&bad.length===0?0:1)'; echo "EXIT=$?"
      ```
      Proven both ways on 2026-09-24: the unedited file exits 1 (`entries 1, held 0`), the edited
      one exits 0, and a two-entry file with one entry unheld exits 1.
    - The limit stops VERSION updates only. Security-update PRs are separate and ignore it, which is
      why alerts and security updates stay off (step 2) until step 6b.
  - Push from the rewritten mirror by name: `main` (with the hold commit), then each branch step 0
    chose to CARRY. Never `git push --mirror`, which would also push `refs/pull/*` and every
    branch step 0 chose to leave.
  - Verify: the push succeeds, the default branch tip is the hold commit, and its parent is the
    rewritten `main`'s tip sha. `git ls-remote` on the new repository lists exactly `main` and the
    carried branches.
  - After this step, every existing clone is on the OLD history. Re-clone from the new repository
    (or `git fetch` and `git reset --hard origin/main` on a clean tree) before working on it again.
    Keep one old checkout, with its `gitlab` remote, for steps 6 and 8.

- [ ] **4. Run `verify-rewrite --expect clean`** against a mirror of it, with the prose-form pattern
  first proven red on today's repository (§200).
  - Command: the command recorded in §200 — `docs/open-followups.md` gives no other reproduce
    command for this step, so this checklist does not invent one. As last recorded there it is
    `node scripts/verify-rewrite.mjs --repo <mirror of GitHub> --allow <allowlist> --expect clean`.
  - Verify: the run reports 0 blob-hit lines, 0 message-hit lines, 0 trailer lines, and an identity
    set equal to the allowlist (unexpected=0, missing=0). §200's own record: the prose-form pattern
    for the GitLab project number must first show nonzero hits against a mirror of TODAY's
    repository (red), before this clean run against the fresh repository counts.
  - §200 closes only once this run passes clean against the fresh repository.

- [ ] **5. Set up the repository:**
  - both `LEAK_LIST` secrets (Actions and Dependabot);
  - the ruleset (deletion, non_fast_forward, pull_request, the eight required checks);
  - Pro-dependent settings;
  - the $0 Actions budget.
  - Dependabot alerts and security updates are NOT enabled here. They move to step 6b, after the
    import is verified.
  - Verify: the ruleset lists all eight required check names, and a manually dispatched CI run
    shows all eight jobs. `ci.yml` carries `workflow_dispatch`, and a dispatch takes no issue number:
    - `gh workflow run ci.yml --repo sebastianmaute/aipm-cockpit --ref main`
    - `gh run list --repo sebastianmaute/aipm-cockpit --workflow ci.yml --limit 1` names the run;
      `gh run view <run id> --repo sebastianmaute/aipm-cockpit --json jobs --jq '.jobs[].name'` lists
      the eight job names (three of them wait on `needs:`, so read it once the run has finished).
  - **Do NOT open a pull request to test CI — not a draft, and not one closed at once. Opening ANY
    pull request before step 6 burns this repository for the import:** a PR takes the next issue
    number, the import then refuses, and the only recovery is another fresh repository. A plain push
    to a throwaway branch does not test CI either: `ci.yml` runs on pushes to `main` only.

- [ ] **6. Import the issues** (`--plan`, then `--apply`), before any PR is opened.
  - Do it promptly after step 3. Step 3's hold commit keeps Dependabot's version updates at zero
    PRs, and steps 2 and 5 keep security updates off, so no Dependabot PR should exist here. The
    guard line below still decides: a Dependabot PR burns the repository exactly as a hand-opened
    one does.
  - Why the import is not moved before step 3's push: the pushed history carries closing keywords
    ("Closes #N"), which could auto-close the imported issues.
  - Prerequisites:
    - Run every `issues:import` command from today's checkout, which has the `gitlab` remote and the
      `glab` configuration the repository uses today. `--plan`, `--apply` and `--close-gitlab` all
      call `glab api projects/:id/…`, and `glab` resolves `:id` from that remote. A fresh clone of
      the new repository has no such remote, so the command exits 2.
    - The plan file lives OUTSIDE the repository, for example `$TEMP/issue-plan.json`, and is never
      committed: it holds the full text of every imported issue.
  - Plan: `LEAK_LIST_FILE=<untracked list> npm run issues:import -- --plan --out <file> --repo
    sebastianmaute/aipm-cockpit --pointer search`
  - Guard, immediately before `--apply`:
    `gh pr list --repo sebastianmaute/aipm-cockpit --state all --json number --jq length` must print
    `0`. The importer refuses a target that has any pull request on its own (exit 1, before its
    first write), but by then the repository is already burned; this line shows it before anything
    runs.
  - Apply: `LEAK_LIST_FILE=<untracked list> npm run issues:import -- --apply --plan <file> --repo
    sebastianmaute/aipm-cockpit` (the GitHub token comes from `GH_TOKEN` or `gh auth token`). If the
    apply stops partway, re-run with `--resume` added.
  - Then run the check: `REGISTER_TRACKER=github GITHUB_REPOSITORY=sebastianmaute/aipm-cockpit
    GITHUB_TOKEN=$(gh auth token) npm run followups:github:check`, which must report 0 drift.
  - Verify:
    - `--plan` prints `open A · stub B · placeholder C · total M`, and `A + B + C = M` = the plan's
      `maxNumber` = GitLab's highest issue number at plan time. The action count is a count of
      GitLab NUMBERS (every number from #1 to the highest gets one action), not of register entries.
    - `A` = the number of OPEN GitLab issues: `glab api "projects/:id/issues_statistics"`, field
      `statistics.counts.opened`. `M` is the newest issue's `iid`:
      `glab api "projects/:id/issues?state=all&per_page=1&order_by=created_at&sort=desc"`.
    - `--apply` exits 0 with no `Refused`.
    - `followups:github:check` exits 0, and its summary line reports that the register's open
      entries and the open GitHub issues agree.
    - ★ GitHub's issue LISTING lags a state change by a few seconds (measured in the 2026-09-24
      rehearsal: a check run straight after a close still counted the issue as open). Run the
      check after the apply has finished, and if it disagrees, re-run it once before acting.
    - Expected duration: the 2026-09-24 rehearsal took 14 min 35 s for 397 numbers and never hit
      a rate limit.
    - For scale only, these drift: the 2026-09-23 snapshot in the design's "Proof, before the flip"
      was 268 open + 92 stubs + 37 placeholders = 397; the live run on 2026-09-24 gave 266 + 94 + 37
      = 397 (266 of the register's 275 open entries carry `#NN`; the other 9 are decision records).
  - The register is 3.2 MB, past GitHub's 1 MB blob-render limit, so GitHub's API returns 403 for it
    and `--pointer search` is used above rather than `--pointer anchor` (Task 1 ruling). Once the
    repository is up, the owner may open the register on github.com once and, if it renders there
    and scrolls to a heading, switch future links to `--pointer anchor`.
  - Expect GitHub's secondary rate limit to pause the apply — about 530 writes against its 500
    writes/hour budget. The tool waits it out on its own: it honours `retry-after` or the primary
    limit's reset time, and waits 60 s on a 403 that names the secondary limit without either.
    `--resume` is what covers a hard stop instead.
  - Old PR numbers do not survive. The history's merge commits say "Merge pull request #1" to
    "#12", and some messages cite those PRs. In the new repository those numbers belong to the
    imported GitLab issues, stubs or deleted placeholders, so such a link lands on the wrong item.
    The rewrite leaves the messages as they are. The PRs themselves stay readable only in the
    archive from step 1, which is one reason to keep it. New pull requests start after the highest
    imported number.
  - A wrong-number stop (the target already carries issues at the wrong numbers, or a PR landed
    before the import and took a number) makes the target repository unusable for this import.
    Recovery is a new fresh repository, not a retry against this one — this is why the checklist
    orders the import before any PR is opened.

- [ ] **6b. Enable Dependabot alerts and security updates**, only now that step 6's import is
  verified. Their pull requests take issue numbers too, so enabling them earlier risks the same burn
  as step 5's warning. Version updates stay held at zero until step 7's PR reverts the hold commit.
  - Verify: `gh api repos/sebastianmaute/aipm-cockpit/vulnerability-alerts` succeeds (HTTP 204), and
    `gh api repos/sebastianmaute/aipm-cockpit/automated-security-fixes` prints `"enabled":true`.

- [ ] **7. Set `REGISTER_TRACKER=github`**, delete the GitLab check, and revert step 3's hold commit
  (one PR, the first opened by hand in the new repository).
  - Command: `gh variable set REGISTER_TRACKER --body github`; in the PR, `git revert <hold commit
    sha>` alongside the GitLab-check removal.
  - Verify: `gh variable list` shows `REGISTER_TRACKER=github`; the PR removing the GitLab check job
    passes all required checks and merges; after the merge, step 3's check, run in a checkout of the
    merged `main`, exits 1 (`held 0`), so version updates resume; `register-sync` (`scheduled.yml`) stops
    printing the skip line on its next scheduled run.

- [ ] **8. `--close-gitlab`.**
  - Command: `npm run issues:import -- --close-gitlab --plan <file> --repo sebastianmaute/aipm-cockpit`
    — from the same checkout and with the same plan file as step 6 (see step 6's prerequisites).
  - Before its first GitLab write it lists the GitHub issues and refuses (exit 1, naming the first
    mismatch) unless every imported #N exists on GitHub, is open, and carries its planned title. So
    run it soon after step 7, before any imported issue is closed or retitled on GitHub.
  - Verify: the command prints `verified N imported issue(s) on GitHub`, every GitLab issue in the
    plan is commented (pointing at its GitHub number) and closed, and the command exits 0.

- [ ] **9. Point `ci/gitlab-sync.yml`** at the new repository if its URL changed, and run it once.
  - Verify: the sync run completes and the GitLab read-only mirror shows the new repository's
    default branch tip.

- [ ] **10. Flip the new repository to public.** This is the only step that cannot be undone.
  - Verify: `gh repo view sebastianmaute/aipm-cockpit` reports `visibility: PUBLIC`.
  - Sub-project 5 (releases, tags, auto-update) must be merged and rehearsed on the private
    repository (Task 10 of `docs/superpowers/plans/2026-09-24-releases-and-updates.md`) before this
    step runs — the rehearsal proves the `release.yml` pipeline while a bad run is still invisible to
    the outside world.

- [ ] **10a. Repository hardening that only makes sense once public**, and the first real release:
  - Secret scanning with push protection:
    `gh api -X PATCH repos/sebastianmaute/aipm-cockpit -f 'security_and_analysis[secret_scanning][status]=enabled' -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'`.
  - CodeQL default setup:
    `gh api -X PATCH repos/sebastianmaute/aipm-cockpit/code-scanning/default-setup -f state=configured`.
  - Private vulnerability reporting (which `SECURITY.md` points to):
    `gh api -X PUT repos/sebastianmaute/aipm-cockpit/private-vulnerability-reporting`.
  - The `release` environment's required reviewer could **not** be set while the repository is
    private — measured 2026-09-24: `gh api -X PUT .../environments/release` with a `reviewers` array
    returns HTTP 422 on this repository's plan. Its `v*`-tag deployment-branch policy DID apply from
    that same call (`gh api repos/sebastianmaute/aipm-cockpit/environments/release --jq
    '{rules:[.protection_rules[].type]}'` shows `branch_policy` today, not `required_reviewers`), so
    `publish` currently runs with no approval pause (see `docs/RUNBOOK.md`). Set the reviewer now:
    ```bash
    gh api -X PUT repos/sebastianmaute/aipm-cockpit/environments/release --input - <<'EOF'
    {"reviewers":[{"type":"User","id":65776548}],"prevent_self_review":false,
     "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
    EOF
    gh api -X POST repos/sebastianmaute/aipm-cockpit/environments/release/deployment-branch-policies -f name='v*' -f type=tag
    ```
    The branch-policy `v*` entry likely already exists from the earlier attempt, so that `POST` may
    answer "already exists" — harmless; only the `reviewers` field is new here.
  - Verify each: `gh api repos/sebastianmaute/aipm-cockpit --jq .security_and_analysis`,
    `gh api repos/sebastianmaute/aipm-cockpit/code-scanning/default-setup --jq .state`,
    `gh api repos/sebastianmaute/aipm-cockpit/private-vulnerability-reporting --jq .enabled`, and
    `gh api repos/sebastianmaute/aipm-cockpit/environments/release --jq
    '{rules:[.protection_rules[].type]}'` expecting **both** `required_reviewers` and `branch_policy`
    now (only `branch_policy` before this step).
  - Then the first real release (`docs/RUNBOOK.md`, "Publishing a desktop release (GitHub)") and the
    updater proof: the release after it is offered to, and updates, the installed copy through the
    dialog flow (design §4, rollout steps 4–5). Sub-project 5 closes only once that passes.
