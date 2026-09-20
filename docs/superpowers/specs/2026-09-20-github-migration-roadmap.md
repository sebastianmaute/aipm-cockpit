# Moving to GitHub — roadmap

**Date:** 2026-09-20
**Status:** roadmap approved in conversation; sub-project 1 has its own spec
(`2026-09-20-github-migration-phase1-design.md`). Sub-projects 2–5 are scoped here only —
each gets its own spec before any work starts.

## Goal

GitHub becomes the canonical home for this project: code, history, issues, CI and releases.
The self-hosted GitLab project is retired. The repository ends up **public**.

## Decisions already taken

These were settled in conversation and are not re-opened by the sub-project specs.

| Decision | Choice |
|---|---|
| Scope | Leave GitLab entirely — not a mirror, not a partial split |
| Visibility | Public, but **flipped last** (see ordering) |
| History | Rewritten, with the commit citations remapped rather than orphaned |
| Commit identity | A personal address owned by the author |
| De-branding | Full — including the opaque brand trigram, with a read-compatible settings migration |

★ **The identity choice carries a permanent cost that was stated and accepted:** a working
mailbox in 8,355 public commit records is harvestable and cannot be recalled after the flip.
A GitHub `users.noreply` address was offered and declined.

## What already exists

`main` is push-mirrored from GitLab to a **private, personal-account** GitHub repo today —
`only_protected_branches: true`, **zero tags mirrored**. This is not the target; the target is a
repo under an organisation, carrying rewritten history, with tags.

Register entry §200 (work item #185) has tracked "internal identifiers block making the mirror
public" since 2026-08-28. It names four classes of identifier and the central history trap. It
is **incomplete** — see the Phase 1 spec, which adds two classes §200's own verification method
could not see.

## Measured facts that bound the work

Surveyed 2026-09-20. Every number here is reproducible; re-measure rather than trusting this
table, because all of them drift.

| Fact | Value |
|---|---|
| Repo size / commits / branches | ~69 MiB packed, 8,422 commits, 34 branches |
| Git LFS, submodules | none, none |
| CI jobs | 26, across install → quality → build → e2e → release |
| Open register entries carrying a work item | 275 (266 issue-linked, 11 decision-record) |
| Issue numbers cited | #39 – #378 |
| Commit SHA citations in docs | ~1,095 backticked, ~511 in the register alone |
| Commits carrying a session trailer | 3,048 (+217 co-author lines) |
| Author/committer identities | one employer address on 8,355 commits, plus 90 CI-bot identities |

★★ The small repo size is the single most helpful fact: a full history rewrite is tractable,
which is what makes "rewrite and remap" a real option rather than a forced squash.

## The five sub-projects

Each is independently specifiable and independently valuable. They are **not** one project.

### 1. Sanitise, and settle history

Remove every internal identifier from the tree *and* from all history, rewrite the commit
identities, strip the session trailers, and remap the ~1,095 commit citations so they still
resolve. Ends with a repository that *could* be made public.

Has its own spec. This is the only sub-project with an irreversible consequence downstream, and
the only one already partly explored.

### 2. Cut over to GitHub

Push the sanitised history to a GitHub **organisation** repo (an organisation, not a personal
account — releases need it, and the current mirror is on a personal account). Make it canonical,
retire the push mirror, repoint remotes and developer docs.

Cut over **private**. The visibility flip is deferred to the end of the roadmap.

### 3. CI → GitHub Actions

26 jobs to re-express. Most are a syntax port; five are not, and they are the cost:

- **SAST** currently emits a GitLab-native SAST report for the Security widget. GitHub wants
  SARIF uploaded through the code-scanning action. Replacement, not translation.
- **Unit tests** publish a JUnit report and a coverage badge through GitLab-native mechanisms.
  Both need third-party actions or a different presentation.
- **The register↔issue sync job** talks to the GitLab Issues REST API with CI-provided
  credentials. Full rewrite against a different API. See sub-project 4.
- **The release-publish job** is GitLab-**API**-shaped, not merely GitLab-YAML-shaped. See
  sub-project 5.
- **The DAST job** needs a Docker-in-Docker service; the equivalent on hosted runners differs.

★ One incidental simplification: the desktop packaging job deliberately omits `needs:` and
relies on stage ordering. That trick has no meaning in Actions, where the dependency graph is
explicit — so the workaround disappears, but every gate it implicitly waited for has to be
named explicitly instead. A port that drops it silently loses the ordering guarantee.

### 4. Issues, and the register contract

The register pairs each open entry to an issue by number. Two gates touch this, and they are
**not** equally coupled:

- The **blocking** gate is purely textual. It reads the register and never calls any API. It
  enforces that every open entry carries exactly one conforming work-item line and that no
  closed entry carries one. It does not care which tracker the number belongs to.
- The **sync** gate is warn-only, and it is the one that calls the GitLab Issues API.

★★ Consequence, and it is the opposite of the intuition: migrating issues does **not** break the
blocking gate. The expensive part is re-pairing 266 citations to whatever numbers GitHub assigns
on import, and deciding whether a mirrored issue tracker is worth keeping at all now that the
register is the real record.

### 5. Releases, tags, and the update feed

Currently: a tag drives a release job that builds the desktop installer and publishes through
the GitLab Releases API, including a per-tag **artifact-browsing URL** that is a GitLab concept
with no GitHub equivalent — GitHub Releases carries uploaded asset **bytes** instead. The
publish library therefore needs rewriting, not porting.

This sub-project is also what finally unblocks the auto-update question. An internal GitLab
project serves no unauthenticated downloads, and neither does a private GitHub repo — so today
an `electron-updater` feed would need a credential shipped on every laptop. A **public** GitHub
repo with real releases is the first time that constraint lifts.

★ Two copies of the release URL ship inside the product and are kept in step only by a
text-comparison test. Both must move together.

## Ordering, and the one-way door

```
1 sanitise  →  2 cut over (PRIVATE)  →  3 CI  →  4 issues  →  5 releases  →  flip public
```

1 must precede 2. Everything else could in principle happen in any order, but the flip is
deliberately **last**, not second.

★★★ **Why the flip is last.** Making the repository public is the only step that cannot be
undone: a clone taken inside the window keeps whatever was exposed, forever. Sequencing it last
costs nothing — CI, issues and releases can all be built and proven against a private GitHub
repo — and it means the irreversible action happens when the system is finished and quiet rather
than while it is half-built.

## Verification principles carried by every sub-project

These are not Phase 1 specifics; they apply to each spec written from this roadmap.

- **A scan that finds nothing has two possible meanings** — "clean" and "scanned nothing" — and
  an exit code cannot tell them apart. Every scan gets a positive control: run it where it
  *must* find something and require a specific nonzero count, then run it where it must find
  nothing.
- **Prove the mechanism against the state it denies.** A check that passes both before and after
  the change it is checking has never had contact with that change.
- **Gates are textual until proven otherwise.** Read what a gate actually enforces before
  assuming a migration breaks it; the assumption was wrong once already in this very roadmap's
  drafting, in the expensive direction.

## Open questions, carried

| Question | Needed by |
|---|---|
| GitHub organisation and repository name | 2, and the product URL replacements in 1 |
| The personal address for commit identity | 1, at execution time only |
| Whether a mirrored issue tracker is kept at all | 4 |
| Whether the auto-update feed becomes GitHub Releases | 5 |

## Relationship to existing records

- **§200 / #185** is superseded in scope by the Phase 1 spec, which finds two further classes.
  It should be updated or closed by that work rather than left describing four classes.
- **The 2026-09-10 releases design** deliberately built no second publish target, on the
  explicit grounds that GitHub could not receive releases until the repo is public, off a
  personal account and mirroring tags. This roadmap schedules exactly those three things, so
  that decision's premise expires here — the abstraction it declined to build becomes
  sub-project 5.
