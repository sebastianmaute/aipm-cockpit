# Defect batch 8 — data loss — design

**Date:** 2026-09-27
**Branch:** `fix/defect-batch-8` (worktree `C:/Projects/aipm-wt-c`), from `origin/main` at `e6793604d`; merge `origin/main` in once PR #439 (cockpit-main) has landed.
**Issues:** #435 (§622) · #433 (§620) · E1 (new register entry, number taken from `origin/main` at commit time) · close-outs #135 (§98) · #206 (§241) · #207 (§242)
**Release:** ships in 1.14.2; the release PR (cockpit-main) waits for this PR.

## Intent

Stop the two remaining ways a user silently loses data, and close three register entries that a verdict pass found already fixed.

A read-only verdict pass against `origin/main` at `e6793604d` (2026-09-27) checked nine data-loss candidates. Only §622 and §620 are live silent loss. It also found one unregistered case of the §622 class (E1). §98, §241 and §242 are fixed in code. §299, §133, §228 and §537 lose no data and are out of scope.

Success:
- Nothing a user typed is lost when the window closes, reloads or navigates away.
- A stored setting that loads as unusable pauses saving on every backend, instead of being dropped and then overwritten.
- Each fix is pinned by a test that is red on the unfixed code and mutation-checked.
- The fixed entries and their GitHub issues are closed with evidence.

## Constraints

- Peer session `cockpit-main` owns `scripts/**`, `CHANGELOG.md`, `APP_VERSION` and the release flow. This PR changes none of them. The final CHANGELOG lines go to cockpit-main.
- CPU lock: local vitest, Playwright, builds and dev servers run only while holding the `LOCK vitest` token agreed with `cockpit-main`. Tests run in the foreground with `--maxWorkers=2`.
- Commits cite `§NNN` only. `Closes #NN` appears only in the PR description.
- Commits carry no `Claude-Session:` trailer and no other attribution.
- Commit with `git commit --only`. Never use `--amend`, `git stash`, `git reset` or `git checkout --`.
- `src/app/*` files are CRLF. Never `sed -i`. `i18n.de.ts` is changed only by a node utf8 script, with real umlauts.
- The register index is generated. After any heading change run `node scripts/rebuild-followup-index.mjs`; `--check` must exit 0.
- Owner rule from §185 (2026-09-27): a tab switch or minimize (`visibilitychange`) must NOT commit a draft. Only `pagehide` (close, reload, navigation) and unmount do.

## 1. §622 (#435) + E1 — a draft that was never blurred is lost on window close

**Defect.** Block editors hold the draft in `useBlockDraft` state and commit it on blur. The `pagehide` handler added for §185 (`flushRefusedOnPageHide`, `document-block-editors.tsx:453-460`) returns early unless the paragraph is over the cap (`if (!paragraphOverCap(raw)) return;`). So an ordinary edit that was never blurred is lost on close, reload or navigation. The hook is shared, so the loss covers heading, paragraph, bullets and table blocks.

E1 is the same class and is not yet registered: the dashboard status narrative (`dashboard-sections/dashboard-narrative.tsx`) keeps `draftNarrative` in local state, commits it only on blur, Done or dismiss, and has no `pagehide` handler.

**Fix.**
- Add one shared hook, `useCommitOnPageHide(commit: () => void)`. It owns a plain bubble `pagehide` listener on `window` and keeps the latest `commit` in a ref.
  - It uses a bubble listener, not capture, for the jsdom reason recorded in §185: jsdom calls a bubble listener that a capture listener adds at the target, and the browser does not. A capture listener would let the tests pass and hide a broken `pageHiding`.
- `useBlockDraft` uses the hook. On `pagehide` it commits any dirty draft under `flushSync`, with `flatten` true only when the paragraph is over the cap. It clears the dirty flag in the same statement, as every other `tryCommit` caller does.
  - An emptied draft is still refused.
  - The `externallyWritten()` abandon guard still applies.
- The dashboard narrative registers its existing commit through the hook.
- The existing `pageHiding` flag in `debounced-save.ts` makes the save these commits schedule write at once.
- **Sweep.** Find every other editor that holds a local draft and commits only on blur: grep `onBlur=` next to local draft state across `src/app`. Label each hit AFFECTED or NOT, with a reason. Convert the affected ones to the hook. Record the labelled list in the plan and in the E1 Status line.
  - If the sweep finds more affected editors than the PR can hold, the extras become new register entries. The implementer does not quietly drop them.

**Verification.**
- For each of heading, paragraph, bullets, table and the narrative, a test types without blurring and dispatches `pagehide`. The persisted value is the typed text. The test is red on the unfixed code.
- A `visibilitychange` to hidden commits nothing.
- Each commit happens exactly once, including when `pagehide` fires after an unmount flush and when two editors are dirty.
- Mutants, each must go red:
  - restore the over-cap guard;
  - drop the hook call from the narrative;
  - add a `visibilitychange` listener to the hook.

## 2. §620 (#433) — JSON-file and IndexedDB loads drop a meta slice that sanitizes to nothing

**Defect.** Only Turso reports a meta slice that parses but sanitizes to nothing (§617: `sanitizedToNothing` → `lastDecodeFailures` → "Saving paused"). `jsonToWorkspace` (`workspace.ts`, e.g. `:642`, `:661-663`, `:679-685`, `:780`) and `BrowserBackend.load` (`browser-backend.ts:271-305`) sanitize, keep the value if it is non-empty, and otherwise omit the key with no record. The next autosave writes the file or blob without it, so the value is gone for good. Example: a project file edited by a newer build holds a `steeringCommittee` or `settingsOverrides` shape this build rejects entirely.

**Fix (owner decision 2026-09-27: pause saving, as on Turso).**
- Give `jsonToWorkspace` an opt-in recorder through an options argument. When present, the recorder receives every meta slice whose raw value had content and whose sanitized value is empty or absent, judged by the same `sanitizedToNothing` from `meta-slice-decode.ts` that Turso uses.
- The file-backend load and `BrowserBackend.load` pass a recorder and expose the result as `lastDecodeFailures`, the optional field that the storage backend interface (`workspace.ts:484`) already declares.
- `use-load-truncation` already reads `lastDecodeFailures` generically, so "Saving paused" and "Save anyway" work unchanged.
- The version-history diff, import and every other `jsonToWorkspace` caller pass no recorder, so they never raise a pause.
- The §617 silent cases stay silent: `[]`, `{}`, Simple-mode `features: []`, and a status made of blank strings.
- **Out of scope:** IndexedDB `status` is not sanitized at all (`browser-backend.ts:267`), so it cannot be dropped there. It stays with §470.

**Verification.**
- For each of the file and IndexedDB backends:
  - an unusable slice is recorded and saving pauses;
  - each §617 silent case loads with no record;
  - a valid slice loads.
- A `jsonToWorkspace` call without a recorder behaves exactly as today.
- Mutants, each must go red:
  - drop the recorder call;
  - record on every empty value;
  - let the version-diff path pass a recorder.

> **Correction (2026-09-27):** the `steeringCommittee` half of the Example above is NOT covered by this fix. An OBJECT-shaped `steeringCommittee` (or `timelogLinks`) value is never reported on any backend: both sanitizers return an object with fixed keys for any object input, so `sanitizedToNothing` is never true and a newer object shape is emptied silently, the same on Turso since §617. Register §620 records the limit.

## 3. Close-outs — §98 (#135), §241 (#206), §242 (#207)

Each entry was verified fixed at `e6793604d`:
- **§98:** both save-time counters count documents, knowledge items and document assets (`workspace-metrics.ts:106-131`).
- **§241:** all six extra slices are in the version-diff `COLLECTION_SPECS` (`version-diff.ts:158-170`). Documents are `restorable:false` and are restored through their own document history instead.
- **§242:** `isEmptyWorkspacePayload` counts documents, knowledge items and calendar events (`use-version-history.ts:72-86`). `insights` and `documentVersions` stay uncounted on purpose.

**Work.**
- Move the decision rationale for §241 and §242 into code comments beside the two `writeVersion` guards (`use-version-history.ts:77` and `:196-210`): which slices are deliberately not counted or not restorable, and why. After that, the register entry is no longer the only record of the decision.
- Close each entry with the evidence above, using the real commit date.
- Close the GitHub issues from the PR description.

## Out of scope

- §299, §133, §228, §537. None of them loses data; §537 is a large format change.
- §24 (named entities counted as 7 characters at the cap) and §470 (IndexedDB plan blob unsanitized).
- `CHANGELOG.md` and `APP_VERSION`. These are release-time work, owned by cockpit-main.

## Verification before PR

- `npx tsc --noEmit` must report 0 errors in total.
- `npx eslint --max-warnings=0 src`
- `npm run size:check`, `npm run dup:check`
- the register gates: `followups:status`, `followups:index`, `followups:workitems`, and `node scripts/rebuild-followup-index.mjs --check`
- `npm run docs:claims:check`, `docs:symbols` and `src:symbols:check`
- targeted vitest under the lock
- CI on the PR. The owner decides whether `gate:local` is run.
