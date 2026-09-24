# Sub-project 5 — releases, tags and auto-update on GitHub

**Status:** design approved by the owner 2026-09-24, section by section. Not started.
**Roadmap:** [2026-09-20-github-migration-roadmap.md](2026-09-20-github-migration-roadmap.md), sub-project 5.
**Flip checklist:** [2026-09-23-flip-checklist.md](2026-09-23-flip-checklist.md) — this sub-project slots in
before step 10 and adds step 10a.
**Register:** §487 and §563 (the unsigned installer) stay open as the signing follow-up.

## Goal

Pushing a `v*` tag builds the Windows installer on GitHub Actions and, after the owner approves,
publishes it as an immutable GitHub Release together with the update metadata `electron-updater`
reads. Once the repository is public, installed copies of the desktop app find new releases and
update themselves after the user agrees. The GitLab release pipeline is deleted. The repository gets
the best-practice settings a public project should have.

## Decisions taken by the owner (2026-09-24)

| Question | Decision |
|---|---|
| Code signing | **Ship auto-update unsigned now.** No certificate exists (§487, §563). Integrity comes from HTTPS, the sha512 in `latest.yml`, immutable releases, provenance attestations and the tag ruleset — plus the approval gate on publishing once its required reviewer is configured (flip step 10a; GitHub rejects the rule on this private repository's plan today). Signing stays an open follow-up. |
| Update behaviour | **Ask, then install.** Nothing downloads or installs without a click. |
| First release | **Rehearse privately, release after the flip.** A throwaway `-rc` prerelease proves the pipeline on the private repository; the first real release follows flip step 10. |
| Pipeline shape | **Build and publish are separate jobs** (approach B). Only the publish job can write, and it installs no packages. |
| Build runner | **`windows-latest`**, replacing the Linux + Wine container. Windows minutes count double while private; only the rehearsal pays that. |
| Dependabot | **Grouped weekly npm updates** for the root and `desktop/`, framework packages excluded from grouping. |

Rejected: electron-builder publishing directly with a write token (the job holding the token would
also run `npm ci` and the whole build); porting the GitLab publish script to the GitHub API by hand
(more HTTP code than `gh release create`, no gain); silent download-and-install-on-quit; signing
before auto-update.

## What exists today

- `.gitlab-ci.yml` no longer runs anywhere: GitLab's CI config path is `ci/gitlab-sync.yml`. It stays
  in the tree only because `release-publish-lib.test.mjs` reads it. Releasing has been paused since
  the cut-over ("no releases or tags until sub-project 5").
- Its release path: `tag-version-check` (tag = `v` + `APP_VERSION`), `desktop-package-tag` (Windows
  NSIS on `electronuserland/builder` with Wine), `publish-release` (GitLab Releases API with
  `CI_JOB_TOKEN`, linking the job's artifact-browsing URL).
- `desktop/electron-builder.yml`: `appId io.github.sebastianmaute.aipm-cockpit`,
  `artifactName aipm-cockpit-${version}-setup.exe`, `directories.output release`, `win.target nsis`
  (per-user), `signExecutable: false`, no `publish:` block. `desktop:package` runs
  `electron-builder --win --publish never --project desktop`.
- The desktop Help menu's "Check for updates…" (`menu-model.ts`, action `open-releases`) opens
  `RELEASES_URL`. `electron-updater` is not a dependency.
- `APP_RELEASES_URL` (`src/app/version.ts`) and `RELEASES_URL` (`desktop/src/lib/constants.ts`)
  already point at `https://github.com/sebastianmaute/aipm-cockpit/releases`, pinned equal by
  `menu-model.test.ts`.
- The installer is about 137 MB (Electron 44.3.0).
- GitHub has no tag-triggered workflow.

## 1. The release workflow — `.github/workflows/release.yml`

Trigger: `push` of tags matching `v*`. Workflow-level `permissions: contents: read`;
`concurrency: release-${{ github.ref }}` with `cancel-in-progress: false`. Every job has
`timeout-minutes`. Every action is pinned by commit SHA.

### Job `guard` (ubuntu, read-only)

- `npm run tag:check` on the tag. `tag-version-lib` gains prerelease support: a tag
  `v<semver>-rc.<n>` matches only when `APP_VERSION` carries the same suffix.
- The tagged commit must be reachable from `origin/main` (`git merge-base --is-ancestor`), so a tag on
  an unmerged branch cannot ship.
- Outputs `version` and `prerelease` (true for a suffixed tag).

### Job `build` (windows-latest, read-only, `needs: guard`)

- The steps of today's `.desktop-package` job: `NEXT_STANDALONE=1 npm run build`,
  `npm run desktop:copy-static`, `npm --prefix desktop ci`, `npm --prefix desktop run build`,
  `npm run desktop:package`.
- Carries today's guards: the installer must exist; the packaged tree must not contain `sharp`.
- Uploads one artifact holding exactly `aipm-cockpit-<v>-setup.exe`, its `.blockmap` and
  `latest.yml`, short retention.

### Job `publish` (ubuntu, `needs: [guard, build]`, `environment: release`)

- The only job with write permission: `contents: write`, `id-token: write`,
  `attestations: write`.
- Runs no `npm ci` / `npm install`: only the checked-out repository's own dependency-free Node
  scripts and `gh`.
- Steps:
  1. Download the artifact.
  2. `npm run release:verify` (a plain `node scripts/…` invocation, no dependencies): exactly the three
     expected files; names equal `installerName(version)`; `latest.yml`'s `version` equals the tag's
     version; its `sha512` and `size` (top-level and in `files[]`) match the installer's bytes; its
     `path` names the installer.
  3. Provenance attestation for the three files (`actions/attest-build-provenance`) — **only when the
     repository is public**; skipped with a logged line while private (attestations on a private
     repository need GitHub Enterprise).
  4. `gh release create <tag> --draft --verify-tag` with the title and notes built by
     `release-publish-lib`, `--prerelease` when the tag is suffixed.
  5. Upload the three files to the draft, then publish it. With immutable releases the files and tag
     lock at publish, which is why the release is drafted first.
- Exit contract kept from today's publish script: 0 = published (or an identical release already
  exists), 1 = refused (a release for the tag exists with different files or state), 2 = safe to
  retry (network or API failure before publishing).
- A `-rc` release is a GitHub prerelease; `electron-updater` with `allowPrerelease: false` never
  offers it.

### `release-publish-lib.mjs` (rewritten, pure, unit-tested)

- `installerName(version)` — kept; accepts a prerelease suffix.
- `releaseTitle(version, milestone)` — `AI PM Cockpit <v> "<milestone>"` as today.
- `releaseNotes(changelog, version)` — the CHANGELOG section for that version, plus the fixed notice
  that the installer is unsigned and Windows SmartScreen will warn. Refuses (throws) when the section
  is missing.
- `expectedAssets(version)` — the three file names.
- `checkLatestYml(text, version, installerBytes)` — the verification in step 2; returns a list of
  named problems, empty when good.
- Removed: `buildAssetUrl`, `ARTIFACT_JOB`, the GitLab payload and response classifiers.

## 2. Auto-update in the desktop app

- `electron-updater` becomes a runtime dependency of `desktop/`, exact-pinned.
- `electron-builder.yml` gains `publish: { provider: github, owner: sebastianmaute, repo: aipm-cockpit }`,
  which makes the build write `latest.yml` and embeds the feed location as `app-update.yml`.
  `desktop:package` keeps `--publish never`.
- Checks run only when `app.isPackaged`:
  - **startup:** one check about 10 s after the main window is ready; every failure (offline, a 404
    from a private repository, a malformed feed) goes to the diagnostics log only;
  - **manual:** Help → "Check for updates…" now runs a check (menu action `check-for-updates`,
    replacing `open-releases`). "Up to date" shows a plain OK dialog; only the two error dialogs
    (check failed, download failed) also offer a button to open `RELEASES_URL`. A manual check made
    while one is already running promotes it to manual (so it reports when it finishes); one made
    while a download is in progress shows "An update is already downloading." instead of starting a
    second one. `AIPM_DISABLE_UPDATE_CHECK=1` disables checking entirely (used by `e2e:desktop`, so a
    smoke run never meets a modal update dialog).
- Flow:
  1. **Available:** native dialog — version, release notes as plain text, "Download and install",
     "Later", "Skip this version". A skipped version is stored in `userData` and suppresses the startup
     prompt for that version only; a manual check ignores it.
  2. **Downloading:** taskbar progress; differential download through the blockmap. A download failure
     always shows "The update could not be downloaded." (regardless of whether the check that led to
     it was a startup or a manual one — the user already clicked "Download and install" to get here).
  3. **Downloaded:** "Restart now" or "On next quit" (install silently when the app next closes).
     `quitAndInstall` spawns the NSIS installer SYNCHRONOUSLY, before scheduling `app.quit()` — so the
     installer is already running by the time the app's normal quit path (and any unsaved-work flush
     on it) gets a chance to run, not after. "Restart now" does **not** guarantee the flush completes
     first.
- Settings: `autoDownload: false`; `autoInstallOnAppQuit` only after the user chose to download;
  `allowPrerelease: false`; `allowDowngrade: false`. The per-user NSIS install needs no admin rights.
- Modules:
  - `desktop/src/lib/update-policy.ts` — pure: given current version, available version, stored skip
    and whether the check was manual, returns the action (stay silent, prompt, report up to date,
    report error); converts release notes to plain text. Unit-tested.
  - `desktop/src/lib/electron-updater-loader.ts` — pure, unit-tested: resolves `electron-updater`'s
    `autoUpdater` singleton out of whatever shape a dynamic `import()` hands back (it is not a named
    export there, only `.default.autoUpdater`).
  - `desktop/src/updater.ts` — the wiring: `electron-updater` events to the policy and the native
    dialogs. NOT under `lib/` — only the two pure modules above are.
  - `main.ts` calls it; the stale "internal GitLab" comment and the `RELEASES_URL` comment saying
    there is deliberately no updater are rewritten.
- `RELEASES_URL` stays as the fallback link, still pinned equal to `APP_RELEASES_URL`.
- Installed 1.13.x copies have no updater and need one manual install of the first release that has
  it; `docs/desktop-rollout.md` says so.

## 3. Repository hardening

Now, while private:

- **Tag ruleset** on `refs/tags/v*`: restrict creation, update and deletion; bypass for the admin role
  only. Actions and non-admin tokens cannot create, move or delete a release tag. **Active** (ruleset
  "release tags", measured 2026-09-24).
- **Immutable releases** enabled for the repository. **Active** (measured 2026-09-24).
- **Environment `release`:** deployment limited to tags matching `v*` — **active**. Required reviewer =
  the owner, self-review allowed — **NOT active**: GitHub returns HTTP 422 for the reviewers field on
  this private repository's plan (measured 2026-09-24), so it is set at flip step 10a instead, and
  until then `publish` runs with no approval pause.
- **Actions policy:** require SHA pinning — **active**. Allowed actions: the plan was GitHub-owned plus
  an explicit third-party allowlist, but `allowed_actions=selected` (even with a `patterns_allowed[]=
  rhysd/actionlint@*` entry) made `ci.yml` fail at startup (runs 36051255568, 36051362469) — **reverted
  to `allowed_actions=all`** with `sha_pinning_required=true` kept on (measured 2026-09-24). The
  narrower allowlist was not achievable without breaking the workflow.
- **`SECURITY.md`:** supported = latest release only; report through GitHub private vulnerability
  reporting; installers are unsigned; how to verify a download with `gh attestation verify`.
- **Dependabot:** `github-actions`, root `npm`, `desktop/` `npm`, weekly each. npm: one group for minor
  and patch; majors ungrouped; the exact-pinned framework packages named in CONTRIBUTING's
  "Dependencies" rule are excluded from grouping so each arrives as its own PR.
- **Tidy:** GitHub Projects off (unused); homepage = the Releases page.

At the flip, new checklist **step 10a**, right after step 10:

- secret scanning with push protection;
- CodeQL default setup (JavaScript/TypeScript, GitHub Actions);
- private vulnerability reporting (which `SECURITY.md` points to);
- `publish`'s attestation step becomes live (it keys on the repository being public).

Not done, deliberately: CODEOWNERS and required reviews (single maintainer); required commit
signatures (no commit is signed; it would block every push); OpenSSF Scorecard (possible later).

## 4. Retirement, docs, testing, rollout

### Removed

`.gitlab-ci.yml`; `scripts/publish-release.mjs` and `scripts/publish-release.integration.test.mjs`;
the GitLab parts of `release-publish-lib` and its tests. `tag-version-lib` and `check-tag-version.mjs`
stay. The `release:publish` npm script is replaced by `release:verify` (CONTRIBUTING regenerated).
The GitLab project stays a read-only mirror through `ci/gitlab-sync.yml`; retiring it is a separate
decision.

### Tests

- `release-publish-lib.test.mjs`: every export, including `checkLatestYml`'s refusal cases (version
  mismatch, sha512 mismatch, size mismatch, wrong `path`, missing field) and `releaseNotes` refusing a
  missing section. Its structural half now cross-checks `release.yml` and `electron-builder.yml`
  instead of `.gitlab-ci.yml`: the upload paths equal `directories.output` joined with
  `installerName`, the blockmap and `latest.yml`.
- `tag-version-lib.test.mjs`: prerelease suffixes match only with the same suffix in `APP_VERSION`.
- `update-policy.test.ts`: every branch of the decision, the skip rule, manual versus startup.
- A `release.yml` structure test in the style of `ci-workflow.test.mjs`: only `publish` has write
  permissions; `publish` runs no `npm ci`/`npm install`; `publish` uses environment `release`; every
  `uses:` is SHA-pinned; every job has `timeout-minutes`.
- A Dependabot config test: no framework package inside a group.
- `menu-model.test.ts`: the Help item's new action.

### To verify during planning (facts not yet measured)

- **Verified 2026-09-24, locally:** electron-builder writes `latest.yml` under `--publish never` once
  a `publish:` block exists.
- **Verified:** `electron-updater` is inside `app.asar` (`node_modules/electron-updater/out/main.js`
  and its `builder-util-runtime` dependency) — the `build` job's electron-updater guard in
  `release.yml` checks this on every run, not just once.
- **Measured 2026-09-24: NOT available.** The `release` environment's required-reviewer rule is
  rejected (HTTP 422) on this private repository's plan. The rehearsal runs ungated; the rule is set at
  step 10a, before the first real release.
- **Measured 2026-09-24:** immutable releases are enabled for the repository (Task 8 Step 3).
- **Measured 2026-09-24:** yes, under `allowed_actions=all` with `sha_pinning_required=true` — but NOT
  under `allowed_actions=selected` (see the Actions policy bullet in section 3), which is why the
  policy was reverted to `all`.

### Rollout order

1. Implement and merge everything while private.
2. **Rehearsal:** on a branch, `APP_VERSION` `1.14.0-rc.1`; merge; tag `v1.14.0-rc.1`. Expect: `guard`,
   `build`, `publish` — **ungated**, since the environment's required-reviewer rule cannot be set while
   private (see "To verify"); an immutable prerelease with exactly three files; `latest.yml`'s sha512
   equals the installer's. Install it on Windows and start it. Then delete the prerelease and its tag
   (admin bypass on the tag ruleset).
3. **Flip:** checklist step 10, then 10a.
4. **First release** `v1.14.0`: publish; `gh attestation verify` on the downloaded installer passes;
   install it by hand once.
5. **Updater proof:** the next release, `v1.14.1`, is offered to that installed 1.14.0 and updates it
   through the dialog flow. **This sub-project closes only when that passes.**

### Docs

- `docs/RUNBOOK.md`: releasing on GitHub (tag, [approve once flip step 10a configures the reviewer],
  verify), rollback, and withdrawing a bad release — an immutable release cannot be edited, so publish
  a fixed version quickly and mark the bad one as not latest.
- `CONTRIBUTING.md`: a release checklist replacing "no releases and no tags".
- `AGENTS.md`: the CI and Releasing bullets.
- `docs/AGENTS/ci.md`: `release.yml`; the legacy GitLab section is removed.
- `docs/desktop-rollout.md`: GitHub Releases, the one manual install, auto-update from then on.
- The roadmap (sub-project 5 links here) and the flip checklist (step 10a, ordering).
- Register §487 and §563: record the decision to ship unsigned auto-update and the guards that stand
  in for signing; both stay open.
