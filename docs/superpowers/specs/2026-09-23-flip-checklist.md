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
  - the $0 Actions budget;
  - Dependabot.
  - Verify: the ruleset lists all eight required check names, and a test push to a throwaway branch
    shows all eight jobs queued.

- [ ] **6. Import the issues** (`--plan`, then `--apply`), before any PR is opened.
  - Plan: `LEAK_LIST_FILE=<untracked list> npm run issues:import -- --plan --out <file> --repo
    sebastianmaute/aipm-cockpit --pointer search`
  - Apply: `LEAK_LIST_FILE=<untracked list> npm run issues:import -- --apply --plan <file> --repo
    sebastianmaute/aipm-cockpit` (the GitHub token comes from `GH_TOKEN` or `gh auth token`). If the
    apply stops partway, re-run with `--resume` added.
  - Then run the check: `REGISTER_TRACKER=github GITHUB_REPOSITORY=sebastianmaute/aipm-cockpit
    GITHUB_TOKEN=$(gh auth token) npm run followups:github:check`, which must report 0 drift.
  - Verify: `--plan` writes a plan file whose action count matches the register's open-entry count
    at flip time (397 actions — 268 open + 92 stubs + 37 placeholders — as measured in the design's
    "Proof, before the flip"; recount against the register as it stands at flip time, this number
    drifts); `--apply` exits 0 with no `Refused`; `followups:github:check` exits 0.
  - The register is 3.2 MB, past GitHub's 1 MB blob-render limit, so GitHub's API returns 403 for it
    and `--pointer search` is used above rather than `--pointer anchor` (Task 1 ruling). Once the
    repository is up, the owner may open the register on github.com once and, if it renders there
    and scrolls to a heading, switch future links to `--pointer anchor`.
  - Expect GitHub's secondary rate limit to pause the apply — about 530 writes against its 500
    writes/hour budget. The tool waits it out on its own; `--resume` is what covers a hard stop
    instead.
  - A wrong-number stop (the target already carries issues at the wrong numbers, or a PR landed
    before the import and took a number) makes the target repository unusable for this import.
    Recovery is a new fresh repository, not a retry against this one — this is why the checklist
    orders the import before any PR is opened.

- [ ] **7. Set `REGISTER_TRACKER=github`** and delete the GitLab check (one PR, the first in the new
  repository).
  - Command: `gh variable set REGISTER_TRACKER --body github`
  - Verify: `gh variable list` shows `REGISTER_TRACKER=github`; the PR removing the GitLab check job
    passes all required checks and merges; `register-sync` (`scheduled.yml`) stops printing the skip
    line on its next scheduled run.

- [ ] **8. `--close-gitlab`.**
  - Command: `npm run issues:import -- --close-gitlab --plan <file> --repo sebastianmaute/aipm-cockpit`
  - Verify: every GitLab issue in the plan is commented (pointing at its GitHub number) and closed;
    the command exits 0.

- [ ] **9. Point `ci/gitlab-sync.yml`** at the new repository if its URL changed, and run it once.
  - Verify: the sync run completes and the GitLab read-only mirror shows the new repository's
    default branch tip.

- [ ] **10. Flip the new repository to public.** This is the only step that cannot be undone.
  - Verify: `gh repo view sebastianmaute/aipm-cockpit` reports `visibility: PUBLIC`.

The sub-project 5 steps (releases, tags) slot in before step 10 when that sub-project is written.
