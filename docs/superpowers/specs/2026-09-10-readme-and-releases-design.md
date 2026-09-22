# README as entry point, and publishing desktop releases

**Status:** approved design, 2026-09-10. Two parts, deliberately coupled by the
user because the entry point's main call-to-action is a download that does not
exist yet.

## 1. Context

`README.md` is 35 KB across fourteen sections and says so itself: *"The rest of
this document is the in-depth reference … written to be searched for the one
section you need rather than read end to end."* That is a reference manual, not
an entry point. The precedent for fixing it already exists — the complete
feature list was lifted to `docs/features.md` (32 KB) and README kept a pointer
plus a Further-reading table.

Separately, the Electron desktop shell now produces a working installer, but
nothing publishes it. A colleague cannot get the app without someone handing
them a file.

## 2. Goals

- README reads as an entry point: what this is, how to run it, where everything
  else lives. Target ~9 KB.
- Each technical subject gets exactly one owning document.
- A tagged release builds the installer and publishes it somewhere a colleague
  with a GitLab account can download.

## 3. Non-goals

- **Auto-update is out of scope.** Spike 1 (UNC vs HTTPS update feed) stays
  open. This design deliberately does not pre-empt it — see §7.
- **Making anything public.** The GitHub mirror stays as it is.
- **No rewrite of moved prose.** Sections move essentially verbatim; edits are
  limited to headings, cross-links, and removing text that duplicates another
  document.

## 4. Measured facts this design rests on

Established by command, not assumption:

| Fact | How |
|---|---|
| README is a `version:sync` satellite ("README shields badge"), carrying version **and** codename with `encode`/`decode` hooks for the space | `scripts/version-sync-lib.mjs` |
| README has **zero** `path:LINE` citations | grep; so the doc-claims ratchet cannot be tripped by moving this text |
| `docs:scripts` does **not** generate README | no reference to it in `scripts/sync-script-docs.mjs`; confirmed by a run that regenerated `CONTRIBUTING.md` alone |
| Six intra-README anchors, all pointing into sections that move | `#security-model` ×4, `#how-sign-in-works`, `#environment-variables--security` |
| The GitLab project is `visibility: internal`, `releases_access_level: enabled`, **`packages_enabled: false`** | `glab api projects/:id` |
| `workflow.rules` already admits tag pipelines (`- if: $CI_COMMIT_TAG`) | `.gitlab-ci.yml` |
| Repo has not tagged a release since `v0.7.3`; app is at 0.301.0 | `git tag --list` |
| GitHub mirror is a **private, personal-account** copy of `main`, `only_protected_branches: true`, with **zero tags mirrored** | `glab api projects/:id/remote_mirrors`, `gh api .../tags` |
| `desktop/release/` is **407 MB**, of which `win-unpacked/` is 314 MB and the installer 93 MB | `du -sh` |

Two consequences follow from those and are load-bearing:

- **The Packages registry is unavailable** (disabled), so release assets link to
  job artifacts rather than a generic package.
- **GitHub cannot serve colleagues today** — private, personal account, and no
  tags reach it. It is a backup of `main`, not a distribution channel.

## 5. Part A — README restructure

### 5.1 What moves

| Section | Destination |
|---|---|
| Storage Backends (3.7 K) | `docs/storage.md` |
| Integrations (7.4 K) | `docs/integrations.md` |
| Automation / Notifications (2.5 K) | `docs/automation.md` |
| AI Cost & Prompt Caching (6.6 K) | `docs/ai-cost.md` |
| Environment Variables & Security (1.3 K) + Security Model (2.7 K) | `docs/security.md` |
| Sample Workspace (0.9 K) | `CONTRIBUTING.md` |

`Environment Variables & Security` and `Security Model` merge because they are
one subject split across two headings; merging gives it a single owner.

`Sample Workspace` goes to CONTRIBUTING rather than a new file: it documents a
generator script and a source-of-truth fixture, which is developer-facing.

New files are lowercase, matching `features.md` and `desktop-rollout.md` rather
than the older `RUNBOOK.md` spelling.

### 5.2 What README keeps

Title and badges · a trimmed *Why AI PM Cockpit* · **Get started** · Tech Stack ·
a documentation map · License.

**Get started** serves two audiences, desktop first:

- **Desktop app** — for colleagues. Points at the Releases page (Part B) and
  links `docs/desktop-rollout.md` for the steps. README names no share path and
  no file name; that document owns the concrete location, so there is exactly
  one place to update.
- **From source** — for developers. The three commands and the "no environment
  variables required" line. Prerequisites is deleted in favour of
  CONTRIBUTING's (it is duplicated verbatim today); Deploying moves to
  `docs/RUNBOOK.md`, which already owns hosting.

### 5.3 Constraints

1. **The shields badge is untouched.** It is a blocking-gate satellite; its
   regex shape must survive byte-for-byte.
2. **All six anchors become cross-file links.** Slugs are **derived, never
   hand-written** — `environment-variables--security` already carries the double
   hyphen that an `&` produces, and the same trap applies to every em dash. No
   gate checks anchors, so §8 makes this an explicit verification step.
3. **A fact lands in one file.** Moved prose is deleted from README, not
   summarised there as well.

### 5.4 Correction carried by this change

`AGENTS.md` and a standing memory both state that `README.md` is generated from
`scriptsDescriptions` alongside `CONTRIBUTING.md`. It is not, and has not been.
The claim is corrected in the same change that touches these files.

## 6. Part B — Publishing releases

### 6.1 Trigger and the tag/version guard

A `v*` tag triggers the release path. Because `src/app/version.ts` is the source
of truth, a job asserts `$CI_COMMIT_TAG == "v$APP_VERSION"` and fails the
pipeline otherwise.

Without it, tagging `v0.302.0` on a tree whose `APP_VERSION` is `0.301.0`
publishes an installer that misreports its own version — the exact drift class
`version-sync-check` exists to catch, one level up. The guard must be proved
non-vacuous by driving it red with a deliberately mismatched tag.

### 6.2 Artifact scope

`artifacts.paths` narrows from `desktop/release/` to the installer and its
`.blockmap`. This is a defect fix, not an optimisation: the current setting
uploads 407 MB, of which `win-unpacked/` (314 MB) is an expanded duplicate of
the installer's own contents.

Tag builds set `expire_in: never`, so a published download cannot vanish out
from under a Release asset link. Branch builds keep the existing `1 week`.
The asymmetry is the point: an expiring artifact is fine for a manual check and
unacceptable for something README tells people to download.

### 6.3 Installer file name

`electron-builder`'s `artifactName` becomes `aipm-cockpit-${version}-setup.exe`.

The default is `aipm-cockpit Setup 0.301.0.exe`. Spaces force percent-encoding
into every download URL, which is the same failure shape as the README badge
truncating on a codename containing a space. Removing the spaces removes the
class rather than encoding around it.

### 6.4 Creating the Release

The job calls the Releases API with `CI_JOB_TOKEN` and attaches an asset link to
the **per-tag** artifact URL (`/-/jobs/artifacts/<tag>/raw/<path>?job=<job>`),
which stays valid across job re-runs where a job-id URL would not.

The `release:` keyword is deliberately not used: it requires the `release-cli`
image, and this pipeline already carries one unverified image dependency.

### 6.5 `allow_failure`

The existing job has a single `- when: manual` rule with `allow_failure: true`
indented under it. Adding a tag rule means a second entry, and **a `rules:`
entry that omits `allow_failure` defaults to `false`** — which is what a tag
build wants, since a release that silently did not build is worse than a red
pipeline. It must be written deliberately rather than inherited, and the job's
existing comment already warns the next reader about exactly this.

### 6.6 GitHub, later

No abstraction is built for a second publish target today. The build job emits a
clean, versioned, self-contained installer; publishing is a separate small job
that consumes it. Adding GitHub later is another such job.

A pluggable-target indirection now would be speculative: GitHub cannot receive
releases until the repo is public, off a personal account, and mirroring tags —
none of which is scheduled.

## 7. Relationship to spike 1

Spike 1 asks whether the auto-update feed is a UNC share or HTTPS. This design
does not answer it, and one finding here constrains it:

**An `internal` GitLab project serves no unauthenticated downloads.** An
`electron-updater` feed pointed at GitLab would need a credential shipped inside
the app — a token on every laptop. The same is true of the private GitHub
mirror. So GitLab is a fine place for a human to *download* a release and a poor
place for an app to *poll* for one, and those two questions come apart.

## 8. Verification

- **Anchors:** every one of the six rewritten links resolves to a heading that
  exists in the destination file. Slugs derived programmatically; nothing checks
  this automatically.
- **Blocking gates that must stay green:** `version:check` (the badge),
  `docs:claims:check` (expect "none added" — the moved prose carries no
  citations), `docs:scripts:check` (CONTRIBUTING gains a section, so its
  generated table must still match), `lint`, `typecheck`.
- **The tag guard is driven red** with a mismatched tag and green with a
  matching one.
- **Artifact size** is confirmed to be the installer plus blockmap, not the
  unpacked tree.
- **No file loses content:** section byte counts before and after are compared,
  so a move cannot silently drop prose.

## 9. First-run unknowns

Neither blocks the design; both are settled the first time the job runs.

1. **`electronuserland/builder:wine` has never run on these runners.** If it is
   unreachable, the honest outcome is deleting that job and publishing from a
   local build — the plan says so rather than leaving a broken job in place.
2. **Whether 93 MB clears `max_artifacts_size`.** The settings endpoint is
   admin-only and unreadable from here.

## 10. Rejected alternatives

- **One `docs/reference.md` holding all moved sections** — relocates the
  catch-all rather than giving each subject an owner; Sample Workspace and AI
  Cost have nothing to do with each other.
- **Folding security into `docs/RUNBOOK.md`** — grows a file that already owns
  operations, and risks restating rather than owning.
- **Enabling the Packages registry** — needs a Maintainer, and the auth problem
  in §7 means it would not unlock the update feed anyway.
- **GitHub Releases now** — blocked on visibility, account, and tag mirroring.
- **README carrying the download URL directly** — two places to update and one
  of them rots; `docs/desktop-rollout.md` owns the location.
