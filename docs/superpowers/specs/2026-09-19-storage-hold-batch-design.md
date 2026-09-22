# Storage-hold batch — §548 · §591 · §577 · §573

**Date:** 2026-09-19 · **Branch:** `fix/storage-hold-batch` (off `origin/main` at 1.12.1 merge `9d7a6b5c`)
**Target version:** the next patch after whatever `main` carries when this ships. The peer session's
`fix/data-loss-batch` (§567 · §534 · §546) is in flight and ships separately; release order is settled with
the peer at release time. **No new register numbers are reserved.** Any entry this batch has to file gets
its number from the peer session first (register max on `origin/main` is §591).

## Revision 2026-09-19 (plan review)

The user approved the plan with three amendments. They are folded into the sections below, and the text
they contradict has been changed:

1. **The hold covers the pre-hydration window too.** `loadPending` is true while `!hydrated` (§1a). Before
   this, the app tree was live over the empty boot workspace between `i18nReady` and `hydrated`, and an edit
   made there was overwritten by the first load. The render hold only helps if `hydrated` always becomes
   true. Every throw on the settings-load path already reaches `setHydrated(true)`. The one path that can
   leave it false is a secret-store promise that never settles, so that merge is now bounded (§1e).
2. **All nine `holdDuring` ops are tested**, not three: in flight, after resolving, and after throwing
   (§1a Tests).
3. **SharePoint loads time out after 10 s**, like Turso loads (`LOAD_TIMEOUT_MS`), through one shared
   fetch-with-timeout helper, so a hung Graph read fails the load, the load settles and the hold lifts (§1d).

## Goal

| § | Issue | Loss / defect today | Fix |
|---|---|---|---|
| 548 | #336 | an edit made while a project load is in flight is overwritten when the load lands | hold the whole app behind the existing skeleton while a load is pending |
| 591 | #375 | after a Turso URL/token or SharePoint target change, the previous project's activity log and budget history are merged into the new target | merge only when the storage target is unchanged, otherwise replace |
| 577 | #362 | the budget-variance insight compares the whole-window budget with to-date actuals, so open buckets are flagged and an untouched bucket wins "worst" | compare with budget-to-date and leave unstarted buckets out |
| 573 | #358 | the Open Points visual baseline is stale | re-baseline after an eye check |

## Global constraints

- No hand-rolled UI controls; reuse existing primitives (`PanelSkeleton`) and existing notice paths. Ask
  if none fits.
- Run only the gates each task needs, one task at a time and in order. Read exit codes unpiped. vitest runs
  `--maxWorkers=1 --reporter=dot`, never two runs at once on this machine: announce "starting vitest" /
  "vitest done" to the peer session. No full suite locally.
- `src/app/*.ts(x)` are CRLF (Edit tool, never `sed -i`); docs are LF. `src/app/i18n.de.ts` only via a
  node utf8 write matching `\r\n`; EN/DE key parity.
- Commits cite §N; `Closes #NN` appears only in the MR description. Stage explicit paths; never `--amend`.
- Every "this is covered" claim is backed by a named mutation that turns the test red.
- Coordination: `src/app/use-insight-recommendations.ts` is also edited by the peer's §534. Tell the
  peer before touching it; whichever branch merges second resolves the conflict.

## 1. §548 — hold the app while a project load is pending

**Principle:** an edit that cannot start cannot be lost. The user chose (2026-09-19) the whole-app
skeleton over a read-only UI and over merging in-flight edits.

**Where:** `src/app/use-storage-backend.ts` (signal + swap hold), `src/app/task-manager.tsx` (render hold +
background writers), the hooks named below; and, per the 2026-09-19 revision, `src/app/use-settings.ts`
(hydration bound), `src/app/turso-pipeline.ts` + a new shared fetch-with-timeout helper, and
`src/app/sharepoint-backend.ts` (load timeout).

### 1a. Signal — `loadPending`

`workspaceLoaded` / `loadedBackend` are NOT usable: by design (§77) they stay unstamped after an
empty-load refusal and after a failed load, so a hold keyed on them would lock the app for the whole session
after one load error. Instead:

- `settledBackend`: an identity state like `loadedBackend`, stamped on EVERY terminal branch of the load
  effect (applied, suppressed re-stamp, empty-load refusal, catch). Because it is identity-keyed, a rebuilt
  backend (project switch, kind switch, Turso/SharePoint target change) starts unsettled automatically.
- `swapsInFlight`: a counter raised and lowered by a `holdDuring(op)` wrapper around the nine project-swap
  ops: `reloadCurrentProject`, `switchToProject`, `createProject`, `loadProjectFromFile`,
  `createDemoProject`, `onOpenStorageFile`, `switchToTursoProject`, `createTursoProject`,
  `migrateCurrentProjectToTurso`. It is lowered in `finally`, so a throwing op never leaves the hold on.
- `loadPending = !hydrated || settledBackend !== backend || swapsInFlight > 0`, returned from the hook.
- Before hydration (`!hydrated`) the hook claims pending (revision 2026-09-19): the first load has not
  started yet, so it is pending. That one signal feeds the render hold AND every background-writer gate, so
  none of them can miss the pre-hydration window. The hold therefore depends on `hydrated` always becoming
  true (§1e).

### 1b. Render hold

In the MAIN window, while `loadPending` is true, render `<PanelSkeleton lang={lang} />` in place of the app
tree. This is the same ternary shape `showTursoListLoading` already uses, one level up. Popouts are
unchanged: they never run a backend load, and they keep `guardEdit`.

- No edit control exists during the hold, so the 39 UI writer paths outside `guardEdit` are covered, and so
  is any writer added later. `guardEdit` / `makeEditGuard` are unchanged.
- No new i18n string. The skeleton's `role="status"` carries the existing loading text.
- The storage error surfaces (load error banner, saving-paused banner, the "Pick storage file" recovery)
  must stay reachable. They need no hold, because a failed or refused load settles.

### 1c. Background writers that do not unmount

Each of these gets an explicit early return while `loadPending` is true. Each gets a test that it does not
write during a pending load and does write once the load settles:

1. the insight reconcile effect (`task-manager.tsx`, debounced);
2. the insight-recommendation background runner and on-demand generate (`use-insight-recommendations.ts`;
   tell the peer first);
3. calendar auto-push (`use-calendar-integrations.ts` → `useCalendarAutoSync` / non-interactive
   `useEntityCalendarPush`);
4. calendar auto-pull (`useCalendarAutoPull` / background `useEntityCalendarPull`);
5. the undo/redo hotkey (`useUndoHotkey`).

The planner re-verifies this list against the tree (the writer inventory in
`fix/data-loss-batch:docs/superpowers/plans/2026-09-19-data-loss-batch.md`, appendix "§548 — deferred
design notes", is the starting point, not an authority).

### 1d. SharePoint load timeout (revision 2026-09-19)

A load that never settles would keep the hold up with no way to reach Settings. Turso loads already fail
after `LOAD_TIMEOUT_MS` (10 s). Its AbortController timer, and the rule that the response body is read
inside the armed window, move into one shared helper that both Turso and the SharePoint Graph load use with
the same 10 s. A timed-out SharePoint read throws the same kind of plain `Error` that SharePoint already
throws for a failed HTTP status. The load effect's `catch` then settles the load and shows the existing
`storageLoadFailed` toast and the generic storage banner. No new i18n string. Token acquisition (the MSAL
popup) is not bounded: it waits on the user, who can close it, and closing it rejects.

### 1e. Settings hydration always completes (revision 2026-09-19)

`useSettings` sets `hydrated` in a `finally` after the secret merge (`migratePlaintextSecrets` +
`hydrateSecretsInto`). A throw there already falls back to the in-memory settings, so it reaches
`setHydrated(true)`. A merge that never settles (for example an IndexedDB open queued behind another
connection) would leave `hydrated` false forever, and with the hold that means a permanent skeleton. The
merge is raced against a bound (`SECRET_MERGE_TIMEOUT_MS`, 5 s). On timeout it falls back exactly like the
throw path and logs a diagnostic.

**Tests:**
- Hook: `loadPending` is true before hydration, and true before the first load settles and false after, in
  each of the four settle branches. It turns true again on a backend rebuild.
- All nine held ops, table-driven: `loadPending` is true while the op waits on its first awaited step,
  false after the op resolves, and false after it throws. Removing any one op's wrap turns its row red.
- Hydration: `hydrated` becomes true when the secret merge throws, when IndexedDB is unavailable, and after
  the bound when the merge never settles.
- SharePoint: a never-resolving Graph fetch fails the load at 10 s and not before. The hook then settles
  (`loadPending` false, saving paused, `storageLoadFailed` toast), and a failed load renders the app with
  the storage banner.
- Render: the main window shows the skeleton and no app chrome while pending, and also before hydration. A
  hanging or failing secret merge still lifts it. A popout never shows it.
- The §548 reproduction: an edit cannot be made during a pending load (no control rendered), and the loaded
  data is what shows after.
- e2e: a Playwright spec with a delayed load shows the skeleton, then the app.

## 2. §591 — replace, don't merge, after a target change

**Where:** `src/app/use-storage-backend.ts` (load effect + `reloadCurrentProject`).

- `storageTargetKey`: a pure function of the settings deriving a stable string from the storage kind plus
  EITHER the Turso `databaseUrl`, `authToken` and `tursoProjectId`, OR the SharePoint hostname, site path
  and item path (or the local-file/IndexedDB identity). It deliberately EXCLUDES `auth.acquireToken`: an
  M365 sign-in or sign-out rebuilds the backend against the SAME target and must keep merging.
- The target key of the last applied load is kept in a ref. The load effect and `reloadCurrentProject` pass
  `logMode = "merge"` only when the current key equals that ref. Otherwise they pass `"replace"`. An unknown
  or absent previous key counts as a change (`"replace"`). `applyWorkspace`'s own header records why:
  wrongly merging leaks another project's audit trail, while wrongly replacing loses at most a bounded
  in-flight append.
- A token-only Turso edit on the same URL counts as a new target. The app cannot tell "same database, new
  token" from a switch.
- Project ops keep passing the default `"replace"`. The kind switch keeps writing the current workspace
  verbatim (same project).

**Tests** (extend `use-storage-backend.load-gate.test.tsx` (e)/(h) or siblings):
- Turso URL change onto a populated target: `activityLog` and `budgetHistory` are the target's own.
- SharePoint same-kind target change onto a populated target: same.
- Rebuild onto an empty target, then "Reload project": both slices replaced, as the confirm text promises.
- `acquireToken`-only rebuild: an entry appended locally during the load is still MERGED (the
  anti-overcorrection pin).

## 3. §577 — budget-variance insight compares budget to date

**Where:** `src/app/insights/detect.ts` (`budgetVarianceInsight`, `detectInsights`), reusing
`budget-report.ts` primitives.

- `detectInsights` passes its `today` into `budgetVarianceInsight`.
- Per bucket, budget-to-date = the sum of `effectiveBudgetHours` over `bucketActivePeriods(bucket, plan)`
  filtered to periods whose start is ≤ `today`. That is the same per-period rule (including
  budget-follows-plan) that the report and the burn-down chart use, and the same cutoff as
  `computeBurndownSeries`' `todayIndex`. Actuals are unchanged (already to date).
- A bucket with zero actual hours is left out of the breach count and out of "worst". A bucket whose window
  starts in the future has zero budget-to-date and is skipped by the existing `budgetHours <= 0` guard.
- Closed buckets are not special-cased. Periods are filtered by date, not status.
- No separate "unstarted bucket" signal (YAGNI).

**Tests:** a regression test with an open bucket budgeted into future months and zero actuals, next to a
real overspend. The overspend is "worst", and the untouched bucket neither breaches nor wins. A test that
future-only periods do not count. The existing four `budgetVariance` tests stay green.

## 4. §573 — refresh the Open Points visual baseline

- Run `npx playwright test e2e/visual.spec.ts --project=visual -g "Open Points"`, eye-check the actual
  screenshot, then re-run with `--update-snapshots` and commit
  `e2e/visual.spec.ts-snapshots/open-points-visual-win32.png`. Always go through the spec: it seeds
  `tourSeen` and masks the version label.
- Do this LAST, after §548 lands, because the skeleton hold changes what the app shows before the load. The
  spec waits for the loaded app.
- No CI job runs the visual project, so this has no pipeline effect.

## Docs and register

- `docs/AGENTS/`: document `loadPending` (and why it is not `workspaceLoaded`), the render hold, the
  background-writer checks, and target-key merging. Update the `applyWorkspace` / `logMode` notes wherever
  they are documented (`activity-log.md`).
- Close §548, §591, §577 and §573 in `docs/open-followups.md` (`— CLOSED 2026-09-19` style) and DELETE each
  entry's `**Work item:**` line. Run `npm run followups:workitems:check`, `followups:index:check` and
  `followups:status:check`. Close #336, #375, #362 and #358 after merge, verifying each one's state.
- CHANGELOG entry and version bump at release time only.

## Out of scope

- Per-slice load merging of in-flight edits (rejected by user ruling).
- Changing `guardEdit` or the popout read-only model.
- Linux visual baselines / a CI visual job.
- A cross-project `bucket` to-date primitive in `computeBucketReport` (larger blast radius; the detector
  filters periods itself).

## Order

§591 (hook only) → §548 signal (with all nine ops tested) → settings hydration bound → SharePoint load
timeout → §548 render hold + background writers → §577 → docs/register → §573 last. The two bounds land
before the render hold, so the hold never ships without them.
