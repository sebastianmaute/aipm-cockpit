# Guard Transparency (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn 8 high-value silent-failure / capability-gap sites into a diagnostic-log entry + a user toast, via two shared helpers over sub-project B's `logDiag`.

**Architecture:** A React-free `guard-feedback.ts` exposes `reportSilentFailure` (log error + error toast) and `reportCapabilityGap` (log warn + guidance toast); the caller supplies its ambient `showToast`+`lang`. Each of the 8 audit-identified sites is wired additively — no guard's control flow changes.

**Tech Stack:** TypeScript, React 19, forked Next.js, vitest. Depends on `src/app/diagnostics.ts` (`logDiag`) already on main.

**Verify commands:** tests `npm run test:run -- <file>` · typecheck `npx tsc --noEmit` (enforces i18n EN/DE parity) · lint `npm run lint`.

★★ i18n.de.ts LANDMINE: patch `src/app/i18n.de.ts` via a node utf8 write (\uXXXX for umlauts), matching CRLF `\r\n`. NEVER use the Edit tool on it. `i18n.ts` (EN) is Edit-safe.

---

## File Structure

- Create `src/app/guard-feedback.ts` — the two helpers.
- Modify `src/app/i18n.ts` + `src/app/i18n.de.ts` — 8 message keys.
- Modify (additive log+toast only): `diagnostics-panel.tsx`, `use-version-history.ts`, `settings-sections/comm-templates-section.tsx`, `jira-settings.tsx`, `task-manager.tsx`, `timelog-panel.tsx` (+ possibly `use-timelog-sync.ts` to surface a count).

---

## Task 1: guard-feedback helpers

**Files:** Create `src/app/guard-feedback.ts` + `src/app/guard-feedback.test.ts`

- [ ] **Step 1: Failing test** (`src/app/guard-feedback.test.ts`)

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { reportSilentFailure, reportCapabilityGap } from "./guard-feedback";
import { readDiagLog } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("guard-feedback", () => {
  it("reportSilentFailure logs an error event + shows an error toast", () => {
    const showToast = vi.fn();
    reportSilentFailure(showToast, "en-US", "test.failed", new Error("boom"), "guardClipboardCopyFailed");
    const log = readDiagLog();
    expect(log[0].level).toBe("error");
    expect(log[0].code).toBe("test.failed");
    expect(log[0].fields!.message).toBe("boom");
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("reportCapabilityGap logs a warn event + shows an info toast", () => {
    const showToast = vi.fn();
    reportCapabilityGap(showToast, "en-US", "test.gap", "guardTrendsNotConfigured");
    const log = readDiagLog();
    expect(log[0].level).toBe("warn");
    expect(log[0].code).toBe("test.gap");
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("captures a non-Error rejection reason as a string", () => {
    const showToast = vi.fn();
    reportSilentFailure(showToast, "en-US", "test.failed", "plain string", "guardClipboardCopyFailed");
    expect(readDiagLog()[0].fields!.message).toBe("plain string");
  });
});
```
(These reference keys created in Task 2; run Task 2 first OR accept the test fails on the missing key until Task 2 — to keep TDD clean, DO TASK 2 BEFORE Task 1's Step 2. Reorder: implement i18n keys first, then this.)

- [ ] **Step 2: Implement** (`src/app/guard-feedback.ts`)

```ts
// Thin user-transparency layer over the diagnostic log (diagnostics.ts). Turns a
// silent guard bail into a logged event + a user toast. Helpers take showToast +
// lang as params so they work from both components and hooks. No control flow here.
import { logDiag } from "./diagnostics";
import { t, type Lang, type TranslationKey } from "./i18n";

type ShowToast = (kind: "info" | "error", text: string) => void;

/** A user action FAILED and would otherwise be swallowed: log the technical
 *  detail + tell the user (error toast). */
export function reportSilentFailure(
  showToast: ShowToast,
  lang: Lang,
  code: string,
  err: unknown,
  msgKey: TranslationKey,
): void {
  logDiag("error", code, { message: err instanceof Error ? err.message : String(err) });
  showToast("error", t(lang, msgKey));
}

/** A user triggered an OFF/unconfigured feature: log + guide the user (info toast). */
export function reportCapabilityGap(
  showToast: ShowToast,
  lang: Lang,
  code: string,
  guidanceKey: TranslationKey,
): void {
  logDiag("warn", code, {});
  showToast("info", t(lang, guidanceKey));
}
```

- [ ] **Step 3:** `npm run test:run -- guard-feedback` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/guard-feedback.ts src/app/guard-feedback.test.ts && git commit -m "feat(guard): shared silent-failure/capability-gap feedback helpers"`

---

## Task 2: i18n message keys (do FIRST, before Task 1 Step 2)

**Files:** Modify `src/app/i18n.ts` (Edit) + `src/app/i18n.de.ts` (node utf8 write)

- [ ] **Step 1:** Add these 8 keys to `i18n.ts` (EN), grouped together after any stable anchor key:

```ts
  guardClipboardCopyFailed: "Couldn't copy to clipboard — check browser permissions and try again.",
  guardRestoreVersionMissing: "This version could no longer be loaded — nothing was restored.",
  guardCommTemplateSaveFailed: "Couldn't save the template — your change wasn't stored. Please retry.",
  guardTimelogPartialFetch: "Bookings for {0} employee(s) couldn't be fetched — totals may be incomplete.",
  guardJiraProjectListFailed: "Connected, but couldn't load your Jira projects — pick one manually or retry.",
  guardCommVersionSaveFailed: "Couldn't save this template version.",
  guardTimelogCustomersFailed: "Couldn't load the customer list — showing all projects instead.",
  guardTrendsNotConfigured: "Trends needs a connected database — reconnect Turso in Settings to record snapshots.",
```

- [ ] **Step 2:** Add the SAME keys to `i18n.de.ts` via a node utf8 script (\uXXXX for umlauts, match `\r\n`, same anchor position):

```
  guardClipboardCopyFailed: "Kopieren in die Zwischenablage nicht möglich — prüfen Sie die Browser-Berechtigungen und versuchen Sie es erneut.",
  guardRestoreVersionMissing: "Diese Version konnte nicht mehr geladen werden — es wurde nichts wiederhergestellt.",
  guardCommTemplateSaveFailed: "Vorlage konnte nicht gespeichert werden — Ihre Änderung wurde nicht gespeichert. Bitte erneut versuchen.",
  guardTimelogPartialFetch: "Buchungen für {0} Mitarbeiter konnten nicht abgerufen werden — die Summen sind möglicherweise unvollständig.",
  guardJiraProjectListFailed: "Verbunden, aber Ihre Jira-Projekte konnten nicht geladen werden — wählen Sie manuell oder versuchen Sie es erneut.",
  guardCommVersionSaveFailed: "Diese Vorlagenversion konnte nicht gespeichert werden.",
  guardTimelogCustomersFailed: "Kundenliste konnte nicht geladen werden — es werden alle Projekte angezeigt.",
  guardTrendsNotConfigured: "Trends benötigt eine verbundene Datenbank — verbinden Sie Turso in den Einstellungen erneut, um Snapshots aufzuzeichnen.",
```

- [ ] **Step 3:** `npx tsc --noEmit` → 0 (EN/DE parity); `npm run test:run -- i18n-encoding` → PASS (no ASCII umlaut subs); grep DE umlauts intact.
- [ ] **Step 4: Commit** `git add src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat(guard): i18n messages for guard-transparency sites"`

---

## Task 3: Wire #1 diagnostics-panel copy failure

**File:** Modify `src/app/diagnostics-panel.tsx`

- [ ] **Step 1:** Read the `copy` handler. It currently is:
```tsx
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticBundle());
      showToast("info", t(lang, "diagnosticsCopied"));
    } catch { /* clipboard blocked — no-op */ }
  };
```
Change the catch to capture the error and report it:
```tsx
    } catch (e) {
      reportSilentFailure(showToast, lang, "diagnostics.copyFailed", e, "guardClipboardCopyFailed");
    }
```
Add `import { reportSilentFailure } from "./guard-feedback";`.

- [ ] **Step 2: Test** — add to `src/app/diagnostics-panel.test.tsx`:
```tsx
  it("reports a clipboard copy failure", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) } });
    logDiag("info", "seed"); // ensure ring exists
    render(<DiagnosticsPanel lang="en-US" />);
    fireEvent.click(screen.getByRole("button", { name: /copy diagnostic bundle/i }));
    await vi.waitFor(() => expect(readDiagLog().some((e) => e.code === "diagnostics.copyFailed")).toBe(true));
  });
```
(import `vi` + `readDiagLog` if not already imported; this test needs a ToastProvider-free render — the panel uses `useToastContext` which no-ops without a provider, fine.)

- [ ] **Step 3:** `npm run test:run -- diagnostics-panel` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/diagnostics-panel.tsx src/app/diagnostics-panel.test.tsx && git commit -m "feat(guard): surface diagnostics copy failure"`

---

## Task 4: Wire #2 version-restore payload-missing

**File:** Modify `src/app/use-version-history.ts`

Context: `restore` (near line 167) does `const verStr = await loadVersionPayload(...); if (!verStr) return;` — the silent path. Its `catch (err) { onError?.(err); }` already routes real errors to `onError`. Route the payload-missing case the same way.

- [ ] **Step 1:** Change `if (!verStr) return;` to:
```ts
      if (!verStr) { onError?.(new Error("version payload could not be loaded")); return; }
```

- [ ] **Step 2:** Confirm the `onError` consumer surfaces it. Grep for where `useVersionHistory` is instantiated (likely `task-manager.tsx`) and read its `onError`. If `onError` already shows a toast/logs, DONE — the payload-missing now flows through it. If `onError` is absent or a no-op at that instantiation, wire it to `reportSilentFailure(showToast, lang, "history.restoreVersionMissing", err, "guardRestoreVersionMissing")` there (the instantiation site has `showToast`+`lang`). Do NOT change the existing loop-safety of the `onError` identity (keep it stable — see the file's comment about churn; if you must add a handler, wrap it in the same stable ref pattern already used).

- [ ] **Step 3: Test** — add to `src/app/use-version-history.test.ts` (or the nearest existing test for this hook): render/drive `restore` with a `loadVersionPayload` mocked to resolve `null` (or `""`) and an `onError` spy; assert `onError` is called once. If mocking `loadVersionPayload` is hard, add a focused test that asserts the `!verStr` branch calls `onError` (mirror how the existing catch test, if any, is structured).

- [ ] **Step 4:** `npm run test:run -- use-version-history` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 5: Commit** `git add src/app/use-version-history.ts <consumer if changed> <test> && git commit -m "feat(guard): surface version-restore payload-missing"`

---

## Task 5: Wire #3 + #6 comm-template CRUD failures

**File:** Modify `src/app/settings-sections/comm-templates-section.tsx`

Context: `use-comm-templates.ts` handlers (`create`/`upsertField`/`remove`/`setDefault`) and `use-comm-template-versions.ts` (`saveVersion`/`removeVersion`) have `try/finally` with NO catch; the section calls them fire-and-forget. Attach `.catch(...)` at the call sites (the section has `showToast`+`lang`).

- [ ] **Step 1:** Read the section. For each call to a comm-templates mutator (create/rename/saveBody/remove/setDefault) add a `.catch`:
```tsx
    void create(...).catch((e) => reportSilentFailure(showToast, lang, "commTemplates.saveFailed", e, "guardCommTemplateSaveFailed"));
```
For each comm-template-version mutator (saveVersion/removeVersion):
```tsx
    void saveVersion(...).catch((e) => reportSilentFailure(showToast, lang, "commTemplateVersions.saveFailed", e, "guardCommVersionSaveFailed"));
```
Add `import { reportSilentFailure } from "../guard-feedback";`. Apply to EVERY mutator call in the section (create, rename, save-body, remove, set-default, save-version, remove-version). If a call is already awaited inside a try/catch that toasts, leave it.

- [ ] **Step 2: Test** — in the section's test file (or a new `comm-templates-section` test), mock the hook so `create` rejects; render, trigger create, assert a `commTemplates.saveFailed` diag event (via `readDiagLog`) or that `showToast` was called with the error kind. Use `vi.waitFor` for the async catch.

- [ ] **Step 3:** `npm run test:run -- comm-templates` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/settings-sections/comm-templates-section.tsx <test> && git commit -m "feat(guard): surface comm-template + version save failures"`

---

## Task 6: Wire #5 jira project-list load failure

**File:** Modify `src/app/jira-settings.tsx`

Context: `handleTest` has an inner `try { listProjects } catch { /* swallow */ }` after a successful auth test.

- [ ] **Step 1:** Change that inner catch to:
```tsx
      } catch (e) {
        reportSilentFailure(showToast, lang, "jira.projectListLoadFailed", e, "guardJiraProjectListFailed");
      }
```
Add `import { reportSilentFailure } from "./guard-feedback";`. Confirm `showToast`+`lang` are in scope in this component (grep — jira-settings shows toasts elsewhere).

- [ ] **Step 2: Test** — in `jira-settings` test: mock the project-list call to reject after a successful test; assert a `jira.projectListLoadFailed` diag event or an error toast. If the component test harness is heavy, at minimum add a targeted test that the catch path calls `reportSilentFailure` (spy).

- [ ] **Step 3:** `npm run test:run -- jira-settings` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 4: Commit** `git add src/app/jira-settings.tsx <test> && git commit -m "feat(guard): surface jira project-list load failure"`

---

## Task 7: Wire #8 trends capability gap

**File:** Modify `src/app/task-manager.tsx`

Context: the snapshot/trends handlers (`captureNow`/`rebaselineNow`/`setBaseline`/`deleteSnapshot`/`deleteSnapshots`) start with `if (!active) return;` and are invoked by user clicks in the Trends panel. Add a capability-gap toast on that bail — ONLY in these user-invoked handlers.

- [ ] **Step 1:** For each of those handlers, change `if (!active) return;` to:
```ts
    if (!active) { reportCapabilityGap(showToast, lang, "trends.notConfigured", "guardTrendsNotConfigured"); return; }
```
Add `import { reportCapabilityGap } from "./guard-feedback";`. Confirm `showToast`+`lang` are in scope in task-manager (they are — used widely). Do NOT touch the `if (!active) return;` guards in the effect/derivation paths (the debounced capture effect near line 55, refresh, etc.) — only the user-invoked action handlers.

- [ ] **Step 2:** Because task-manager is baselined at the file-size ratchet limit, run `npm run size:check` after — if it now exceeds, fold lines (combine the guard onto one line as shown) to stay at/under baseline; do NOT `--update` the baseline for this if a fold suffices.

- [ ] **Step 3: Test** — the task-manager characterization test may not cover these handlers directly. Add a focused unit test if a seam exists; otherwise verify via `npx tsc --noEmit` + `npm run lint` + a manual note. Do not weaken existing tests.

- [ ] **Step 4:** `npm run test:run -- task-manager` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run size:check` → ok.
- [ ] **Step 5: Commit** `git add src/app/task-manager.tsx && git commit -m "feat(guard): hint when Trends is used without a connected database"`

---

## Task 8: Wire #4 + #7 timelog partial fetch + customers load

**Files:** Modify `src/app/use-timelog-sync.ts` + `src/app/timelog-panel.tsx`

Context: `fetchBookings` org loop swallows per-employee failures; `loadCustomers` swallows its failure. The hook has no `showToast`. Surface a count/flag the panel can toast.

- [ ] **Step 1 (#4):** In `use-timelog-sync.ts` `fetchBookings`, count caught per-employee failures into a local `let failedEmployees = 0;` (increment in the existing per-employee catch). Return that count in the hook's result (extend the returned object / the resolved value of `fetchBookings` with `failedEmployees`), OR store it in a new state the hook already exposes. Choose the path with the smallest surface — if `fetchBookings` returns a result object, add `failedEmployees` to it.

- [ ] **Step 2 (#4):** In `timelog-panel.tsx`, at the call site that awaits `fetchBookings`, after success, if `failedEmployees > 0` call:
```tsx
    reportSilentFailure(showToast, lang, "timelog.partialFetch", new Error(`${failedEmployees} employees failed`), "guardTimelogPartialFetch");
```
BUT the message needs the count interpolated — `guardTimelogPartialFetch` uses `{0}`. So instead of `reportSilentFailure` (which has no interpolation), call directly:
```tsx
    if (failedEmployees > 0) {
      logDiag("warn", "timelog.partialFetch", { failedEmployees });
      showToast("error", t(lang, "guardTimelogPartialFetch", failedEmployees));
    }
```
Add imports `logDiag` from `./diagnostics`, `t` from `./i18n` (likely already imported in the panel).

- [ ] **Step 3 (#7):** For `loadCustomers`: simplest is to wire at the panel call site too. If `loadCustomers` is called on picker focus in the panel, wrap it: `void loadCustomers().catch((e) => reportSilentFailure(showToast, lang, "timelog.customersLoadFailed", e, "guardTimelogCustomersFailed"));`. If the swallow is entirely inside the hook with no rejection surfacing, add a `failedCustomers` boolean to the hook result and toast in the panel like Step 2. Prefer the `.catch` at the call site if `loadCustomers` can reject.

- [ ] **Step 4: Test** — in `use-timelog-sync` test: drive `fetchBookings` (org scope) with one employee call rejecting; assert the returned `failedEmployees === 1`. In `timelog-panel` test (if feasible): assert a `timelog.partialFetch` diag/toast when the count is >0.

- [ ] **Step 5:** `npm run test:run -- use-timelog-sync timelog-panel` → PASS; `npx tsc --noEmit` → 0; `npm run lint` → 0.
- [ ] **Step 6: Commit** `git add src/app/use-timelog-sync.ts src/app/timelog-panel.tsx <tests> && git commit -m "feat(guard): surface timelog partial fetch + customers load failures"`

---

## Final verification (before finishing the branch)

- [ ] `npx tsc --noEmit` → 0 · `npm run lint` → 0 · `npm run test:run` → full green · `npm run size:check` → ok · `npm run dup:check` → within 2.4
- [ ] Grep-confirm every new site imports and calls the right helper; no control-flow change (each guard still returns/handles as before).
- [ ] Manual smoke: block clipboard → copy shows the error toast + `diagnostics.copyFailed` in `window.__lopDiag()`; open Trends with Turso unconfigured → the hint toast fires.

Then follow **superpowers:finishing-a-development-branch**.
