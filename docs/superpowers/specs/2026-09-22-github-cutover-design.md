# GitHub cut-over — design (roadmap sub-project 2)

**Date:** 2026-09-22
**Status:** design approved in conversation 2026-09-22; awaiting written-spec review.
**Roadmap:** `2026-09-20-github-migration-roadmap.md` (sub-project 2 of five)
**Depends on:** sub-project 1 (`2026-09-20-github-migration-phase1-design.md`), done: the rewritten
history exists and verifies clean, but is not yet published anywhere.

## Goal

GitHub (`sebastianmaute/aipm-cockpit`) becomes the **only** canonical home for code: branches,
pull requests, merges and — from sub-project 3 on — CI. The self-hosted GitLab project becomes a
**read-only copy** that pulls from GitHub once a day. Everything stays **private**; the visibility
flip remains the roadmap's last step.

## Decisions taken 2026-09-22 (by the repository owner)

These change the roadmap, which is corrected in the same change (see "Docs").

| Decision | Choice | Replaces in the roadmap |
|---|---|---|
| GitLab's role | Read-only copy, synced in **from** GitHub | "Leave GitLab entirely — not a mirror" |
| Sync mechanism | A scheduled GitLab CI job (GitLab 19.4 CE has no pull mirroring) | — |
| Sync frequency | Once a day | — |
| Commit identity | The author's GitHub `users.noreply` address — already applied by the rewrite | "A personal address … `users.noreply` was offered and declined" |
| CI during the gap | Cut over first; merges gated locally until sub-project 3 | — |
| GitLab's history | Rewritten **in place** (force-push `main` once), not a fresh project | — |

## What exists at the start

- The rewritten history, verified clean by `scripts/verify-rewrite.mjs`, in a working clone at
  `C:\Projects\aipm-rewritten`. Its branch `chore/rewrite-history` carries the sub-project 1 tail
  (Tasks 11–14) plus this spec.
- GitLab: `main` only (protected, force push off), 5 tags, 110 merge-request refs, one push mirror
  to GitHub (enabled, protected branches only, keep-divergent off).
- GitHub: the private push-mirror repository, holding the **un**rewritten `main`.
- Local: three worktrees and a set of branches on the old history; one of them,
  `feat/timelog-booking-review-tl1`, is 2 commits ahead of `main` (measured 2026-09-22).

## Cut-over sequence

Order is load-bearing. Two steps are irreversible and one, done out of order, silently undoes the
cut-over.

0. **Backups and relocation.** `git bundle create --all` of the ORIGINAL mirror and the recorded
   old GitLab `main` hash, stored outside every repository. Copy the untracked replacement list and
   mailmap next to the leak list in `~/.config/aipm-cockpit/`, so a re-run never depends on a temp
   directory. (The clone relocation is already done.)
1. **Freeze.** Merge or park every in-flight branch; no session commits to GitLab after this point.
2. **Catch up.** If GitLab `main` moved since the rewrite was cut, re-run the rewrite on the frozen
   `main` and redo sub-project 1's Tasks 12–13. Replay every parked branch onto the rewritten
   history with `format-patch` / `am`: rewrite the `From:` address to the noreply address first,
   strip the session trailer, and require the resulting tree to equal the source branch's tree.
3. **Remove the GitLab → GitHub push mirror.** ★★ Must precede step 4, or GitLab pushes the old
   `main` into the fresh repository.
4. **Delete and recreate** `sebastianmaute/aipm-cockpit` — private, empty, no README. The owner
   runs this (it needs the `delete_repo` scope). **Irreversible.**
5. **Push** the rewritten `main` and the 5 tags. Open `chore/rewrite-history` as the first pull
   request. Merge-request and pipeline refs are GitLab concepts and are not pushed.
6. **Load GitLab.** Allow force push on `main` once, force-push `main` and the tags, re-protect.
   GitLab keeps the old objects under its merge-request refs; accepted, because GitLab is internal
   and never becomes public.
7. **Switch on the sync job** and prove it end to end (see "Sync job").
8. **Re-clone** every checkout and worktree from GitHub. Delete an old clone only after `git fsck`
   passes and no branch in it is ahead of either remote.

### Reversibility and guards

| Step | Reversible? | Guard before it |
|---|---|---|
| 0–2 | yes, local | GitLab `main` hash recorded |
| 3 | yes, re-add the mirror | — |
| 4 | **no** | the GitHub repository holds nothing GitLab lacks: issues, PRs, releases, wiki, all 0 or accounted for |
| 5 | yes, the repository is private | — |
| 6 | via the step-0 bundle | step 5 verified |
| 7 | yes | — |
| 8 | **no** for anything unpushed | `git fsck` + "no branch ahead of either remote" in every old clone and worktree |

**Abort rule.** A failed check before step 4 stops the cut-over with nothing lost. After step 4 a
failed check stops forward progress; GitHub needs no rollback because GitLab still holds everything
until step 6 is verified.

### Verification — measure the server, not the local clone

After step 5, on a **fresh `git clone --mirror` from GitHub**:

- `verify-rewrite --expect clean` passes, and `--expect dirty` against the step-0 bundle still finds
  nonzero counts (the positive control — a zero there means the scan is broken);
- `leaks:check` on a checkout exits 0;
- commit and tag counts equal the local rewritten mirror's;
- `main`'s tree hash equals the frozen GitLab `main`'s tree hash: the rewrite changed history,
  identities and messages, never the tip's tree (the sub-project 1 tail is on the pull-request
  branch, not on `main`).

After step 6: GitLab's `main` hash equals GitHub's.

## Sync job

**Location: a separate file, `ci/gitlab-sync.yml`**, set as the GitLab project's CI configuration
path. GitLab then reads only that file:

- none of the existing `.gitlab-ci.yml` jobs runs on GitLab again, without editing them;
- `.gitlab-ci.yml` stays byte-identical — `release-publish-lib.test.mjs` reads it (it requires a
  top-level `desktop-package-tag` job) and sub-project 3 ports from it.

**Behaviour:**

- Runs only on a pipeline schedule, `0 3 * * *` Europe/Berlin, plus the manual "Run pipeline"
  button; `workflow: rules` drop every other pipeline source, pushes included.
- Mirror-clones GitHub, then pushes into GitLab: `+refs/heads/*` (force-update), `refs/tags/*`,
  `--prune`, `-o ci.skip`.
- GitLab `main` stays protected with force push **off**, so a force-push to GitHub `main` — which
  must never happen — makes the job fail loudly instead of silently rewriting GitLab. The failure
  mail is the alarm.
- Lag: GitLab can be up to a day behind GitHub. Accepted.

**Credentials** — two masked, protected CI variables:

- `GITHUB_SYNC_TOKEN`: fine-grained GitHub token, `contents:read` on this repository only.
- `GITLAB_SYNC_TOKEN`: GitLab project access token, Maintainer role, `write_repository`.

★ The job's script is GitHub content, so whoever can merge to GitHub `main` can change what runs
with the GitLab token. Today that is the owner alone.

**"Read-only", stated honestly.** CE cannot restrict pushes to one bot (per-user push allowances are
a paid tier) and the owner is a Maintainer. Read-only is therefore mechanical where it can be and
conventional where it cannot: merge requests are disabled in project settings; the sync overwrites
or prunes anything pushed to GitLab directly, except a non-fast-forward `main`, which fails the job.
**Issues stay writable on GitLab** until sub-project 4 migrates them.

**Proof, positive control first** (via the manual button, not the schedule):

1. push a throwaway branch to GitHub → one run → it exists on GitLab;
2. delete it on GitHub → one run → it is pruned from GitLab;
3. GitLab `main` hash equals GitHub's.

## Working on GitHub during the CI gap (until sub-project 3)

**Remotes after the re-clone.** `origin` = GitHub, the only push target. `gitlab` = fetch-only,
push URL set to `DISABLED` — kept because `glab` (issues) and `followups:gitlab:check` need it
until sub-project 4.

**GitHub repository settings.** Merge commits only (squash and rebase off) so history keeps the
shape the citations rely on. `main` protected: no force push, no deletion, changes via pull request;
no required reviews (single contributor); no required status checks until sub-project 3.

> ★★ **Correction 2026-09-23:** "`main` protected" was never in force. On the Free plan a private
> repository can hold neither branch protection nor rulesets — both APIs answer 403 "Upgrade to
> GitHub Pro or make this repository public". Only the merge settings took effect. Sub-project 3
> (`2026-09-23-github-actions-ci-design.md`, "Protection") adds the ruleset after the Pro upgrade.

**"Release" in the gap** = push the branch → `gh pr create` → `npm run gate:local` → `gh pr merge
--merge`. Never auto-merge. This replaces "no local gates": with no CI, skipping the local gate
means no gate at all.

**`npm run gate:local`** — one new script, strictly sequential, exit code = first failure:
`lint` → `tsc --noEmit` → `test:coverage` → `test:shuffle` → `dup:check` → `size:check` → the
docs, register and version checks → `build`. It needs a `scriptsDescriptions` entry, so the
generated table in `CONTRIBUTING.md` changes with it.

**Known gap risk until sub-project 3:** e2e and the axe gate, semgrep, the dependency audit and
prod-smoke do not run anywhere.

**No releases and no tags in the gap.** The release job lives in GitLab CI; sub-project 5 rebuilds
releasing on GitHub Releases.

## Docs, in the same change

- `AGENTS.md`: the "CI is GitLab" hard constraint → GitHub canonical, GitLab read-only copy, the CI
  gap and its local gate.
- `CONTRIBUTING.md`: pull-request process, remotes, `gate:local`.
- `docs/RUNBOOK.md`: releasing is paused until sub-project 5.
- `docs/AGENTS/ci.md`: a banner — it describes the GitLab pipeline, which no longer runs; sub-project 3
  ports it.
- The roadmap: the three decisions in the table above.
- Register §200: GitHub now holds only the rewritten history; the entry stays open until the flip.

## Out of scope

CI on GitHub Actions (sub-project 3), issue migration and re-pairing (4), releases and the update
feed (5), the visibility flip (last). A leak-gate CI job belongs to sub-project 3.
