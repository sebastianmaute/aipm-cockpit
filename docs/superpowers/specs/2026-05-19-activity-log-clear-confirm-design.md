# Activity Log — Confirm Before Clear

**Date:** 2026-05-19

## Problem

The "Clear log" button in the activity log panel fires `handleClearActivityLog` directly. There is no confirmation step, so an accidental click permanently deletes the entire activity history (both in-memory state and localStorage). The codebase already gates similar destructive actions with `window.confirm`:

- `task-manager.tsx:1863` — clear all tasks: `if (!window.confirm(t(lang, "confirmClearAll", tasks.length))) return;`
- `task-manager.tsx:384` — delete a single task: `if (!window.confirm(t(lang, "confirmDelete", id))) return;`

The activity-log clear path is the odd one out.

## Goal

Add a confirmation step in `handleClearActivityLog` that matches the existing two-confirm precedent: native `window.confirm` with an i18n-keyed message that includes the entry count.

## Non-goals

- **Custom-modal confirm.** The existing two confirms use `window.confirm`. Introducing a styled `<Modal>` here only would create inconsistency. Migrating all three confirms to a shared modal is a separate, larger refactor and is out of scope.
- **Wider audit of other destructive actions.** Only `handleClearActivityLog` is in scope; the rest of the app's destructive actions are either already gated or handled elsewhere.
- **Tests.** Neither `handleClearAll` nor `handleDelete` is unit-tested for its confirm gate. The value added by mocking `window.confirm` for this single call is low. The change is purely additive and follows an established pattern.

## Change

Three small edits in three existing files. No new files.

### 1. `src/app/task-manager.tsx`

Replace the current `handleClearActivityLog` body:

```ts
// Before
const handleClearActivityLog = useCallback(() => {
  setActivityLog([]);
  clearActivityLogStorage();
}, []);

// After
const handleClearActivityLog = useCallback(() => {
  if (activityLog.length === 0) return;
  if (!window.confirm(t(lang, "confirmClearActivityLog", activityLog.length))) return;
  setActivityLog([]);
  clearActivityLogStorage();
}, [activityLog.length, lang]);
```

The early-return-on-empty mirrors `handleClearAll` (`task-manager.tsx:1862`). Dependencies grow from `[]` to `[activityLog.length, lang]` because both are now read inside the callback. `setActivityLog` and `clearActivityLogStorage` are stable references and are intentionally not in the dependency array.

### 2. `src/app/i18n.ts`

Add one key near `confirmClearAll`:

```ts
confirmClearActivityLog: "Clear all {0} activity log entries? This cannot be undone.",
```

### 3. `src/app/i18n.de.ts`

Matching German key:

```ts
confirmClearActivityLog: "Alle {0} Aktivitätsprotokoll-Einträge löschen? Dies kann nicht rückgängig gemacht werden.",
```

## Verification

- `npx vitest run` — full suite must remain green (no test touches `handleClearActivityLog`; suite is unaffected).
- `npx tsc --noEmit` — clean. The new i18n key is automatically picked up by `TranslationKey` once defined in both language files.
- **Manual smoke** — open the activity panel with non-empty log. Click "Clear log" → native confirm appears with the entry count. Cancel → log unchanged. Click again → OK → log cleared, button hides (the panel's `entries.length > 0` guard removes it). Switch language to German and repeat → message appears in German.

## Risks & rollback

- **Trivial change.** Three additive edits, no removed code paths.
- **Stale-closure read of `activityLog.length`** — the callback recreates whenever `activityLog.length` changes, so the value passed to `t(...)` is always current. Identity change is harmless: `ActivityLogPanel` re-renders on prop change but does not memoize behaviour against `onClear` identity.
- **Empty-log guard** is defensive; the panel button doesn't render when `entries.length === 0`, so the early-return primarily protects against future call sites (e.g., a keyboard shortcut or chat tool dispatcher).
- **Rollback:** `git revert` the implementation commit. No storage, API, or migration change.

## What this unlocks

- Pattern consistency across the three destructive actions in `task-manager.tsx`.
- If a future slice migrates all three confirms to a shared modal, the three call sites are now uniform and easy to swap.
