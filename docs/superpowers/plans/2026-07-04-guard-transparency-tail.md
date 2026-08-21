# Guard Transparency Tail (A-tail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the 8 remaining silent-failure/capability-gap sites to A's `guard-feedback` helpers (or, on the recovery pages, a `setMessage` + `logDiag`), fixing four ignored-return bugs where a failed reset/restore/download currently claims success.

**Architecture:** Reuse `reportSilentFailure`/`reportCapabilityGap` (`guard-feedback.ts`) at toast-scope call sites; on `recovery-panel.tsx`/`recovery-banner.tsx` (no ToastProvider) call `logDiag` + set the failure message and stop claiming success. Additive feedback; the recovery + FX changes also fix real correctness bugs.

**Tech Stack:** TypeScript, React 19, vitest. No new deps/secret/proxy/CSP.

**Verify:** tests `npm run test:run -- <file>` · typecheck `npx tsc --noEmit` (i18n parity) · lint `npm run lint`. ★★ i18n.de.ts: node utf8 write, never Edit.

---

## Task 1: i18n keys (do first)

**Files:** Modify `src/app/i18n.ts` (Edit) + `src/app/i18n.de.ts` (node write)

- [ ] **Step 1:** Add 7 keys to `i18n.ts` (EN):
```ts
  guardMsSignInFailed: "Microsoft sign-in didn't complete. Check for a blocked pop-up and try again.",
  guardRecoveryResetFailed: "Reset didn't complete — your configuration may still be broken. Try again or use the manual steps below.",
  guardRecoveryRestoreFailed: "Restore didn't complete — the backup may be corrupt or storage is unavailable.",
  guardRecoveryBackupDownloadFailed: "Couldn't download the backup file. Copy the on-screen data manually before resetting.",
  guardFxRefreshFailed: "Couldn't refresh exchange rates. Currency conversions may be stale or missing.",
  guardExportFailed: "Export failed — nothing was downloaded. Please try again.",
  guardJiraIssueTypesFailed: "Couldn't load issue types for this project. Jira sync may not pick up the types you expect — try reselecting the project.",
```
- [ ] **Step 2:** Same 7 keys in `i18n.de.ts` via node utf8 write (same anchor position), umlauts as \uXXXX:
```
  guardMsSignInFailed: "Die Microsoft-Anmeldung wurde nicht abgeschlossen. Prüfen Sie, ob ein Pop-up blockiert wurde, und versuchen Sie es erneut.",
  guardRecoveryResetFailed: "Zurücksetzen nicht abgeschlossen — Ihre Konfiguration ist möglicherweise weiterhin fehlerhaft. Versuchen Sie es erneut oder nutzen Sie die manuellen Schritte unten.",
  guardRecoveryRestoreFailed: "Wiederherstellung nicht abgeschlossen — die Sicherung ist möglicherweise beschädigt oder der Speicher nicht verfügbar.",
  guardRecoveryBackupDownloadFailed: "Sicherungsdatei konnte nicht heruntergeladen werden. Kopieren Sie die angezeigten Daten manuell, bevor Sie zurücksetzen.",
  guardFxRefreshFailed: "Wechselkurse konnten nicht aktualisiert werden. Währungsumrechnungen sind möglicherweise veraltet oder fehlen.",
  guardExportFailed: "Export fehlgeschlagen — es wurde nichts heruntergeladen. Bitte versuchen Sie es erneut.",
  guardJiraIssueTypesFailed: "Vorgangstypen für dieses Projekt konnten nicht geladen werden. Die Jira-Synchronisierung erfasst möglicherweise nicht die erwarteten Typen — wählen Sie das Projekt erneut aus.",
```
- [ ] **Step 3:** `npx tsc --noEmit` → 0 (parity); `npm run test:run -- i18n-encoding` → PASS; grep DE umlauts.
- [ ] **Step 4: Commit** `git add src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat(guard-tail): i18n messages"`

---

## Task 2: recovery reset/restore/download (#2 #4 #7) — fix ignored returns

**Files:** Modify `src/app/recovery-panel.tsx`

Context: `quarantineConfig()` returns `{ ok: boolean; id }`; `restoreConfig(id)` returns `boolean`; `downloadJson` swallows. All discard the result + claim success. `lang` is `readPersistedLang()` in scope; `message`/`setMessage` exist. Add `import { logDiag } from "./diagnostics";`.

- [ ] **Step 1:** `onReset` (near line 82) — currently:
```tsx
  const onReset = () => {
    quarantineConfig();
    setMessage(t(lang, "recoveryResetDone"));
    ...
  };
```
Change to check the result:
```tsx
  const onReset = () => {
    const r = quarantineConfig();
    if (!r.ok) {
      logDiag("error", "recovery.resetFailed", {});
      setMessage(t(lang, "guardRecoveryResetFailed"));
      return;
    }
    setMessage(t(lang, "recoveryResetDone"));
    ... (keep the rest of the success path)
  };
```

- [ ] **Step 2:** `onRestore` (near line 88) — currently `restoreConfig(latest.id); setMessage(recoveryRestoreDone);`. Change:
```tsx
    if (!restoreConfig(latest.id)) {
      logDiag("error", "recovery.restoreFailed", {});
      setMessage(t(lang, "guardRecoveryRestoreFailed"));
      return;
    }
    setMessage(t(lang, "recoveryRestoreDone"));
```

- [ ] **Step 3:** `downloadJson` (line 44) currently returns `void` and swallows in a try/catch. Change it to `function downloadJson(...): boolean` returning `true` on success, `false` in the catch. Then `onDownload` (line 99) — currently `const onDownload = () => downloadJson("lop-config.json", exportConfig());` — change to:
```tsx
  const onDownload = () => {
    if (!downloadJson("lop-config.json", exportConfig())) {
      logDiag("error", "recovery.backupDownloadFailed", {});
      setMessage(t(lang, "guardRecoveryBackupDownloadFailed"));
    }
  };
```

- [ ] **Step 4: Test** — `recovery-panel.test.tsx`: mock `quarantineConfig`→`{ok:false,id:null}` → assert `setMessage`/rendered message is the failure key text (not success) + a `readDiagLog()` `recovery.resetFailed` event; mock `restoreConfig`→`false` → failure message + `recovery.restoreFailed`. (If the existing test asserts the success message on these paths, that's the bug — update it.)
- [ ] **Step 5:** `npm run test:run -- recovery-panel` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 6: Commit** `git add src/app/recovery-panel.tsx src/app/recovery-panel.test.tsx && git commit -m "fix(guard-tail): recovery reset/restore/download surface real failures"`

---

## Task 3: recovery-banner reset (#3)

**Files:** Modify `src/app/recovery-banner.tsx`

Context: `onResetNow` (line 13) does `quarantineConfig();` and ignores the result; the banner has `lang` but no message state. Add minimal failure feedback.

- [ ] **Step 1:** Add `import { logDiag } from "./diagnostics";` + a local error state. Change `onResetNow`:
```tsx
  const [failed, setFailed] = useState(false);
  const onResetNow = () => {
    const r = quarantineConfig();
    if (!r.ok) { logDiag("error", "recovery.resetFailed", {}); setFailed(true); return; }
    ... (keep the existing success behavior — navigate/reload etc.)
  };
```
Render the failure inline (palette-safe) when `failed`:
```tsx
  {failed && <span className="text-xs text-AIPM-pink-strong">{t(lang, "guardRecoveryResetFailed")}</span>}
```
(place it in the banner's control row; import `useState` if not already).

- [ ] **Step 2: Test** — `recovery-banner.test.tsx`: mock `quarantineConfig`→`{ok:false}` → clicking reset renders the failure text + logs `recovery.resetFailed`; success path unchanged.
- [ ] **Step 3:** `npm run test:run -- recovery-banner` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/recovery-banner.tsx src/app/recovery-banner.test.tsx && git commit -m "fix(guard-tail): recovery banner surfaces a failed reset"`

---

## Task 4: export failure (#6)

**Files:** Modify `src/app/export-menu.tsx` + `src/app/task-manager.tsx`

Context: both `void exportWorkspace(...)` (export-menu:72, task-manager:1320) can throw (dynamic import / builder) with no catch. Wire `.catch` at both. Add `import { reportSilentFailure } from "./guard-feedback";` where missing; ensure `showToast`+`lang` in scope (task-manager has both; export-menu — add `const showToast = useToastContext();` + import if absent).

- [ ] **Step 1 (export-menu.tsx:72):** change `void exportWorkspace(...)` to:
```tsx
      void exportWorkspace({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates }, format, exportConfig, lang)
        .catch((e) => reportSilentFailure(showToast, lang, "export.failed", e, "guardExportFailed"));
```
- [ ] **Step 2 (task-manager.tsx:1320):** change `void exportWorkspace(ws, ...)` to:
```tsx
      void exportWorkspace(ws, format as ExportFormat, settings.export ?? defaultExportConfig, lang)
        .catch((e) => reportSilentFailure(showToast, lang, "export.failed", e, "guardExportFailed"));
```
- [ ] **Step 3: Test** — `export-menu.test.tsx` (or nearest): mock `exportWorkspace` to reject; trigger an export; assert (via `vi.waitFor`) a `readDiagLog()` `export.failed` event or `showToast("error", ...)`.
- [ ] **Step 4:** `npm run test:run -- export-menu` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run size:check` → ok (task-manager +1-2 lines; fold if it trips).
- [ ] **Step 5: Commit** `git add src/app/export-menu.tsx src/app/task-manager.tsx src/app/export-menu.test.tsx && git commit -m "feat(guard-tail): surface export failures"`

---

## Task 5: FX refresh failure (#5)

**Files:** Modify `src/app/use-fx-rates.ts` + `src/app/task-manager.tsx`

Context: `useFxRates` returns `{ loading, error, refresh }`; `refresh` catches internally and only sets `error` state (so a `.catch` at the call site can't see it). Make `refresh` RESOLVE with the error string (or null), and toast at the call site.

- [ ] **Step 1 (use-fx-rates.ts):** change `refresh` to return the error. It currently does something like `try { ...; setError(null) } catch (e) { setError(msg) }`. Make it `async (): Promise<string | null>` returning the error message on failure, `null` on success:
```ts
  const refresh = useCallback(async (): Promise<string | null> => {
    try {
      ... existing fetch/parse ...
      setError(null);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return msg;
    }
  }, [/* existing deps */]);
```
(Keep the existing `error` state for any existing consumer; just add the return.)

- [ ] **Step 2 (task-manager.tsx):** the FX refresh is threaded as `onRefreshFx: refreshFx` (line ~1606). Wrap it to toast on failure. Add `import { reportSilentFailure } from "./guard-feedback";` (if not already). Change the wiring to:
```ts
    onRefreshFx: async () => {
      const err = await refreshFx();
      if (err) reportSilentFailure(showToast, lang, "fx.refreshFailed", new Error(err), "guardFxRefreshFailed");
    },
```
(task-manager has `showToast`+`lang`.)

- [ ] **Step 3: Test** — `use-fx-rates.test.ts` (or nearest): mock the fetch to reject → `refresh()` resolves to the error string (not null); success → null. If a task-manager-level test is feasible, assert the toast; otherwise the unit return-value test suffices.
- [ ] **Step 4:** `npm run test:run -- use-fx-rates` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 5: Commit** `git add src/app/use-fx-rates.ts src/app/task-manager.tsx src/app/use-fx-rates.test.ts && git commit -m "feat(guard-tail): surface FX refresh failures"`

---

## Task 6: M365 sign-in + Jira issue-types (#1 #8)

**Files:** Modify `src/app/storage-config.tsx`, `src/app/task-manager.tsx`, `src/app/settings-sections/integrations-section.tsx` (M365 call sites) + `src/app/jira-settings.tsx`

- [ ] **Step 1 (#1 M365):** at each `void auth.signIn()` / `void msAuth.signOut()` / `void auth.signOut()` call site that has `showToast`+`lang` in scope (`storage-config.tsx:246`, `task-manager.tsx:2131`, and the `integrations-section.tsx` sign-in/out buttons), attach a `.catch`:
```tsx
    void auth.signIn().catch((e) => reportSilentFailure(showToast, lang, "msauth.signInFailed", e, "guardMsSignInFailed"));
```
Add `import { reportSilentFailure } from "./guard-feedback";` (or `../guard-feedback` for the section) + `useToastContext` where a `showToast` isn't already present. Grep each file for how `showToast`/`lang` are obtained and match it. Use the same key for signIn and signOut.

- [ ] **Step 2 (#8 Jira):** `jira-settings.tsx` project-key-change effect (`catch` near line 85) currently silently `setIssueTypes([])`. Add feedback in the catch (component has `showToast`+`lang` — see Task from the first A pass which added `reportSilentFailure` import here already, or add it):
```tsx
      } catch (e) {
        setIssueTypes([]);
        reportSilentFailure(showToast, lang, "jira.issueTypesLoadFailed", e, "guardJiraIssueTypesFailed");
      }
```
Keep the `setIssueTypes([])` (don't change behavior) — just ADD the report.

- [ ] **Step 3: Test** — jira-settings test: mock `listIssueTypes` to reject on a project change → assert a `jira.issueTypesLoadFailed` diag event / error toast. For M365, add the smallest viable test at one call site (mock `auth.signIn` reject → error toast/diag) if a harness exists; otherwise verify via tsc/lint + note.
- [ ] **Step 4:** `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run test:run -- jira-settings storage-config integrations-section` → PASS.
- [ ] **Step 5: Commit** `git add <the 4 files + tests> && git commit -m "feat(guard-tail): surface M365 sign-in + Jira issue-type load failures"`

---

## Final verification
- [ ] `npx tsc --noEmit` → 0 · `npm run lint` → 0 · `npm run test:run` → full green · `npm run size:check` → ok · `npm run dup:check` → within 2.4
- [ ] Grep: every wired site imports the right helper; recovery sites use `logDiag`+`setMessage` (NOT the toast helpers); no control-flow change beyond the recovery/FX correctness fixes.
- [ ] Confirm the four ignored-return bugs are fixed: a failed `quarantineConfig`/`restoreConfig`/download no longer shows the success message.

Then follow **superpowers:finishing-a-development-branch**.
