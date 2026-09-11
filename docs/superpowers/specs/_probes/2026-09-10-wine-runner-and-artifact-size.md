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

All on 2026-09-11. Five `desktop-package` runs, the first two red for reasons
that are NOT these questions; the fifth is the first after the sharp fix (see
**The size gap** below):

| Pipeline | Job | Outcome |
|---|---|---|
| 6894 (MR !468) | [29413](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29413) | Red at the root typecheck — `desktop/src/main.ts` imports `electron`, which only `desktop/node_modules` has. Fixed by excluding that file in the root `tsconfig.json`. |
| 6896 (MR !468) | [29451](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29451) | Red at the `ls` guard. With no platform flag electron-builder packaged for the HOST, and the runner is Linux: it built `target=snap` and `target=AppImage` under the `-setup.exe` artifactName (134,289,527 B, no `.blockmap`), and logged "Implicit publishing triggered by CI detection". Fixed by `--win --publish never` in `desktop:package` (MR !469). |
| 6898 (MR !469) | [29489](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29489) | **Green.** `target=nsis`, 131 s. |
| 6904 (tag `v0.303.0`) | [29602](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29602) | **Green** as `desktop-package-tag`, 132 s; `publish-release` then created the first Release. |
| 6908 (MR !471, commit `edca3783`, version 1.0.0) | [29645](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/jobs/29645) | **Green**, 171 s, manual `desktop-package` — the first run with the sharp filter and guard. The guard step ran (the log shows its `nm=desktop/release/win-unpacked/resources/standalone/node_modules` line) and printed no `sharp guard:` line, and the job succeeded, so the packaged tree existed and held no sharp package. |

**Question 1 — the image: YES.** `electronuserland/builder:wine` pulled on the
first run in 45 s (29413: `Pulling docker image` 14:42:18 → `Using docker image`
14:43:03), 43 s on the second, and under 1 s on the two green runs, all at the
same digest (`sha256:41ae5409…`), so the runner keeps it cached even under the
`always` pull policy. The fifth run (29645) used the same digest; its pull time
was not read.

**Question 2 — the size: YES — with little room until the sharp fix.** What
GitLab stored:

| Job | Installer | `.blockmap` | Archive GitLab accepted |
|---|---|---|---|
| 29489 | 103,565,557 B | 107,483 B | 103,549,498 B — `201 Created` |
| 29602 | 103,565,559 B | 107,444 B | 103,549,382 B — `201 Created` |
| 29645 (after the sharp fix) | 97,186,650 B | 101,937 B | 97,169,276 B — `201 Created` |

Before the fix, installer plus `.blockmap` was ~98.9 MiB in CI (29602:
103,673,003 B), about 6 MiB more than the 92.9 MiB (same two files) of the local
build this spike was sized from — a gap consistent with the sharp finding under
**The size gap** below. An accepted 103.5 MB archive rules out a DECIMAL
100 MB limit; it does not say which limit applies. If it is the 100 MiB default
(104,857,600 B), the headroom then was ~1.3 MB (1.25 %) — one sizeable
dependency away from a rejection, which arrives only at the upload, after a
green build.

After the fix (29645), installer plus `.blockmap` is 97,288,587 B ≈ 92.78 MiB,
within ~0.1 MiB of the local 0.301.0 build's 92.9 MiB (same two files): the
~6 MiB gap is closed. Against a 100 MiB
default the accepted 97,169,276 B archive leaves 7,688,324 B of headroom
(~7.3 MiB, 7.3 %). Which limit applies is still not known.

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

**The size gap: the installer carried Linux sharp.** Measured 2026-09-11 by
downloading tag job 29602's artifact (103,549,382 B) with
`glab api --hostname gitlab.example.com example-group/aipm-cockpit/jobs/29602/artifacts`
and unpacking it with 7-Zip in three layers: the artifact zip, the NSIS
installer inside it, then `$PLUGINSDIR/app-64.7z` inside that. Under
`resources/standalone/node_modules/@img/` sat the following — sizes from
`du -sh` on the unpacked tree, i.e. DISK USAGE rounded to 4 KiB clusters, not
apparent bytes:

- `sharp-linux-x64`, 413K, including `lib/sharp-linux-x64-0.35.4.node`;
- `sharp-libvips-linux-x64`, 18M;
- `colour`, 57K, a pure-JS dependency of sharp.

Those two sharp directories, archived on their own with `7z a -mx=7`, make an
archive of 6,291,480 B (apparent bytes) = 6.0 MiB. That is CONSISTENT WITH the
~6 MiB gap above, not proof that it is the gap: the gap compares a local 0.301.0
build against a CI 0.303.0 build, so anything else that changed between those
versions is inside it too. `du -s` gives the CI standalone `node_modules` as
38,191 KiB against 19,733 KiB for the local 0.301.0 build. No other native file
(`.node`, `.so`, `.dll`, `.dylib`) and no other platform-named package exists
anywhere in the CI standalone tree, so sharp is the whole class.

How it got there: the ROOT `npm ci`, which installs sharp, runs in the `install`
job on the default `node:24-bookworm-slim` image — Linux — and hands its
`node_modules/` on as an artifact; `.desktop-package` receives it through
`needs: [install]` and itself runs only `npm --prefix desktop ci`. So the
tree the job builds from carries sharp's Linux prebuilt binaries; Next's
standalone output traces them into `.next/standalone/node_modules`; and the
second `extraResources` entry in `desktop/electron-builder.yml` ships that
directory into the installer. A Windows install can never load a Linux `.node`
file.

The local Windows build is no better, only smaller. Its
`desktop/release/win-unpacked` (0.301.0) carries `@img/sharp-win32-x64` (`du -sh`
445K; its `colour` 53K) holding only `sharp-win32-x64-0.35.4.node`: the
`libvips-42.dll` (18,614,784 B apparent, by `ls -l`) and `libvips-cpp-8.18.6.dll`
it links against were NOT traced, although both sit in the repo root's
`node_modules/@img/sharp-win32-x64/lib/`. So no installer build has ever carried
a loadable sharp.

Nothing needs one — reasoned from the code, not observed at runtime. Only Next's
image optimizer (`/_next/image`) loads sharp, and nothing reaches it: no file
imports `next/image` (`grep -rnE "from ['\"]next/image['\"]" src` finds nothing;
the two plain-text hits for `next/image` are a comment in
`src/app/asset-preview-modal.tsx` and the `_next/image` exclusion in
`src/proxy.ts`'s matcher), `next.config.ts` sets no `images`, and the app
generates no metadata images. Its one metadata file, `src/app/favicon.ico`, is a
STATIC one: `next-metadata-route-loader` routes a non-dynamic metadata file
through `getStaticAssetRouteCode`, which embeds the file's bytes in a plain
`NextResponse` and never touches sharp (that loader contains no `sharp` at all:
`grep -n "sharp" node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js`
prints nothing). There is no `opengraph-image`, `twitter-image`, `icon` or
`apple-icon` file under `src/app`. Removing it
cannot break the server's boot either: Next requires sharp LAZILY —
`require('sharp')` sits inside `getSharp()` in
`next/dist/server/image-optimizer.js`, whose only caller is `optimizeImage()`
(`grep -rn "getSharp(" node_modules/next/dist/server --include=*.js`, read
against the installed Next 16.3.4).

The fix, 2026-09-11: a `filter` on that `extraResources` entry drops the
TOP-LEVEL `@img/**` and `sharp/**` (which takes `@img/colour` with it), and the
`.desktop-package` CI job now fails if the packaged
`win-unpacked/resources/standalone/node_modules` lacks `next/package.json` —
so the check cannot pass against a tree that is not there — or if a `find` walk
of it turns up a `node_modules/sharp` or `node_modules/@img/sharp-*` at ANY
depth, which covers a nested copy the filter would let through. The check sits
on the base job, so a tag pipeline goes red in `e2e`, before `publish-release`
can publish the installer.

**Its effect, measured on job 29645** (MR !471, version 1.0.0): the guard ran and
found nothing, and the installer went from 103,565,559 B (29602, v0.303.0) to
97,186,650 B — 6,378,909 B (6.08 MiB) smaller, consistent with the 6,291,480 B
7z archive above, 87,429 B apart. That is not an exact attribution: the two
builds are different versions (0.303.0 and 1.0.0), so whatever else changed
between them is inside the difference too. The headroom it buys is under
**Question 2** above.

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
