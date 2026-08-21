# Guard Transparency (Sub-project A) — Design

**Goal:** Turn high-value *silent failures* — user actions that fail or no-op with zero feedback — into a diagnostic-log entry (sub-project B's `logDiag`) plus a user-facing toast, so users know what happened and support gets evidence.

**Context:** Sub-project A of the three-feature thread (B log → **A transparency** → C dictation). B shipped `logDiag(level, code, fields)` + the diagnostic ring (on `main`). A adds a thin feedback layer over it. Approach 1 (approved): shared helpers + a curated audit list; benign catches stay silent.

**Scope decisions (approved):**
- Feedback for: **silent error swallows** (user action's error dropped) + **capability/config gaps** (feature off/unconfigured, no hint). Mechanism: **text-only toast + `logDiag`**.
- Popout no-ops, input-validation no-ops (button already disabled), best-effort/quota/abort catches → **left silent** (correct as-is).
- A adds ONLY log+toast; it changes **no guard's control flow** and touches no persistence.

---

## Architecture

One tiny React-free module over B + the existing toast:

```
user action fails/no-ops ──▶ reportSilentFailure / reportCapabilityGap ──▶ logDiag(...)  +  showToast(...)
```

Helpers take `showToast` + `lang` as parameters (not context) so they're pure-ish, unit-testable, and callable from both components and hooks (the caller supplies its ambient `showToast`/`lang`).

## Module: `guard-feedback.ts`

```ts
import { logDiag } from "./diagnostics";
import { t, type Lang } from "./i18n";
import type { TranslationKey } from "./i18n"; // whatever the project's key type is; use the type `t`'s 2nd param expects

type ShowToast = (kind: "info" | "error", text: string) => void;

/** A user action FAILED and would otherwise be swallowed. Record the technical
 *  detail to the diagnostic log and tell the user (error toast). */
export function reportSilentFailure(
  showToast: ShowToast, lang: Lang, code: string, err: unknown, msgKey: TranslationKey,
): void {
  logDiag("error", code, { message: err instanceof Error ? err.message : String(err) });
  showToast("error", t(lang, msgKey));
}

/** A user triggered a feature that is OFF / unconfigured. Record it and guide the
 *  user (info toast) instead of a silent no-op. */
export function reportCapabilityGap(
  showToast: ShowToast, lang: Lang, code: string, guidanceKey: TranslationKey,
): void {
  logDiag("warn", code, {});
  showToast("info", t(lang, guidanceKey));
}
```

(If the exact `TranslationKey` type isn't exported, type `msgKey`/`guidanceKey` as the parameter type of `t`'s second argument via `Parameters<typeof t>[1]`.)

## Target sites (from the audit — the whole first slice)

Each row: file · category · diagnostic code · EN message key + text · wiring note. **These are the complete A scope.** Anything not listed stays silent.

### Category 1 — silent error swallows (→ `reportSilentFailure`, error toast)

1. **`diagnostics-panel.tsx`** `copy()` — clipboard write can throw (permission/insecure context); currently `catch { /* no-op */ }`. Code `diagnostics.copyFailed`; key `guardClipboardCopyFailed` = "Couldn't copy to clipboard — check browser permissions and try again." Wire: in the existing `catch`, call `reportSilentFailure(showToast, lang, "diagnostics.copyFailed", e, "guardClipboardCopyFailed")` (panel already has `showToast`+`lang`).

2. **`use-version-history.ts`** `restore()` — `if (!verStr) return;` (payload missing/pruned) returns silently; `history-panel.tsx`'s `.then()` then runs success cleanup, so it *looks* restored. Code `history.restoreVersionMissing`; key `guardRestoreVersionMissing` = "This version could no longer be loaded — nothing was restored." Wire: `restore()` already accepts an `onError` (or add a `onResult(false)`); on the `!verStr` branch call it, and in `history-panel.tsx` toast + `logDiag` via `reportSilentFailure` there (it has `showToast`+`lang`). If the hook lacks an error signal, make `restore()` return `boolean` and have the caller `reportSilentFailure` on `false` (pass a synthetic `Error("version payload missing")`). NOTE: distinct from the already-shipped empty-diff `historyRestoreNothing` toast (that's `loadDiff===0`; this is payload-missing).

3. **`use-comm-templates.ts`** `create`/`upsertField`(rename/saveBody)/`remove`/`setDefault` — `try { await storeX } finally { setBusy(false) }` with **no catch** → unhandled rejection on a Turso write failure. Code `commTemplates.saveFailed`; key `guardCommTemplateSaveFailed` = "Couldn't save the template — your change wasn't stored. Please retry." Wire: at the **call sites in `settings-sections/comm-templates-section.tsx`** (which has `showToast`+`lang`), attach `.catch((e) => reportSilentFailure(showToast, lang, "commTemplates.saveFailed", e, "guardCommTemplateSaveFailed"))` to each fire-and-forget call. (Do not change the hook's control flow.)

4. **`use-timelog-sync.ts`** `fetchBookings` org-scope loop — per-employee failures swallowed → totals silently short, feeding "Apply to budget". Code `timelog.partialFetch`; key `guardTimelogPartialFetch` = "Bookings for {0} employee(s) couldn't be fetched — totals may be incomplete." Wire: count caught failures in the loop; after the loop, if `failed > 0`, surface via the hook's existing feedback path. The hook has no `showToast`; expose the failed count (e.g. add to the returned result or an `error`-like field) and have **`timelog-panel.tsx`** toast it with `reportSilentFailure`-style call (uses positional `{0}` → `t(lang, key, failed)`). If threading is heavy, set the hook's existing `error` state to a structured "partial" marker the panel already renders.

5. **`jira-settings.tsx`** `handleTest` inner `try { listProjects } catch { /* swallow */ }` — status shows "Connected" but the project dropdown silently stays empty. Code `jira.projectListLoadFailed`; key `guardJiraProjectListFailed` = "Connected, but couldn't load your Jira projects — pick one manually or retry." Wire: in that inner catch, `reportSilentFailure(showToast, lang, "jira.projectListLoadFailed", e, "guardJiraProjectListFailed")` (component has `showToast`+`lang`).

6. **`use-comm-template-versions.ts`** `saveVersion`/`removeVersion` — same missing-catch shape as #3; a failed pre-restore checkpoint save is invisible. Code `commTemplateVersions.saveFailed`; key `guardCommVersionSaveFailed` = "Couldn't save this template version." Wire: at the **call sites in `comm-templates-section.tsx`**, `.catch(reportSilentFailure(..., "commTemplateVersions.saveFailed", e, "guardCommVersionSaveFailed"))`.

7. **`use-timelog-sync.ts`** `loadCustomers` — swallowed; picker silently stays "All". Code `timelog.customersLoadFailed`; key `guardTimelogCustomersFailed` = "Couldn't load the customer list — showing all projects instead." Wire: same approach as #4 (surface to `timelog-panel.tsx`, info toast — this one is guidance-ish but is a failure, so error toast is fine; use `reportSilentFailure`).

### Category 2 — capability/config gaps (→ `reportCapabilityGap`, info toast)

8. **`task-manager.tsx`** snapshot/trends handlers (`captureNow`/`rebaselineNow`/`setBaseline`/`deleteSnapshot`/`deleteSnapshots`) — `if (!active) return;` where `active` needs `tursoConfig !== null`; the Trends view can be reachable with Turso `kind` set but config unset/quarantined → every button no-ops silently. Code `trends.notConfigured`; key `guardTrendsNotConfigured` = "Trends needs a connected database — reconnect Turso in Settings to record snapshots." Wire: before each `if (!active) return;` bail (or once at the top of each handler), `reportCapabilityGap(showToast, lang, "trends.notConfigured", "guardTrendsNotConfigured")` (task-manager has `showToast`+`lang`). Fire the toast ONLY on a user-invoked handler, not on effect/derivation paths.

**Deliberately left silent (documented):** popout `isPopout` guards; `saved-views`/`panel-views`/`reports-views`/`secrets-store`/`contacts`/`*-snooze` quota/disabled-storage catches; AbortController aborts; already-toasting calendar push/pull, comm-send, AI-analysis/proposal/weights (errors surfaced by callers); storage load/save/reload (hardened in the data-loss guards). ~12+ tail sites; not in this slice.

## i18n

Eight new keys (EN in `i18n.ts`, DE in `i18n.de.ts` via node utf8 write per the umlaut landmine). `guardTimelogPartialFetch` uses positional `{0}`. DE strings (real umlauts where needed): e.g. `guardTrendsNotConfigured` = "Trends benötigt eine verbundene Datenbank — verbinden Sie Turso in den Einstellungen erneut, um Snapshots aufzuzeichnen."

## Error handling / boundary

- Helpers can't throw meaningfully (`logDiag` swallows; `showToast` is a no-op without a provider). No new failure surface.
- No control-flow change at any site: the guard still returns/handles exactly as before; A only ADDS a `logDiag`+`showToast` alongside.
- No persistence, no exports, no Turso, no new backend paths.

## Testing

- **`guard-feedback.test.ts`:** `reportSilentFailure` → a `logDiag("error", code, {message})` entry appears in `readDiagLog()` AND `showToast` called with `("error", <msg>)`; `reportCapabilityGap` → `logDiag("warn", …)` + `showToast("info", <guidance>)`. Assert the `err` message is captured (and redaction still applies — a secret in the message is scrubbed by B's `redactFields`).
- **Wired-site integration (2–3):** force `navigator.clipboard.writeText` to reject in the diagnostics panel → error toast shown + `diagnostics.copyFailed` logged; a comm-template save rejection → `guardCommTemplateSaveFailed` toast; a trends handler with `active=false` → `guardTrendsNotConfigured` info toast.
- i18n EN/DE parity (tsc) + `i18n-encoding` (no ASCII umlaut subs).

## Out of scope

- The tail (~12+) low-value silent sites (follow-up slice if wanted).
- Extending the toast contract with action buttons/deep-links (decided against — text-only).
- Sub-project C (dictation).
