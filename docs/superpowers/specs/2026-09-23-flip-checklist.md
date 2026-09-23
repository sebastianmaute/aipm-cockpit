# Flip checklist

**Date:** 2026-09-23
**Source:** the "Flip checklist" section of
[`2026-09-23-issues-migration-design.md`](2026-09-23-issues-migration-design.md), copied here because
the issue steps must sit in order among the rest of the flip. The roadmap
(`2026-09-20-github-migration-roadmap.md`, "Ordering, and the one-way door") links here for the flip
step; register entry §200 (`docs/open-followups.md`) closes after step 4.

The order matters — do not reorder these steps.

- [ ] **1. Rename today's repository** (for example `aipm-cockpit-archive`), keeping it **private**, to
  free the name. Whether it is later deleted is an owner decision.
  - While it exists, its `refs/pull/*` stay private.
  - Verify: the name `sebastianmaute/aipm-cockpit` is free (a `gh repo view sebastianmaute/aipm-cockpit`
    against the renamed repo returns the new name, not the old one).

- [ ] **2. Create the fresh private repository** `sebastianmaute/aipm-cockpit`.
  - Verify: `gh repo view sebastianmaute/aipm-cockpit` reports `visibility: PRIVATE` and 0 issues, 0
    pull requests.

- [ ] **3. Push the rewritten history**, which drops the 7 trailer lines and the GitLab project number
  (§200).
  - Verify: the push succeeds and the default branch matches the rewritten `main`'s tip sha.

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
  - Dependabot is NOT enabled here. It moved to step 6b, after the import is verified.
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
  - Do it promptly after step 3. The `.github/dependabot.yml` pushed there may start Dependabot's
    version updates on its own, before anyone enables anything, and a Dependabot PR burns the
    repository exactly as a hand-opened one does. Whether it does so in this window is unverified;
    the guard line below is what decides.
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
  - A wrong-number stop (the target already carries issues at the wrong numbers, or a PR landed
    before the import and took a number) makes the target repository unusable for this import.
    Recovery is a new fresh repository, not a retry against this one — this is why the checklist
    orders the import before any PR is opened.

- [ ] **6b. Enable Dependabot** (version updates and security updates), only now that step 6's import
  is verified. Its pull requests take issue numbers too, so enabling it earlier risks the same burn
  as step 5's warning.
  - Verify: the repository's Dependabot settings show both enabled.

- [ ] **7. Set `REGISTER_TRACKER=github`** and delete the GitLab check (one PR, the first in the new
  repository).
  - Command: `gh variable set REGISTER_TRACKER --body github`
  - Verify: `gh variable list` shows `REGISTER_TRACKER=github`; the PR removing the GitLab check job
    passes all required checks and merges; `register-sync` (`scheduled.yml`) stops printing the skip
    line on its next scheduled run.

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

The sub-project 5 steps (releases, tags) slot in before step 10 when that sub-project is written.
