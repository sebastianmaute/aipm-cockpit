<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# Diagnostics · guards · dictation · AI master switch

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
- **Usage-limit notices + counting knobs (★★ security):** pure `ai-errors.ts` — `classifyAiError(status, errorType)` → `"limit"|"auth"|"network"|"parse"|"generic"` (429 or Anthropic `error.type` `rate_limit_error`/`overloaded_error` ⇒ limit), the `AiHttpError(status, errorType?)` class (message is STATUS-ONLY), and `safeAiErrorType(body)` (reads ONLY `error.type`, never the body message; can't throw). `callClaude` throws `AiHttpError` on `!ok` (the old body-slice leak is GONE); all 6 AI call sites classify + surface a distinct translated `aiUsageLimitReached` for `"limit"`. ★★ NEVER log/echo the key or response body anywhere. Behaviour is ADVISORY — never blocks: the 100%-of-self-cap notice (`crossed100` in `usage-warning.ts` → `aiSelfLimitReached` toast) and the 429 notice both just inform. Chat APPENDS a `notice` DisplayItem (`setDisplay(prev=>[...prev,…])`) — never clears history. `AiConfig` gained `maxChatTurns` (default 12; ★ clamp via the SINGLE `clampMaxChatTurns` in `settings-types.ts`, used by `sanitizeAiConfig` + the `CapInput` onChange + the `chat-panel` loop read site — a directly-typed out-of-range value must never drive unbounded billed calls) and `tokenMultiplier` (default 5). ★★ the multiplier is applied ONCE up-front in `ai-usage-context.record()` to a `scaled` usage fed to BOTH the session total AND `addToBuckets` (weekly) — scaling only one puts the two caps on different scales.
- **Rate card = DAY rates are the source of truth (★★):** `Role` has `internalRateDay?`/`externalRateDay?`/`rateBasis?:"day"|"hour"`; `internalRate`/`externalRate` stay HOURLY and remain the cost-math source every consumer reads (`resource-cost`/`budget-report`/EVM/reports UNCHANGED) — they are DERIVED. Pure `role-rates.ts` `materializeRoleRates(role, workdayHours)`: basis `"day"` → hourly = round2(day/wdh); basis `"hour"` → day = round2(hourly·wdh); guards `wdh<=0 → 8`. `roles-editor.tsx` edits materialize on change; "clear the filled cell to switch" flips `rateBasis`; the hour-basis day cell ALWAYS live-recomputes (never a frozen `internalRateDay`). ★★ `sanitizeRole` SPARSE-emits `rateBasis` (only `"day"`; absent⇒`"hour"`) + sparse day fields, so legacy roles stay byte-identical (an always-emit broke round-trip); consumers read `role.rateBasis ?? "hour"` / `=== "day"`. New columns ride `ROLES_CSV_COLUMNS` (auto CSV + Turso single/tenant + turso-migrate self-heal — roles ∈ ENTITY_SPECS, NO special migrate edit) + `ROLES_MD_COLUMNS`; golden regen roles-only; sample `rateBasis:"day"` synthesized in the gen script. ★★ `task-manager.tsx` re-materializes day-basis roles when `settings.resources.workdayHours` changes (guarded RENDER-TIME reconcile, NOT an effect) so the derived hourly can't go stale.
- **Budget bucket earned value (Phase C EVM, ★):** `BudgetBucket` gained `taskIds?: number[]` (tasks whose completion drives the bucket's derived progress) + `percentComplete?: number` (manual 0-100 override — WINS over the derivation whenever set, including 0). Both ride `BUDGETS_CSV_COLUMNS` (→ CSV + Turso single/tenant DDL/insert, turso-migrate self-heals existing DBs) and `BUDGETS_MD_COLUMNS`, and are SPARSE-emitted so a bucket that never sets them stays byte-identical (no golden regen for untouched buckets). Pure i18n-free `budget-earned-value.ts`: `bucketPercentComplete(bucket, tasks)` (manual value first; else the share of `taskIds` that are `isTaskFinished` — Done|Cancelled — among the ones still present in `tasks`; `null` when neither source resolves — never guesses) and `earnedValueFor(budgetedCost, pct)` (= budgetedCost × pct/100, `null` when `pct` is `null`). `budget-report.ts` folds `earnedValue`/`costPerformanceIndex` (= earnedValue ÷ actual cost, guarded on `cost > 0`) into both `BucketReport` and the project rollup; `costPerformanceIndexHealth` (`budget-health.ts`) bands the TRUE 0-1 EVM ratio (R<0.8, A<0.9, G>=0.9 — same thresholds as the pre-existing `costPerformanceHealth` percent-flavor, just on a different scale, so the two never collide). ★★ PROJECT ROLLUP IS ALL-OR-NOTHING: `projectEarnedValue`/`projectCostPerformanceIndex` are `null` unless EVERY relevant budgeted bucket has a known `earnedValue` — one un-scored bucket blanks the whole rollup rather than silently summing a partial figure (mirrors the panel's `costIsKnowable` anti-approximation stance from the 0.195.x McGuire line). The Budget panel's fourth Cci tile ("Cost performance (CPI)", `budgetCciCpi` — the key freed when the old BAC/AC tile was renamed "Cost burn"/`budgetCciBurn` in 0.195.x) renders "—" whenever `costPerformanceIndex` is `null`. The bucket editor modal's task-link field reuses the shared `TaskLinkPicker` chip picker (same primitive as RAID/Change linked-tasks) — do not hand-roll a new one; clearing the manual % writes `undefined`, not `0`, mirroring the rate-override clear-to-undefined pattern.
- **Integration disclaimer:** `integration-disclaimer.tsx` — a one-time security note shown the FIRST time any enable checkbox is ticked (AI/Jira/M365/Turso/Timelog). Context provider (no-op default) so the five checkboxes fire `useIntegrationDisclaimer().notifyEnable()` without prop-threading; gated by per-device `settings.integrationDisclaimerSeen`. Mounted at SettingsView + backend-setup-wizard + backend-config-modal. ★ memoize the context value (`useCallback`+`useMemo`) — an unstable value re-fires. NOT shown in popouts.
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

