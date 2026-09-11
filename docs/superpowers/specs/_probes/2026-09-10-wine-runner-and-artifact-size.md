# Spike: the wine runner and the artifact size limit

**Status:** RESOLVED 2026-09-11 — both questions answered YES; the decision
table's "Both fine" row applies. See **Measured**.

Two unknowns, one measurement. Both are settled by triggering the existing
manual job once and reading its log.

## Questions

1. Can these runners pull and run `electronuserland/builder:wine`? It has never
   run here. The runners are Linux (`node:24-bookworm-slim` by default), so a
   Windows NSIS target needs wine, and that image is the only thing providing it.
2. Does a 92.9 MiB (97.5 MB) artifact — the installer plus its blockmap — clear
   this instance's `max_artifacts_size`? The setting is admin-only and
   unreadable from here. GitLab's documented DEFAULT is 100 MB per job: ~7.1%
   headroom if that "MB" means MiB, only ~2.5% if it is decimal. Which unit
   GitLab applies is NOT established here, so plan for the smaller figure.

## Procedure

1. Push the branch and open a merge request — each only on the user's explicit
   say-so. A push alone starts no pipeline: the `workflow:` rules in
   `.gitlab-ci.yml` admit only merge-request events, the default branch, tags
   and schedules, so the branch's pipeline is the MR pipeline. Open it.
2. Run the `desktop-package` job manually (its `when: manual` rule matches any
   pipeline that is not a tag's).
3. Read the log for three things, in order:
   - **Image pull.** A failure here is question 1, answered NO.
   - **Build completion.** `electron-builder` printing a `.exe` path.
   - **Artifact upload.** A size rejection here is question 2, answered NO —
     and note it arrives AFTER a successful build, so a green build is not
     evidence the artifact survived.
4. If the job is green, download the artifact and confirm it is the installer
   plus its `.blockmap` and NOT `win-unpacked/`.

## Measured

All on 2026-09-11. Four `desktop-package` runs, the first two red for reasons
that are NOT these questions:

| Pipeline | Job | Outcome |
|---|---|---|
| 6894 (MR !468) | [29413](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29413) | Red at the root typecheck — `desktop/src/main.ts` imports `electron`, which only `desktop/node_modules` has. Fixed by excluding that file in the root `tsconfig.json`. |
| 6896 (MR !468) | [29451](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29451) | Red at the `ls` guard. With no platform flag electron-builder packaged for the HOST, and the runner is Linux: it built `target=snap` and `target=AppImage` under the `-setup.exe` artifactName (134,289,527 B, no `.blockmap`), and logged "Implicit publishing triggered by CI detection". Fixed by `--win --publish never` in `desktop:package` (MR !469). |
| 6898 (MR !469) | [29489](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29489) | **Green.** `target=nsis`, 131 s. |
| 6904 (tag `v0.303.0`) | [29602](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29602) | **Green** as `desktop-package-tag`, 132 s; `publish-release` then created the first Release. |

**Question 1 — the image: YES.** `electronuserland/builder:wine` pulled on the
first run in 45 s (29413: `Pulling docker image` 14:42:18 → `Using docker image`
14:43:03), 43 s on the second, and under 1 s on the two green runs, all at the
same digest (`sha256:41ae5409…`), so the runner keeps it cached even under the
`always` pull policy.

**Question 2 — the size: YES, with little room.** What GitLab stored:

| Job | Installer | `.blockmap` | Archive GitLab accepted |
|---|---|---|---|
| 29489 | 103,565,557 B | 107,483 B | 103,549,498 B — `201 Created` |
| 29602 | 103,565,559 B | 107,444 B | 103,549,382 B — `201 Created` |

Installer plus `.blockmap` is ~98.9 MiB in CI, about 6 MiB more than the
92.9 MiB (same two files) of the local build this spike was sized from. An accepted 103.5 MB archive rules out a DECIMAL
100 MB limit; it does not say which limit applies. If it is the 100 MiB default
(104,857,600 B), the headroom is ~1.3 MB (1.25 %) — one sizeable dependency
away from a rejection, which arrives only at the upload, after a green build.

**Contents: the installer and its `.blockmap`, nothing else.** Read from the
upload log, not from a downloaded archive: `desktop/release/*-setup.exe` and
`desktop/release/*-setup.exe.blockmap` each "found 1 matching artifact files",
and those two globs are the job's only `artifacts:paths`, so `win-unpacked/`
cannot be in it. The tag job's artifacts report no expiry (`expire_in: never`).

**Who can download (plan Task 11 Step 6): any signed-in user.** A signed-in
colleague who is NOT a project member opened the v0.303.0 Release's asset link
and the installer downloaded (reported by the user, 2026-09-11). The settings
that make it so, read from `GET /example-group/aipm-cockpit`: `visibility: internal` (so an
anonymous visitor gets nothing) and `public_jobs: true` (Settings → CI/CD →
General pipelines → "Project-based pipeline visibility"). GitLab's permissions
docs tie a non-member's artifact access to that setting; turning it off was NOT
tried, so treat it as the likely cause if colleagues start getting 404s. Not
measured either: a GitLab EXTERNAL user, whom `internal` projects exclude.

## Decision table — decided in advance, so the outcome cannot be rationalised

| Outcome | Action |
|---|---|
| Image unreachable | **DELETE the `desktop-package` and `desktop-package-tag` jobs, AND remove `publish-release` in the same change.** Publish from a local Windows build instead, and say so in `docs/RUNBOOK.md`. A broken job left in place is worse than no job: it reports a red pipeline nobody can act on. ★★ Deleting the build jobs ALONE is worse still: `publish-release` has no `needs:`, so it would go on running on every tag and publish a Release whose asset link names a job that no longer exists — a green pipeline over a download that 404s. The build job's own comment in `.gitlab-ci.yml` prescribes the same. |
| Image fine, artifact rejected as too large | Keep the build job; **drop the Release asset link** and have `docs/desktop-rollout.md` point at a manually-uploaded copy. Do NOT chase the limit by splitting the installer — a two-part download is worse than a share link. |
| Both fine | Proceed with the rest of the plan unchanged. |

## What this does NOT establish

- Nothing about SmartScreen. A CI-built installer is unsigned and carries no
  Mark-of-the-Web until a browser downloads it (measured 2026-09-10:
  `Get-Item -Stream *` on a locally built installer returns `:$DATA` alone).
- Nothing about the auto-update feed. Spike 1 of the Electron plan owns that,
  and the design's §7 constrains it: an `internal` project serves no
  unauthenticated downloads, so an updater pointed here needs a credential on
  every laptop.
