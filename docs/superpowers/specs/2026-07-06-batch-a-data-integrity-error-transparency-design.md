# Batch A — Data Integrity & Error Transparency (design)

**Goal:** Close the silent data-loss and swallowed-failure paths found in the audit so that a corrupt file never masquerades as an empty project, and every persistence/integration failure the user can act on is surfaced (toast/banner) and inspectable (Diagnostics `logDiag`).

**Theme:** "Never silently lose data; always tell the user." Almost every item wires an existing bail-out into the sanctioned `guard-feedback.ts` (`reportSilentFailure`) / `diagnostics.ts` (`logDiag`) surfaces. One item (#1) changes a codec contract; one (#4) tightens a guard; one (#2) generalizes the storage-error banner.

**Out of scope / parked:** `#39` two-tab last-writer-wins clobber (needs Web-Locks single-writer election — its own design slice, documented backlog).

**Cross-cutting constraints:**
- New user-facing strings → i18n `i18n.ts` (EN) + `i18n.de.ts` (DE) key parity (tsc-enforced). DE via node utf8 write (Edit tool corrupts umlauts/quotes), real umlauts, CRLF anchors.
- `logDiag(level, code, fields?)` — codes are dot-namespaced strings (e.g. `storage.switchFlushFailed`). Never log secret values (diagnostics redaction exists but don't rely on it for keys/tokens).
- Verify each: `npm run lint` (max-warnings=0), `npx tsc --noEmit`, `npm run test:run` (FULL — a moved literal breaks a source-scan guard in an unrelated file).
- One MR for the whole batch; released only on explicit "release".

---

## A1 — Corrupt project JSON must throw, not load as empty *(CRITICAL, #1 + #10)*

**Files:** `workspace.ts` (`jsonToWorkspace`), `local-file-backend.ts:118`, `sharepoint-backend.ts:108`.

**Problem:** `jsonToWorkspace` wraps parse + all sanitizers in `try { … } catch { return emptyWorkspace(); }` and returns empty for a non-object / missing `tasks|raid`. A truncated/corrupt file loads as a brand-new empty workspace on first load; the "don't overwrite populated state" save guard can't fire (no populated in-memory state yet), so the next autosave overwrites the real file with empty content — silent, irreversible loss. `sharepoint-backend.load()` is worse: raw `res.json() as Workspace` with no validation at all.

**Design — additive strict variant, forgiving default kept:**
- Add `export class WorkspaceParseError extends Error` to `workspace.ts` (carries a short `reason`).
- Change signature to `jsonToWorkspace(text: string, opts?: { strict?: boolean }): Workspace`.
  - Default (forgiving, `strict` falsy): **unchanged** behavior — returns `emptyWorkspace()` on any failure. Preserves all internal callers: `use-version-history.ts` (diff/summary), `task-manager.tsx:815` (demo import), `turso-backend.ts:259` (already guards `blob.length>0`).
  - `strict: true`: on `JSON.parse` throw → `throw new WorkspaceParseError("parse")`; on non-object / array → `throw new WorkspaceParseError("shape")`; on missing/non-array `tasks|raid` → `throw new WorkspaceParseError("shape")`. Interior sanitizer throws also propagate (wrapped) instead of collapsing to empty.
  - Note the empty-file case is already handled *upstream*: `local-file-backend.load()` returns `emptyWorkspace()` for `!text.trim()` (line 117) BEFORE reaching the codec, so strict mode only ever sees non-blank content — any parse failure there is genuine corruption.
- `local-file-backend.load()` line 118: `return jsonToWorkspace(text, { strict: true });` and let `WorkspaceParseError` propagate. The existing load orchestration surfaces it as the standard load-failed path (does NOT substitute empty).
- `sharepoint-backend.load()`: replace the raw cast with `jsonToWorkspace(await res.text(), { strict: true })` (fetch text, run the same pipeline). This fixes #10 in the same slice — SharePoint now validates+migrates like every other JSON backend and throws (controlled load-failed) instead of risking a downstream `TypeError`.

**Data flow:** corrupt on-disk/SharePoint JSON → `WorkspaceParseError` → backend `load()` rejects → storage orchestration's load-failed handling (existing `storageLoadFailed` toast + `logDiag`), NOT `emptyWorkspace()`. The real file is never overwritten because the failed load never becomes in-memory state.

**Error handling:** the throw is the fix. Confirm the load path that calls `backend.load()` reports (not swallows) the rejection; if any layer catches-and-empties, route it through `reportSilentFailure`/existing load-error toast.

**Testing:**
- `jsonToWorkspace(truncated, { strict:true })` throws `WorkspaceParseError`; forgiving default returns empty (back-compat pinned).
- Valid workspace round-trips identically in both modes.
- `{}` / non-object / missing `tasks` → strict throws, forgiving empties.
- `local-file-backend.load()` on corrupt JSON rejects (not empty); on `""`/whitespace still returns empty (line-117 guard intact).
- Preserve the ~15 existing `jsonToWorkspace` golden/round-trip test call sites (all default-mode → untouched).

---

## A2 — Non-Turso save failures get a persistent banner + toast *(HIGH, #2)*

**Files:** `task-manager.tsx` (`reportStorageOutcome` ~333, banner gate ~1960, `storageError` state), storage-error banner component, `storage-error.ts`.

**Problem:** the debounced autosave (`use-storage-backend.ts:217-222, 290-293`) calls `onStorageOutcome(err)`; `reportStorageOutcome` only sets `storageError` when `tursoErrorKind(err)` matches, and the sticky banner renders only when `storageConfig.kind === "turso"`. A persistent file/CSV/MD/IDB save failure (revoked FS handle, quota, disk error) from the autosave path shows nothing. (Manual save callbacks at :445/:836 already toast via the `if (!tursoErrorKind(err))` fallback — the gap is the autosave path + the banner.)

**Design (chosen: persistent banner + toast):**
- Widen `storageError` state to `{ kind: StorageErrorKind | "generic" }` (or add a `generic` member to `StorageErrorKind`). `reportStorageOutcome(err)`: if `tursoErrorKind(err)` → set that kind (existing); else set `{ kind: "generic" }`. `null` clears (existing).
- Banner render gate (line ~1960): drop the `&& settings.storageConfig.kind === "turso"` condition — render whenever `storageError` is set and not dismissed. Banner copy is kind-aware: Turso kinds keep their messages; `generic` shows a "changes not saved to <backend>" message with a retry hint. Persists until a save succeeds (`reportStorageOutcome(null)` clears + resets `storageErrorDismissed`).
- Add a one-shot toast on the *first* generic failure (guard against toast spam on repeated autosave failures — only toast on the null→error transition). Reuse `reportSilentFailure(showToast, lang, "storage.autosaveFailed", err, "storageSaveFailed")` or the existing `storageSaveFailed` string.

**i18n:** reuse `storageSaveFailed`; new `storageSaveFailedBanner` (EN/DE) for the persistent banner body if the existing banner strings are Turso-specific.

**Testing:** `reportStorageOutcome(genericErr)` sets `storageError.kind==="generic"`; banner renders in file mode; `reportStorageOutcome(null)` clears; toast fires once per failure episode (not per retry tick).

---

## A3 — Turso switch/create/migrate: surface a failed outgoing-project flush *(HIGH, #3)*

**Files:** `use-storage-turso-ops.ts:58, 81, 121`.

**Problem:** `try { await deps.backend.save(deps.currentWorkspace()); } catch { /* best-effort flush */ }` — a failed pre-switch save (network blip, auth expiry, lock timeout) is fully discarded; the switch proceeds and unsaved outgoing edits are lost with no trace.

**Design (chosen: log + warn toast, proceed):** in each catch, `logDiag("warn", "storage.switchFlushFailed", { message })` and `showToast("info"|"error", t(lang, "storageSwitchFlushFailed", <projectName>))` then continue (non-blocking). The hook `deps` must expose `showToast` + `lang` (thread if not already present; `logDiag` is import-only). Positional `{0}` = outgoing project name where resolvable, else omit.

**i18n:** new `storageSwitchFlushFailed` (EN/DE), e.g. EN "Recent changes to {0} may not have been saved." / DE with real umlauts.

**Testing:** mock `backend.save` reject → assert `logDiag` warn + toast fired AND the switch/create/migrate still completed (proceed semantics).

---

## A4 — Settings-write failure surfaced *(HIGH, #5)*

**Files:** `use-settings.ts` (`writeSettings` ~23-40, persist effect call site ~432).

**Problem:** `writeSettings` swallows `localStorage.setItem` failures (quota / private-browsing) with a bare catch, no return, no log, no toast. Setting changes apply in-memory, look saved, silently revert on reload (incl. AI/Jira/Turso/Timelog config).

**Design:** `writeSettings` returns `boolean` (true=persisted, false=failed) and in the catch calls `logDiag("error", "settings.writeFailed", { message })`. The persist call site checks the return; on false, surface a one-time toast/banner. `writeSettings` itself can't `showToast` (pure-ish, no lang) — the caller (the settings persist effect in a component/hook with `showToast`+`lang`) toasts on false via `reportSilentFailure(showToast, lang, "settings.writeFailed", err, "settingsWriteFailed")`. De-dupe with a "last state was failure" ref so a stuck quota doesn't toast on every keystroke.

**i18n:** new `settingsWriteFailed` (EN/DE).

**Testing:** stub `setItem` to throw → `writeSettings` returns false + `logDiag` error; caller toasts once; success path returns true + no toast. Preserve `writeSettings` as the SOLE `lop-app:settings` writer (do not add a second setItem).

---

## A5 — Bulk-edit Jira guard: per-field (surgical) *(HIGH, #4)*

**Files:** `use-bulk-operations.ts` (`applyBulkEdit`, existing assignee guard ~138-148, apply loop ~150+).

**Problem:** inline row/Kanban controls disable status/drag for `task.jiraKey` rows (Jira owns statusCategory→status, assignee, dates), but bulk edit only replicates that for `assignee`. Bulk status/dueDate/priority edits on synced rows write locally then silently revert (read-only pull) or unexpectedly push (two-way). Local-only fields (blockers/group/inquiriesSent) are preserved by read-only pull, so those ARE safe to bulk-edit.

**Design (chosen: per-field surgical):**
- Define `JIRA_MANAGED_BULK_FIELDS = ["status", "dueDate", "priority", "assignee"]` (the fields Jira owns; align with `issueToTaskFields` patch set).
- In `applyBulkEdit`, when the enabled field set intersects `JIRA_MANAGED_BULK_FIELDS`, count selected `jiraKey` rows and, for those rows, apply ONLY the non-Jira-managed enabled fields (skip the managed ones). Non-synced rows: apply all enabled fields (unchanged).
- Surface a notice when Jira-managed edits were skipped on N synced rows (extend/replace the existing `jiraBulkAssigneeBlocked` alert into a general `jiraBulkManagedFieldsSkipped` with the count + which fields, or keep a single count message).

**i18n:** generalize `jiraBulkAssigneeBlocked` → `jiraBulkManagedFieldsSkipped` (EN/DE) OR add the new key and keep the old.

**Testing:** bulk-edit status+group over a mix of synced/unsynced rows → synced rows get group only (status skipped), unsynced get both; notice reports N synced skipped. Existing single-field assignee-block test still passes (or updated to the general key).

---

## A6 — Sealed-secret decrypt failure ≠ "not configured" *(MEDIUM-HIGH, #9)*

**Files:** `secrets-store.ts:59-67` (`readDeviceSecret`), `secrets.ts:146-157` (`aesDecrypt` throws `SecretUnlockError`).

**Problem:** `readDeviceSecret` catches any error (incl. `SecretUnlockError` from corrupt ciphertext / device-key mismatch after profile change or IDB reset) and returns `null`, identical to "never sealed". Every consumer treats a now-unreadable AI/Turso/Jira/Timelog/STT key as "not configured" — the key silently vanishes with no explanation.

**Design:**
- In `readDeviceSecret`, distinguish: if a sealed record EXISTS (`sealed && sealed.wrap==="device"`) but `aesDecrypt` throws → `logDiag("warn", "secrets.decryptFailed", { id })` and still return `null` (callers stay simple) BUT expose the fact of failure so the load-effect can notify. Minimal-risk approach: return `null` as today + log; add an optional out-of-band signal the hydrate/load effect reads to toast once ("Your saved <X> could not be read — please re-enter it").
- Concretely: add `export async function probeDeviceSecretReadable(id): Promise<"ok"|"empty"|"unreadable">` (or have `hydrateSecretsInto` collect unreadable ids) so the settings load-effect can `reportSilentFailure`/info-toast per unreadable secret id. Keep `readDeviceSecret` returning `string | null` for existing callers.

**i18n:** new `secretUnreadable` (EN/DE) with a `{0}` label for which secret (AI key / Turso token / …).

**Testing:** seal a device secret, corrupt the stored ciphertext → `readDeviceSecret` returns null + `logDiag("warn","secrets.decryptFailed")`; the hydrate path reports it unreadable; a never-sealed id reports "empty" (no toast). No secret value ever logged (assert fields carry only `id`).

---

## A7 — Per-item Outlook push failures reach Diagnostics *(MEDIUM, #29)*

**Files:** `use-entity-calendar-push.ts:69,78,84`, `use-outlook-calendar-push.ts:40,49,55`, `use-committee-outlook-push.ts:56,62,67,73,78`.

**Problem:** per-item create/update/delete failures are `console.warn`-only, then rolled into an aggregate "N failed" toast; the individual failures never hit `logDiag`, so the in-app Diagnostics panel (the sanctioned surface) can't show which items/why.

**Design:** replace/augment each `console.warn(...)` with `logDiag("warn", "calendar.pushItemFailed", { entityType, id, message })`. Keep the aggregate toast for the interactive path (unchanged). Mechanical swap across ~3 files. Background/auto path stays user-silent per AGENTS.md — but now inspectable in Diagnostics.

**Testing:** mock one item push to reject → `logDiag("warn","calendar.pushItemFailed", {entityType,id})` called; aggregate failed-count unchanged. No token/body in fields.

---

## A8 — Version-restore resets UI only on real success *(MEDIUM, #30)*

**Files:** `history-panel.tsx:127-136` (`restoreRecord`, `restoreWholeVersion`), `use-version-history.ts:163-182` (`restore`).

**Problem:** `restore()` never rejects — failures go to `onError?.(err)` and it resolves normally; `restoreRecord` does `void restore(...).then(() => { clear selection/diff/compare state })`, so the UI clears identically whether restore succeeded or silently failed, discarding the user's compare context and hiding that nothing was restored.

**Design:** `restore()` returns `Promise<boolean>` (true=applied, false=failed; keeps `onError` for the toast). Callers only reset UI state on `=== true`; on false, leave selection/diff intact so the user can retry and sees the failure toast in context.

**Testing:** mock the restore apply to fail → `restore()` resolves false, `onError` toast fired, selection/compare state PRESERVED; success → true + state cleared.

---

## A9 — Storage `isReady()` exception logged distinctly *(LOW, #43)*

**Files:** `use-storage-backend.ts:175-184` (`refreshBackendStatus`).

**Problem:** `backend.isReady()`/`describe()` failures are caught bare (`setStorageReady(false); setStorageDescription(null)`) — a genuine exception is indistinguishable from a clean "not ready".

**Design:** add `logDiag("warn", "storage.statusCheckFailed", { message })` inside the catch. Behavior (fallback to not-ready) unchanged.

**Testing:** stub `isReady` to throw → still sets not-ready AND `logDiag` warn fired.

---

## A10 — Remove misleading dead `.catch`; log background auto-sync failures *(LOW, #42)*

**Files:** `use-calendar-auto-sync.ts:26`.

**Problem:** `void push().catch((err) => console.warn("calendar auto-sync failed", err))` is dead — the `push` reconcile wraps its body in try/catch/finally and never rethrows (`interactive:false` suppresses toast). The `.catch` can never run; it misleads about where the silence happens (one layer down, unlogged).

**Design:** remove the dead `.catch`; instead have the background push path `logDiag("warn", "calendar.autoSyncFailed", { entityType, message })` at its actual failure site (still no toast — matches the documented "auto path is user-silent" rule, but now inspectable). If the failure site is inside `useEntityCalendarPush` background mode, add the `logDiag` there guarded on `background`/non-interactive.

**Testing:** background push failure → `logDiag("warn","calendar.autoSyncFailed")` fired, NO toast; assert the dead `.catch` is gone.

---

## Implementation order (within Batch A)

1. **A1** (#1+#10) — critical, foundational, isolated codec + two backends.
2. **A2** (#2) — storage banner generalization.
3. **A3** (#3) — turso switch flush.
4. **A4** (#5) — settings write.
5. **A5** (#4) — bulk Jira guard.
6. **A6** (#9) — secret decrypt.
7. **A7** (#29), **A8** (#30) — calendar/version logDiag + success-gate.
8. **A9** (#43), **A10** (#42) — small logDiag cleanups.

One commit per item (A1…A10). New i18n keys added with EN/DE parity in the same commit that uses them. Full `test:run` + `tsc` + `lint` before each commit. One MR for the batch, released on explicit approval.

## New i18n keys (EN/DE) introduced
`storageSaveFailedBanner` (A2, if needed) · `storageSwitchFlushFailed` (A3) · `settingsWriteFailed` (A4) · `jiraBulkManagedFieldsSkipped` (A5) · `secretUnreadable` (A6). All others reuse existing strings (`storageSaveFailed`, `storageLoadFailed`).
