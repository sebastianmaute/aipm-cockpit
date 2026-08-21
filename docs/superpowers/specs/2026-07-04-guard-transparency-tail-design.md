# Guard Transparency Tail (A-tail) — Design

**Goal:** Surface the 8 remaining worthwhile silent-failure / capability-gap sites the first guard-transparency pass (A) deferred, reusing A's merged `guard-feedback` helpers — plus fix four ignored-return bugs on the recovery page where a *failed* reset/restore currently reports success.

**Context:** Follow-up to sub-project A (merged). A shipped `reportSilentFailure(showToast, lang, code, err, msgKey)` + `reportCapabilityGap(showToast, lang, code, guidanceKey)` (in `guard-feedback.ts`) over B's `logDiag`, and wired 8 high-value sites. This A-tail wires the audit-identified remaining 8. Additive-only feedback; the recovery sites additionally FIX ignored return values (a real correctness bug, not just missing feedback).

**Scope decision (approved):** wire all 8. Toast-surface sites use the helpers; recovery-page sites (no ToastProvider) surface via the panel's own `setMessage` + a direct `logDiag`.

---

## Two wiring flavors

- **Toast sites** (a `showToast`+`lang` scope exists): `reportSilentFailure`/`reportCapabilityGap` (toast + logDiag). Sites #1, #5, #6, #8.
- **Recovery sites** (`recovery-panel.tsx` / `recovery-banner.tsx` — no ToastProvider; they show a `setMessage` string): call `logDiag("error", code, {...})` directly + set the failure message. Sites #2, #3, #4, #7. These also FIX an ignored return value.

## Target sites

### #1 — M365 sign-in/out failure (toast) — `msauth.signInFailed`
`use-ms-auth.ts` `signIn`/`signOut` have no try/catch and callers `void` them (`integrations-section.tsx`, `storage-config.tsx`, `task-manager.tsx`). A blocked popup → unhandled rejection, no in-the-moment feedback. Wire at the CALL SITES (which have `showToast`+`lang`): `void auth.signIn().catch((e) => reportSilentFailure(showToast, lang, "msauth.signInFailed", e, "guardMsSignInFailed"))`. Apply to each `void auth.signIn()/signOut()` call site that has a toast scope. Key `guardMsSignInFailed` = "Microsoft sign-in didn't complete. Check for a blocked pop-up and try again."

### #2 — recovery reset failure (recovery message + FIX) — `recovery.resetFailed`
`recovery-panel.tsx` `onReset`: `quarantineConfig()` returns `{ ok: boolean }` but the result is discarded; UI shows success + navigates regardless. FIX: check the result; on `!ok`, `logDiag("error", "recovery.resetFailed", {})` + `setMessage(t(lang,"guardRecoveryResetFailed"))` and DO NOT navigate/claim success. Key `guardRecoveryResetFailed` = "Reset didn't complete — your configuration may still be broken. Try again or use the manual steps below."

### #3 — recovery-banner reset failure (same) — `recovery.resetFailed`
`recovery-banner.tsx` `onResetNow`: same ignored `quarantineConfig()` result on the in-app safe-mode banner. FIX the same way (surface via the banner's own message/UI + `logDiag`). Reuse `guardRecoveryResetFailed`.

### #4 — recovery restore failure (recovery message + FIX) — `recovery.restoreFailed`
`recovery-panel.tsx` `onRestore`: `restoreConfig(latest.id)` returns `boolean`, discarded; UI shows "Restore done" regardless. FIX: on `false`, `logDiag("error", "recovery.restoreFailed", {})` + `setMessage(t(lang,"guardRecoveryRestoreFailed"))`, no success claim. Key `guardRecoveryRestoreFailed` = "Restore didn't complete — the backup may be corrupt or storage is unavailable."

### #5 — FX refresh failure (toast) — `fx.refreshFailed`
`useFxRates` exposes an `error` field that `task-manager.tsx` drops at the destructure (`{ refresh: refreshFx, loading: fxLoading }` — no `error`). Thread `error` (as `fxError`) → `BudgetPanel`, and when the refresh button's action ends with a non-null error, toast it. Simplest: in the FX refresh click handler / an effect keyed on the fx error, `reportSilentFailure(showToast, lang, "fx.refreshFailed", new Error(fxError), "guardFxRefreshFailed")` when `fxError` transitions to set after a user-triggered refresh. If threading the transition is heavy, wrap the refresh call: `refreshFx().catch(...)` if it returns a promise; otherwise thread `error` to BudgetPanel and toast on it. Key `guardFxRefreshFailed` = "Couldn't refresh exchange rates. Currency conversions may be stale or missing."

### #6 — export failure (toast) — `export.failed`
`exportWorkspace(...)` is `void`ed at `export-menu.tsx` + `task-manager.tsx` with no catch; a dynamic-import chunk-load failure or a builder throw → silent no-download. Wire `.catch` at both call sites (both have `showToast`+`lang`): `void exportWorkspace(...).catch((e) => reportSilentFailure(showToast, lang, "export.failed", e, "guardExportFailed"))`. Key `guardExportFailed` = "Export failed — nothing was downloaded. Please try again."

### #7 — recovery backup-download failure (recovery message + FIX) — `recovery.backupDownloadFailed`
`recovery-panel.tsx` `downloadJson` swallows the blob/anchor failure with a comment and no `setMessage` — right before an irreversible reset. FIX: in that catch, `logDiag("error", "recovery.backupDownloadFailed", {})` + `setMessage(t(lang,"guardRecoveryBackupDownloadFailed"))`. Key `guardRecoveryBackupDownloadFailed` = "Couldn't download the backup file. Copy the on-screen data manually before resetting."

### #8 — Jira issue-types load failure (toast, capability-ish) — `jira.issueTypesLoadFailed`
`jira-settings.tsx` project-key-change effect: `listIssueTypes` failure silently resets `issueTypes=[]`, indistinguishable from "no issue types". This runs in an EFFECT (project change), not a direct click — but it's a user-initiated project selection. Wire in that catch: `reportSilentFailure(showToast, lang, "jira.issueTypesLoadFailed", e, "guardJiraIssueTypesFailed")` (the component has `showToast`+`lang`). Key `guardJiraIssueTypesFailed` = "Couldn't load issue types for this project. Jira sync may not pick up the types you expect — try reselecting the project."

## i18n
Six new keys (four codes reuse — `recovery.resetFailed` is shared by #2/#3, so 7 messages / but `guardRecoveryResetFailed` shared → 6 distinct keys): `guardMsSignInFailed`, `guardRecoveryResetFailed`, `guardRecoveryRestoreFailed`, `guardFxRefreshFailed`, `guardExportFailed`, `guardRecoveryBackupDownloadFailed`, `guardJiraIssueTypesFailed` — 7 keys. EN in `i18n.ts`, DE via node utf8 write (umlaut landmine).

## Boundary / error handling
- Additive feedback everywhere; the recovery sites ALSO fix a correctness bug (ignored failure return → no longer falsely claim success).
- No new persistence, no new secret, no proxy, no CSP.
- Recovery pages have no ToastProvider → use `setMessage` + `logDiag` there (NOT the toast helpers).

## Testing
- Toast sites (#1/#5/#6/#8): force the underlying call to reject/error → assert a `logDiag` event with the code (via `readDiagLog`) AND `showToast("error"/"info", ...)`. Use `vi.waitFor` for async `.catch`.
- Recovery sites (#2/#3/#4/#7): mock `quarantineConfig`→`{ok:false}` / `restoreConfig`→`false` / the download to throw → assert the failure message is set (not the success one) + a `logDiag` event. These are the correctness-bug regression tests (previously they'd assert success).
- i18n EN/DE parity (tsc) + `i18n-encoding`.

## Out of scope
- The correctly-silent catches (quota/abort/best-effort) — untouched.
- Any site already surfacing errors (calendar/comm-send/AI/import) — untouched.
- Extending the toast contract or the recovery message UI — reuse both as-is.
