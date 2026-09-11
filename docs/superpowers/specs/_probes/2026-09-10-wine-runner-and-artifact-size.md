# Spike: the wine runner and the artifact size limit

**Status:** OPEN — resolved by the first manual run of `desktop-package`.

Two unknowns, one measurement. Both are settled by triggering the existing
manual job once and reading its log.

## Questions

1. Can these runners pull and run `electronuserland/builder:wine`? It has never
   run here. The runners are Linux (`node:24-bookworm-slim` by default), so a
   Windows NSIS target needs wine, and that image is the only thing providing it.
2. Does a 92.8 MB artifact clear this instance's `max_artifacts_size`? The
   setting is admin-only and unreadable from here. GitLab's documented DEFAULT
   is 100 MB per job, which would leave ~7% headroom.

## Procedure

1. Push the branch. Open the pipeline.
2. Run the `desktop-package` job manually.
3. Read the log for three things, in order:
   - **Image pull.** A failure here is question 1, answered NO.
   - **Build completion.** `electron-builder` printing a `.exe` path.
   - **Artifact upload.** A size rejection here is question 2, answered NO —
     and note it arrives AFTER a successful build, so a green build is not
     evidence the artifact survived.
4. If the job is green, download the artifact and confirm it is the installer
   plus its `.blockmap` and NOT `win-unpacked/`.

## Measured

_(fill in: date, pipeline URL, job outcome, artifact size as GitLab reports it)_

## Decision table — decided in advance, so the outcome cannot be rationalised

| Outcome | Action |
|---|---|
| Image unreachable | **DELETE the `desktop-package` and `desktop-package-tag` jobs.** Publish from a local Windows build instead, and say so in `docs/RUNBOOK.md`. A broken job left in place is worse than no job: it reports a red pipeline nobody can act on. The job's own comment in `.gitlab-ci.yml` already prescribes this. |
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
