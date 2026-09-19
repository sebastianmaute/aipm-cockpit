<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# Diagnostics · guards · dictation · AI master switch · the load hold

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

### Diagnostics log · guard transparency · dictation

- **Diagnostic log (`diagnostics.ts`):** `logDiag(level, code, fields?)` → a capped (200) per-device ring
  `aipm-cockpit:diag-log` — OUT of workspace exports/Turso/recovery `CONFIG_KEYS`, swept by `clearAppConfig`'s
  `aipm-cockpit:*` sweep, NEVER holds secrets. ★★ Level-aware eviction (drops oldest `info` first so rare
  `warn`/`error` survive an info/error storm). ★★ Redaction (`diagnostics-redact.ts`) is TWO-layer: a
  secret-KEY denylist (key normalized before match) AND a secret-VALUE scrub (`sk-ant-*`/`Bearer`/JWT/
  `ATATT…`/`Basic <base64>`/`key=value`) — the EXPORTED bundle (`buildDiagnosticBundle`) must never carry a
  secret. Inspect via `window.__aipmDiag()`. Panel = Settings → Diagnostics (level/code filter + summary;
  ★ Copy/Download export the FULL ring, never the filtered view). `dataloss-forensics.ts` folds in under
  `dataloss.*` codes. ★ load() must THROW on a malformed/partial read, never mask it as an empty project
  (`relationalReadIsEmpty`); the save effect refuses a full-wipe / mass-deletion over a populated project
  unless `allowDestructiveSave()` armed (clear-all self-arms) — the data-loss defense.
  ★★★ **NO AUTOMATIC SAVE RUNS BEFORE A LOAD FOR THE CURRENT BACKEND HAS BEEN APPLIED (§586, §587).** Before it,
  render scope holds the EMPTY boot workspace — or, after a settings-driven rebuild (an applied Turso
  URL/token change, a SharePoint target change), the PREVIOUS target's — and that guard cannot see it: its
  baselines start at 0/0, or equal the previous project's counts. So a pre-load save was a Turso
  `DELETE FROM` every table, or a copy of one project over another. `savesAllowedFor` in
  `use-storage-backend.ts` is an identity like `loadedBackend`, opened where `loadedBackend` is stamped
  plus after an explicit "Pick storage file" write. It is checked by the save effect, by `doSave` (the
  debounce timer AND flush-on-hide both call it) and by the pre-switch `flushCurrent`; a storage-kind
  switch skips its conversion write while it is shut (nothing is copied; the new backend loads). A failed load, and an empty load REFUSED over populated
  scope, leave it shut for that backend and publish `loadPause`, which task-manager mounts on the
  STICKY `SavingPausedBanner` (a `load` cause whose action is "Reload project") — never a toast
  alone, which times out. A new path that writes the live workspace to the ACTIVE backend must check
  the gate too. ★ EXPLICIT writes are outside it: "Pick storage file" (§590), a conversion after a
  successful load, create and load-from-file.
- **Guard transparency (`guard-feedback.ts`):** `reportSilentFailure(showToast, lang, code, err, msgKey)`
  (error toast + `logDiag`) / `reportCapabilityGap(showToast, lang, code, guidanceKey)` (info toast +
  `logDiag`) — the pattern for surfacing a swallowed user-action failure or an off/unconfigured-feature
  no-op. Recovery pages (no ToastProvider) use `logDiag` + `setMessage` instead. ★ ADDITIVE — wire
  alongside the existing bail; never change control flow (except the recovery ignored-return fixes).
- **Dictation (push-to-talk):** `voice.ts` gained a NON-breaking `continuous?` flag + exported `getCtor`;
  `dictation-engine.ts` = the `DictationEngine` interface + pure `appendDictation`; `resolveDictationEngine(
  dictation, lang)` (`dictation-config.ts`) picks `web-speech-engine` (free, browser) vs `stt-engine`
  (OpenAI-compatible; `MediaRecorder` → `/api/stt`). `usePushToTalk` (hold/tap 250ms threshold; exposes
  `press`/`release`) → `useDictationMic` (shared mic button + interim/transcribing preview + centralized
  mic-denied/stt/unsupported toasts) used by chat + the 5 edit-modal prose textareas + prose single-line
  inputs. ★★ `dictation-target.ts` = ONE active target (registered on field focus, cleared on blur/unmount,
  clear-ONLY-if-active); the global hold-to-talk hotkey (`use-dictation-hotkey.ts`, configurable
  `settings.dictation.hotkey`, default `F4`) remote-triggers the focused field's mic — captures the pressed
  target so a mid-hold focus change / window blur can't strand it. ★★ Web Speech fires `onFinal` MULTIPLE
  times per hold → a field's `onAppendFinal` MUST read the LATEST state (functional setter or a ref), else
  each segment overwrites the last (bit RAID/change/stakeholder). ★★ `useDictationMic`'s `target` useMemo must
  be identity-STABLE (route `press`/`release` through refs) or the unmount-cleanup effect nulls the live
  target every render (bit the hotkey).
- **`/api/stt` proxy (`api/stt/route.ts` + `_helpers.ts`):** browser → same-origin `/api/stt` (NO new CSP
  host); REUSES `proxy-ssrf` `isPrivateHost` + https-only on the USER-configured BYO base URL (no fixed
  apex allowlist — inherent BYO residual, documented), REFUSES upstream redirects (3xx→502, closes
  redirect-SSRF), content-length + post-parse file-size cap (25MB), Bearer key only outbound, never logged.
  `settings.dictation` = `{ engine: "web-speech"|"stt", sttBaseUrl?, sttModel?, sttApiKey?(sealed 5th SecretId), hotkey? }`.

### AI master switch + integration disclaimer

- **AI master switch:** `settings.ai.enabled` (default OFF, even for existing users) gates ALL AI features. Use `isAiEnabled(settings.ai)` (enabled && key present) / `aiKeyIfEnabled(settings.ai)` — NOT a raw `apiKey` read — at every AI activation site (chat, action analysis, scheduled jobs, weight suggestions, create-wizard). `sanitizeAiConfig` sets `enabled: obj.enabled === true`. AiSection collapses its config body until enabled.
- **Usage-limit notices + counting knobs (★★ security):** pure `ai-errors.ts` — `classifyAiError(status, errorType)` → `"limit"|"auth"|"network"|"parse"|"generic"` (429 or Anthropic `error.type` `rate_limit_error`/`overloaded_error` ⇒ limit), the `AiHttpError(status, errorType?)` class (message is STATUS-ONLY), and `safeAiErrorType(body)` (reads ONLY `error.type`, never the body message; can't throw). `callClaude` throws `AiHttpError` on `!ok` (the old body-slice leak is GONE); every AI call site (`grep -rln "classifyAiError(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`, which also lists the definition in `ai-errors.ts`) classifies + surfaces a distinct translated `aiUsageLimitReached` for `"limit"`. ★★ NEVER log/echo the key or response body anywhere. Behaviour is ADVISORY — never blocks: the 100%-of-self-cap notice (`crossed100` in `usage-warning.ts` → `aiSelfLimitReached` toast) and the 429 notice both just inform. Chat APPENDS a `notice` DisplayItem (`setDisplay(prev=>[...prev,…])`) — never clears history. `AiConfig` gained `maxChatTurns` (default 12; ★ clamp via the SINGLE `clampMaxChatTurns` in `settings-types.ts`, used by `sanitizeAiConfig` + the `CapInput` onChange + the `chat-panel` loop read site — a directly-typed out-of-range value must never drive unbounded billed calls). ★★ Usage is stored RAW and weighted at READ: `record()` writes the API's own four counts straight into the session usage and `addToBuckets`, and `usageCostEquivalent` (`ai-usage.ts`, weights in `USAGE_COST_WEIGHTS`) prices them for BOTH the session total AND `weekToDate` — one pricing function, so the two caps cannot land on different scales. ★★ A blunt whole-request token multiplier setting, applied at WRITE time, was retired here and must not be reintroduced: scaling before persistence made a re-basing permanent, because the factor in force at write time was never recorded beside the numbers, so stored buckets could not afterwards be re-interpreted.
- **Rate card = DAY rates are the source of truth (★★):** `Role` has `internalRateDay?`/`externalRateDay?`/`rateBasis?:"day"|"hour"`; `internalRate`/`externalRate` stay HOURLY and remain the cost-math source every consumer reads (`resource-cost`/`budget-report`/EVM/reports UNCHANGED) — they are DERIVED. Pure `role-rates.ts` `materializeRoleRates(role, workdayHours)`: basis `"day"` → hourly = round2(day/wdh); basis `"hour"` → day = round2(hourly·wdh); guards `wdh<=0 → 8`. `roles-editor.tsx` edits materialize on change; "clear the filled cell to switch" flips `rateBasis`; the hour-basis day cell ALWAYS live-recomputes (never a frozen `internalRateDay`). ★★ `sanitizeRole` SPARSE-emits `rateBasis` (only `"day"`; absent⇒`"hour"`) + sparse day fields, so legacy roles stay byte-identical (an always-emit broke round-trip); consumers read `role.rateBasis ?? "hour"` / `=== "day"`. New columns ride `ROLES_CSV_COLUMNS` (auto CSV + Turso single/tenant + turso-migrate self-heal — roles ∈ ENTITY_SPECS, NO special migrate edit) + `ROLES_MD_COLUMNS`; golden regen roles-only; sample `rateBasis:"day"` synthesized in the gen script. ★★ `task-manager.tsx` re-materializes day-basis roles when `settings.resources.workdayHours` changes (guarded RENDER-TIME reconcile, NOT an effect) so the derived hourly can't go stale.
- **Budget bucket earned value (Phase C EVM, ★):** `BudgetBucket` gained `taskIds?: number[]` (tasks whose completion drives the bucket's derived progress) + `percentComplete?: number` (manual 0-100 override — WINS over the derivation whenever set, including 0). Both ride `BUDGETS_CSV_COLUMNS` (→ CSV + Turso single/tenant DDL/insert, turso-migrate self-heals existing DBs) and `BUDGETS_MD_COLUMNS`, and are SPARSE-emitted so a bucket that never sets them stays byte-identical (no golden regen for untouched buckets). Pure i18n-free `budget-earned-value.ts`: `bucketPercentComplete(bucket, tasks)` (manual value first; else the share of `taskIds` that are `isTaskFinished` — Done|Cancelled — among the ones still present in `tasks`; `null` when neither source resolves — never guesses) and `earnedValueFor(budgetedCost, pct)` (= budgetedCost × pct/100, `null` when `pct` is `null`). `budget-report.ts` folds `earnedValue`/`costPerformanceIndex` (= earnedValue ÷ actual cost, guarded on `cost > 0`) into both `BucketReport` and the project rollup; `costPerformanceIndexHealth` (`budget-health.ts`) bands the TRUE 0-1 EVM ratio (R<0.8, A<0.9, G>=0.9 — same thresholds as the pre-existing `costPerformanceHealth` percent-flavor, just on a different scale, so the two never collide). ★★ PROJECT ROLLUP IS ALL-OR-NOTHING: `projectEarnedValue`/`projectCostPerformanceIndex` are `null` unless EVERY relevant budgeted bucket has a known `earnedValue` — one un-scored bucket blanks the whole rollup rather than silently summing a partial figure (mirrors the panel's `costIsKnowable` anti-approximation stance from the 0.195.x McGuire line). The Budget panel's fourth Cci tile ("Internal cost index", `budgetCciInternalCostIndex`) renders "—" whenever `costPerformanceIndex` is `null`. ★★ THAT KEY HAS BEEN RENAMED THREE TIMES. The name budgetCciCpi was first FREED when the old BAC/AC tile was renamed "Cost burn"/`budgetCciBurn` in 0.195.x, then CLAIMED by this EV/AC tile — which left two DIFFERENT quantities labelled CPI a click apart: this MONEY ratio (earned value ÷ cost) and the EVM HOURS ratio `evmCpi` (ev ÷ ac) on the Dashboard and the Budget report. THE SECOND RENAME (`docs/open-followups.md` §464) is why a bare "CPI" stopped naming this tile at all: CPI stayed with EVM and this tile became "Cost recovery"/budgetCciRecovery — deliberately un-backticked, like the rest of this paragraph's dead spellings (see below). THE THIRD RENAME, in the forecast-figures MR, is why "Cost recovery" itself is gone: that MR (`docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` §11 "Three indices, one word") introduced a THIRD, price-based CPI/SPI pair on the forecast cards, so a bare "CPI"/"SPI" now means THAT index everywhere in the app — this tile was renamed again to "Internal cost index"/`budgetCciInternalCostIndex`, and the EVM hours ratio — key `evmCpi`/`evmSpi`, unchanged — is now rendered "Effort CPI"/"Effort SPI" so it reads unambiguously wherever it appears (Dashboard, Budget report, next-actions, trends). ★ The dead spellings budgetCciCpi, budgetCciCpiHint, budgetCciRecovery and budgetCciRecoveryHint are deliberately un-backticked in this paragraph: all four were RENAMED out of the codebase, and `docs:symbols:check` fails on a backticked mixed-case name that exists nowhere in `src`. The bucket editor modal's task-link field reuses the shared `TaskLinkPicker` chip picker (same primitive as RAID/Change linked-tasks) — do not hand-roll a new one; clearing the manual % writes `undefined`, not `0`, mirroring the rate-override clear-to-undefined pattern.
- **Integration disclaimer:** `integration-disclaimer.tsx` — a one-time security note shown the FIRST time any enable checkbox is ticked (AI/Jira/M365/Turso/Timelog). Context provider (no-op default) so each enable checkbox, including the digest toggle, fires `useIntegrationDisclaimer().notifyEnable()` (`grep -rn "notifyEnable()" src/app --include=*.tsx | grep -v "\.test\."`) without prop-threading; gated by per-device `settings.integrationDisclaimerSeen`. Mounted at SettingsView + backend-setup-wizard + backend-config-modal. ★ memoize the context value (`useCallback`+`useMemo`) — an unstable value re-fires. NOT shown in popouts.
- **Jira lives INSIDE Integrations:** `IntegrationsSection` renders `JiraSettingsSection` (below Timelog) gated on `!hideJira`; the wizard passes `hideJira` (it has a dedicated Jira step). `settings.jira` stays TOP-LEVEL.
- **Multi-project Jira sync (per-project read-only):** `settings.jira` keeps a single PRIMARY `projectKey` (two-way,
  the create target + issue-type/user-picker source) PLUS `extraProjects: {key,name,readOnly}[]` (opt-in reads, each
  with its own read-only flag, default read-only ON). Pure dep-light `jira-projects.ts` (kept OUT of the lazy
  `jira-api.ts` so `use-settings`/badge/settings-UI import it cheaply): `jiraProjectKeyOf`, `jiraProjectKeys` (deduped
  union), `isReadOnlyIssue` (primary→false, extra→its flag, UNKNOWN/removed project→**true**), `sanitizeJiraExtraProjects`
  (drops primary-colliding/dup/`[A-Za-z0-9_]`-invalid keys, default readOnly true, cap 20). `buildJql` unions keys →
  `project in (...)` (single-project BYTE-IDENTICAL). ★★ `isReadOnlyIssue` is the SINGLE classifier across ALL surfaces
  — sync, conflict-resolution guard, badge, editor banner (thread `projectKey`+`extraProjects`, NOT a pre-filtered
  key list, or the surfaces diverge for a removed project). Read-only rows in `use-jira-sync` are PULL-ONLY: never
  `updateIssue`/`transitionIssueTo`, never queue a conflict; always pull (revert stray local edits, clear
  `localModifiedAt`), local-only fields (blockers/group/inquiriesSent) preserved. ★ `sanitizeJiraExtraProjects` runs on
  the settings LOAD merge in `use-settings.ts` (JiraConfig otherwise has NO sanitizer). ★★ PERSISTENCE: `extraProjects`
  rides `settings.jira` via the `writeSettings` spread — per-device, NOT a Workspace field: OUT of exports/Turso/CSV/MD,
  no six-write-path, no golden fixture. Settings UI = checkbox list + per-row read-only toggle + a degraded-state
  fallback (manage/remove configured extras when the project list isn't loaded); row-unique aria-labels (Settings is
  axe-scanned). Editor read-only banner (`jira-readonly-banner.tsx`) threads to the floating `TaskFormModal`
  (via `app-modals.tsx`).

### The load hold (§548)

- **`loadPending` (`useStorageBackend`) is true until the workspace in scope is the settled project
  of the current backend**: before settings hydration (no load has started yet), until the load effect
  for the CURRENT `backend` instance reaches a terminal branch, and while any of the nine ops wrapped
  by `holdDuring` runs (`reloadCurrentProject`, `switchToProject`, `createProject`,
  `loadProjectFromFile`, `createDemoProject`, `onOpenStorageFile`, `switchToTursoProject`,
  `createTursoProject`, `migrateCurrentProjectToTurso`). ★ The pre-hydration term lives IN the signal,
  not at the render site, so every consumer below covers that window too. ★ Enumerate the wraps with
  `grep -n "holdDuring(" src/app/use-storage-backend.ts`.
- ★★★ **The hold is only safe because every wait it depends on is BOUNDED — keep it that way.**
  `hydrated` always becomes true: a throw in the secret merge falls back, and a merge that never settles
  is cut off at `SECRET_MERGE_TIMEOUT_MS` (`use-settings.ts`). Turso and SharePoint loads read through
  `fetchTextWithTimeout` (`fetch-with-timeout.ts`) with `LOAD_TIMEOUT_MS` (10 s), so a hung server
  fails the load, and a failed load settles. **A new backend, or a new await in a load path, needs the
  same bound, or it can hold the app behind the skeleton forever.** The remaining unbounded waits are
  waits ON THE USER, each settling only when dismissed: the MSAL popup in the SharePoint `getToken`
  (closing it rejects, which settles the load), and the native file picker plus the `window.confirm`
  overwrite prompt inside the held `onOpenStorageFile` (`use-storage-file-ops.ts`) — cancelling either
  one settles the op the same way.
- ★★★ **It is NOT `workspaceLoaded`.** `workspaceLoaded` stays false after a FAILED load and after the
  empty-load refusal (§77), which is right for snapshot capture and saving. Holding edits on it would
  lock the app for the whole session after one load error. `settledBackend` is stamped on EVERY terminal
  branch: applied (inside `applyWorkspace`), the suppress-branch re-stamp, the refusal and the `catch`.
  Identity, not a latch, so a rebuilt backend (project switch, kind switch, Turso or SharePoint target
  edit) starts unsettled with no reset code.
- **The render hold.** `task-manager.tsx` renders `PanelSkeleton` instead of the main-window app tree
  while `loadPending` is true (the same ternary `showTursoListLoading` uses). No control that writes
  workspace state exists during the hold, so the UI writers outside `guardEdit` are covered, and so is
  any writer added later — ★ EXCEPT the two branches ranked ABOVE the hold in that ternary,
  `SecretUnlockGate` and `ProjectEmptyState` (file mode with an empty registry keeps the latter up
  through the first load and through its own create/demo ops, whose swaps are themselves held by
  `holdDuring`). A failed or refused load settles, so the storage banner, Settings and "Pick
  storage file" stay reachable. Popouts return before this ternary and are never held. `guardEdit` /
  `makeEditGuard` are unchanged.
  ★★ The hold unmounts Settings too, so **a Settings field that feeds `useStorageBackend`'s backend memo
  must never commit per keystroke** — else the first character rebuilds the backend and the field
  vanishes under the cursor. The memo reads the Turso URL and token only for storage kind "turso",
  and `integrations-section.tsx` picks the commit model by that same kind (`tursoIsLive`):
  **on Turso storage both fields are pure drafts that ONLY the explicit Apply button commits**
  (`applyTursoDrafts`, or Enter in either field: one `onChange` for both fields, the token
  device-sealed in device mode; in passphrase mode a CHANGED token is re-sealed under the passphrase
  typed into the section's own passphrase fields (`sealUnderTypedPassphrase`) — the passphrase is never
  held in memory, so until it is typed Apply and "Save & switch" stay disabled (`tokenSealBlocked`) and each shows
  the blocked hint as its visible text and `aria-describedby`,
  else a reload + unlock would yield the OLD token, or none after the switch. ★★ When a
  passphrase-sealed record ALREADY exists, both actions first VERIFY the typed passphrase opens it
  (`typedPassphraseOpensRecord`, over `unlockSecret`) and only then commit — the verify must precede
  `commitTurso`, because a commit rebuilds the backend and the hold unmounts Settings, taking any
  later error with it. A wrong passphrase commits, seals and switches nothing, keeps every field, and
  shows `secretUnlockFailed` as a `FieldError` under the button that was pressed (in its
  `aria-describedby`); editing either passphrase field or the token clears it. While either action
  verifies, the other is disabled. So the hint reads
  `integrationsTursoApplyNeedsPassphrase` (enter the CURRENT passphrase) with a record and
  `integrationsTursoApplyNeedsNewPassphrase` (it becomes the passphrase) without one, and the
  passphrase Save button stays the one way to CHANGE the passphrase); nothing
  commits on a keystroke, blur, Tab or Escape, and unapplied drafts are discarded when the section
  unmounts. Apply is disabled while the drafts equal the stored values, so an enabled Apply is the
  "unapplied change" signal; it is the only action that commits the drafts (Remove token,
  `handleRemoveToken`, also rebuilds: it commits an empty token). ★★ The passphrase lock toggle and
  its Save seal the COMMITTED token on Turso storage (`sealableTursoToken`), never the draft:
  `hydrateSecretsInto` restores `authToken` from the sealed store at boot, so sealing a draft would
  silently apply it on the next reload.
  On any OTHER kind each keystroke commits (`commitTurso`) with no rebuild, and no Apply renders —
  that covers the hosts that configure Turso before switching the kind to it (the setup wizard,
  `BackendConfigModal` from create-project). "Test connection" probes the drafts without committing.
  (`integrations-section.backend-hold.test.tsx` pins both models against the real hook.)
  ★★ The blur-commit design this replaced — commit when focus left the credentials group — lost a
  click (WebKit does not focus a clicked button), a focus (Tab out dropped it to `<body>` after the
  remount) or a draft (an unmount with no blur) in every variant; do NOT reintroduce a blur commit.
  Edges pinned in `integrations-section.drafts.test.tsx`: Escape in a `Modal` host blurs the field
  before `onClose` (`docs/AGENTS/ui-shell.md` dismissal) and must NOT commit a Turso draft;
  "Save & switch" is itself an explicit save, so it APPLIES any unapplied drafts (the Turso option it
  offers is enabled by the drafts, and the reload means no hold can swallow anything) and waits for
  every in-flight token seal before reloading — tracked at MODULE scope (`pendingTokenSeals`),
  because the instance that started a seal may already be remounted away, and BOUNDED by
  `waitForTokenSeals` (`SECRET_MERGE_TIMEOUT_MS`; on timeout it proceeds and logs
  `settings.tursoTokenSealWaitTimedOut`); and the render-time reconcile resyncs a CLEAN draft only,
  keeping a dirty one when the stored value moves.
- ★★ **Background writers do not unmount, and each gates itself.** Today: the insight reconcile effect
  (`task-manager.tsx`), the recommendation store `applyInsightRecommendation`
  (`use-insight-recommendations.ts`), the four calendar auto-sync pushes and four background pulls plus the auto-pull runner
  (`use-calendar-integrations.ts`), and the undo hotkey (`useUndoHotkey`, read through `loadPendingRef`).
  **A new timer, interval, listener or subscription that writes workspace state must check
  `loadPending` too**; the render hold cannot reach it. ★ `useCalendarAutoPull` re-ticks when its
  `enabled` flag flips false→true (a mount-value-seeded `prevEnabledRef`, `use-calendar-auto-pull.ts`),
  so the startup background pull — gated off for the whole hold — actually runs once the load settles
  instead of waiting for the next interval or `visibilitychange`; the four `useCalendarAutoSync` pushes
  re-arm the same way on their own `active` flag. ★★ Each background writer checks `loadPending` when
  it STARTS, except the recommendation store, which checks it when it WRITES
  (`applyInsightRecommendation`'s `if (loadPending) return;`, the one choke point both the background
  runner and on-demand generate write through — a result computed during a hold is dropped, not
  queued, and the runner's next tick regenerates it).
- ★★★ **`loadPending` ANSWERS "may I START?", NOT "may I still WRITE?" — that is what the SCOPE EPOCH
  is for.** A Graph or AI call that began before a swap can resolve after the swap FINISHED, when
  `loadPending` is false again, and write the previous project's result into the new project's
  workspace. `useStorageBackend` therefore keeps a monotonic counter (`scopeEpochRef`, beside
  `scopeTargetKeyRef`) and publishes a STABLE reader `getScopeEpoch` (a `useCallback` over a ref —
  deliberately not a render value, which would re-render every consumer on each swap). `scope-epoch.ts`
  holds the shared guard: a writer captures `getScopeEpoch()` BEFORE its first await and calls
  `dropStaleScopeWrite` before it touches workspace state, which returns true and logs one
  `storage.staleScopeWriteDropped` naming the writer. Dropped, never queued — the runners regenerate.
- ★★★ **THE EPOCH'S PREDICATE IS NARROW, AND THE OBVIOUS WIDE ONE IS A BUG.** It means exactly "the
  workspace in scope has become a DIFFERENT PROJECT", not "a load is happening". The first cut bumped
  on every false→true transition of `loadPending`, which also fires for a same-target reload, a held op
  the user CANCELLED at the OS file picker, and a settings-driven rebuild onto the same target — in all
  of which an in-flight result that would have landed in the RIGHT project was dropped. It now bumps in
  exactly two places: **(a)** a load that REPLACES rather than merges, decided inside
  `resolveLogModeAndStamp` so §591's rule has one implementation and the epoch cannot drift from it;
  and **(b)** an op that put another project's data in scope — `applyWorkspaceForOp` (the wrapper the
  two project-op hooks receive as their `applyWorkspace`, covering `switchToProject` · `createProject` ·
  `loadProjectFromFile` · `createDemoProject` · `switchToTursoProject` · `createTursoProject`) and
  `onOpenStorageFile`'s ACCEPT branch, which replaces tasks+raid through raw setters. ★★ (b) is NOT
  redundant with (a): `storageTargetKey` keys `browser` and every `local-*` kind on the KIND ALONE
  (§591 ruling 3), so a file-mode project switch never moves the key. ★ `migrateCurrentProjectToTurso`
  never calls `applyWorkspace` — same project, new backend — so it correctly never bumps, and neither
  does a failed load or the empty-load refusal (nothing applied, scope still holds the right project).
  ★★ The bump is SYNCHRONOUS and immediately precedes the replacement it announces, so there is no
  instant at which the new project's workspace is in scope while the epoch still reads old. A writer
  resolving between the bump and React's commit is dropped although scope still holds the OUTGOING
  project — the conservative direction, and that write would have been replaced anyway.
- ★ **Guarded today** (`grep -rn "dropStaleScopeWrite(" src/app --include=*.ts | grep -v test` — ★★ one
  of its rows is the DECLARATION in `scope-epoch.ts`, so subtract it before quoting a count; today it
  prints 10 call sites plus that row):
  `useEntityCalendarPush` and `useOutlookCalendarPush` (TWICE each — once before any Graph mutation,
  once before the workspace write), `useEntityCalendarPull`, `useMilestoneCalendarPull`,
  `useCommitteeOutlookPush` (also twice), `useInsightRecommend` and `useInsightRecommendRunner` (per
  CANDIDATE, and the tick `break`s — every remaining candidate came from the project that just left).
  ★★ The reader is OPTIONAL at each child hook, so a caller outside the storage hook's reach keeps the
  pre-§548 behaviour and is NOT guarded: `tasks-section.tsx`'s own manual task push/pull, and the chat
  agent loop (which has no such reader at all). Both `deps` members (`CalendarIntegrationDeps` /
  `InsightRecommendationDeps`) are REQUIRED, so tsc proves `task-manager.tsx` hands the reader over.
- ★★★ **WHAT A DROPPED PUSH COSTS, and it is NOT "the next push re-links it".** For the entity and
  milestone pushes the ids just created are orphaned and the reconcile SELF-HEALS the wrong way round:
  `planEntityReconcile` / `planCalendarReconcile` put every listed event id not referenced by an item
  into `plan.delete`, so the next push in the right project DELETES the orphan and RE-CREATES the
  event — one extra delete plus one extra create, once. `planCommitteeReconcile` does NOT list Outlook
  at all: it derives `deleteEventIds` from the committee's own STORED ids, so a committee event created
  just before a drop is a **permanent orphan in the user's calendar AND a duplicate on every later
  push**, accumulating per occurrence. ★ No compensating delete is issued anywhere — a rollback that
  fails mid-way is worse than the orphan. ★★ That committee cost is the reason the predicate above is
  narrow; widening it back re-introduces the orphan for reloads and cancelled ops.
- ★★ **`confirmInsightRecommendation` awaits and then writes, and carries NO epoch guard — for a
  reason that is a CONDITION, not a property.** Closing the modal cancels nothing; the loop runs to
  completion after the unmount. It is safe only because every `ALLOWED_REC_TOOLS` dispatcher writes
  local state and does no I/O, so each `await runTool` resolves in the MICROTASK queue and the whole
  confirm finishes inside one macrotask, where no swap can interleave. The condition is written on
  `ALLOWED_REC_TOOLS` itself (`insights/insight.ts`), where a tool author will meet it: a dispatcher
  that gains a network call must bring `dropStaleScopeWrite` with it.
- ★ Pinned by `use-storage-backend.load-pending.test.tsx` (the signal, including before hydration and
  a SharePoint load that times out), `use-storage-backend.hold-ops.test.tsx` (all nine held ops: in
  flight, resolved, threw), `use-settings.hydration.test.ts` (hydration completes on a throw, without
  IndexedDB and at the bound), `fetch-with-timeout.test.ts` and `sharepoint-backend.test.ts` (the 10 s
  bound), `task-manager.load-hold.test.tsx` (render hold, pre-hydration hold, failed load with banner,
  reconcile, hotkey, popout exemption, wiring), `use-calendar-integrations.load-hold.test.ts`,
  `use-insight-recommendations.test.tsx` and `e2e/load-hold.spec.ts`. The scope epoch adds
  `scope-epoch.test.ts` (the guard), `use-storage-backend.load-pending.test.tsx` cases (h)+(i) (the
  bump, and that settling does NOT bump), and a drop + a positive control per writer in
  `use-entity-calendar-push.test.tsx`, `use-entity-calendar-pull.test.tsx`,
  `use-outlook-calendar-push.test.tsx`, `use-milestone-calendar-pull.test.tsx`,
  `use-committee-outlook-push.test.tsx`, `use-insight-recommend.test.tsx` and
  `use-insight-recommend-runner.test.ts`.
- ★ **The settings secret merge is itself bounded, and the bound has a cost.** `useSettings` races
  `migratePlaintextSecrets`/`hydrateSecretsInto` against `SECRET_MERGE_TIMEOUT_MS` (5 s; `use-settings.ts`)
  and falls back exactly like the existing throw path on a timeout, which is what keeps `hydrated`
  bounded for the hold above. The trade is user-visible: on a timeout, sealed secrets (AI, Turso, Jira,
  Timelog, STT) stay blank for the session — those features read as unconfigured, with only the
  `settings.secretMergeTimedOut` diagnostic entry saying why — and a legacy PLAINTEXT secret still
  pending sealing is blanked from `localStorage` by `writeSettings` and survives only in memory, lost on
  reload if the seal never completes. Same trade the pre-existing throw path already made.
- ★ **The Turso/SharePoint load bound is a shared module, and SharePoint's timeout is a different
  error SHAPE than Turso's on purpose.** `fetch-with-timeout.ts` (`fetchTextWithTimeout`,
  `FetchTimeoutError`, `LOAD_TIMEOUT_MS`) is the one AbortController-timer implementation; `turso-pipeline.ts`
  re-exports `LOAD_TIMEOUT_MS` so its existing importers are unchanged. On a timeout, Turso keeps its own
  `StorageNotReadyError` ("unreachable" banner); `sharepoint-backend.ts` deliberately throws a plain
  `Error` instead (reaching the generic `storageLoadFailed`/`storageSaveFailedBanner` path, not the
  Turso-worded unreachable banner), because that banner's text names the Turso database. A SharePoint
  file whose download takes longer than 10 s now fails its load — the same trade Turso already makes.
- ★ **An `IndexedDB` open BLOCKED by an older tab is bounded too, and carries no register entry.**
  `idb.ts` `openIdb` sets `db.onversionchange = () => db.close()` on every connection it resolves (so
  this tab yields to a LATER tab's own upgrade — existing callers never close a connection themselves,
  so this is the only thing that lets an older tab release one), and `req.onblocked` now REJECTS with a
  plain "IndexedDB upgrade is blocked by another open tab of this app. Close the other tabs and reload."
  Error rather than waiting for the blocking tab to close on its own; a late `onsuccess` after that
  reject closes the connection at once rather than resolving twice. This is the fix for the risk the
  plan carried as open ("an IndexedDB open that is BLOCKED keeps the skeleton up") — filed as a plan
  ruling, not as its own register entry.

