# Sub-project 4 — issues move to GitHub, numbers preserved

**Status:** design approved by the owner 2026-09-23. Not started.
**Roadmap:** [2026-09-20-github-migration-roadmap.md](2026-09-20-github-migration-roadmap.md), sub-project 4.
**Register:** §200 (the flip's history requirements) is the related open entry.

## Goal

At the visibility flip, GitHub Issues becomes the tracker. Every open register entry then points at
exactly one open GitHub issue carrying **the same number it had on GitLab**. A weekly check reports
drift between the register and GitHub. GitLab's issues end closed, each with a pointer to its
GitHub copy.

## Decisions (owner, 2026-09-23)

| Question | Decision |
|---|---|
| Which issues are imported | The **open** ones only (268 on 2026-09-23). |
| What each issue carries | Title, body and labels. **No comments.** |
| Where the body comes from | **Generated from the current register entry**, not copied from GitLab. |
| The GitLab side | Each imported GitLab issue is closed with a comment "Moved to GitHub #N". |
| Numbers | **Preserved.** The import runs into the fresh repository created at the flip (see below). |
| Numbers not imported | A **closed stub** for each closed GitLab issue. A **deleted placeholder** for every number GitLab never used. |
| Where the sync check runs | Weekly in `scheduled.yml`, plus a local `npm run` script. It reports and never blocks. |

### Why the import runs at the flip, not now

The flip pushes the rewritten history to a **freshly created** repository (roadmap, "Requirement for the
flip", §200). Issues, PRs, labels, secrets and rulesets belong to a repository, and a push carries none
of them. Anything imported into today's repository would have to move again. GitHub's issue transfer
gives a moved issue a new number, so the register would be re-paired twice.

A fresh repository also has the property that makes number preservation possible: it has no issues and
no PRs, so the next issue created is #1. Creating issues in GitLab order reproduces every GitLab number.
The register's roughly 1,000 issue citations, and the issue numbers in commit messages, then stay valid
with no rewrite.

★★ **This holds only if no PR is opened in the fresh repository before the import finishes.** Issues and
PRs share one number sequence on GitHub. The importer refuses to start unless the target has zero
issues and zero PRs (see "Guards").

Until the flip, GitLab stays the tracker, and the register's procedure (`glab issue create`) is
unchanged.

## Measured facts (2026-09-23)

Reproduce with `glab api "projects/:id/issues_statistics"` and the paged
`glab api "projects/:id/issues?state=all&per_page=100&page=N"`.

| Fact | Value |
|---|---|
| GitLab issues | 360, numbers #38–#397 with no gaps; 268 open, 92 closed |
| Open issues that are register issues | 268 of 268 (`§NNN:` title and the `source::register` label) |
| Closed register issues | 87 of 92; 5 closed issues are not register issues |
| Comments | 89 on 74 issues; 46 on open issues (not imported) |
| Labels in use | 23 (`type::`, `theme::`, `source::`) |
| Leak-list hits in open issue titles and bodies | 213 issues, 216 lines. 211 are each body's first line (a GitLab file URL). This is why bodies are regenerated, not copied. |
| `docs/open-followups.md` | about 3.2 MB (`wc -c`) |

★ Every number here drifts until the flip. The importer reads them at run time and never from this table.

## The numbering plan

For N = 1 … M, where M is the highest GitLab issue number at run time (397 on 2026-09-23):

| GitLab state of #N | Action in the fresh repository | Count on 2026-09-23 |
|---|---|---|
| open | create the imported issue, open | 268 |
| closed | create a stub, then close it | 92 |
| never existed | create a placeholder, then delete it | 37 (#1–#37) |

Deleting an issue does not free its number, so the next create still receives N+1. A deleted
number returns 404. That is correct for a number that never had an issue.

## Components

### `scripts/issue-import-lib.mjs` (pure: no network, no filesystem, no shebang)

- **`planImport(gitlabIssues, entries)`** returns the ordered action list above, one action per number
  from 1 to M. It fails if the GitLab list has a duplicate number, or if an open GitLab issue's `§N`
  has no OPEN register entry.
- **`issueBody(entry, gitlabNumber)`** generates an imported issue's body:
  - a pointer to entry §N in `docs/open-followups.md`;
  - the entry's `**Status:**` paragraph;
  - its first body paragraph;
  - a footer, "Imported from GitLab #N on <date>. The register entry is the source of truth; update
    it, not this issue."

  It is capped at 20,000 characters, well under GitHub's 65,536-character body limit. A cut is marked
  as a cut.
- **The pointer's form is open until measured.** The register is about 3.2 MB, and GitHub may not
  render a Markdown file that size in its file view. A heading anchor would then lead nowhere. The
  plan's first task measures what GitHub does with this file, then picks the form: an anchor if it
  renders, otherwise the path plus "search for `## N.`".
- **`stubIssue(gitlabIssue)`** makes a stub:
  - title `GitLab #N, closed before the migration`;
  - body: one line naming the closed register entry when the GitLab title carries `§N:`, otherwise a
    fixed sentence.

  No GitLab text is copied.
- **`labelsFor(action)`** returns an imported issue's GitLab labels unchanged. A stub gets none.
- **`leakCheckPlan(actions, patterns)`** runs `scanMessage` from `identifier-leak-lib.mjs` over every
  planned title and body. It returns the hit count per class and never the matched text.

### `scripts/import-issues.mjs` (the CLI; owns I/O and exit codes)

- **Exit codes:** 0 success; 1 refused, with a precise reason; 2 could not run (missing input, network,
  unexpected response).
- **`--plan --out <file>`:** reads GitLab (`glab api`) and the register, writes the plan as JSON, prints
  the three counts and the leak result, and changes nothing.
  - Any leak hit in the plan is exit 1, and no `--apply` may use that plan.
- **`--apply --plan <file> --repo <owner/name>`:**
  - First creates any missing labels, then walks the plan.
  - After each create, checks that the number GitHub returned equals the planned N, and stops at
    once on any mismatch.
  - Stubs are closed right after creation.
  - Placeholders are deleted with the GraphQL `deleteIssue` mutation.
  - Requests are paced to stay under GitHub's secondary rate limit. A 403 or 429 carrying
    `retry-after` waits and retries the same N.
- **`--resume`:** reads the highest existing issue number and continues from the next one. It first
  checks that every existing number matches the plan.
- **`--close-gitlab --plan <file> --repo <owner/name>`:** runs after `--apply` is verified, and checks
  that itself: before its first GitLab write it lists the GitHub issues and refuses unless every
  imported #N exists there, open, with its planned title. For each imported issue, it posts "Moved to
  GitHub #N: <url>" on GitLab and closes the issue. It is idempotent: an issue already closed with
  that comment is skipped.
- `--apply` and `--close-gitlab` refuse a plan whose `version` is not 1.

### Guards (all tested)

- `--apply` refuses a target that has any issue or any PR, unless `--resume` is given.
- `--apply` refuses a plan file whose leak result is not zero, or whose recorded M is below GitLab's
  current highest number (the plan is stale).
- No bypass flag exists for any guard.

### The sync check: `scripts/check-followup-github.mjs`

- **Port of `check-followup-gitlab.mjs`.** The comparison it relies on, `compareWithGitLab` in
  `followup-workitem-lib.mjs`, is renamed to a tracker-neutral `compareWithTracker`. Issue numbers
  arrive as `{iid, title, labels}` from either tracker.
- **Reads** the GitHub REST API (`/repos/{owner}/{repo}/issues?state=open`) with `GITHUB_TOKEN`,
  follows `Link` pagination, and drops pull requests: the issues endpoint returns them too, marked by a
  `pull_request` key.
- **Exit codes** are the GitLab script's contract, unchanged: 0 in sync or skipped, 1 drift, 2 could not
  compare. The floor of 50 register issues is also kept.
- **Skip switch:** the check exits 0 with the line "issues are not on GitHub yet" unless the repository
  variable `REGISTER_TRACKER` is `github`. Before the flip every entry would otherwise read as
  ISSUE_NOT_OPEN, every week.
- **Wiring:**
  - `npm run followups:github:check`;
  - a weekly job in `scheduled.yml` with `permissions: issues: read` and `continue-on-error: true`.
- **At the flip,** `check-followup-gitlab.mjs` and its npm script are deleted with their test, in the
  same change that sets `REGISTER_TRACKER`.

## Proof, before the flip

1. **Plan on today's data:** exactly 268 open + 92 stubs + 37 placeholders = 397 actions. The leak
   result is zero.
2. **Leak guard positive control:** a test fixture entry carrying a synthetic identifier from a
   synthetic list makes `leakCheckPlan` report 1 hit and makes `--plan` exit 1.
3. **Full dress rehearsal on a throwaway private repository.**
   - It runs only with the owner's go-ahead: the controller creates the repository and deletes it
     afterwards.
   - Run `--apply` with today's plan. Then:
     - list all issues and check that #1–#397 match the plan one to one;
     - run `followups:github:check` against it with `REGISTER_TRACKER=github`, which must report 0
       drift.
   - `--close-gitlab` is NOT run in the rehearsal.
4. **Refusal control:** a second `--apply` against the rehearsal repository, which now holds issues,
   must exit 1. A `--resume` against it must report "nothing to do".
5. **Sync check controls:**
   - against the rehearsal repository with one issue closed by hand: exit 1, with ISSUE_NOT_OPEN;
   - with `REGISTER_TRACKER` unset: exit 0, with the skip line.

## Flip checklist

This goes to `docs/superpowers/specs/2026-09-23-flip-checklist.md`, written by this sub-project, because
the issue steps must sit in order among the rest. The order matters:

1. Rename today's repository (for example `aipm-cockpit-archive`), keeping it **private**, to free the
   name. Whether it is later deleted is an owner decision.
   - While it exists, its `refs/pull/*` stay private.
2. Create the fresh **private** repository `sebastianmaute/aipm-cockpit`, first checking that the
   owner account's "automatically enable for new repositories" default leaves Dependabot alerts and
   security updates off.
3. Push the rewritten history, which drops the 7 trailer lines and the GitLab project number (§200),
   with one hold commit on top setting `open-pull-requests-limit: 0` on every `updates:` entry in
   `.github/dependabot.yml`: version updates start from that file alone, and one Dependabot PR
   before step 6 burns the repository. The limit does not stop security-update PRs, hence step 2's
   check.
4. Run `verify-rewrite --expect clean` against a mirror of it, with the prose-form pattern first proven
   red on today's repository (§200).
5. Set up the repository:
   - both `LEAK_LIST` secrets (Actions and Dependabot);
   - the ruleset (deletion, non_fast_forward, pull_request, the eight required checks);
   - Pro-dependent settings;
   - the $0 Actions budget.

   Dependabot alerts and security updates are not enabled here (see 6b), and CI is checked with
   `gh workflow run`, never with a pull request: any PR before step 6 takes an issue number and
   burns the repository for the import.
6. **Import the issues** (`--plan`, then `--apply`), before any PR is opened, behind a zero-PR guard.
   Then run `followups:github:check`, which must report 0 drift. The import is not moved before
   step 3's push, because that history carries closing keywords ("Closes #N") that could auto-close
   the imported issues.

   6b. Enable Dependabot alerts and security updates, only once the import is verified.
7. Set `REGISTER_TRACKER=github`, delete the GitLab check, and revert step 3's hold commit (one PR,
   the first opened by hand in the new repository).
8. `--close-gitlab`.
9. Point `ci/gitlab-sync.yml` at the new repository if its URL changed, and run it once.
10. Flip the new repository to **public**. This is the only step that cannot be undone.

§200 closes after step 4. The sub-project 5 steps (releases, tags) slot in before step 10 when that
sub-project is written.

## Docs changed by this sub-project

- **`docs/AGENTS/ci.md`:** the weekly sync job, and the GitLab check's retirement at the flip.
- **The register's "how to file an entry" instructions:** `glab issue create` until the flip,
  `gh issue create` after it. Both are written down now, with the switch tied to `REGISTER_TRACKER`.
- **Roadmap sub-project 4 section:** a link to this spec. The checklist link goes where the roadmap
  describes the flip.
- **CONTRIBUTING:** regenerated for the new npm scripts.

## Out of scope

- Issue comments.
- GitLab merge-request links.
- Issues closed before the migration, beyond their stubs.
- Releases and tags (sub-project 5).
- Rewriting issue numbers in `CHANGELOG.md` or commit history. Preserved numbers make that unnecessary.

## Risks

- **A PR opened in the fresh repository before step 6 takes a number** and breaks preservation. The
  guard catches it (exit 1). Recovery is a new fresh repository, so the checklist orders import before
  any PR.
- **GitHub's secondary rate limits** on 397 creates and 37 deletes. Pacing and `--resume` cover it. The
  rehearsal measures the real duration.
- **The register changes between `--plan` and `--apply`.** The plan file records the register's commit
  sha, and `--apply` refuses a mismatch with the checked-out tree.
